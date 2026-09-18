/**
 * Herkent welke CMP's op de pagina aanwezig zijn (regel 6: meerdere CMP's).
 *
 * Per CMP tellen we losse signalen: script in de ruwe HTML, script in de DOM,
 * daadwerkelijk request, window-global, cookie en banner-element. "Actief" is
 * een CMP die meer doet dan alleen in de HTML staan: een script dat echt is
 * geladen, een global of een element in de DOM. Zo valt een uitgeschakelde
 * plugin-rest niet in dezelfde categorie als een draaiende banner.
 */

export const CMPS = [
  { id: 'cookiescript', naam: 'CookieScript', scripts: [/cookie-script\.com/i], globals: ['CookieScript'], cookies: [/^CookieScriptConsent$/], dom_ids: ['cookiescript_injected'] },
  { id: 'cookiebot', naam: 'Cookiebot (Usercentrics)', scripts: [/consent\.cookiebot\.com/i, /consentcdn\.cookiebot\.com/i, /cookiebot\.com\/uc\.js/i], globals: ['Cookiebot'], cookies: [/^CookieConsent$/, /^CookieConsentBulkSetting/], dom_ids: ['CybotCookiebotDialog', 'Cookiebot'] },
  { id: 'complianz', naam: 'Complianz', scripts: [/complianz/i, /cmplz/i], globals: ['complianz'], cookies: [/^cmplz_/], dom_ids: ['cmplz-cookiebanner-container'] },
  { id: 'onetrust', naam: 'OneTrust', scripts: [/cookielaw\.org/i, /onetrust\.com/i, /otSDKStub/i], globals: ['OneTrust', 'Optanon'], cookies: [/^OptanonConsent$/, /^OptanonAlertBoxClosed$/], dom_ids: ['onetrust-banner-sdk', 'onetrust-consent-sdk'] },
  { id: 'cookieyes', naam: 'CookieYes / GDPR Cookie Consent', scripts: [/cookieyes\.com/i, /cookie-law-info/i], globals: ['CookieYes', 'CLI_Cookie'], cookies: [/^cookieyes-consent$/, /^cky-/, /^cookielawinfo-checkbox-/, /^viewed_cookie_policy$/], dom_ids: ['cookie-law-info-bar', 'cky-consent-container'] },
  { id: 'iubenda', naam: 'iubenda', scripts: [/iubenda\.com/i], globals: ['iubenda'], cookies: [/^_iub_cs-/], dom_ids: ['iubenda-cs-banner'] },
  { id: 'usercentrics', naam: 'Usercentrics', scripts: [/usercentrics\.eu/i], globals: ['UC_UI'], cookies: [/^uc_/], dom_ids: ['usercentrics-root'] },
  { id: 'didomi', naam: 'Didomi', scripts: [/privacy-center\.org/i, /didomi/i], globals: ['Didomi'], cookies: [/^didomi_token$/], dom_ids: ['didomi-host'] },
  { id: 'cookie_notice', naam: 'Cookie Notice (WordPress-plugin)', scripts: [/\/cookie-notice\//i], globals: ['cn_cookie_notice'], cookies: [/^cookie_notice_accepted$/], dom_ids: ['cookie-notice'] },
  { id: 'moove_gdpr', naam: 'GDPR Cookie Compliance (Moove)', scripts: [/gdpr-cookie-compliance/i, /moove-gdpr/i], globals: [], cookies: [/^moove_gdpr_popup$/], dom_ids: ['moove_gdpr_cookie_info_bar'] },
  { id: 'borlabs', naam: 'Borlabs Cookie', scripts: [/borlabs-cookie/i], globals: ['BorlabsCookie'], cookies: [/^borlabs-cookie/], dom_ids: ['BorlabsCookieBox'] },
  { id: 'real_cookie_banner', naam: 'Real Cookie Banner', scripts: [/real-cookie-banner/i], globals: [], cookies: [/^rcb-consent$/], dom_ids: [] },
  { id: 'klaro', naam: 'Klaro', scripts: [/klaro/i], globals: ['klaro'], cookies: [/^klaro$/], dom_ids: ['klaro'] },
  { id: 'tarteaucitron', naam: 'tarteaucitron', scripts: [/tarteaucitron/i], globals: ['tarteaucitron'], cookies: [/^tarteaucitron$/], dom_ids: ['tarteaucitronRoot'] },
  { id: 'osano_cookieconsent', naam: 'Osano / cookieconsent', scripts: [/osano\.com/i, /\bcookieconsent(\.min)?\.js/i], globals: ['Osano', 'cookieconsent'], cookies: [/^osano_consentmanager/, /^cookieconsent_status$/, /^cc_cookie$/], dom_ids: ['cc-main'] },
  { id: 'cookiefirst', naam: 'CookieFirst', scripts: [/cookiefirst\.com/i], globals: ['CookieFirst'], cookies: [/^cookiefirst-consent$/], dom_ids: [] },
  { id: 'cookieinformation', naam: 'Cookie Information', scripts: [/cookieinformation\.com/i], globals: ['CookieInformation'], cookies: [/^CookieInformationConsent$/], dom_ids: [] },
  { id: 'termly', naam: 'Termly', scripts: [/termly\.io/i], globals: [], cookies: [/^TERMLY_API_CACHE$/], dom_ids: [] },
  { id: 'axeptio', naam: 'Axeptio', scripts: [/axept\.io/i], globals: [], cookies: [/^axeptio_/], dom_ids: [] },
  { id: 'quantcast', naam: 'Quantcast Choice', scripts: [/quantcast\.mgr\.consensu\.org/i, /quantcast\.com\/choice/i], globals: [], cookies: [], dom_ids: ['qc-cmp2-container'] },
  { id: 'trustarc', naam: 'TrustArc', scripts: [/trustarc\.com/i, /truste\.com/i], globals: [], cookies: [/^notice_preferences$/, /^cmapi_cookie_privacy$/], dom_ids: ['truste-consent-track'] },
];

/** Alle banner-element-id's, zodat de DOM-snapshot ze in één keer kan nalopen. */
export const CMP_DOM_IDS = [...new Set(CMPS.flatMap((cmp) => cmp.dom_ids))];

const ACTIEVE_BRONNEN = new Set(['dom_script', 'request', 'window_global', 'dom_element']);

export function detecteerCmps({ html, dom, requests, cookies }) {
  const gevonden = [];

  for (const cmp of CMPS) {
    const signalen = [];
    const past = (tekst) => cmp.scripts.some((patroon) => patroon.test(tekst || ''));

    for (const script of html?.scripts || []) {
      if (script.src && past(script.src)) signalen.push({ bron: 'html_script', detail: script.src, positie: script.positie });
      else if (!script.src && script.inline_fragment && past(script.inline_fragment)) signalen.push({ bron: 'html_inline', detail: script.inline_fragment.slice(0, 120) });
    }
    for (const script of dom?.scripts || []) {
      if (script.src && past(script.src)) signalen.push({ bron: 'dom_script', detail: script.src, positie: script.positie });
    }

    const aantalRequests = requests.filter((request) => past(`${request.host}${request.pad}`)).length;
    if (aantalRequests > 0) signalen.push({ bron: 'request', detail: `${aantalRequests} request(s)` });

    for (const naam of cmp.globals) {
      if (dom?.cmp_globals?.[naam]) signalen.push({ bron: 'window_global', detail: `window.${naam}` });
    }
    for (const cookie of cookies) {
      if (cmp.cookies.some((patroon) => patroon.test(cookie.naam))) signalen.push({ bron: 'cookie', detail: cookie.naam });
    }
    for (const id of cmp.dom_ids) {
      if (dom?.cmp_elementen?.includes(id)) signalen.push({ bron: 'dom_element', detail: `#${id}` });
    }

    if (signalen.length === 0) continue;
    // Hetzelfde script kan meerdere keren in de DOM staan; één signaal per bron+detail volstaat.
    const uniek = [...new Map(signalen.map((signaal) => [`${signaal.bron}|${signaal.detail}`, signaal])).values()];
    gevonden.push({
      id: cmp.id,
      naam: cmp.naam,
      actief: uniek.some((signaal) => ACTIEVE_BRONNEN.has(signaal.bron)),
      signalen: uniek,
    });
  }

  return gevonden.sort((a, b) => Number(b.actief) - Number(a.actief) || b.signalen.length - a.signalen.length);
}
