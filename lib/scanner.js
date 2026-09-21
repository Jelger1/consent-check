/**
 * De kernflow per URL:
 *
 *   1. ruwe HTML ophalen (gewone HTTP-fetch, voor de iframe-vergelijking);
 *   2. schone browsercontext, navigeren, wachten tot het netwerk rustig is;
 *   3. meting 1: cookies, requests, DOM (iframes, scripts, dataLayer, CMP-status);
 *   4. consent geven via de API van de CMP (of zijn officiële knop); is er geen
 *      banner, dan is dat het antwoord en blijft het bij meting 1;
 *   5. opnieuw wachten, meting 2.
 *
 * Alles wat tot aan een fout gemeten is, blijft bewaard: een scan die bij
 * stap 4 strandt levert nog steeds meting 1 en de CMP-analyse op, maar met
 * status "mislukt" en de stap erbij. Stilzwijgend doorgaan zonder consent zou
 * een meting 2 opleveren die niets betekent.
 */

import { verrijkRequests } from './analyse.js';
import { bepaalHuisstijl } from './branding.js';
import { LOCALE, VIEWPORT, maakSchoneContext, startBrowser, userAgentVoor, vangStoringenAf, volgInitiators, volgNetwerk, wachtOpRustigNetwerk } from './browser.js';
import { herkenBlokkade } from './stealth.js';
import { beschrijfMethode, geefConsent } from './cmp/consent.js';
import { CMP_DOM_IDS, consentAlGegeven, detecteerCmps } from './cmp/detect.js';
import { siteDomeinen } from './domain.js';
import { haalHtmlOp, ontleedHtml } from './html.js';
import { snapshotCookies, snapshotDom } from './snapshot.js';
import { fail, seconden } from './util.js';

export async function scanUrl(url, instellingen, log = () => {}) {
  const w = instellingen.wachttijden;
  const gestart = Date.now();
  const scan = {
    url,
    eind_url: null,
    gescand_op: new Date(gestart).toISOString(),
    duur_ms: 0,
    status: 'mislukt',
    fout: null,
    waarschuwingen: [],
    browser: null,
    blokkade: null,
    storingen: [],
    huisstijl: null,
    html: null,
    meting1: null,
    cmps: [],
    consent: null,
    meting2: null,
  };

  let browser = null;
  let context = null;

  const stealth = instellingen.stealth !== false;

  try {
    browser = await startBrowser({ headless: instellingen.headless, stealth });
    const userAgent = userAgentVoor(browser);
    scan.browser = {
      engine: 'chromium',
      bron: browser.__bron || 'onbekend',
      versie: browser.version(),
      headless: instellingen.headless,
      stealth,
      user_agent: userAgent,
      viewport: VIEWPORT,
      locale: LOCALE,
    };

    // 1. Ruwe HTML. Mislukt dit, dan gaat de scan door: alleen regel 8 valt weg.
    try {
      const { html, ...meta } = await haalHtmlOp(url, { userAgent, timeoutMs: w.html_timeout_ms });
      scan.html = { ...meta, ontleed: ontleedHtml(html) };
      log(`HTML opgehaald: status ${meta.status}, ${Math.round(meta.lengte / 1024)} KB, ${scan.html.ontleed.aantal_scripts} scripts, ${scan.html.ontleed.aantal_iframes} iframes`);
    } catch (error) {
      scan.waarschuwingen.push(error.message);
      log(`! ${error.message} De iframe-vergelijking (regel 8) valt weg.`);
    }

    // 2. Navigeren in een verse context.
    context = await maakSchoneContext(browser, { userAgent, stealth });
    const page = await context.newPage();
    // Dialogs, pop-ups en crashes afvangen vóór de eerste navigatie: een site
    // die meteen een `alert()` doet, zou de scan anders laten hangen.
    scan.storingen = vangStoringenAf(context, page);
    const tracker = volgNetwerk(context);
    try {
      await volgInitiators(context, page, tracker);
    } catch (error) {
      scan.waarschuwingen.push(`Request-initiators niet beschikbaar: ${error.message}`);
    }

    tracker.gestart = Date.now();
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: w.navigatie_timeout_ms });
    } catch (error) {
      // De gewone HTTP-fetch uit stap 1 weet vaak wél wat er aan de hand is.
      // Gaf die een 4xx, dan is dit geen netwerkprobleem maar een blokkade, en
      // dat is een bruikbaarder antwoord dan "time-out".
      const htmlStatus = scan.html?.status;
      const beveiliging = herkenBlokkade({ status: htmlStatus ?? null, headers: {}, titel: '', tekst: '' });
      if (htmlStatus && htmlStatus >= 400) {
        scan.blokkade = {
          geblokkeerd: true,
          twijfel: false,
          soort: 'navigatie_geblokkeerd',
          beveiliging: beveiliging.beveiliging,
          status: htmlStatus,
          melding: `De site antwoordde met status ${htmlStatus} en liet de browser niet toe (${error.message.split('\n')[0]}).`,
        };
        throw fail('navigatie', `De site weigert de scanner: status ${htmlStatus} op de gewone aanvraag, en de browser kwam niet binnen (${error.message.split('\n')[0]}). `
          + 'Dit is een blokkade van de site zelf, geen fout in de tool. Controleer de site handmatig of vraag de beheerder om toegang.');
      }
      throw fail('navigatie', `Navigeren naar ${url} mislukt: ${error.message.split('\n')[0]}`);
    }
    const responseHeaders = await response?.allHeaders().catch(() => ({})) ?? {};
    scan.eind_url = page.url();
    const domeinen = siteDomeinen(url, scan.eind_url);

    const wacht1 = await wachtOpRustigNetwerk(page, tracker, {
      minimaalMs: w.minimaal_voor_consent_ms,
      maximaalMs: w.maximaal_ms,
      rustMs: w.netwerk_rust_ms,
    });

    // 3. Meting 1.
    scan.meting1 = await meet({ context, page, tracker, domeinen, fase: 'voor_consent', wachttijd: wacht1, navigatieStatus: response?.status() ?? null });
    scan.cmps = detecteerCmps({ html: scan.html?.ontleed || null, dom: scan.meting1.dom, requests: scan.meting1.requests, cookies: scan.meting1.cookies });
    log(beschrijfMeting('Meting 1 (vóór consent)', scan.meting1));

    // Kregen we de site, of een blokkade- of challenge-pagina? Dat laatste is
    // geen meting: de rest van het rapport zou dan over de blokkade gaan.
    // "Geen cookiebanner" zou daar de gevaarlijkste conclusie zijn.
    const paginatekst = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    scan.blokkade = herkenBlokkade({
      status: scan.meting1.navigatie_status,
      headers: responseHeaders,
      titel: scan.meting1.dom?.titel || '',
      tekst: paginatekst.slice(0, 4000),
      aantalRequests: tracker.aantal_gezien.voor_consent,
    });
    if (scan.blokkade.geblokkeerd || scan.blokkade.twijfel) {
      const melding = scan.blokkade.geblokkeerd ? `Let op: ${scan.blokkade.melding}` : scan.blokkade.melding;
      scan.waarschuwingen.push(melding);
      log(scan.blokkade.geblokkeerd ? `! ${melding}` : melding);
    }

    // Is er tijdens het wachten al geaccepteerd (meestal een klik in een
    // zichtbaar browservenster)? Dan is meting 1 geen nulmeting meer. De scan
    // gaat door, maar het rapport zegt er nu bij dat de cijfers scheef staan.
    scan.meting1.consent_al_gegeven = consentAlGegeven(scan.meting1.dom);
    if (scan.meting1.consent_al_gegeven.gegeven) {
      const { cmp, detail } = scan.meting1.consent_al_gegeven;
      const melding = `Let op: er was vóór meting 1 al consent gegeven (${cmp}: ${detail}). `
        + 'Alles wat daarna vuurde staat nu onder "vóór consent", en "ná consent" laat vrijwel geen verschil meer zien. '
        + 'Dit gebeurt als er tijdens de scan in het browservenster geklikt wordt; de tool accepteert zelf, dus laat het venster met rust.';
      scan.waarschuwingen.push(melding);
      log(`! ${melding}`);
    }
    log(`CMP's herkend: ${scan.cmps.length ? scan.cmps.map((cmp) => `${cmp.naam}${cmp.actief ? '' : ' (alleen in HTML)'}`).join(', ') : 'geen'}`);

    // Huisstijl van de site aflezen vóór consent: de pagina is dan nog in de
    // staat die de bezoeker als eerste ziet, en de banner heeft het logo nog
    // niet weggedrukt. Puur voor het PDF-rapport; mislukt het, dan gaat de
    // scan gewoon door met de Pure Minds-kleuren.
    try {
      scan.huisstijl = await bepaalHuisstijl(page, context);
    } catch (error) {
      scan.waarschuwingen.push(`Huisstijl van de site aflezen mislukt: ${error.message.split('\n')[0]}`);
    }

    // 4. Consent. `voorAccept` zet de fase om vlak vóór de eerste acceptatie,
    // zodat alleen wat daarná gebeurt als "ná consent" telt.
    try {
      scan.consent = await geefConsent(page, context, {
        timeoutMs: w.consent_timeout_ms,
        cmps: scan.cmps,
        voorAccept: () => { tracker.fase = 'na_consent'; },
      });
    } catch (error) {
      const actief = scan.cmps.filter((cmp) => cmp.actief).map((cmp) => cmp.naam);
      throw fail('consent', `${error.message} Herkende CMP's: ${actief.length ? actief.join(', ') : 'geen'}.`, { geprobeerd: error.geprobeerd || [] });
    }

    if (!scan.consent.gegeven) {
      // Niets te accepteren: dan is meting 1 het hele verhaal. Geen fout, wel duidelijk gemeld.
      log(`Geen consent-stap: ${scan.consent.reden}`);
    } else {
      log(`Consent gegeven via ${beschrijfMethode(scan.consent)} in ${seconden(scan.consent.duur_ms)}`);
      for (const poging of scan.consent.geprobeerd.filter((p) => !p.gelukt && p.reden)) log(`  (${poging.cmp}: ${poging.reden})`);

      // 5. Meting 2.
      const wacht2 = await wachtOpRustigNetwerk(page, tracker, {
        minimaalMs: w.minimaal_na_consent_ms,
        maximaalMs: w.maximaal_ms,
        rustMs: w.netwerk_rust_ms,
      });
      scan.meting2 = await meet({ context, page, tracker, domeinen, fase: 'na_consent', wachttijd: wacht2, navigatieStatus: null });
      log(beschrijfMeting('Meting 2 (ná consent)', scan.meting2));
    }

    scan.status = 'geslaagd';
  } catch (error) {
    scan.fout = { stap: error.stap || 'onbekend', melding: error.message, ...(error.geprobeerd ? { geprobeerd: error.geprobeerd } : {}) };
    log(`! Mislukt bij stap "${scan.fout.stap}": ${error.message}`);
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  scan.duur_ms = Date.now() - gestart;
  return scan;
}

async function meet({ context, page, tracker, domeinen, fase, wachttijd, navigatieStatus }) {
  const cookies = await snapshotCookies(context, domeinen);
  const dom = await snapshotDom(page, { cmpIds: CMP_DOM_IDS });
  const requests = verrijkRequests(tracker.requests.filter((request) => request.fase === fase), domeinen, tracker.initiators);
  return { wachttijd, navigatie_status: navigatieStatus, cookies, dom, requests };
}

function beschrijfMeting(label, meting) {
  const extern = meting.requests.filter((request) => request.is_extern).length;
  const rust = meting.wachttijd.netwerk_rustig ? 'rustig' : 'NIET rustig (maximum bereikt)';
  return `${label}: ${meting.cookies.length} cookies, ${meting.requests.length} requests (${extern} extern), ${meting.dom.iframes.length} iframes; netwerk ${rust} na ${seconden(meting.wachttijd.gewacht_ms)}`;
}
