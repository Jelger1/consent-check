/**
 * Browserlaag: start Chromium, maakt per scan een schone context en houdt al
 * het netwerkverkeer bij.
 *
 * Twee keuzes die het meetresultaat bepalen:
 *   - Third-party cookies staan aan. De Chromium van Playwright blokkeert ze
 *     niet (de opslagpartitionering staat door Playwright zelf al uit) en de
 *     tool zet bewust geen extra blokkade: we willen zien wat de site probéért.
 *   - De user-agent verbergt "HeadlessChrome". Tagbeheerders en pixels gedragen
 *     zich anders bij een herkenbare bot; de meting moet zijn wat een bezoeker
 *     krijgt. De versie komt uit de echte browser, dus de string blijft kloppen.
 */

import { chromium } from 'playwright';
import { ontleedUrl } from './domain.js';
import { kort } from './util.js';

export const VIEWPORT = { width: 1366, height: 768 };
export const LOCALE = 'nl-NL';
const TIJDZONE = 'Europe/Amsterdam';

const MAX_URL_TEKENS = 2000;
const MAX_POST_TEKENS = 1500; // identifiers staan vooraan in een body; de rest is ballast voor de LLM
const MAX_PARAM_TEKENS = 300;
const POLL_MS = 250;

// --- Browser en context ---------------------------------------------------------

export async function startBrowser({ headless }) {
  try {
    // Kanaal 'chromium' is de volledige Chromium in de nieuwe headless-modus:
    // die gedraagt zich als een gewone browser, de "headless shell" niet helemaal.
    return await chromium.launch({ channel: 'chromium', headless });
  } catch (error) {
    console.warn(`  ! Chromium-kanaal niet beschikbaar (${error.message.split('\n')[0]}); terugvallen op de standaard build.`);
    return chromium.launch({ headless });
  }
}

export function userAgentVoor(browser) {
  const major = String(browser.version()).split('.')[0] || '140';
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64';
  // Chrome stuurt sinds de UA-reductie zelf ook alleen het major-nummer.
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** Verse context: geen cookies, geen cache, geen opslag. Elke scan begint als een nieuwe bezoeker. */
export async function maakSchoneContext(browser, { userAgent }) {
  const context = await browser.newContext({
    userAgent,
    viewport: VIEWPORT,
    locale: LOCALE,
    timezoneId: TIJDZONE,
    serviceWorkers: 'allow',
    acceptDownloads: false,
  });
  await context.addInitScript(initScript);
  return context;
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
    initiators: new Map(),
  };
  const perRequest = new WeakMap();
  const activiteit = () => {
    tracker.laatsteActiviteit = Date.now();
  };

  context.on('request', (request) => {
    activiteit();
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
