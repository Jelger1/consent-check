/**
 * Browserlaag: start Chromium, maakt per scan een schone context en houdt al
 * het netwerkverkeer bij.
 *
 * Drie keuzes die het meetresultaat bepalen:
 *   - Third-party cookies staan aan. De Chromium van Playwright blokkeert ze
 *     niet (de opslagpartitionering staat door Playwright zelf al uit) en de
 *     tool zet bewust geen extra blokkade: we willen zien wat de site probéért.
 *   - De browser meldt zich niet als automation (zie lib/stealth.js). Niet om
 *     ergens binnen te komen, maar omdat tagmanagers en pixels zichzelf bij een
 *     herkenbare bot onderdrukken; dan zouden we te wéinig trackers meten.
 *   - Dialogs, pop-ups en crashes worden afgevangen in plaats van de scan te
 *     laten stranden. Een site die `alert()` aanroept of een pop-up opent, mag
 *     de meting niet ophouden.
 */

import { ontleedUrl } from './domain.js';
import { extraHeaders, stealthScript } from './stealth.js';
import { kort } from './util.js';

export { startBrowser, userAgentVoor } from './stealth.js';

export const VIEWPORT = { width: 1366, height: 768 };
export const LOCALE = 'nl-NL';
const TIJDZONE = 'Europe/Amsterdam';

const MAX_URL_TEKENS = 2000;
const MAX_POST_TEKENS = 1500; // identifiers staan vooraan in een body; de rest is ballast voor de LLM
const MAX_PARAM_TEKENS = 300;
const POLL_MS = 250;

/**
 * Bovengrens aan het aantal vastgelegde requests. Een advertentiepagina kan er
 * duizenden doen; dan wordt het rapport onhanteerbaar groot en heeft de lezer
 * er niets meer aan. We tellen wél door, zodat het rapport eerlijk vermeldt
 * hoeveel er zijn weggelaten.
 */
const MAX_REQUESTS = 1500;

// --- Browser en context ---------------------------------------------------------

/** Verse context: geen cookies, geen cache, geen opslag. Elke scan begint als een nieuwe bezoeker. */
export async function maakSchoneContext(browser, { userAgent, stealth = true }) {
  const context = await browser.newContext({
    userAgent,
    viewport: VIEWPORT,
    locale: LOCALE,
    timezoneId: TIJDZONE,
    serviceWorkers: 'allow',
    acceptDownloads: false,
    ...(stealth ? { extraHTTPHeaders: extraHeaders(LOCALE) } : {}),
  });
  if (stealth) await context.addInitScript(stealthScript);
  await context.addInitScript(initScript);
  return context;
}

/**
 * Vangt alles af wat een scan kan laten stranden en houdt bij wat er gebeurde.
 * Geeft een `storingen`-array terug die in het rapport belandt.
 *
 * - dialogs: `alert`, `confirm`, `beforeunload`. Playwright laat een dialog
 *   zonder handler de pagina blokkeren zodra je hem zelf afhandelt; met een
 *   expliciete handler weten we bovendien wát er gevraagd werd.
 * - pop-ups: `window.open` naar een advertentie of een socialelogin. Hun
 *   requests tellen gewoon mee (de listeners hangen op de context), maar het
 *   venster zelf sluiten we, anders blijft het netwerk onrustig.
 * - crashes: een tab die omvalt. Zonder handler hangt elke volgende aanroep
 *   tot de timeout.
 */
export function vangStoringenAf(context, hoofdpagina) {
  const storingen = [];
  const noteer = (soort, detail) => {
    if (storingen.length < 50) storingen.push({ soort, detail: kort(detail, 300), tijd: new Date().toISOString() });
  };

  context.on('page', async (pagina) => {
    if (pagina === hoofdpagina) return;
    const url = pagina.url();
    noteer('popup', `pop-up geopend: ${url || 'about:blank'}`);
    // Even laten leven zodat zijn requests nog gemeten worden, daarna opruimen.
    setTimeout(() => pagina.close().catch(() => {}), 2000);
  });

  context.on('dialog', async (dialog) => {
    noteer('dialog', `${dialog.type()}: ${dialog.message()}`);
    // Wegklikken, niet accepteren: een `confirm` met "wil je de site verlaten"
    // moet níet bevestigd worden, anders navigeert de pagina weg.
    await dialog.dismiss().catch(() => {});
  });

  hoofdpagina.on('crash', () => noteer('crash', 'de pagina is gecrasht'));
  hoofdpagina.on('pageerror', (error) => noteer('pagina_fout', error.message));

  return storingen;
}

/**
 * Draait in de pagina vóór alle andere scripts en legt CMP-events vast met
 * een tijdstempel. Zo weten we wanneer CookieScript geladen was en of het
 * accept-event daadwerkelijk is afgevuurd. Mag niets van buiten refereren:
 * Playwright serialiseert deze functie naar de browser.
 */
function initScript() {
  const store = { gestart: Date.now(), events: [] };
  Object.defineProperty(window, '__consentCheck', { value: store, enumerable: false });
  const namen = [
    'CookieScriptLoaded', 'CookieScriptAccept', 'CookieScriptAcceptAll', 'CookieScriptReject', 'CookieScriptClose',
    'CookieScriptConsentUpdated', 'CookieScriptGoogleConsentUpdated',
    'CookiebotOnLoad', 'CookiebotOnDialogInit', 'CookiebotOnDialogDisplay', 'CookiebotOnAccept', 'CookiebotOnDecline', 'CookiebotOnConsentReady',
    'cmplz_fire_categories', 'cmplz_status_change', 'OneTrustGroupsUpdated', 'cookieyes_consent_update',
  ];
  const veilig = (detail) => {
    try {
      return detail === undefined ? null : JSON.parse(JSON.stringify(detail));
    } catch {
      return String(detail);
    }
  };
  for (const naam of namen) {
    window.addEventListener(naam, (event) => {
      store.events.push({ naam, tijd_ms: Date.now() - store.gestart, detail: veilig(event.detail) });
    });
  }
}

// --- Netwerk volgen --------------------------------------------------------------

/**
 * Legt elk request in de context vast (alle frames, service workers incl.)
 * met de fase waarin het startte. `tracker.fase` wordt door de scanner op
 * 'na_consent' gezet vlak voordat consent wordt gegeven.
 */
export function volgNetwerk(context) {
  const tracker = {
    fase: 'voor_consent',
    gestart: Date.now(),
    laatsteActiviteit: Date.now(),
    requests: [],
    // Wat er is langsgekomen, ook boven de bovengrens: anders liegt het rapport
    // over het totaal.
    aantal_gezien: { voor_consent: 0, na_consent: 0 },
    weggelaten: 0,
    initiators: new Map(),
  };
  const perRequest = new WeakMap();
  const activiteit = () => {
    tracker.laatsteActiviteit = Date.now();
  };

  context.on('request', (request) => {
    activiteit();
    tracker.aantal_gezien[tracker.fase] = (tracker.aantal_gezien[tracker.fase] || 0) + 1;
    if (tracker.requests.length >= MAX_REQUESTS) {
      tracker.weggelaten += 1;
      return;
    }
    const url = request.url();
    const parsed = ontleedUrl(url);
    const entry = {
      fase: tracker.fase,
      tijd_ms: Date.now() - tracker.gestart,
      url: kort(url, MAX_URL_TEKENS),
      host: parsed?.hostname.toLowerCase() || '',
      pad: parsed?.pathname || '',
      method: request.method(),
      resource_type: request.resourceType(),
      is_navigatie: request.isNavigationRequest(),
      iframe_url: iframeUrl(request),
      query_parameters: queryParameters(parsed),
      post_data: null,
      post_data_lengte: 0,
      status: null,
      mislukt: null,
    };
    try {
      const data = request.postData();
      if (data) {
        entry.post_data_lengte = data.length;
        entry.post_data = kort(data, MAX_POST_TEKENS);
      }
    } catch {
      // binaire body: niet leesbaar als tekst, lengte blijft 0
    }
    // De volledige URL blijft nodig om de CDP-initiator te koppelen, maar hoort
    // niet (nogmaals) in de JSON: daarom niet-enumerable.
    Object.defineProperty(entry, '_url', { value: url, enumerable: false });
    perRequest.set(request, entry);
    tracker.requests.push(entry);
  });

  context.on('response', (response) => {
    activiteit();
    const entry = perRequest.get(response.request());
    if (entry) entry.status = response.status();
  });

  context.on('requestfinished', activiteit);

  context.on('requestfailed', (request) => {
    activiteit();
    const entry = perRequest.get(request);
    if (entry) entry.mislukt = request.failure()?.errorText || 'onbekend';
  });

  return tracker;
}

/**
 * Alleen gevuld voor requests uit een iframe (dan is de bron interessant:
 * een YouTube-embed, een CMP-frame). Het hoofdframe is de pagina zelf en
 * service-worker-requests hebben geen frame; in beide gevallen null.
 */
function iframeUrl(request) {
  try {
    const frame = request.frame();
    return frame.parentFrame() ? kort(frame.url(), 300) : null;
  } catch {
    return null;
  }
}

function queryParameters(parsed) {
  const parameters = {};
  if (!parsed) return parameters;
  for (const [naam, waarde] of parsed.searchParams) {
    if (!Object.hasOwn(parameters, naam)) parameters[naam] = kort(waarde, MAX_PARAM_TEKENS);
  }
  return parameters;
}

/**
 * Via het Chrome DevTools Protocol weten we wíe een request startte: de
 * HTML-parser, of een script (en welk). Daarmee is "CookieScript geïnjecteerd
 * door gtm.js" een meting in plaats van een vermoeden. Alleen beschikbaar voor
 * de frames van deze pagina; voor iframes in een ander proces is dit leeg.
 */
export async function volgInitiators(context, page, tracker) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (event) => {
    const url = event.request?.url;
    if (!url || tracker.initiators.has(url)) return;
    tracker.initiators.set(url, beschrijfInitiator(event.initiator));
  });
  return cdp;
}

function beschrijfInitiator(initiator) {
  if (!initiator) return null;
  const stack = [];
  let frame = initiator.stack;
  let diepte = 0;
  while (frame && diepte++ < 6 && stack.length < 5) {
    for (const call of frame.callFrames || []) {
      if (call.url && !stack.includes(call.url)) stack.push(call.url);
      if (stack.length >= 5) break;
    }
    frame = frame.parent;
  }
  return {
    type: initiator.type,
    url: kort(initiator.url || stack[0] || null, 300),
    stack: stack.map((url) => kort(url, 300)),
  };
}

/**
 * Wacht tot het netwerk minstens `rustMs` stil is, maar nooit korter dan
 * `minimaalMs` (vertraagde pixels krijgen zo hun kans) en nooit langer dan
 * `maximaalMs` (een site met een eeuwige poll mag de scan niet ophouden).
 */
export async function wachtOpRustigNetwerk(page, tracker, { minimaalMs, maximaalMs, rustMs }) {
  const gestart = Date.now();
  const aantalStart = tracker.requests.length;
  let rustig = false;

  for (;;) {
    const verstreken = Date.now() - gestart;
    const stilSinds = Date.now() - tracker.laatsteActiviteit;
    if (verstreken >= maximaalMs) break;
    if (verstreken >= minimaalMs && stilSinds >= rustMs) {
      rustig = true;
      break;
    }
    await page.waitForTimeout(POLL_MS);
  }

  return {
    gewacht_ms: Date.now() - gestart,
    minimaal_ms: minimaalMs,
    maximaal_ms: maximaalMs,
    netwerk_rustig: rustig,
    requests_tijdens_wachten: tracker.requests.length - aantalStart,
  };
}
