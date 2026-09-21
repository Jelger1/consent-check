/**
 * Consent geven, voor elke CMP die we kennen.
 *
 * Volgorde van betrouwbaarheid, per CMP:
 *   1. de officiële JavaScript-API van de CMP (CookieScript, Cookiebot,
 *      Usercentrics, Complianz, OneTrust, Didomi, Klaro, tarteaucitron,
 *      CookieFirst) — de staat wordt daarna bij diezelfde API bevestigd;
 *   2. de officiële accept-knop van de CMP, herkend aan zijn vaste id of klasse;
 *   3. als laatste redmiddel een zichtbare knop met een accept-achtige tekst
 *      ("Alles accepteren", "Akkoord", "Accept all") in een element dat over
 *      cookies gaat. Dat is een gok, en het rapport zegt dat er dan ook bij.
 *
 * Een CMP wordt alleen bediend als zijn banner ook echt getoond wordt. Een CMP
 * die wel geladen is maar geen banner laat zien (verkeerde configuratie, of een
 * tweede CMP die door de eerste wordt onderdrukt) kan een bezoeker immers ook
 * niet accepteren; die staat in het rapport als "overgeslagen".
 *
 * Geen banner en geen CMP? Dan is dat het antwoord, geen fout: de scan levert
 * één meting op, met de melding dat er niets te accepteren viel.
 *
 * Elke aanroep in de pagina zit in `paginaApi`: één functie die Playwright
 * naar de browser serialiseert, met alle CMP-implementaties erin. Die mag dus
 * niets van buiten zichzelf gebruiken.
 */

import { fail, kort } from '../util.js';

/** Per CMP: naam, of er een API-implementatie is in paginaApi, en de vaste selectors. */
export const STRATEGIEEN = [
  { id: 'cookiescript', naam: 'CookieScript', api: true, knoppen: ['#cookiescript_accept'], banner: ['#cookiescript_injected'], cookie: /^CookieScriptConsent$/ },
  { id: 'cookiebot', naam: 'Cookiebot', api: true, knoppen: ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept', '#CybotCookiebotDialogBodyLevelButtonAccept'], banner: ['#CybotCookiebotDialog'], cookie: /^CookieConsent$/ },
  { id: 'usercentrics', naam: 'Usercentrics', api: true, knoppen: [], banner: ['#usercentrics-root', '#usercentrics-cmp-ui'], cookie: /^(uc_settings|uc_user_interaction|ucData|consent-policy)$/ },
  { id: 'complianz', naam: 'Complianz', api: true, knoppen: ['.cmplz-accept'], banner: ['#cmplz-cookiebanner-container', '.cmplz-cookiebanner'], cookie: /^cmplz_/ },
  { id: 'onetrust', naam: 'OneTrust', api: true, knoppen: ['#onetrust-accept-btn-handler', '#accept-recommended-btn-handler'], banner: ['#onetrust-banner-sdk', '#onetrust-consent-sdk'], cookie: /^OptanonConsent$/ },
  { id: 'didomi', naam: 'Didomi', api: true, knoppen: ['#didomi-notice-agree-button'], banner: ['#didomi-host', '#didomi-notice'], cookie: /^didomi_token$/ },
  { id: 'klaro', naam: 'Klaro', api: true, knoppen: ['.cm-btn-accept-all', '.cm-btn-success'], banner: ['#klaro', '.klaro .cookie-notice'], cookie: /^klaro$/ },
  { id: 'tarteaucitron', naam: 'tarteaucitron', api: true, knoppen: ['#tarteaucitronPersonalize2', '.tarteaucitronAllow'], banner: ['#tarteaucitronAlertBig', '#tarteaucitronRoot'], cookie: /^tarteaucitron$/ },
  { id: 'cookiefirst', naam: 'CookieFirst', api: true, knoppen: ['[data-cookiefirst-action="accept"]'], banner: ['[data-cookiefirst-widget="banner"]'], cookie: /^cookiefirst-consent$/ },
  { id: 'cookieyes', naam: 'CookieYes / GDPR Cookie Consent', api: false, knoppen: ['.cky-btn-accept', '#cookie_action_close_header', '.cli_action_button[data-cli_action="accept"]', '#wt-cli-accept-all-btn'], banner: ['.cky-consent-container', '#cookie-law-info-bar'], cookie: /^(cookieyes-consent|viewed_cookie_policy|cookielawinfo-checkbox-)/ },
  { id: 'iubenda', naam: 'iubenda', api: false, knoppen: ['.iubenda-cs-accept-btn'], banner: ['#iubenda-cs-banner'], cookie: /^_iub_cs-/ },
  { id: 'cookie_notice', naam: 'Cookie Notice', api: false, knoppen: ['#cn-accept-cookie'], banner: ['#cookie-notice'], cookie: /^cookie_notice_accepted$/ },
  { id: 'moove_gdpr', naam: 'GDPR Cookie Compliance (Moove)', api: false, knoppen: ['.moove-gdpr-infobar-allow-all'], banner: ['#moove_gdpr_cookie_info_bar'], cookie: /^moove_gdpr_popup$/ },
  { id: 'borlabs', naam: 'Borlabs Cookie', api: false, knoppen: ['a[data-cookie-accept-all]', '.brlbs-btn-accept-all', '[data-borlabs-cookie-actions="accept-all"]'], banner: ['#BorlabsCookieBox'], cookie: /^borlabs-cookie/ },
  { id: 'osano_cookieconsent', naam: 'Osano / cookieconsent', api: false, knoppen: ['.osano-cm-accept-all', '.cc-btn.cc-allow', '.cc-btn.cc-dismiss'], banner: ['.osano-cm-window', '.cc-window'], cookie: /^(cookieconsent_status|cc_cookie|osano_consentmanager)/ },
  { id: 'quantcast', naam: 'Quantcast Choice', api: false, knoppen: ['.qc-cmp2-summary-buttons button[mode="primary"]'], banner: ['#qc-cmp2-container'], cookie: /^euconsent-v2$/ },
  { id: 'trustarc', naam: 'TrustArc', api: false, knoppen: ['#truste-consent-button'], banner: ['#truste-consent-track', '.truste_box_overlay'], cookie: /^(notice_preferences|cmapi_cookie_privacy)$/ },
  { id: 'cookieinformation', naam: 'Cookie Information', api: false, knoppen: ['.coi-banner__accept'], banner: ['#coiOverlay'], cookie: /^CookieInformationConsent$/ },
  { id: 'termly', naam: 'Termly', api: false, knoppen: ['.t-acceptAllButton', '[data-tid="banner-accept"]'], banner: ['#termly-code-snippet-support'], cookie: /^TERMLY_API_CACHE$/ },
  { id: 'axeptio', naam: 'Axeptio', api: false, knoppen: ['#axeptio_btn_acceptAll'], banner: ['#axeptio_overlay'], cookie: /^axeptio_/ },
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

const RUST_NA_ACCEPT_MS = 1500;
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
      state: () => (typeof window.cmplz_get_cookie === 'function'
        ? { functional: window.cmplz_get_cookie('functional'), statistics: window.cmplz_get_cookie('statistics'), marketing: window.cmplz_get_cookie('marketing') }
        : { cookie: document.cookie.split(';').map((c) => c.trim()).filter((c) => c.startsWith('cmplz_')) }),
    },
    onetrust: {
      beschikbaar: () => !!(window.OneTrust && typeof window.OneTrust.AllowAll === 'function'),
      getoond: () => zichtbaar(document.getElementById('onetrust-banner-sdk')),
      accepteer: () => { window.OneTrust.AllowAll(); },
      bevestigd: () => typeof window.OnetrustActiveGroups === 'string' && window.OnetrustActiveGroups.split(',').filter(Boolean).length > 1,
      state: () => ({ actieveGroepen: window.OnetrustActiveGroups }),
    },
    didomi: {
      beschikbaar: () => !!(window.Didomi && typeof window.Didomi.setUserAgreeToAll === 'function'),
      getoond: () => zichtbaar(document.getElementById('didomi-notice')) || zichtbaar(document.getElementById('didomi-host')),
      accepteer: () => { window.Didomi.setUserAgreeToAll(); },
      bevestigd: () => /didomi_token=/.test(document.cookie) && (typeof window.Didomi.isConsentRequired !== 'function' || window.Didomi.isConsentRequired() === false || !zichtbaar(document.getElementById('didomi-notice'))),
      state: () => ({ consentRequired: window.Didomi.isConsentRequired && window.Didomi.isConsentRequired() }),
    },
    klaro: {
      beschikbaar: () => !!(window.klaro && typeof window.klaro.getManager === 'function'),
      getoond: () => [...document.querySelectorAll('#klaro .cookie-notice, #klaro .cookie-modal')].some(zichtbaar),
      accepteer: () => { const m = window.klaro.getManager(); m.changeAll(true); m.saveAndApplyConsents(); },
      bevestigd: () => window.klaro.getManager().confirmed === true,
      state: () => ({ confirmed: window.klaro.getManager().confirmed, consents: window.klaro.getManager().consents }),
    },
    tarteaucitron: {
      beschikbaar: () => !!(window.tarteaucitron && window.tarteaucitron.userInterface && typeof window.tarteaucitron.userInterface.respondAll === 'function'),
      getoond: () => zichtbaar(document.getElementById('tarteaucitronAlertBig')),
      accepteer: () => { window.tarteaucitron.userInterface.respondAll(true); },
      bevestigd: () => /tarteaucitron=/.test(document.cookie),
      state: () => ({ cookie: (document.cookie.match(/tarteaucitron=([^;]*)/) || [])[1] || null }),
    },
    cookiefirst: {
      beschikbaar: () => !!(window.CookieFirst && typeof window.CookieFirst.acceptAllCategories === 'function'),
      getoond: () => [...document.querySelectorAll('[data-cookiefirst-widget="banner"]')].some(zichtbaar),
      accepteer: () => { window.CookieFirst.acceptAllCategories(); },
      bevestigd: () => !!(window.CookieFirst && window.CookieFirst.consent && Object.values(window.CookieFirst.consent).some(Boolean)),
      state: () => ({ consent: window.CookieFirst.consent }),
    },
  };

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

async function api(page, id, actie) {
  try {
    return await page.evaluate(paginaApi, { actie, id });
  } catch (error) {
    return { ok: false, fout: error.message.split('\n')[0] };
  }
}

/** Playwright-locators kijken ook in open shadow roots; daarom hier en niet via querySelector. */
async function zichtbareLocator(page, selectors) {
  for (const selector of selectors) {
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
  const cookies = await context.cookies();
  return cookies.filter((cookie) => patroon.test(cookie.name)).map((cookie) => ({ naam: cookie.name, domein: cookie.domain, waarde: kort(cookie.value, 200) }));
}

/** Wat is er, per CMP, op dit moment aan te treffen? */
async function inventariseer(page) {
  const stand = [];
  for (const strategie of STRATEGIEEN) {
    const item = { id: strategie.id, naam: strategie.naam, api_beschikbaar: false, banner_getoond: false, knop: null };
    if (strategie.api) {
      const beschikbaar = await api(page, strategie.id, 'beschikbaar');
      item.api_beschikbaar = beschikbaar.ok && beschikbaar.resultaat === true;
      if (item.api_beschikbaar) {
        const getoond = await api(page, strategie.id, 'getoond');
        item.banner_getoond = getoond.ok && getoond.resultaat === true;
      }
    }
    if (!item.banner_getoond) {
      const banner = await zichtbareLocator(page, strategie.banner);
      item.banner_getoond = !!banner;
    }
    const knop = await zichtbareLocator(page, strategie.knoppen);
    item.knop = knop ? knop.selector : null;
    stand.push(item);
  }
  return stand;
}

/**
 * Laatste redmiddel: een zichtbare knop met accept-achtige tekst, in een
 * element dat over cookies of privacy gaat. Geeft de locator en de tekst terug.
 */
async function zoekAcceptKnop(page) {
  for (const tekst of ACCEPT_TEKSTEN) {
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
        if (!info || !info.context || UITSLUITEN.test(info.eigen)) continue;
        return { locator: knop, tekst: info.eigen };
      }
    }
  }
  return null;
}

/** Is er überhaupt een zichtbare banner die over cookies gaat? Los van of we een knop herkennen. */
async function bannerAchtigElement(page) {
  return page.evaluate(() => {
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
        return { tag: el.tagName.toLowerCase(), id: el.id || null, tekst: tekst.slice(0, 160) };
      }
      return null;
    };
    try {
      return doorzoek(document);
    } catch {
      return null;
    }
  }).catch(() => null);
}

// --- De consent-stap ------------------------------------------------------------------

/**
 * Geeft consent en bevestigt dat. `voorAccept` wordt aangeroepen vlak vóór de
 * eerste acceptatie, zodat de scanner vanaf dat moment requests als "ná
 * consent" kan labelen.
 *
 * Geeft terug:
 *   { gegeven: true,  cmps: [...], methode, geprobeerd: [...], ... }   consent gegeven
 *   { gegeven: false, methode: 'geen_banner' | 'geen_cmp', ... }       niets te accepteren
 * en gooit fail('consent', ...) als er wél een banner is maar accepteren niet lukt.
 */
export async function geefConsent(page, context, { timeoutMs, cmps = [], voorAccept = () => {} }) {
  const gestart = Date.now();
  const gedetecteerd = new Set(cmps.filter((cmp) => cmp.actief).map((cmp) => cmp.id));

  // Een gedetecteerde CMP die zijn API of banner nog niet klaar heeft, krijgt kort de tijd.
  let stand = await inventariseer(page);
  const bruikbaar = (item) => item.api_beschikbaar || item.banner_getoond || item.knop;
  if (!stand.some(bruikbaar) && gedetecteerd.size > 0) {
    await wachtTot(async () => {
      stand = await inventariseer(page);
      return stand.some(bruikbaar);
    }, GRATIE_MS);
  }

  // Alleen CMP's waarvan de banner echt getoond wordt komen in aanmerking; eerst
  // de gedetecteerde, dan de rest in tabelvolgorde.
  const kandidaten = stand
    .filter((item) => item.banner_getoond || item.knop)
    .sort((a, b) => Number(gedetecteerd.has(b.id)) - Number(gedetecteerd.has(a.id)));
  const overgeslagen = stand
    .filter((item) => item.api_beschikbaar && !item.banner_getoond && !item.knop)
    .map((item) => ({ cmp: item.naam, id: item.id, methode: null, gelukt: false, reden: 'CMP is geladen maar toont geen banner; een bezoeker kan hier niets accepteren' }));

  const geprobeerd = [...overgeslagen];
  const gelukt = [];
  let accepteerGestart = false;
  const markeerStart = () => {
    if (accepteerGestart) return;
    accepteerGestart = true;
    voorAccept();
  };

  for (const item of kandidaten) {
    const strategie = STRATEGIEEN.find((s) => s.id === item.id);
    const poging = { cmp: strategie.naam, id: strategie.id, methode: null, gelukt: false, reden: null, state_voor: null, state_na: null };

    if (item.api_beschikbaar) {
      poging.state_voor = (await api(page, strategie.id, 'state')).resultaat ?? null;
      markeerStart();
      const aanroep = await api(page, strategie.id, 'accepteer');
      if (aanroep.ok) {
        poging.methode = `${strategie.id}_api`;
        const bevestigd = await wachtTot(async () => (await api(page, strategie.id, 'bevestigd')).resultaat === true, timeoutMs);
        poging.state_na = (await api(page, strategie.id, 'state')).resultaat ?? null;
        if (bevestigd) {
          poging.gelukt = true;
        } else {
          poging.reden = 'API aangeroepen, maar de CMP bevestigt de acceptatie niet';
        }
      } else {
        poging.reden = `API gaf een fout: ${aanroep.fout}`;
      }
    }

    if (!poging.gelukt && item.knop) {
      // De officiële knop van deze CMP. Bevestiging: de CMP-API als die er is, anders de banner die verdwijnt of het consentcookie dat verschijnt.
      const knop = await zichtbareLocator(page, [item.knop]);
      if (knop) {
        markeerStart();
        const geklikt = await knop.locator.click({ timeout: 5000 }).then(() => true).catch((error) => { poging.reden = `klikken op ${item.knop} mislukt: ${error.message.split('\n')[0]}`; return false; });
        if (geklikt) {
          poging.methode = `${strategie.id}_knop`;
          const bevestigd = await wachtTot(async () => {
            if (item.api_beschikbaar) return (await api(page, strategie.id, 'bevestigd')).resultaat === true;
            const bannerWeg = !(await zichtbareLocator(page, strategie.banner));
            const cookie = (await consentCookies(context, strategie.cookie)).length > 0;
            return bannerWeg || cookie;
          }, timeoutMs);
          if (item.api_beschikbaar) poging.state_na = (await api(page, strategie.id, 'state')).resultaat ?? null;
          poging.gelukt = bevestigd;
          if (!bevestigd) poging.reden = `op ${item.knop} geklikt, maar de banner bleef staan en er verscheen geen consentcookie`;
        }
      }
    }

    if (!poging.methode && !poging.reden) poging.reden = 'banner gezien, maar geen API en geen herkende knop';
    geprobeerd.push(poging);
    if (poging.gelukt) gelukt.push(poging);
  }

  // Niets herkend: kijken of er überhaupt een banner staat, en zo ja, een accept-knop op tekst proberen.
  if (gelukt.length === 0) {
    const banner = await bannerAchtigElement(page);
    const knop = await zoekAcceptKnop(page);

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
      // Geen banner, geen knop, geen CMP met een getoonde banner: er valt niets te accepteren.
      const aanwezig = stand.filter((item) => item.api_beschikbaar).map((item) => item.naam);
      const cmpNamen = cmps.map((cmp) => cmp.naam);
      return {
        gegeven: false,
        methode: aanwezig.length || cmpNamen.length ? 'geen_banner' : 'geen_cmp',
        cmps: [],
        cmps_aanwezig: [...new Set([...aanwezig, ...cmpNamen])],
        reden: aanwezig.length || cmpNamen.length
          ? `Er is een CMP geladen (${[...new Set([...aanwezig, ...cmpNamen])].join(', ')}) maar die toont geen banner, dus een bezoeker krijgt niets te kiezen.`
          : 'Geen cookiebanner en geen CMP aangetroffen: de site vraagt geen toestemming.',
        geprobeerd,
        duur_ms: Date.now() - gestart,
      };
    }
  }

  if (gelukt.length === 0) {
    const banner = await bannerAchtigElement(page);
    const redenen = geprobeerd.filter((p) => p.reden).map((p) => `${p.cmp}: ${p.reden}`);
    throw fail('consent', `Er staat een cookiebanner${banner?.tekst ? ` ("${kort(banner.tekst, 80)}")` : ''}, maar accepteren is niet gelukt.${redenen.length ? ` ${redenen.join('; ')}.` : ''}`, { geprobeerd });
  }

  // Even wachten zodat de CMP zijn eigen opruimwerk (banner weg, cookie schrijven) kan afmaken.
  await page.waitForTimeout(RUST_NA_ACCEPT_MS);

  const cookies = [];
  for (const poging of gelukt) {
    const strategie = STRATEGIEEN.find((s) => s.id === poging.id);
    if (strategie) cookies.push(...(await consentCookies(context, strategie.cookie)));
  }

  return {
    gegeven: true,
    cmps: gelukt.map((p) => p.cmp),
    methode: gelukt.map((p) => p.methode).join('+'),
    geprobeerd,
    cookies,
    duur_ms: Date.now() - gestart,
  };
}

/** Leesbare omschrijving van de gebruikte methode, voor console en interface. */
export function beschrijfMethode(consent) {
  if (!consent) return 'geen consent-stap';
  if (!consent.gegeven) return consent.methode === 'geen_cmp' ? 'geen cookiebanner en geen CMP aangetroffen' : 'CMP aanwezig, maar geen banner getoond';
  return (consent.geprobeerd || [])
    .filter((p) => p.gelukt)
    .map((p) => {
      if (p.methode === 'knop_tekstherkenning') return `knop "${p.knop_tekst}" (tekstherkenning, geen bekende CMP)`;
      return p.methode.endsWith('_api') ? `${p.cmp}-API` : `officiële ${p.cmp}-knop`;
    })
    .join(' en ');
}
