/* =============================================================================
   server.js — serveert de interface en draait de scans
   -----------------------------------------------------------------------------
   Kleine server zonder dependencies. De interface is statisch; de scan zelf
   draait hier, want Playwright start een echte Chromium en kan dus niet in de
   browser of op een serverless functie draaien.

   POST /api/pdf     een rapport als body -> het PDF-verslag terug.
   GET  /api/health  -> of de scanner klaarstaat (Playwright en Chromium aanwezig).
                        De interface vraagt dit bij het laden, zodat hij meteen
                        kan uitleggen wat er ontbreekt.
   POST /api/scan    {"urls": [...], "headed": false}
                     -> NDJSON: één gebeurtenis per regel, zodat de interface
                        kan meelezen terwijl de scan loopt (een halve minuut per URL).

   Omgevingsvariabelen:
     PORT   poort om op te luisteren (standaard 3000)
   ============================================================================= */

import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDAARD_WACHTTIJDEN, laadConfig, normaliseerUrl } from '../lib/config.js';
import { bouwRapport, schrijfRapport } from '../lib/report.js';
import { seconden } from '../lib/util.js';

const PROJECTMAP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.env.PORT, 10) || 3000;
// Alleen bereikbaar vanaf deze machine: de tool start een browser en bezoekt
// websites, dat hoort niemand anders op het netwerk te kunnen aanzwengelen.
const HOST = process.env.HOST || '127.0.0.1';
const MAX_URLS = 25;
const MAX_BODY_BYTES = 64 * 1024;
// Een rapport is 250 tot 400 KB; de PDF-endpoint krijgt er een heel rapport in.
const MAX_PDF_BODY_BYTES = 12 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Wat de browser mag ophalen. Bewust een lijst van wat mág in plaats van een
 * lijst van wat niet mag: zo komt er nooit per ongeluk een configuratie-,
 * rapport- of broncodebestand mee als het project groeit.
 */
const UI_BESTANDEN = new Set(['/index.html', '/styles.css', '/app.js']);
const UI_MAPPEN = ['/assets/'];

/** Eén scan tegelijk: elke scan start een eigen Chromium, parallel draaien vertekent de meting. */
let bezet = false;

/**
 * Of alles klaarstaat om te kunnen scannen. Wordt bij het opstarten gevuld en
 * via /api/health aan de interface doorgegeven, zodat die meteen kan zeggen
 * wat er ontbreekt in plaats van pas bij de eerste scan een fout te geven.
 */
let omgeving = { klaar: false, code: 'nog_niet_gecontroleerd', melding: 'Omgeving wordt gecontroleerd.' };

/**
 * Playwright wordt pas geladen als er echt gescand wordt. Zo start de server
 * (en dus de uitleg in de interface) ook op als `npm install` nog niet gedraaid
 * heeft — precies het geval waarin de gebruiker die uitleg nodig heeft.
 */
let scannerModule = null;

async function laadScanner() {
  if (!scannerModule) scannerModule = await import('../lib/scanner.js');
  return scannerModule.scanUrl;
}

/** Staat Playwright er, en is Chromium gedownload? Beide zijn een aparte stap. */
async function controleerOmgeving() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    if (/cannot find (module|package)/i.test(error.message)) {
      return { klaar: false, code: 'geen_playwright', melding: 'Playwright is nog niet geïnstalleerd. Draai eerst: npm install' };
    }
    return { klaar: false, code: 'playwright_fout', melding: `Playwright kon niet geladen worden: ${error.message.split('\n')[0]}` };
  }

  try {
    const pad = chromium.executablePath();
    if (!existsSync(pad)) {
      return { klaar: false, code: 'geen_browser', melding: 'Chromium is nog niet gedownload. Draai eenmalig: npm run browser' };
    }
    return { klaar: true, code: 'klaar', melding: 'Klaar om te scannen.' };
  } catch (error) {
    return { klaar: false, code: 'geen_browser', melding: `Chromium is nog niet gedownload (${error.message.split('\n')[0]}). Draai eenmalig: npm run browser` };
  }
}

// --- Statische bestanden -------------------------------------------------------

async function serveStatic(req, res) {
  let urlPad;
  try {
    urlPad = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    urlPad = '/';
  }
  if (urlPad === '/') urlPad = '/index.html';

  // Eerst het pad platslaan (../ eruit), dan pas toetsen: anders komt
  // "/assets/../config.json" ongemerkt door de lijst heen.
  const bestand = normalize(join(PROJECTMAP, urlPad));
  const rel = relative(PROJECTMAP, bestand);
  const genormaliseerd = `/${rel.split(sep).join('/')}`;
  const toegestaan = UI_BESTANDEN.has(genormaliseerd) || UI_MAPPEN.some((map) => genormaliseerd.startsWith(map));
  if (rel.startsWith('..') || !toegestaan) {
    stuurTekst(res, 404, 'Niet gevonden');
    return;
  }

  try {
    const info = await stat(bestand);
    if (!info.isFile()) throw new Error('geen bestand');
    const ext = extname(bestand).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': info.size,
      // De interface verandert tijdens het ontwikkelen; afbeeldingen niet.
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(bestand).pipe(res);
  } catch {
    stuurTekst(res, 404, 'Niet gevonden');
  }
}

// --- De scan-endpoint ------------------------------------------------------------

async function handleScan(req, res) {
  let body;
  try {
    body = JSON.parse(await leesBody(req));
  } catch (error) {
    stuurJson(res, 400, { error: `Ongeldige aanvraag: ${error.message}`, code: 'ongeldige_aanvraag' });
    return;
  }

  const invoer = Array.isArray(body?.urls) ? body.urls : [];
  if (invoer.length === 0) {
    stuurJson(res, 400, { error: 'Geef minstens één URL op.', code: 'geen_urls' });
    return;
  }
  if (invoer.length > MAX_URLS) {
    stuurJson(res, 413, { error: `Maximaal ${MAX_URLS} URL's per scan.`, code: 'te_veel_urls' });
    return;
  }

  const genormaliseerd = invoer.map(normaliseerUrl);
  const ongeldig = genormaliseerd.filter((url) => !url.ok);
  if (ongeldig.length) {
    stuurJson(res, 400, {
      error: `Geen geldige URL: ${ongeldig.map((url) => url.invoer).join(', ')}`,
      code: 'ongeldige_url',
    });
    return;
  }

  if (!omgeving.klaar) {
    // Opnieuw kijken: misschien heeft de gebruiker `npm run browser` gedraaid
    // terwijl de server al aan stond.
    omgeving = await controleerOmgeving();
    if (!omgeving.klaar) {
      stuurJson(res, 503, { error: omgeving.melding, code: omgeving.code });
      return;
    }
  }

  if (bezet) {
    stuurJson(res, 409, { error: 'Er draait al een scan. Wacht tot die klaar is.', code: 'bezet' });
    return;
  }
  bezet = true;

  const config = await laadConfig();
  const instellingen = {
    headless: body.headed ? false : config.headless !== false,
    wachttijden: { ...STANDAARD_WACHTTIJDEN, ...(config.wachttijden || {}) },
  };
  const outputMap = resolve(PROJECTMAP, config.output_map || 'output');

  // NDJSON: één gebeurtenis per regel. Geen buffering onderweg, anders komt de
  // log pas aan als de hele scan klaar is.
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });

  const stuur = (gebeurtenis) => res.write(`${JSON.stringify(gebeurtenis)}\n`);
  let afgebroken = false;
  req.on('close', () => {
    // De browser is weg (tab gesloten, pagina ververst). De lopende scan maken
    // we af — Chromium netjes afsluiten scheelt achtergebleven processen —
    // maar we beginnen niet aan de volgende URL.
    if (!res.writableEnded) afgebroken = true;
  });

  try {
    const scanUrl = await laadScanner();

    for (const [index, { url }] of genormaliseerd.entries()) {
      if (afgebroken) break;
      stuur({ type: 'start', url, nummer: index + 1, totaal: genormaliseerd.length });
      console.log(`> ${url}`);

      const scan = await scanUrl(url, instellingen, (melding) => {
        console.log(`  - ${melding}`);
        stuur({ type: 'log', url, melding });
      });

      const rapport = bouwRapport(scan, instellingen);
      try {
        const pad = await schrijfRapport(rapport, outputMap);
        rapport.bestand = relative(PROJECTMAP, pad).split(sep).join('/');
        console.log(`  ${rapport.status === 'geslaagd' ? 'OK' : 'MISLUKT'} -> ${pad} (${seconden(scan.duur_ms)})`);
      } catch (error) {
        // Het rapport zelf is er al; alleen het wegschrijven mislukte.
        rapport.waarschuwingen.push(`Rapport kon niet worden opgeslagen: ${error.message}`);
        console.error(`  ! Opslaan mislukt: ${error.message}`);
      }
      stuur({ type: 'rapport', url, rapport });
    }
    stuur({ type: 'klaar', afgebroken });
  } catch (error) {
    console.error('Scan mislukt:', error);
    stuur({ type: 'fout', melding: `Onverwachte fout: ${error.message}` });
  } finally {
    bezet = false;
    res.end();
  }
}

/**
 * POST /api/pdf met een rapport als body -> de PDF als download.
 *
 * De interface heeft het rapport al in het geheugen, dus die stuurt het mee.
 * Zo werkt de knop ook voor een scan die uit localStorage is teruggehaald,
 * zonder dat de server rapporten hoeft te bewaren of op te zoeken.
 */
async function handlePdf(req, res) {
  let rapport;
  try {
    rapport = JSON.parse(await leesBody(req, MAX_PDF_BODY_BYTES));
  } catch (error) {
    stuurJson(res, 400, { error: `Ongeldig rapport: ${error.message}`, code: 'ongeldige_aanvraag' });
    return;
  }
  if (!rapport || !rapport.url || !rapport.gescand_op) {
    stuurJson(res, 400, { error: 'Dit lijkt geen consent-check-rapport.', code: 'ongeldig_rapport' });
    return;
  }

  const { maakPdf, pdfBestandsnaam } = await import('../lib/pdf.js');
  const bytes = await maakPdf(rapport);
  const naam = pdfBestandsnaam(rapport);
  console.log(`  PDF gemaakt: ${naam} (${Math.round(bytes.length / 1024)} KB)`);
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': bytes.length,
    'Content-Disposition': `attachment; filename="${naam}"`,
    'Cache-Control': 'no-store',
  });
  res.end(bytes);
}

function leesBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (stuk) => {
      data += stuk;
      if (data.length > maxBytes) {
        reject(new Error('aanvraag te groot'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data || '{}'));
    req.on('error', reject);
  });
}

// --- Antwoorden ------------------------------------------------------------------

function stuurJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function stuurTekst(res, status, tekst) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(tekst);
}

// --- Server ------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  // /health is er voor hostingplatforms, /api/health voor de interface.
  if (req.url === '/health' || req.url === '/api/health') {
    stuurJson(res, 200, { ok: true, bezet, ...omgeving, versie: '1.0.0' });
    return;
  }
  if (req.url === '/api/pdf') {
    if (req.method !== 'POST') {
      stuurJson(res, 405, { error: 'Alleen POST wordt ondersteund.', code: 'verkeerde_methode' });
      return;
    }
    handlePdf(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) stuurJson(res, 500, { error: error.message, code: 'pdf_fout' });
      else res.end();
    });
    return;
  }
  if (req.url === '/api/scan') {
    if (req.method !== 'POST') {
      stuurJson(res, 405, { error: 'Alleen POST wordt ondersteund.', code: 'verkeerde_methode' });
      return;
    }
    handleScan(req, res).catch((error) => {
      bezet = false;
      console.error(error);
      if (!res.headersSent) stuurJson(res, 500, { error: error.message, code: 'server_fout' });
      else res.end();
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    stuurTekst(res, 405, 'Methode niet toegestaan');
    return;
  }
  serveStatic(req, res);
});

// Een scan duurt een halve minuut per URL en er kunnen er 25 in één aanvraag.
// De standaardtime-outs van Node zouden die verbinding halverwege verbreken.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;

/** Opent de interface in de standaardbrowser, zodat `npm start` genoeg is. */
function openBrowser(adres) {
  const commando = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', adres]]
    : process.platform === 'darwin'
      ? ['open', [adres]]
      : ['xdg-open', [adres]];
  try {
    spawn(commando[0], commando[1], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Geen browser beschikbaar (bijvoorbeeld in een container): het adres staat in de console.
  }
}

server.listen(PORT, HOST, async () => {
  const adres = `http://localhost:${PORT}`;
  omgeving = await controleerOmgeving();

  console.log(`\nConsent-check draait op ${adres}`);
  if (omgeving.klaar) {
    console.log('Klaar om te scannen. Sluit dit venster om te stoppen.\n');
  } else {
    // Geen harde stop: de interface draait wel en legt uit wat er moet gebeuren.
    console.log(`\n  LET OP: ${omgeving.melding}`);
    console.log('  De interface werkt al wel en laat zien wat er nog moet gebeuren.\n');
  }

  // Alleen lokaal: op een server is er geen browser om te openen.
  if (HOST === '127.0.0.1' && !process.env.NO_OPEN) openBrowser(adres);
});
