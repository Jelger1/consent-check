/**
 * Consent geven of weigeren, voor elke CMP die we kennen, en de banner zelf
 * bekijken.
 *
 * Volgorde van betrouwbaarheid, per CMP:
 *   1. de officiële JavaScript-API van de CMP (CookieScript, Cookiebot,
 *      Usercentrics, Complianz, OneTrust, Didomi, Klaro, tarteaucitron,
 *      CookieFirst, CookieCode) — de staat wordt daarna bij diezelfde API
 *      bevestigd;
 *   2. de officiële accept- of weigerknop van de CMP, herkend aan zijn vaste
 *      id of klasse;
 *   3. als laatste redmiddel een zichtbare knop met een accept- of weigertekst
 *      ("Alles accepteren", "Alles weigeren") in een element dat over cookies
 *      gaat. Dat is een gok, en het rapport zegt dat er dan ook bij.
 *
 * De weiger-API's zijn op de sites van de leveranciers zelf bevestigd
 * (rejectAllAction, denyAllConsents, cmplz_deny_all, RejectAll,
 * setUserDisagreeToAll, declineAllCategories, consentNone); voor Klaro en
 * tarteaucitron geldt, net als bij accepteren, alleen hun documentatie.
 *
 * Een CMP wordt alleen bediend als zijn banner ook echt getoond wordt. Een CMP
 * die wel geladen is maar geen banner laat zien (verkeerde configuratie, of een
 * tweede CMP die door de eerste wordt onderdrukt) kan een bezoeker immers ook
 * niet bedienen; die staat in het rapport als "overgeslagen".
 *
 * Geen banner en geen CMP? Dan is dat het antwoord, geen fout: de scan levert
 * één meting op, met de melding dat er niets te kiezen viel.
 *
 * Elke aanroep in de pagina zit in `paginaApi`: één functie die Playwright
 * naar de browser serialiseert, met alle CMP-implementaties erin. Die mag dus
 * niets van buiten zichzelf gebruiken.
 */

import { fail, kort } from '../util.js';

/**
 * Per CMP: naam, of er een API-implementatie is in paginaApi, en de vaste
 * selectors. `cookie` is het consentcookie, of null als de CMP de keuze
 * elders opslaat (CookieCode).
 */
export const STRATEGIEEN = [
  { id: 'cookiescript', naam: 'CookieScript', api: true, knoppen: ['#cookiescript_accept'], weigerknoppen: ['#cookiescript_reject'], banner: ['#cookiescript_injected'], cookie: /^CookieScriptConsent$/ },
  { id: 'cookiebot', naam: 'Cookiebot', api: true, knoppen: ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept', '#CybotCookiebotDialogBodyLevelButtonAccept'], weigerknoppen: ['#CybotCookiebotDialogBodyButtonDecline'], banner: ['#CybotCookiebotDialog'], cookie: /^CookieConsent$/ },
  { id: 'usercentrics', naam: 'Usercentrics', api: true, knoppen: [], weigerknoppen: [], banner: ['#usercentrics-root', '#usercentrics-cmp-ui'], cookie: /^(uc_settings|uc_user_interaction|ucData|consent-policy)$/ },
  { id: 'complianz', naam: 'Complianz', api: true, knoppen: ['.cmplz-accept'], weigerknoppen: ['.cmplz-deny'], banner: ['#cmplz-cookiebanner-container', '.cmplz-cookiebanner'], cookie: /^cmplz_/ },
  { id: 'onetrust', naam: 'OneTrust', api: true, knoppen: ['#onetrust-accept-btn-handler', '#accept-recommended-btn-handler'], weigerknoppen: ['#onetrust-reject-all-handler'], banner: ['#onetrust-banner-sdk', '#onetrust-consent-sdk'], cookie: /^OptanonConsent$/ },
  { id: 'didomi', naam: 'Didomi', api: true, knoppen: ['#didomi-notice-agree-button'], weigerknoppen: ['#didomi-notice-disagree-button'], banner: ['#didomi-host', '#didomi-notice'], cookie: /^didomi_token$/ },
  { id: 'klaro', naam: 'Klaro', api: true, knoppen: ['.cm-btn-accept-all', '.cm-btn-success'], weigerknoppen: ['.cn-decline', '.cm-btn-decline'], banner: ['#klaro', '.klaro .cookie-notice'], cookie: /^klaro$/ },
  { id: 'tarteaucitron', naam: 'tarteaucitron', api: true, knoppen: ['#tarteaucitronPersonalize2', '.tarteaucitronAllow'], weigerknoppen: ['#tarteaucitronAllDenied2'], banner: ['#tarteaucitronAlertBig', '#tarteaucitronRoot'], cookie: /^tarteaucitron$/ },
  { id: 'cookiefirst', naam: 'CookieFirst', api: true, knoppen: ['[data-cookiefirst-action="accept"]'], weigerknoppen: ['[data-cookiefirst-action="reject"]'], banner: ['[data-cookiefirst-widget="banner"]'], cookie: /^cookiefirst-consent$/ },
  // De banner staat in een shadow root; Playwright-locators kijken daar doorheen.
  { id: 'cookiecode', naam: 'CookieCode', api: true, knoppen: ['.cc_button_allowall'], weigerknoppen: ['.cc_button_rejectall'], banner: ['cookiecode-banner .cc_root'], cookie: null },
  { id: 'cookieyes', naam: 'CookieYes / GDPR Cookie Consent', api: false, knoppen: ['.cky-btn-accept', '#cookie_action_close_header', '.cli_action_button[data-cli_action="accept"]', '#wt-cli-accept-all-btn'], weigerknoppen: ['.cky-btn-reject', '#cookie_action_close_header_reject'], banner: ['.cky-consent-container', '#cookie-law-info-bar'], cookie: /^(cookieyes-consent|viewed_cookie_policy|cookielawinfo-checkbox-)/ },
  { id: 'iubenda', naam: 'iubenda', api: false, knoppen: ['.iubenda-cs-accept-btn'], weigerknoppen: ['.iubenda-cs-reject-btn'], banner: ['#iubenda-cs-banner'], cookie: /^_iub_cs-/ },
  { id: 'cookie_notice', naam: 'Cookie Notice', api: false, knoppen: ['#cn-accept-cookie'], weigerknoppen: ['#cn-refuse-cookie'], banner: ['#cookie-notice'], cookie: /^cookie_notice_accepted$/ },
  { id: 'moove_gdpr', naam: 'GDPR Cookie Compliance (Moove)', api: false, knoppen: ['.moove-gdpr-infobar-allow-all'], weigerknoppen: ['.moove-gdpr-infobar-reject-btn'], banner: ['#moove_gdpr_cookie_info_bar'], cookie: /^moove_gdpr_popup$/ },
  { id: 'borlabs', naam: 'Borlabs Cookie', api: false, knoppen: ['a[data-cookie-accept-all]', '.brlbs-btn-accept-all', '[data-borlabs-cookie-actions="accept-all"]'], weigerknoppen: ['[data-borlabs-cookie-actions="accept-only-essential"]'], banner: ['#BorlabsCookieBox'], cookie: /^borlabs-cookie/ },
  { id: 'osano_cookieconsent', naam: 'Osano / cookieconsent', api: false, knoppen: ['.osano-cm-accept-all', '.cc-btn.cc-allow', '.cc-btn.cc-dismiss'], weigerknoppen: ['.osano-cm-denyAll', '.cc-btn.cc-deny'], banner: ['.osano-cm-window', '.cc-window'], cookie: /^(cookieconsent_status|cc_cookie|osano_consentmanager)/ },
  { id: 'quantcast', naam: 'Quantcast Choice', api: false, knoppen: ['.qc-cmp2-summary-buttons button[mode="primary"]'], weigerknoppen: [], banner: ['#qc-cmp2-container'], cookie: /^euconsent-v2$/ },
  { id: 'trustarc', naam: 'TrustArc', api: false, knoppen: ['#truste-consent-button'], weigerknoppen: ['#truste-consent-required'], banner: ['#truste-consent-track', '.truste_box_overlay'], cookie: /^(notice_preferences|cmapi_cookie_privacy)$/ },
  { id: 'cookieinformation', naam: 'Cookie Information', api: false, knoppen: ['.coi-banner__accept'], weigerknoppen: [], banner: ['#coiOverlay'], cookie: /^CookieInformationConsent$/ },
  { id: 'termly', naam: 'Termly', api: false, knoppen: ['.t-acceptAllButton', '[data-tid="banner-accept"]'], weigerknoppen: ['.t-declineAllButton', '[data-tid="banner-decline"]'], banner: ['#termly-code-snippet-support'], cookie: /^TERMLY_API_CACHE$/ },
  { id: 'axeptio', naam: 'Axeptio', api: false, knoppen: ['#axeptio_btn_acceptAll'], weigerknoppen: ['#axeptio_btn_dismiss'], banner: ['#axeptio_overlay'], cookie: /^axeptio_/ },
];

/**
 * Teksten waaraan een accept-knop te herkennen is, van specifiek naar algemeen.
 * Korte woorden als "ok" staan achteraan en matchen alleen als hele knoptekst.
 */
const ACCEPT_TEKSTEN = [
  'alle cookies accepteren', 'alles accepteren', 'accepteer alle cookies', 'accepteer alles', 'alle cookies toestaan', 'alles toestaan',
  'accept all cookies', 'accept all', 'allow all cookies', 'allow all', 'agree to all', 'alle akzeptieren', 'tout accepter',
  'ik ga akkoord', 'ja, ik ga akkoord', 'akkoord en sluiten', 'accepteren en sluiten', 'accept and close',
  'cookies accepteren', 'accepteren', 'accepteer', 'toestaan', 'akkoord', 'accept cookies', 'allow cookies', 'i agree', 'i accept', 'agree', 'accept', 'allow',
  'begrepen', 'prima', 'got it', 'oké', 'ok',
];

/** Knoppen met deze woorden zijn geen "accepteer alles", ook al staat er "accept" in. */
const UITSLUITEN = /instelling|setting|voorkeur|preference|weiger|reject|decline|afwijz|noodzakelijk|necessary|essenti|only|alleen|selectie|selection|aanpass|manage|beheer|customi|meer|more|detail|lees|read|info|opslaan|save|sluit\b|close/i;

/** Teksten van een weigerknop, van specifiek naar algemeen. */
const WEIGER_TEKSTEN = [
  'alle cookies weigeren', 'alles weigeren', 'weiger alle cookies', 'weiger alles', 'cookies weigeren',
  'alleen noodzakelijke cookies', 'alleen noodzakelijke', 'enkel noodzakelijke cookies', 'alleen strikt noodzakelijke cookies',
  'alleen functionele cookies', 'alleen essentiële cookies', 'alleen functioneel', 'doorgaan zonder te accepteren', 'verder zonder cookies',
  'weigeren', 'weiger', 'afwijzen', 'niet akkoord', 'nee, bedankt', 'nee bedankt',
  'reject all cookies', 'reject all', 'reject cookies', 'decline all', 'deny all', 'refuse all',
  'only necessary cookies', 'only necessary', 'necessary cookies only', 'use necessary cookies only', 'only essential cookies',
  'continue without accepting', 'reject', 'decline', 'deny',
  'alle ablehnen', 'ablehnen', 'nur notwendige cookies', 'tout refuser', 'refuser',
];

/** Een weigerknop opent geen instellingen: knoppen met deze woorden slaan we over. */
const WEIGER_UITSLUITEN = /instelling|setting|voorkeur|preference|aanpass|customi|beheer|manage|meer|more|lees|read|info|details/i;

/** Hoe de knoppen in een banner heten, voor de bannerinspectie. */
const SOORT_PATRONEN = [
  ['weiger', /weiger|reject|decline|deny|refus|afwijz|noodzakelijk|necessary|essenti|niet akkoord|nee,? bedankt|ablehnen|without accept|zonder (te )?accept/i],
  ['instellingen', /instelling|voorkeur|aanpass|setting|preference|customi|beheer|manage|kies|choose|details|opties|options/i],
  ['accepteer', /accept|akkoord|toestaan|allow|agree|akzeptier|zustimm|begrepen|got it|prima|^ok[eé]?$|^oké$/i],
  ['sluiten', /^(sluiten|sluit|close|x|×|✕|✖)$/i],
];

/** Een aangevinkt vakje voor deze categorieën is normaal: die staan altijd aan. */
const ALTIJD_AAN = /noodzakelijk|necessary|essenti|functione|functional|strikt|strictly|required|vereist|technisch|technical/i;

/** Hoe een bezoeker een eerder gegeven toestemming terugvindt: zwevende knop van de CMP of een link. */
const INTREK_WIDGETS = [
  { selector: '#CookiebotWidget', naam: 'Cookiebot-widget' },
  { selector: '.cky-btn-revisit-wrapper', naam: 'CookieYes-knop' },
  { selector: '#cmplz-manage-consent .cmplz-manage-consent', naam: 'Complianz-knop' },
  { selector: '#ot-sdk-btn-floating', naam: 'OneTrust-knop' },
  { selector: '.iubenda-tp-btn', naam: 'iubenda-knop' },
  { selector: '#cookiescript_badge', naam: 'CookieScript-badge' },
  { selector: 'button[data-testid="uc-privacy-button"]', naam: 'Usercentrics-knop' },
  { selector: '#didomi-host .didomi-consent-popup-preferences, .didomi-notice-preferences', naam: 'Didomi-knop' },
];
const INTREK_TEKST = /cookie[- ]?(instellingen|voorkeuren|settings|preferences|beleid ?(&|en) ?instellingen)|cookies? (beheren|wijzigen|aanpassen)|wijzig (je |uw )?cookie|privacy[- ]?instellingen|toestemming (wijzigen|intrekken|beheren)|manage cookies|cookie consent|consent (settings|preferences)/i;

const RUST_NA_KEUZE_MS = 1500;
const POLL_MS = 250;
const GRATIE_MS = 5000; // een gedetecteerde CMP nog even de tijd geven om zijn API klaar te zetten

// --- In de pagina ------------------------------------------------------------------

/**
 * Alle CMP-API's op één plek. Wordt door Playwright in de pagina uitgevoerd
 * met { actie, id }; geeft { ok, resultaat } of { ok: false, fout } terug.
 *
 *   beschikbaar  is de API er?
 *   getoond      wordt de banner op dit moment aan de bezoeker getoond?
 *   accepteer    alles accepteren
 *   bevestigd    zegt de CMP zelf dat er nu geaccepteerd is?
 *   weiger       alles weigeren
 *   geweigerd    zegt de CMP zelf dat er nu geweigerd is?
 *   state        de staat volgens de CMP, voor in het rapport
 */
function paginaApi({ actie, id }) {
  const zichtbaar = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  };
  const veilig = (waarde) => {
    try {
      return JSON.parse(JSON.stringify(waarde === undefined ? null : waarde));
    } catch {
      return String(waarde);
    }
  };

  const API = {
    cookiescript: {
      beschikbaar: () => !!(window.CookieScript && window.CookieScript.instance && typeof window.CookieScript.instance.acceptAllAction === 'function'),
      getoond: () => zichtbaar(document.getElementById('cookiescript_injected')),
      accepteer: () => { window.CookieScript.instance.acceptAllAction(); },
      bevestigd: () => { const s = window.CookieScript.instance.currentState(); return !!s && s.action === 'accept'; },
      weiger: () => { window.CookieScript.instance.rejectAllAction(); },
      geweigerd: () => { const s = window.CookieScript.instance.currentState(); return !!s && s.action === 'reject'; },
      state: () => window.CookieScript.instance.currentState(),
    },
    cookiebot: {
      beschikbaar: () => !!(window.Cookiebot && typeof window.Cookiebot.submitCustomConsent === 'function'),
      getoond: () => zichtbaar(document.getElementById('CybotCookiebotDialog')),
      accepteer: () => {
        window.Cookiebot.submitCustomConsent(true, true, true);
        try { window.Cookiebot.hide(); } catch { /* de dialoog blijft anders soms staan; niet erg */ }
      },
      bevestigd: () => window.Cookiebot.consented === true && window.Cookiebot.hasResponse === true,
      weiger: () => {
        window.Cookiebot.submitCustomConsent(false, false, false);
        try { window.Cookiebot.hide(); } catch { /* zie boven */ }
      },
      geweigerd: () => window.Cookiebot.hasResponse === true && !!window.Cookiebot.consent
        && window.Cookiebot.consent.marketing === false && window.Cookiebot.consent.statistics === false,
      state: () => ({
        consented: window.Cookiebot.consented, declined: window.Cookiebot.declined, hasResponse: window.Cookiebot.hasResponse,
        consent: window.Cookiebot.consent && { preferences: window.Cookiebot.consent.preferences, statistics: window.Cookiebot.consent.statistics, marketing: window.Cookiebot.consent.marketing },
      }),
    },
    usercentrics: {
      // UC_UI is de "Browser UI API" (v2, ook onder de Wix-banner); __ucCmp is de v3-API en werkt met promises.
      beschikbaar: () => !!((window.UC_UI && typeof window.UC_UI.acceptAllConsents === 'function') || (window.__ucCmp && typeof window.__ucCmp.acceptAllConsents === 'function')),
      getoond: async () => {
        if (window.UC_UI && typeof window.UC_UI.isConsentRequired === 'function') return window.UC_UI.isConsentRequired() === true;
        if (window.__ucCmp && typeof window.__ucCmp.isConsentRequired === 'function') return (await window.__ucCmp.isConsentRequired()) === true;
        return false;
      },
      accepteer: async () => {
        if (window.UC_UI && typeof window.UC_UI.acceptAllConsents === 'function') await window.UC_UI.acceptAllConsents();
        else await window.__ucCmp.acceptAllConsents();
      },
      bevestigd: async () => {
        if (window.UC_UI && typeof window.UC_UI.areAllConsentsAccepted === 'function') return window.UC_UI.areAllConsentsAccepted() === true;
        const details = await window.__ucCmp.getConsentDetails();
        return /accept/i.test(String(details && details.consent && details.consent.status));
      },
      weiger: async () => {
        if (window.UC_UI && typeof window.UC_UI.denyAllConsents === 'function') await window.UC_UI.denyAllConsents();
        else await window.__ucCmp.denyAllConsents();
      },
      geweigerd: async () => {
        if (window.UC_UI && typeof window.UC_UI.isConsentRequired === 'function') {
          return window.UC_UI.isConsentRequired() === false && window.UC_UI.areAllConsentsAccepted() === false;
        }
        const details = await window.__ucCmp.getConsentDetails();
        return /den(y|ied)/i.test(String(details && details.consent && details.consent.status));
      },
      state: async () => {
        if (window.UC_UI) return { api: 'UC_UI', initialized: window.UC_UI.isInitialized && window.UC_UI.isInitialized(), consentRequired: window.UC_UI.isConsentRequired && window.UC_UI.isConsentRequired(), allAccepted: window.UC_UI.areAllConsentsAccepted && window.UC_UI.areAllConsentsAccepted() };
        const details = await window.__ucCmp.getConsentDetails();
        return { api: '__ucCmp', status: details && details.consent && details.consent.status };
      },
    },
    complianz: {
      beschikbaar: () => typeof window.cmplz_accept_all === 'function',
      getoond: () => [...document.querySelectorAll('#cmplz-cookiebanner-container, .cmplz-cookiebanner')].some(zichtbaar),
      accepteer: () => { window.cmplz_accept_all(); },
      bevestigd: () => (typeof window.cmplz_get_cookie === 'function' ? window.cmplz_get_cookie('marketing') === 'allow' : /cmplz_marketing=allow/.test(document.cookie)),
      weiger: () => { window.cmplz_deny_all(); },
      geweigerd: () => (typeof window.cmplz_get_cookie === 'function' ? window.cmplz_get_cookie('marketing') === 'deny' : /cmplz_marketing=deny/.test(document.cookie)),
      state: () => (typeof window.cmplz_get_cookie === 'function'
        ? { functional: window.cmplz_get_cookie('functional'), statistics: window.cmplz_get_cookie('statistics'), marketing: window.cmplz_get_cookie('marketing') }
        : { cookie: document.cookie.split(';').map((c) => c.trim()).filter((c) => c.startsWith('cmplz_')) }),
    },
    onetrust: {
      beschikbaar: () => !!(window.OneTrust && typeof window.OneTrust.AllowAll === 'function'),
      getoond: () => zichtbaar(document.getElementById('onetrust-banner-sdk')),
      accepteer: () => { window.OneTrust.AllowAll(); },
      bevestigd: () => typeof window.OnetrustActiveGroups === 'string' && window.OnetrustActiveGroups.split(',').filter(Boolean).length > 1,
      weiger: () => { window.OneTrust.RejectAll(); },
      // Na weigeren blijft alleen de groep met noodzakelijke cookies over, en is de banner gesloten.
      geweigerd: () => typeof window.OnetrustActiveGroups === 'string' && window.OnetrustActiveGroups.split(',').filter(Boolean).length <= 1
        && /OptanonAlertBoxClosed=/.test(document.cookie),
      state: () => ({ actieveGroepen: window.OnetrustActiveGroups }),
    },
    didomi: {
      beschikbaar: () => !!(window.Didomi && typeof window.Didomi.setUserAgreeToAll === 'function'),
      getoond: () => zichtbaar(document.getElementById('didomi-notice')) || zichtbaar(document.getElementById('didomi-host')),
      accepteer: () => { window.Didomi.setUserAgreeToAll(); },
      bevestigd: () => /didomi_token=/.test(document.cookie) && (typeof window.Didomi.isConsentRequired !== 'function' || window.Didomi.isConsentRequired() === false || !zichtbaar(document.getElementById('didomi-notice'))),
      weiger: () => { window.Didomi.setUserDisagreeToAll(); },
      geweigerd: () => /didomi_token=/.test(document.cookie) && !zichtbaar(document.getElementById('didomi-notice')),
      state: () => ({ consentRequired: window.Didomi.isConsentRequired && window.Didomi.isConsentRequired() }),
    },
    klaro: {
      beschikbaar: () => !!(window.klaro && typeof window.klaro.getManager === 'function'),
      getoond: () => [...document.querySelectorAll('#klaro .cookie-notice, #klaro .cookie-modal')].some(zichtbaar),
      accepteer: () => { const m = window.klaro.getManager(); m.changeAll(true); m.saveAndApplyConsents(); },
      bevestigd: () => window.klaro.getManager().confirmed === true,
      weiger: () => { const m = window.klaro.getManager(); m.changeAll(false); m.saveAndApplyConsents(); },
      geweigerd: () => window.klaro.getManager().confirmed === true,
      state: () => ({ confirmed: window.klaro.getManager().confirmed, consents: window.klaro.getManager().consents }),
    },
    tarteaucitron: {
      beschikbaar: () => !!(window.tarteaucitron && window.tarteaucitron.userInterface && typeof window.tarteaucitron.userInterface.respondAll === 'function'),
      getoond: () => zichtbaar(document.getElementById('tarteaucitronAlertBig')),
      accepteer: () => { window.tarteaucitron.userInterface.respondAll(true); },
      bevestigd: () => /tarteaucitron=/.test(document.cookie),
      weiger: () => { window.tarteaucitron.userInterface.respondAll(false); },
      geweigerd: () => /tarteaucitron=/.test(document.cookie),
      state: () => ({ cookie: (document.cookie.match(/tarteaucitron=([^;]*)/) || [])[1] || null }),
    },
    cookiefirst: {
      beschikbaar: () => !!(window.CookieFirst && typeof window.CookieFirst.acceptAllCategories === 'function'),
      getoond: () => [...document.querySelectorAll('[data-cookiefirst-widget="banner"]')].some(zichtbaar),
      accepteer: () => { window.CookieFirst.acceptAllCategories(); },
      bevestigd: () => !!(window.CookieFirst && window.CookieFirst.consent && Object.values(window.CookieFirst.consent).some(Boolean)),
      weiger: () => { window.CookieFirst.declineAllCategories(); },
      // Na weigeren staat alleen "necessary" nog aan.
      geweigerd: () => !!(window.CookieFirst && window.CookieFirst.consent)
        && Object.entries(window.CookieFirst.consent).every(([categorie, aan]) => categorie === 'necessary' || !aan),
      state: () => ({ consent: window.CookieFirst.consent }),
    },
    cookiecode: {
      // Op fitness-seller.nl bevestigd: consentAll / consentNone, en getState().consentValid na een keuze.
      beschikbaar: () => !!(window.CookieCode && typeof window.CookieCode.consentAll === 'function'),
      getoond: () => {
        const host = document.querySelector('cookiecode-banner');
        const root = host && host.shadowRoot && host.shadowRoot.querySelector('.cc_root');
        return zichtbaar(root);
      },
      accepteer: () => { window.CookieCode.consentAll(); window.CookieCode.hideBanner(); },
      bevestigd: () => window.CookieCode.getState().consentValid === true,
      weiger: () => { window.CookieCode.consentNone(); window.CookieCode.hideBanner(); },
      geweigerd: () => window.CookieCode.getState().consentValid === true,
      state: () => window.CookieCode.getState(),
    },
  };

  // Alles in één aanroep: per CMP of de API er is en of de banner getoond wordt.
  // Losse aanroepen zouden tientallen heen-en-weertjes met de browser kosten en
  // daarmee seconden aan meettijd, precies in de fase waarin de site nog laadt.
  if (actie === 'inventaris') {
    const namen = Object.keys(API);
    return Promise.all(namen.map(async (naam) => {
      const item = { id: naam, api_beschikbaar: false, banner_getoond: false };
      try {
        item.api_beschikbaar = API[naam].beschikbaar() === true;
        if (item.api_beschikbaar) item.banner_getoond = (await API[naam].getoond()) === true;
      } catch (error) {
        item.fout = String((error && error.message) || error);
      }
      return item;
    })).then((resultaat) => ({ ok: true, resultaat }));
  }

  const impl = API[id];
  if (!impl || typeof impl[actie] !== 'function') return { ok: false, fout: `geen API-implementatie voor ${id}.${actie}` };
  try {
    return Promise.resolve(impl[actie]())
      .then((resultaat) => ({ ok: true, resultaat: veilig(resultaat) }))
      .catch((error) => ({ ok: false, fout: String((error && error.message) || error) }));
  } catch (error) {
    return { ok: false, fout: String((error && error.message) || error) };
  }
}

// --- Hulpfuncties op de Node-kant --------------------------------------------------

/**
 * Roept `paginaApi` aan in de pagina. Navigeert de site precies op dat moment
 * (een CMP die na acceptatie herlaadt, of een redirect), dan gooit Playwright
 * "Execution context was destroyed". Dat is geen fout van de site maar een
 * kwestie van timing, dus we wachten de navigatie af en proberen het één keer
 * opnieuw.
 */
async function api(page, id, actie) {
  for (let poging = 0; poging < 2; poging += 1) {
    try {
      return await page.evaluate(paginaApi, { actie, id });
    } catch (error) {
      const melding = error.message.split('\n')[0];
      const navigatie = /execution context|destroyed|navigating|Target closed|frame was detached/i.test(melding);
      if (!navigatie || poging === 1) return { ok: false, fout: melding };
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    }
  }
  return { ok: false, fout: 'onbereikbaar' };
}

/** Playwright-locators kijken ook in open shadow roots; daarom hier en niet via querySelector. */
async function zichtbareLocator(page, selectors) {
  for (const selector of selectors || []) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return { selector, locator };
  }
  return null;
}

async function wachtTot(conditie, timeoutMs) {
  const einde = Date.now() + timeoutMs;
  for (;;) {
    if (await conditie()) return true;
    if (Date.now() >= einde) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function consentCookies(context, patroon) {
  if (!patroon) return [];
  const cookies = await context.cookies();
  return cookies.filter((cookie) => patroon.test(cookie.name)).map((cookie) => ({ naam: cookie.name, domein: cookie.domain, waarde: kort(cookie.value, 200) }));
}

/** Wat is er, per CMP, op dit moment aan te treffen? */
async function inventariseer(page) {
  // Stap 1: alle CMP-API's in één browser-aanroep.
  const inventaris = await api(page, null, 'inventaris');
  const perId = new Map((inventaris.ok ? inventaris.resultaat : []).map((item) => [item.id, item]));

  // Stap 2: de selectors. Dit moet via Playwright-locators en niet via
  // querySelector in de pagina, want locators kijken ook in open shadow roots
  // (Usercentrics, Didomi en CookieCode zetten hun banner daarin).
  const stand = [];
  for (const strategie of STRATEGIEEN) {
    const viaApi = perId.get(strategie.id);
    const item = {
      id: strategie.id,
      naam: strategie.naam,
      api_beschikbaar: !!viaApi?.api_beschikbaar,
      banner_getoond: !!viaApi?.banner_getoond,
      knop: null,
      weigerknop: null,
    };
    // Selectors alleen nalopen als de API nog geen uitsluitsel gaf: dat scheelt
    // op een site zonder CMP tientallen zoekopdrachten.
    if (!item.banner_getoond) item.banner_getoond = !!(await zichtbareLocator(page, strategie.banner));
    if (item.api_beschikbaar || item.banner_getoond) {
      item.knop = (await zichtbareLocator(page, strategie.knoppen))?.selector || null;
      item.weigerknop = (await zichtbareLocator(page, strategie.weigerknoppen))?.selector || null;
    }
    stand.push(item);
  }

  // Een CMP die nergens uit de inventaris komt kan nog steeds alleen een knop
  // hebben (CookieYes, iubenda); die controleren we apart en pas hier, zodat
  // het dure zoekwerk alleen gebeurt als er verder niets gevonden is.
  if (!stand.some((item) => item.api_beschikbaar || item.banner_getoond)) {
    for (const item of stand) {
      const strategie = STRATEGIEEN.find((s2) => s2.id === item.id);
      if (strategie.knoppen.length) item.knop = (await zichtbareLocator(page, strategie.knoppen))?.selector || null;
      if (strategie.weigerknoppen.length) item.weigerknop = (await zichtbareLocator(page, strategie.weigerknoppen))?.selector || null;
    }
  }

  return stand;
}

/**
 * Laatste redmiddel: een zichtbare knop met een herkenbare tekst, in een
 * element dat over cookies of privacy gaat. Geeft de locator en de tekst terug.
 */
async function zoekKnopOpTekst(page, teksten, uitsluiten) {
  for (const tekst of teksten) {
    const naam = new RegExp(`^\\s*${tekst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[!.]?\\s*$`, 'i');
    for (const rol of ['button', 'link']) {
      const kandidaten = page.getByRole(rol, { name: naam });
      const aantal = await kandidaten.count().catch(() => 0);
      for (let i = 0; i < Math.min(aantal, 5); i += 1) {
        const knop = kandidaten.nth(i);
        if (!(await knop.isVisible().catch(() => false))) continue;
        const info = await knop.evaluate((el) => {
          const eigen = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
          // Omhoog lopen, ook uit een shadow root: gaat de omliggende tekst over cookies?
          let node = el;
          for (let diepte = 0; node && diepte < 10; diepte += 1) {
            const tekst = (node.innerText || node.textContent || '').toLowerCase();
            if (tekst.length < 4000 && /cookie|privacy|consent|toestemming|tracking|gegevens/.test(tekst)) return { eigen, context: true };
            node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
          }
          return { eigen, context: false };
        }).catch(() => null);
        if (!info || !info.context || uitsluiten.test(info.eigen)) continue;
        return { locator: knop, tekst: info.eigen };
      }
    }
  }
  return null;
}

/**
 * Is er überhaupt een zichtbare banner die over cookies gaat? Los van of we
 * een knop herkennen. Met `markeer: true` krijgt het element een attribuut, zodat
 * de bannerinspectie het via een locator kan terugvinden (ook in een shadow root).
 */
async function bannerAchtigElement(page, { markeer = false } = {}) {
  return page.evaluate((markeer) => {
    const zichtbaar = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 80 && r.height > 30 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    };
    const doorzoek = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const gevonden = doorzoek(el.shadowRoot);
          if (gevonden) return gevonden;
        }
        const s = getComputedStyle(el);
        if (!['fixed', 'sticky'].includes(s.position) || !zichtbaar(el)) continue;
        const tekst = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (tekst.length > 4000 || !/cookie|privacy|consent|toestemming/i.test(tekst)) continue;
        if (markeer) el.setAttribute('data-consentcheck-banner', '1');
        return { tag: el.tagName.toLowerCase(), id: el.id || null, tekst: tekst.slice(0, 160) };
      }
      return null;
    };
    try {
      return doorzoek(document);
    } catch {
      return null;
    }
  }, markeer).catch(() => null);
}

// --- Accepteren of weigeren --------------------------------------------------------------

/** Wat per keuze verschilt: API-actie, bevestiging, knoppen en teksten. */
const KEUZES = {
  accepteer: { actie: 'accepteer', bevestiging: 'bevestigd', knoppen: 'knoppen', knop: 'knop', teksten: ACCEPT_TEKSTEN, uitsluiten: UITSLUITEN, werkwoord: 'accepteren' },
  weiger: { actie: 'weiger', bevestiging: 'geweigerd', knoppen: 'weigerknoppen', knop: 'weigerknop', teksten: WEIGER_TEKSTEN, uitsluiten: WEIGER_UITSLUITEN, werkwoord: 'weigeren' },
};

/**
 * Accepteert of weigert alles en bevestigt dat. `voorKeuze` wordt aangeroepen
 * vlak vóór de eerste klik of API-aanroep, zodat de scanner vanaf dat moment
 * requests in de nieuwe fase kan labelen.
 *
 * Geeft terug:
 *   { gelukt: true,  cmps: [...], methode, geprobeerd: [...], ... }
 *   { gelukt: false, methode: 'geen_banner' | 'geen_cmp', ... }   niets te kiezen
 *   { gelukt: false, methode: null, reden, ... }                  banner, maar het lukte niet
 */
async function geefKeuze(page, context, { keuze, timeoutMs, cmps = [], voorKeuze = () => {} }) {
  const k = KEUZES[keuze];
  const gestart = Date.now();
  const gedetecteerd = new Set(cmps.filter((cmp) => cmp.actief).map((cmp) => cmp.id));

  // Een gedetecteerde CMP die zijn API of banner nog niet klaar heeft, krijgt kort de tijd.
  let stand = await inventariseer(page);
  const bruikbaar = (item) => item.api_beschikbaar || item.banner_getoond || item[k.knop];
  if (!stand.some(bruikbaar) && gedetecteerd.size > 0) {
    await wachtTot(async () => {
      stand = await inventariseer(page);
      return stand.some(bruikbaar);
    }, GRATIE_MS);
  }

  // Alleen CMP's waarvan de banner echt getoond wordt komen in aanmerking; eerst
  // de gedetecteerde, dan de rest in tabelvolgorde.
  const kandidaten = stand
    .filter((item) => item.banner_getoond || item[k.knop])
    .sort((a, b) => Number(gedetecteerd.has(b.id)) - Number(gedetecteerd.has(a.id)));
  const overgeslagen = stand
    .filter((item) => item.api_beschikbaar && !item.banner_getoond && !item[k.knop])
    .map((item) => ({ cmp: item.naam, id: item.id, methode: null, gelukt: false, reden: `CMP is geladen maar toont geen banner; een bezoeker kan hier niets ${k.werkwoord}` }));

  const geprobeerd = [...overgeslagen];
  const gelukt = [];
  let begonnen = false;
  const markeerStart = () => {
    if (begonnen) return;
    begonnen = true;
    voorKeuze();
  };

  for (const item of kandidaten) {
    const strategie = STRATEGIEEN.find((s) => s.id === item.id);
    const poging = { cmp: strategie.naam, id: strategie.id, methode: null, gelukt: false, reden: null, state_voor: null, state_na: null };

    if (item.api_beschikbaar) {
      poging.state_voor = (await api(page, strategie.id, 'state')).resultaat ?? null;
      markeerStart();
      const aanroep = await api(page, strategie.id, k.actie);
      if (aanroep.ok) {
        poging.methode = `${strategie.id}_api`;
        const bevestigd = await wachtTot(async () => (await api(page, strategie.id, k.bevestiging)).resultaat === true, timeoutMs);
        poging.state_na = (await api(page, strategie.id, 'state')).resultaat ?? null;
        if (bevestigd) poging.gelukt = true;
        else poging.reden = `API aangeroepen, maar de CMP bevestigt het ${k.werkwoord} niet`;
      } else {
        poging.reden = `API gaf een fout: ${aanroep.fout}`;
      }
    }

    if (!poging.gelukt && item[k.knop]) {
      // De officiële knop van deze CMP. Bevestiging: de CMP-API als die er is, anders de banner die verdwijnt of het consentcookie dat verschijnt.
      const knop = await zichtbareLocator(page, [item[k.knop]]);
      if (knop) {
        markeerStart();
        const geklikt = await knop.locator.click({ timeout: 5000 }).then(() => true).catch((error) => { poging.reden = `klikken op ${item[k.knop]} mislukt: ${error.message.split('\n')[0]}`; return false; });
        if (geklikt) {
          poging.methode = `${strategie.id}_knop`;
          const bevestigd = await wachtTot(async () => {
            if (item.api_beschikbaar) return (await api(page, strategie.id, k.bevestiging)).resultaat === true;
            const bannerWeg = !(await zichtbareLocator(page, strategie.banner));
            const cookie = (await consentCookies(context, strategie.cookie)).length > 0;
            return bannerWeg || cookie;
          }, timeoutMs);
          if (item.api_beschikbaar) poging.state_na = (await api(page, strategie.id, 'state')).resultaat ?? null;
          poging.gelukt = bevestigd;
          if (!bevestigd) poging.reden = `op ${item[k.knop]} geklikt, maar de banner bleef staan en er verscheen geen consentcookie`;
        }
      }
    }

    if (!poging.methode && !poging.reden) poging.reden = `banner gezien, maar geen API en geen herkende knop om te ${k.werkwoord}`;
    geprobeerd.push(poging);
    if (poging.gelukt) gelukt.push(poging);
  }

  // Niets herkend: kijken of er überhaupt een banner staat, en zo ja, een knop op tekst proberen.
  if (gelukt.length === 0) {
    const banner = await bannerAchtigElement(page);
    const knop = await zoekKnopOpTekst(page, k.teksten, k.uitsluiten);

    if (knop) {
      const poging = { cmp: 'onbekend', id: null, methode: 'knop_tekstherkenning', gelukt: false, reden: null, knop_tekst: knop.tekst };
      const cookiesVoor = (await context.cookies()).length;
      markeerStart();
      const geklikt = await knop.locator.click({ timeout: 5000 }).then(() => true).catch((error) => { poging.reden = `klikken mislukt: ${error.message.split('\n')[0]}`; return false; });
      if (geklikt) {
        const bevestigd = await wachtTot(async () => {
          const weg = !(await knop.locator.isVisible().catch(() => false));
          const meerCookies = (await context.cookies()).length > cookiesVoor;
          return weg || meerCookies;
        }, timeoutMs);
        poging.gelukt = bevestigd;
        if (!bevestigd) poging.reden = `op "${knop.tekst}" geklikt, maar de knop bleef zichtbaar en er kwamen geen cookies bij`;
      }
      geprobeerd.push(poging);
      if (poging.gelukt) gelukt.push(poging);
    } else if (!banner && kandidaten.length === 0) {
      // Geen banner, geen knop, geen CMP met een getoonde banner: er valt niets te kiezen.
      const aanwezig = stand.filter((item) => item.api_beschikbaar).map((item) => item.naam);
      const cmpNamen = cmps.map((cmp) => cmp.naam);
      const alle = [...new Set([...aanwezig, ...cmpNamen])];
      return {
        gelukt: false,
        methode: alle.length ? 'geen_banner' : 'geen_cmp',
        cmps: [],
        cmps_aanwezig: alle,
        reden: alle.length
          ? `Er is een CMP geladen (${alle.join(', ')}) maar die toont geen banner, dus een bezoeker krijgt niets te kiezen.`
          : 'Geen cookiebanner en geen CMP aangetroffen: de site vraagt geen toestemming.',
        geprobeerd,
        duur_ms: Date.now() - gestart,
      };
    }
  }

  if (gelukt.length === 0) {
    const banner = await bannerAchtigElement(page);
    const redenen = geprobeerd.filter((p) => p.reden).map((p) => `${p.cmp}: ${p.reden}`);
    return {
      gelukt: false,
      methode: null,
      cmps: [],
      reden: `Er staat een cookiebanner${banner?.tekst ? ` ("${kort(banner.tekst, 80)}")` : ''}, maar ${k.werkwoord} is niet gelukt.${redenen.length ? ` ${redenen.join('; ')}.` : ''}`,
      geprobeerd,
      duur_ms: Date.now() - gestart,
    };
  }

  // Even wachten zodat de CMP zijn eigen opruimwerk (banner weg, cookie schrijven) kan afmaken.
  await page.waitForTimeout(RUST_NA_KEUZE_MS);

  const cookies = [];
  for (const poging of gelukt) {
    const strategie = STRATEGIEEN.find((s) => s.id === poging.id);
    if (strategie) cookies.push(...(await consentCookies(context, strategie.cookie)));
  }

  return {
    gelukt: true,
    cmps: gelukt.map((p) => p.cmp),
    methode: gelukt.map((p) => p.methode).join('+'),
    geprobeerd,
    cookies,
    duur_ms: Date.now() - gestart,
  };
}

/**
 * Geeft consent. Zelfde contract als altijd: `{ gegeven: true, ... }`,
 * `{ gegeven: false, methode: 'geen_banner' | 'geen_cmp' }`, en een
 * fail('consent', ...) als er wél een banner is maar accepteren niet lukt.
 */
export async function geefConsent(page, context, { timeoutMs, cmps = [], voorAccept = () => {} }) {
  const uitkomst = await geefKeuze(page, context, { keuze: 'accepteer', timeoutMs, cmps, voorKeuze: voorAccept });
  if (uitkomst.gelukt) {
    const { gelukt, ...rest } = uitkomst;
    return { gegeven: true, ...rest };
  }
  if (uitkomst.methode === 'geen_banner' || uitkomst.methode === 'geen_cmp') {
    const { gelukt, ...rest } = uitkomst;
    return { gegeven: false, ...rest };
  }
  throw fail('consent', uitkomst.reden, { geprobeerd: uitkomst.geprobeerd });
}

/**
 * Weigert alles. Gooit nooit: lukt weigeren niet, dan is dat zelf een
 * bevinding (`gelukt: false` met de reden), geen reden om de scan te stoppen.
 */
export async function weigerConsent(page, context, { timeoutMs, cmps = [], voorWeigeren = () => {} }) {
  return geefKeuze(page, context, { keuze: 'weiger', timeoutMs, cmps, voorKeuze: voorWeigeren });
}

// --- De banner zelf ----------------------------------------------------------------------

/** Wat voor knop is dit, op zijn tekst? */
function soortKnop(tekst) {
  const schoon = String(tekst || '').replace(/\s+/g, ' ').trim();
  if (!schoon) return 'overig';
  return SOORT_PATRONEN.find(([, patroon]) => patroon.test(schoon))?.[0] || 'overig';
}

/**
 * Bekijkt de banner zoals een bezoeker hem als eerste ziet: welke knoppen
 * staan er (en hoe groot), staan er vakjes vooraf aan, en blokkeert hij de
 * site. Klikt nergens op. Geeft feiten; de weging staat in lib/prioriteit.js.
 */
export async function inspecteerBanner(page) {
  // De banner vinden: eerst via de selectors van een bekende CMP, anders het
  // eerste vaste element dat over cookies gaat.
  let cmp = null;
  let locator = null;
  for (const strategie of STRATEGIEEN) {
    const gevonden = await zichtbareLocator(page, strategie.banner);
    if (gevonden) {
      cmp = strategie;
      locator = gevonden.locator;
      break;
    }
  }
  if (!locator) {
    const gevonden = await bannerAchtigElement(page, { markeer: true });
    if (!gevonden) return { gevonden: false };
    locator = page.locator('[data-consentcheck-banner]').first();
  }

  const inhoud = await locator.evaluate((banner) => {
    const zichtbaar = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
    };
    const tekstVan = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const alle = [];
    const verzamel = (root) => {
      for (const el of root.querySelectorAll('*')) {
        alle.push(el);
        if (el.shadowRoot) verzamel(el.shadowRoot);
      }
    };
    verzamel(banner);
    if (banner.shadowRoot) verzamel(banner.shadowRoot);

    const knoppen = alle
      .filter((el) => el.matches('button, a, [role="button"], input[type="button"], input[type="submit"]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { tekst: tekstVan(el), zichtbaar: zichtbaar(el), oppervlak: Math.round(r.width * r.height) };
      })
      .filter((k) => k.tekst);

    const vakjes = alle
      .filter((el) => el.matches('input[type="checkbox"], [role="switch"], [role="checkbox"]'))
      .map((el) => {
        const aan = el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true';
        const uit = el.matches('input') ? el.disabled : el.getAttribute('aria-disabled') === 'true';
        const label = (el.labels && el.labels[0] && el.labels[0].innerText)
          || el.getAttribute('aria-label')
          || (el.closest('label') && el.closest('label').innerText)
          || (el.parentElement && el.parentElement.innerText)
          || '';
        return { label: label.replace(/\s+/g, ' ').trim().slice(0, 80), aangevinkt: aan, uitgeschakeld: uit, zichtbaar: zichtbaar(el) };
      });

    const r = banner.getBoundingClientRect();
    const breed = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const hoog = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const overflow = (el) => (el ? getComputedStyle(el).overflow + getComputedStyle(el).overflowY : '');
    return {
      tekst: (banner.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      knoppen,
      vakjes,
      bedekking_procent: Math.round((breed * hoog * 100) / Math.max(1, innerWidth * innerHeight)),
      scroll_geblokkeerd: /hidden/.test(overflow(document.body) + overflow(document.documentElement)),
    };
  }).catch((error) => ({ fout: error.message.split('\n')[0] }));
  if (inhoud.fout) return { gevonden: true, cmp: cmp?.naam || null, fout: inhoud.fout };

  // De officiële knoppen van de CMP wegen zwaarder dan de tekst: CookieCode
  // noemt zijn "alles accepteren"-knop bijvoorbeeld "Sluiten".
  const officieel = async (selectors) => {
    const gevonden = await zichtbareLocator(page, selectors || []);
    if (!gevonden) return null;
    const tekst = (await gevonden.locator.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const doos = await gevonden.locator.boundingBox().catch(() => null);
    return { tekst, oppervlak: doos ? Math.round(doos.width * doos.height) : null };
  };
  const accepteerOfficieel = cmp ? await officieel(cmp.knoppen) : null;
  const weigerOfficieel = cmp ? await officieel(cmp.weigerknoppen) : null;

  const knoppen = inhoud.knoppen.map((knop) => ({ ...knop, soort: soortKnop(knop.tekst) }));
  const zichtbaarVan = (soort) => knoppen.filter((knop) => knop.zichtbaar && knop.soort === soort);
  const accepteer = accepteerOfficieel || zichtbaarVan('accepteer').sort((a, b) => b.oppervlak - a.oppervlak)[0] || null;
  const weiger = weigerOfficieel || zichtbaarVan('weiger').sort((a, b) => b.oppervlak - a.oppervlak)[0] || null;

  const vooraf = inhoud.vakjes.filter((vakje) => vakje.aangevinkt && !vakje.uitgeschakeld && !ALTIJD_AAN.test(vakje.label));

  return {
    gevonden: true,
    cmp: cmp?.naam || null,
    tekst: inhoud.tekst,
    knoppen,
    accepteerknop: accepteer ? { tekst: accepteer.tekst, oppervlak: accepteer.oppervlak, officieel: !!accepteerOfficieel } : null,
    // Zegt de knop die alles accepteert ook dat hij dat doet? "Sluiten" of "OK" doet dat niet.
    accepteerknop_tekst_duidelijk: accepteer ? /accept|akkoord|toestaan|allow|agree|akzeptier|zustimm|toestemming/i.test(accepteer.tekst) : null,
    weigerknop_eerste_laag: !!weiger,
    weigerknop: weiger ? { tekst: weiger.tekst, oppervlak: weiger.oppervlak, officieel: !!weigerOfficieel } : null,
    // Verhouding van de oppervlakken; onder 0,5 is de weigerknop minder dan half zo groot.
    weiger_t_o_v_accepteer: accepteer?.oppervlak && weiger?.oppervlak ? Math.round((weiger.oppervlak / accepteer.oppervlak) * 100) / 100 : null,
    instellingenknop: zichtbaarVan('instellingen').length > 0,
    vooraf_aangevinkt: vooraf.map((vakje) => ({ label: vakje.label, zichtbaar: vakje.zichtbaar })),
    bedekking_procent: inhoud.bedekking_procent,
    scroll_geblokkeerd: inhoud.scroll_geblokkeerd,
  };
}

/**
 * Kan een bezoeker zijn keuze later nog wijzigen? Gezocht ná het accepteren:
 * een zwevende knop van de CMP, of een link als "Cookie-instellingen".
 */
export async function zoekIntrekmogelijkheid(page) {
  for (const widget of INTREK_WIDGETS) {
    const locator = page.locator(widget.selector).first();
    if (await locator.count().catch(() => 0)) return { gevonden: true, hoe: widget.naam };
  }
  for (const rol of ['link', 'button']) {
    const kandidaten = page.getByRole(rol, { name: INTREK_TEKST });
    if (await kandidaten.count().catch(() => 0)) {
      // Een icoonknop heeft geen zichtbare tekst; dan zegt het aria-label wat hij doet.
      const tekst = await kandidaten.first().evaluate((el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim()).catch(() => '');
      return { gevonden: true, hoe: `${rol === 'link' ? 'link' : 'knop'} "${kort(tekst || 'zonder tekst', 60)}"` };
    }
  }
  return { gevonden: false, hoe: null };
}

/** Leesbare omschrijving van de gebruikte methode, voor console en interface. */
export function beschrijfMethode(consent) {
  if (!consent) return 'geen consent-stap';
  if (consent.gegeven === false || consent.gelukt === false) {
    if (consent.methode === 'geen_cmp') return 'geen cookiebanner en geen CMP aangetroffen';
    if (consent.methode === 'geen_banner') return 'CMP aanwezig, maar geen banner getoond';
    return 'niet gelukt';
  }
  return (consent.geprobeerd || [])
    .filter((p) => p.gelukt)
    .map((p) => {
      if (p.methode === 'knop_tekstherkenning') return `knop "${p.knop_tekst}" (tekstherkenning, geen bekende CMP)`;
      return p.methode.endsWith('_api') ? `${p.cmp}-API` : `officiële ${p.cmp}-knop`;
    })
    .join(' en ');
}
