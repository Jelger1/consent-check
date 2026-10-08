/**
 * De kernflow per URL:
 *
 *   1. ruwe HTML ophalen (gewone HTTP-fetch, voor de iframe-vergelijking);
 *   2. schone browsercontext, navigeren, wachten tot het netwerk rustig is;
 *   3. meting 1: cookies, opslag, requests, DOM (iframes, scripts, dataLayer,
 *      CMP-status), en de banner zelf bekijken zonder te klikken;
 *   4. consent geven via de API van de CMP (of zijn officiële knop); is er geen
 *      banner, dan is dat het antwoord en blijft het bij meting 1;
 *   5. opnieuw wachten, meting 2; dan herladen met consent, meting 3, en kijken
 *      of de keuze later nog te wijzigen is;
 *   6. DNS: wijzen eigen subdomeinen naar een trackingdienst (CNAME)?
 *   7. weigeren: een tweede, schone browser die alles weigert, en meet wat er
 *      daarna (ook na herladen) nog gebeurt.
 *
 * Alles wat tot aan een fout gemeten is, blijft bewaard: een scan die bij
 * stap 4 strandt levert nog steeds meting 1, de CMP-analyse, de DNS-controle
 * en het weigeren-scenario op, maar met status "mislukt" en de stap erbij.
 * Stilzwijgend doorgaan zonder consent zou een meting 2 opleveren die niets
 * betekent.
 */

import { promises as dnsPromises } from 'node:dns';
import { verrijkCookies, verrijkRequests } from './analyse.js';
import { bepaalHuisstijl } from './branding.js';
import { LOCALE, VIEWPORT, maakSchoneContext, startBrowser, userAgentVoor, vangStoringenAf, volgInitiators, volgNetwerk, wachtOpRustigNetwerk } from './browser.js';
import { herkenBlokkade } from './stealth.js';
import { beschrijfMethode, geefConsent, inspecteerBanner, weigerConsent, zoekIntrekmogelijkheid } from './cmp/consent.js';
import { CMP_DOM_IDS, consentAlGegeven, detecteerCmps } from './cmp/detect.js';
import { hostVan, siteDomeinen } from './domain.js';
import { haalHtmlOp, ontleedHtml } from './html.js';
import { snapshotCookies, snapshotDom, snapshotOpslag } from './snapshot.js';
import { fail, seconden } from './util.js';

/** Een DNS-vraag mag de scan nooit ophouden. */
const DNS_TIMEOUT_MS = 3000;
/** Meer eigen subdomeinen dan dit is ongebruikelijk; de rest slaan we over. */
const MAX_DNS_HOSTS = 15;

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
    banner: null,
    consent: null,
    meting2: null,
    meting3: null,
    intrekken: null,
    dns: null,
    weigeren: null,
  };

  let browser = null;
  let context = null;
  let tracker = null;
  let domeinen = null;
  let userAgent = null;

  const stealth = instellingen.stealth !== false;

  try {
    try {
      browser = await startBrowser({ headless: instellingen.headless, stealth });
      userAgent = userAgentVoor(browser);
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
      tracker = volgNetwerk(context);
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
      domeinen = siteDomeinen(url, scan.eind_url);

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

      // De banner zoals een bezoeker hem als eerste ziet: welke knoppen, vakjes
      // vooraf aan, blokkeert hij de site. Er wordt niets aangeklikt.
      if (!scan.blokkade.geblokkeerd) {
        try {
          scan.banner = await inspecteerBanner(page);
          if (scan.banner.gevonden) log(beschrijfBanner(scan.banner));
        } catch (error) {
          scan.banner = { gevonden: null, fout: error.message.split('\n')[0] };
        }
      }

      // Huisstijl van de site aflezen vóór consent: de pagina is dan nog in de
      // staat die de bezoeker als eerste ziet, en de banner heeft het logo nog
      // niet weggedrukt. Puur voor het PDF-rapport; mislukt het, dan gaat de
      // scan gewoon door.
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

        // Meting 3: herladen mét consent. Veel tags vuren pas bij een nieuwe
        // paginaweergave; zonder deze meting lijken die "stil" na consent.
        try {
          tracker.fase = 'na_herladen';
          const herladen = await page.reload({ waitUntil: 'domcontentloaded', timeout: w.navigatie_timeout_ms });
          const wacht3 = await wachtOpRustigNetwerk(page, tracker, {
            minimaalMs: w.minimaal_na_herladen_ms ?? w.minimaal_na_consent_ms,
            maximaalMs: w.maximaal_ms,
            rustMs: w.netwerk_rust_ms,
          });
          scan.meting3 = await meet({ context, page, tracker, domeinen, fase: 'na_herladen', wachttijd: wacht3, navigatieStatus: herladen?.status() ?? null });
          log(beschrijfMeting('Meting 3 (herladen met consent)', scan.meting3));
        } catch (error) {
          scan.waarschuwingen.push(`Herladen na consent mislukt: ${error.message.split('\n')[0]}. Regel 4 rust daardoor alleen op meting 2.`);
        }

        // Kan de bezoeker zijn keuze later nog wijzigen?
        scan.intrekken = await zoekIntrekmogelijkheid(page).catch(() => null);
        if (scan.intrekken) log(scan.intrekken.gevonden ? `Keuze later te wijzigen via ${scan.intrekken.hoe}` : 'Geen manier gevonden om de keuze later te wijzigen');
      }

      scan.status = 'geslaagd';
    } catch (error) {
      scan.fout = { stap: error.stap || 'onbekend', melding: error.message, ...(error.geprobeerd ? { geprobeerd: error.geprobeerd } : {}) };
      log(`! Mislukt bij stap "${scan.fout.stap}": ${error.message}`);
    }

    if (context) await context.close().catch(() => {});
    context = null;

    // 6. DNS: wijzen eigen subdomeinen naar een trackingdienst? Over alle
    // requests van de scan, want een server-side endpoint krijgt soms pas ná
    // consent iets.
    if (tracker && domeinen && scan.eind_url) {
      scan.dns = await controleerCnames(verrijkRequests(tracker.requests, domeinen, null), hostVan(scan.eind_url));
      const herkend = scan.dns.filter((item) => item.cname.length);
      if (herkend.length) log(`DNS: ${herkend.map((item) => `${item.host} -> ${item.cname.join(' -> ')}`).join(', ')}`);
    }

    // 7. Weigeren, in een aparte schone browser. Alleen als er iets te weigeren
    // valt: een banner die we zagen, of een consent-stap die erop stuitte.
    const bannerGezien = scan.banner?.gevonden || scan.consent?.gegeven || scan.fout?.stap === 'consent';
    if (browser && instellingen.weigeren !== false && scan.meting1 && !scan.blokkade?.geblokkeerd && bannerGezien) {
      try {
        scan.weigeren = await scanWeigeren({ browser, url, userAgent, stealth, domeinen, cmps: scan.cmps, w });
        log(beschrijfWeigeren(scan.weigeren));
      } catch (error) {
        scan.weigeren = { fout: error.message.split('\n')[0] };
        log(`! Weigeren-scenario mislukt: ${scan.weigeren.fout}`);
      }
    }
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  scan.duur_ms = Date.now() - gestart;
  return scan;
}

/**
 * Het weigeren-scenario: schone context, navigeren, wachten, alles weigeren,
 * wachten, herladen, en meten wat er ná het weigeren nog gebeurde. Alle
 * requests na de klik tellen, ook die na het herladen: een tag die bij de
 * volgende pagina alsnog vuurt, negeert de keuze net zo goed.
 */
async function scanWeigeren({ browser, url, userAgent, stealth, domeinen, cmps, w }) {
  const context = await maakSchoneContext(browser, { userAgent, stealth });
  try {
    const page = await context.newPage();
    vangStoringenAf(context, page);
    const tracker = volgNetwerk(context);
    tracker.fase = 'voor_weigeren';
    tracker.gestart = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: w.navigatie_timeout_ms });
    await wachtOpRustigNetwerk(page, tracker, { minimaalMs: w.minimaal_voor_consent_ms, maximaalMs: w.maximaal_ms, rustMs: w.netwerk_rust_ms });

    const cookiesVoor = (await context.cookies()).map((cookie) => ({ naam: cookie.name, domein: cookie.domain }));
    const opslag = await snapshotOpslag(page);
    const opslagVoor = [
      ...opslag.local_storage.map((item) => `localStorage:${item.sleutel}`),
      ...opslag.session_storage.map((item) => `sessionStorage:${item.sleutel}`),
    ];

    const keuze = await weigerConsent(page, context, {
      timeoutMs: w.consent_timeout_ms,
      cmps,
      voorWeigeren: () => { tracker.fase = 'na_weigeren'; },
    });
    if (!keuze.gelukt) return { keuze, cookies_voor: cookiesVoor, opslag_voor: opslagVoor, meting: null };

    await wachtOpRustigNetwerk(page, tracker, { minimaalMs: w.minimaal_na_consent_ms, maximaalMs: w.maximaal_ms, rustMs: w.netwerk_rust_ms });
    let herladen = true;
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: w.navigatie_timeout_ms });
    } catch {
      herladen = false;
    }
    const wacht = await wachtOpRustigNetwerk(page, tracker, {
      minimaalMs: w.minimaal_na_herladen_ms ?? w.minimaal_na_consent_ms,
      maximaalMs: w.maximaal_ms,
      rustMs: w.netwerk_rust_ms,
    });
    const meting = await meet({ context, page, tracker, domeinen, fase: 'na_weigeren', wachttijd: wacht, navigatieStatus: null, metDom: false });
    return { keuze, cookies_voor: cookiesVoor, opslag_voor: opslagVoor, herladen, meting };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Eén meting: cookies (met hun herkomst), opslag, requests en de DOM. De
 * herkomst van cookies kijkt naar álle requests tot nu toe: een cookie uit
 * meting 1 kan door een request uit de eerste seconde zijn gezet.
 */
async function meet({ context, page, tracker, domeinen, fase, wachttijd, navigatieStatus, metDom = true }) {
  const opslag = await snapshotOpslag(page);
  const alleRequests = verrijkRequests(tracker.requests, domeinen, tracker.initiators);
  const cookies = verrijkCookies(await snapshotCookies(context, domeinen), alleRequests, opslag.logboek);
  const dom = metDom ? await snapshotDom(page, { cmpIds: CMP_DOM_IDS }) : { iframes: [], scripts: [] };
  const requests = alleRequests.filter((request) => request.fase === fase);
  return { wachttijd, navigatie_status: navigatieStatus, cookies, opslag, dom, requests };
}

/**
 * CNAME-keten van elk eigen subdomein dat requests kreeg (behalve de pagina
 * zelf), twee stappen diep. Een server-side tagging-endpoint of een
 * trackingdienst achter data.klant.nl is zo te herkennen.
 */
async function controleerCnames(requests, hoofdHost) {
  const hosts = [...new Set(requests.filter((request) => !request.is_extern && request.host && request.host !== hoofdHost).map((request) => request.host))]
    .slice(0, MAX_DNS_HOSTS);
  const vraag = (host) => Promise.race([
    dnsPromises.resolveCname(host),
    new Promise((_, weiger) => setTimeout(() => weiger(Object.assign(new Error('time-out'), { code: 'ETIMEOUT' })), DNS_TIMEOUT_MS)),
  ]);
  return Promise.all(hosts.map(async (host) => {
    const keten = [];
    let fout = null;
    let huidig = host;
    for (let stap = 0; stap < 2; stap += 1) {
      try {
        const doelen = await vraag(huidig);
        if (!doelen.length) break;
        keten.push(doelen[0]);
        huidig = doelen[0];
      } catch (error) {
        // Geen CNAME is het normale geval (ENODATA); alleen echte fouten noteren.
        if (stap === 0 && !['ENODATA', 'ENOTFOUND'].includes(error.code)) fout = error.code || error.message;
        break;
      }
    }
    return { host, cname: keten, fout };
  }));
}

function beschrijfMeting(label, meting) {
  const extern = meting.requests.filter((request) => request.is_extern).length;
  const rust = meting.wachttijd.netwerk_rustig ? 'rustig' : 'NIET rustig (maximum bereikt)';
  const opslag = (meting.opslag?.local_storage?.length || 0) + (meting.opslag?.session_storage?.length || 0);
  return `${label}: ${meting.cookies.length} cookies, ${opslag} opslagsleutels, ${meting.requests.length} requests (${extern} extern), ${meting.dom.iframes.length} iframes; netwerk ${rust} na ${seconden(meting.wachttijd.gewacht_ms)}`;
}

function beschrijfBanner(banner) {
  const delen = [`Banner${banner.cmp ? ` (${banner.cmp})` : ''}`];
  delen.push(banner.accepteerknop ? `accepteren "${banner.accepteerknop.tekst}"` : 'geen accepteerknop herkend');
  delen.push(banner.weigerknop_eerste_laag ? `weigeren "${banner.weigerknop.tekst}"` : 'GEEN weigerknop in de eerste laag');
  if (banner.vooraf_aangevinkt?.length) delen.push(`${banner.vooraf_aangevinkt.length} vakje(s) vooraf aangevinkt`);
  if (banner.scroll_geblokkeerd) delen.push('scrollen geblokkeerd');
  return delen.join(', ');
}

function beschrijfWeigeren(weigeren) {
  if (!weigeren?.keuze?.gelukt) return `Weigeren: ${weigeren?.keuze?.reden || 'niet gelukt'}`;
  const extern = weigeren.meting.requests.filter((request) => request.is_extern).length;
  return `Weigeren via ${beschrijfMethode(weigeren.keuze)}; daarna (ook na herladen) ${weigeren.meting.requests.length} requests (${extern} extern), ${weigeren.meting.cookies.length} cookies`;
}
