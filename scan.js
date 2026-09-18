#!/usr/bin/env node
/**
 * consent-check: meet per website wat er vóór en ná cookie-consent gebeurt.
 *
 *   node scan.js                          alle URL's uit config.json
 *   node scan.js https://klant.nl [...]   alleen deze URL's (instellingen uit config.json)
 *   node scan.js --config pad.json        andere configuratie
 *   node scan.js --output map             andere uitvoermap
 *   node scan.js --headed                 browser zichtbaar, handig bij debuggen
 *
 * Per URL komt er één JSON-bestand in de uitvoermap. De exitcode is 1 zodra
 * één scan mislukt, zodat een pipeline of script dat ziet.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { bouwRapport, samenvatting, schrijfRapport } from './lib/report.js';
import { scanUrl } from './lib/scanner.js';
import { seconden } from './lib/util.js';

const PROJECTMAP = dirname(fileURLToPath(import.meta.url));

/**
 * Standaardwachttijden. Vertraagde tags (Meta Pixel via GTM-trigger, lazy
 * embeds) vuren soms pas na een paar seconden; vandaar een minimum van tien
 * seconden vóór consent, los van of het netwerk al rustig is.
 */
const STANDAARD_WACHTTIJDEN = {
  minimaal_voor_consent_ms: 10_000,
  minimaal_na_consent_ms: 8_000,
  maximaal_ms: 30_000,
  netwerk_rust_ms: 2_000,
  navigatie_timeout_ms: 45_000,
  consent_timeout_ms: 15_000,
  html_timeout_ms: 20_000,
};

const HELP = `consent-check: meet per website wat er vóór en ná cookie-consent gebeurt.

Gebruik:
  node scan.js [opties] [url ...]

Opties:
  --config <pad>   configuratiebestand (standaard: config.json naast scan.js)
  --output <map>   uitvoermap voor de JSON-rapporten (standaard: output)
  --headed         browser zichtbaar laten draaien
  -h, --help       deze uitleg

Zonder URL's op de commandoregel worden de URL's uit het configuratiebestand gescand.`;

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      config: { type: 'string' },
      output: { type: 'string' },
      headed: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const config = await laadConfig(values.config);
  const urls = (positionals.length ? positionals : config.urls || []).map(normaliseerUrl);
  const ongeldig = urls.filter((url) => !url.ok);
  if (ongeldig.length) {
    console.error(`Ongeldige URL('s): ${ongeldig.map((url) => url.invoer).join(', ')}`);
    return 2;
  }
  if (!urls.length) {
    console.error('Geen URL\'s om te scannen. Geef ze mee op de commandoregel of zet ze in config.json onder "urls".');
    return 2;
  }

  const instellingen = {
    headless: values.headed ? false : config.headless !== false,
    wachttijden: { ...STANDAARD_WACHTTIJDEN, ...(config.wachttijden || {}) },
  };
  const outputMap = resolve(values.output || config.output_map || 'output');

  console.log(`consent-check: ${urls.length} URL('s), browser ${instellingen.headless ? 'headless' : 'zichtbaar'}, rapporten in ${outputMap}`);

  let mislukt = 0;
  for (const { url } of urls) {
    console.log(`\n> ${url}`);
    const scan = await scanUrl(url, instellingen, (regel) => console.log(`  - ${regel}`));
    const rapport = bouwRapport(scan, instellingen);
    const pad = await schrijfRapport(rapport, outputMap);
    console.log(samenvatting(rapport));
    console.log(`  ${rapport.status === 'geslaagd' ? 'OK' : 'MISLUKT'} -> ${pad} (${seconden(scan.duur_ms)})`);
    if (rapport.status !== 'geslaagd') mislukt += 1;
  }

  console.log(`\nKlaar: ${urls.length - mislukt} van ${urls.length} scan(s) geslaagd.`);
  return mislukt ? 1 : 0;
}

async function laadConfig(pad) {
  const bestand = pad ? resolve(pad) : join(PROJECTMAP, 'config.json');
  try {
    return JSON.parse(await readFile(bestand, 'utf-8'));
  } catch (error) {
    if (!pad && error.code === 'ENOENT') return {};
    throw new Error(`Configuratie ${bestand} kan niet gelezen worden: ${error.message}`);
  }
}

/** Accepteert ook "www.klant.nl": marketeers kopiëren adressen vaak zonder https://. */
function normaliseerUrl(invoer) {
  const tekst = String(invoer).trim();
  const metSchema = /^https?:\/\//i.test(tekst) ? tekst : `https://${tekst}`;
  try {
    const url = new URL(metSchema);
    return { ok: /^https?:$/.test(url.protocol) && !!url.hostname, invoer: tekst, url: url.href };
  } catch {
    return { ok: false, invoer: tekst, url: null };
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`Onverwachte fout: ${error.stack || error.message}`);
    process.exit(1);
  });
