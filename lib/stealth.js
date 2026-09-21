/**
 * Stealth: de browser laten meten wat een echte bezoeker krijgt.
 *
 * WAAROM DIT BESTAAT
 * Niet om beveiliging te omzeilen, maar omdat een herkenbare bot een ándere
 * pagina krijgt dan een bezoeker. Tagmanagers, pixels en CMP's onderdrukken
 * zichzelf regelmatig bij bots: Google Tag Manager heeft bot-triggers, Meta en
 * Hotjar slaan sessies van automation over, en sommige CMP's tonen hun banner
 * niet aan een crawler. Voor een consent-audit is dat de gevaarlijkste fout die
 * er is: de tool zou dan mínder trackers rapporteren dan er in werkelijkheid
 * vuren, en de klant zou denken dat het goed zit.
 *
 * Twee signalen zijn daarvoor bepalend en die repareren we:
 *   1. `HeadlessChrome` in de user-agent. Playwright zet dat er standaard in.
 *   2. `navigator.webdriver === true`. Dit is het officiële automation-signaal
 *      uit de WebDriver-spec en het eerste dat elke bot-detectie uitleest.
 * De rest hieronder dicht de gaten die daar logisch bij horen: een browser die
 * zegt "ik ben geen automation" maar geen plugins, geen window.chrome en een
 * SwiftShader-GPU heeft, is alsnog herkenbaar.
 *
 * WAT DIT NIET DOET
 * Dit omzeilt geen IP-blokkades, captcha's of challenge-pagina's, en dat is
 * ook niet de bedoeling. Blokkeert een site de scanner bewust, dan meldt de
 * tool dat (zie `herkenBlokkade`) in plaats van te doen alsof de meting klopt.
 * Een meting achter een challenge-pagina is per definitie waardeloos.
 *
 * WAAROM GEEN playwright-extra / puppeteer-extra-plugin-stealth
 *   - Dit project heeft als regel: geen dependencies buiten Playwright. Die
 *     plugin sleept puppeteer-extra en tientallen transitieve pakketten mee.
 *   - De plugin loopt achter op Chrome-versies; verouderde patches zijn zelf
 *     een vingerafdruk (een property die net iets anders is dan in echte
 *     Chrome valt méér op dan het origineel).
 *   - Wij hebben maar een handvol signalen nodig, geen tientallen. Wat je niet
 *     aanraakt, kan ook niet afwijken.
 */

import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * Een echte Chrome-installatie is geloofwaardiger dan de Chromium van
 * Playwright: echte merknaam in de client hints ("Google Chrome" in plaats van
 * alleen "Chromium"), inclusief de codecs en het widevine-onderdeel die een
 * kale Chromium mist. We nemen hem alleen als hij er staat.
 */
const CHROME_PADEN = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
};

export function vindEchteChrome() {
  for (const pad of CHROME_PADEN[process.platform] || []) {
    if (pad && existsSync(pad)) return pad;
  }
  return null;
}

/**
 * Argumenten waarmee Chrome niet als automation start.
 *
 *   --disable-blink-features=AutomationControlled  haalt de vlag weg waar
 *      Blink `navigator.webdriver` op baseert. Dit is de nette route; de
 *      JavaScript-patch hieronder is het vangnet voor als de vlag toch blijft.
 *   --enable-automation (uit ignoreDefaultArgs)    zet anders de infobalk
 *      "Chrome wordt bestuurd door geautomatiseerde testsoftware" én enkele
 *      interne automation-gedragingen aan.
 *   --disable-infobars, --no-default-browser-check, --no-first-run
 *      houden het venster schoon; die balken verschuiven anders het viewport.
 *
 * Bewust NIET gebruikt: --disable-web-security en --disable-site-isolation.
 * Die veranderen hoe third-party cookies en iframes zich gedragen, en dat is
 * precies wat we meten. Liever een net iets herkenbaardere browser dan een
 * meting die niet klopt.
 */
const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-default-browser-check',
  '--no-first-run',
  '--disable-infobars',
  '--password-store=basic',
  '--use-mock-keychain',
];

const NEGEER_ARGS = ['--enable-automation', '--disable-component-extensions-with-background-pages'];

export async function startBrowser({ headless, stealth = true }) {
  const chromePad = stealth ? vindEchteChrome() : null;
  const opties = {
    headless,
    args: stealth ? LAUNCH_ARGS : [],
    ...(stealth ? { ignoreDefaultArgs: NEGEER_ARGS } : {}),
  };

  if (chromePad) {
    try {
      const browser = await chromium.launch({ ...opties, executablePath: chromePad });
      browser.__bron = 'echte Chrome';
      return browser;
    } catch (error) {
      console.warn(`  ! Echte Chrome starten mislukt (${error.message.split('\n')[0]}); terugvallen op Chromium.`);
    }
  }

  try {
    // Kanaal 'chromium' is de volledige Chromium in de nieuwe headless-modus:
    // die gedraagt zich als een gewone browser, de "headless shell" niet helemaal.
    const browser = await chromium.launch({ ...opties, channel: 'chromium' });
    browser.__bron = 'Playwright Chromium';
    return browser;
  } catch (error) {
    console.warn(`  ! Chromium-kanaal niet beschikbaar (${error.message.split('\n')[0]}); terugvallen op de standaard build.`);
    const browser = await chromium.launch(opties);
    browser.__bron = 'Playwright standaard';
    return browser;
  }
}

/**
 * De user-agent zonder "HeadlessChrome", met het echte versienummer van deze
 * browser erin. Dat laatste is essentieel: een verzonnen versie botst met de
 * `sec-ch-ua`-headers die Chrome zélf stuurt, en zo'n mismatch is een
 * duidelijker bot-signaal dan het woord "Headless".
 */
export function userAgentVoor(browser) {
  const versie = String(browser.version() || '');
  const major = versie.split('.')[0] || '140';
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64';
  // Chrome stuurt sinds de UA-reductie zelf ook alleen het major-nummer.
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/**
 * De enige header die we zelf meesturen.
 *
 * Playwright stuurt op basis van `locale: 'nl-NL'` alleen `Accept-Language: nl-NL`.
 * Een echte Chrome stuurt een lijst met kwaliteitswaarden. Sommige CMP's kiezen
 * hun bannertaal op deze header, dus het scheelt of hij realistisch is.
 *
 * Bewust NIET meesturen: `Sec-Fetch-*` en `Upgrade-Insecure-Requests`. Dat zijn
 * headers die de browser per request zelf berekent; ze staan op de forbidden
 * header list. Zet je ze via `extraHTTPHeaders`, dan gelden ze voor élk request
 * en weigert Chrome ze met ERR_INVALID_ARGUMENT. Gemeten op pureminds.nl:
 * 75 van de 119 requests mislukten, de CMP laadde niet en de meting was
 * waardeloos. Precies de fout die deze tool hoort op te sporen.
 */
export function extraHeaders(locale = 'nl-NL') {
  const taal = locale.split('-')[0];
  return { 'Accept-Language': `${locale},${taal};q=0.9,en-US;q=0.8,en;q=0.7` };
}

/**
 * Draait in élke pagina en élk iframe vóór alle andere scripts.
 *
 * Mag niets van buiten zichzelf gebruiken: Playwright serialiseert deze functie
 * naar de browser. Elke patch zit in een eigen try/catch, want een fout hier
 * breekt de pagina die we willen meten — en dat is erger dan herkend worden.
 */
export function stealthScript() {
  // 1. navigator.webdriver: het officiële automation-signaal en het eerste dat
  //    elke bot-detectie uitleest.
  //
  //    Normaal doet de launch-arg --disable-blink-features=AutomationControlled
  //    dit al, en dan staat hij op `false` — precies zoals in een echte Chrome.
  //    Deze patch is alleen het vangnet voor als die vlag niet werkte.
  //
  //    Let op de waarde: `false`, niet `undefined`. De property bestáát in elke
  //    moderne browser; hem weghalen maakt de browser juist afwijkend. Dat was
  //    hier eerst wél zo en is bewust teruggedraaid.
  try {
    if (navigator.webdriver === true) {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true, enumerable: false });
    }
  } catch { /* dan blijft hij staan; liever dat dan een kapotte pagina */ }

  // 2. window.chrome bestaat in elke echte Chrome, ook zonder extensies. In
  //    headless ontbreekt vooral `runtime`. We vullen alleen aan wat mist.
  try {
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', { value: {}, configurable: true, writable: true });
    }
    if (!window.chrome.runtime) window.chrome.runtime = {};
    if (!window.chrome.app) window.chrome.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
    if (!window.chrome.csi) window.chrome.csi = function csi() { return { onloadT: Date.now(), startE: Date.now(), pageT: performance.now(), tran: 15 }; };
    if (!window.chrome.loadTimes) window.chrome.loadTimes = function loadTimes() { return { requestTime: performance.timeOrigin / 1000, startLoadTime: performance.timeOrigin / 1000, commitLoadTime: performance.timeOrigin / 1000, finishLoadTime: performance.timeOrigin / 1000, navigationType: 'Other' }; };
  } catch { /* niet fataal */ }

  // 3. Notification.permission is 'denied' in headless en 'default' in een
  //    echte browser die het nog niet gevraagd heeft. Het klassieke gat is dat
  //    Notification.permission en permissions.query() elkaar tegenspreken.
  try {
    const origineel = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function query(parameters) {
      if (parameters && parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission === 'denied' ? 'prompt' : Notification.permission, name: 'notifications', onchange: null });
      }
      return origineel(parameters);
    };
  } catch { /* niet fataal */ }

  // 4. Een lege plugin- en mimeType-lijst komt in echte Chrome niet voor: de
  //    ingebouwde PDF-viewer staat er altijd in. Alleen aanvullen als het leeg is.
  try {
    if (navigator.plugins.length === 0) {
      const maakPlugin = (name, description) => Object.create(Plugin.prototype, {
        name: { value: name, enumerable: true },
        filename: { value: 'internal-pdf-viewer', enumerable: true },
        description: { value: description, enumerable: true },
        length: { value: 1, enumerable: true },
      });
      const lijst = [
        maakPlugin('PDF Viewer', 'Portable Document Format'),
        maakPlugin('Chrome PDF Viewer', 'Portable Document Format'),
        maakPlugin('Chromium PDF Viewer', 'Portable Document Format'),
        maakPlugin('Microsoft Edge PDF Viewer', 'Portable Document Format'),
        maakPlugin('WebKit built-in PDF', 'Portable Document Format'),
      ];
      Object.setPrototypeOf(lijst, PluginArray.prototype);
      Object.defineProperty(Navigator.prototype, 'plugins', { get: () => lijst, configurable: true });
    }
  } catch { /* niet fataal */ }

  // 5. WebGL meldt in headless zonder GPU "SwiftShader" of "llvmpipe". Dat is
  //    een bekend bot-kenmerk. Alleen ingrijpen als dat daadwerkelijk zo is;
  //    heeft deze machine een echte GPU, dan laten we het origineel staan.
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '') : '';
    if (/swiftshader|llvmpipe|software|mesa offscreen/i.test(renderer)) {
      const patch = (proto) => {
        const origineel = proto.getParameter;
        proto.getParameter = function getParameter(parameter) {
          if (parameter === 37445) return 'Google Inc. (Intel)';                                                   // UNMASKED_VENDOR_WEBGL
          if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';  // UNMASKED_RENDERER_WEBGL
          return origineel.apply(this, [parameter]);
        };
      };
      if (window.WebGLRenderingContext) patch(WebGLRenderingContext.prototype);
      if (window.WebGL2RenderingContext) patch(WebGL2RenderingContext.prototype);
    }
  } catch { /* niet fataal */ }

  // 6. In headless zijn outerWidth/outerHeight 0. Een venster zonder buitenkant
  //    bestaat niet.
  try {
    if (window.outerWidth === 0 || window.outerHeight === 0) {
      Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth, configurable: true });
      Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 88, configurable: true });
    }
  } catch { /* niet fataal */ }
}

// --- Blokkades herkennen --------------------------------------------------------

/**
 * Tekst waarmee de bekende beveiligingsdiensten hun blokkade- of
 * challenge-pagina aankondigen. Als dit op de pagina staat, meten we de
 * blokkade en niet de site: dat moet het rapport zeggen.
 */
const BLOKKADE_PATRONEN = [
  { patroon: /ip address is blocked|ip adres is geblokkeerd|access to .{0,30} has been .{0,20}blocked/i, soort: 'ip_blokkade' },
  { patroon: /access denied|toegang geweigerd|you are not allowed to access/i, soort: 'toegang_geweigerd' },
  { patroon: /verify (you are|yourself|that you are) (a )?human|ik ben geen robot|i am not a robot|captcha/i, soort: 'captcha' },
  { patroon: /just a moment|even geduld|checking your browser|one more step|attention required/i, soort: 'challenge' },
  { patroon: /reference ?#\s*[0-9a-f.]{8,}|error reference number|incident id/i, soort: 'waf_blokkade' },
  { patroon: /request unsuccessful.{0,40}incapsula|pardon our interruption|bot detection/i, soort: 'bot_detectie' },
];

/** Welke dienst de blokkade opwierp, af te leiden uit de responsheaders. */
export function herkenBeveiliging(headers = {}) {
  const alles = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n').toLowerCase();
  if (/cf-ray|cloudflare/.test(alles)) return 'Cloudflare';
  if (/akamai|x-akamai|akamaighost/.test(alles)) return 'Akamai';
  if (/datadome/.test(alles)) return 'DataDome';
  if (/incap_ses|x-iinfo|imperva/.test(alles)) return 'Imperva / Incapsula';
  if (/x-px|perimeterx|_px/.test(alles)) return 'PerimeterX / HUMAN';
  if (/x-sucuri/.test(alles)) return 'Sucuri';
  return null;
}

/**
 * Kijkt of we een blokkadepagina te pakken hebben in plaats van de site.
 * `status` en `headers` komen uit de navigatierespons, `tekst` en `titel` uit
 * de gerenderde pagina.
 */
export function herkenBlokkade({ status, headers, titel, tekst, aantalRequests }) {
  const inhoud = `${titel || ''}\n${tekst || ''}`;
  const treffer = BLOKKADE_PATRONEN.find(({ patroon }) => patroon.test(inhoud));
  const beveiliging = herkenBeveiliging(headers);

  if (treffer) {
    return {
      geblokkeerd: true,
      soort: treffer.soort,
      beveiliging,
      status,
      melding: `De site serveerde een ${treffer.soort === 'captcha' ? 'captcha' : 'blokkadepagina'}`
        + `${beveiliging ? ` (${beveiliging})` : ''}${status ? ` met status ${status}` : ''}. `
        + 'De meting hieronder gaat over die pagina, niet over de site zelf.',
    };
  }

  if (status !== null && status >= 400) {
    return {
      geblokkeerd: true,
      soort: 'http_fout',
      beveiliging,
      status,
      melding: `De pagina gaf status ${status}${beveiliging ? ` via ${beveiliging}` : ''}. `
        + 'Wat hieronder staat is dan niet de echte site.',
    };
  }

  // Een volledige site doet tientallen requests. Een handvol kán een blokkade
  // zijn, maar ook gewoon een eenvoudige pagina. Daarom geen harde conclusie:
  // een aantekening waar de lezer zelf naar kan kijken. Anders krijgt elke
  // kale landingspagina onterecht het stempel "geblokkeerd".
  if (aantalRequests !== undefined && aantalRequests < 5) {
    return {
      geblokkeerd: false,
      twijfel: true,
      soort: 'weinig_requests',
      beveiliging,
      status,
      melding: `Deze pagina deed maar ${aantalRequests} request(s). Dat kan kloppen bij een eenvoudige pagina, maar controleer of de site echt volledig geladen is.`,
    };
  }

  return { geblokkeerd: false, twijfel: false, soort: null, beveiliging, status, melding: null };
}
