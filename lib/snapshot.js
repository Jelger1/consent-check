/**
 * Momentopnamen van de browsertoestand: alle cookies in de context en een
 * DOM-snapshot (iframes, scripts, dataLayer, CMP-status, afgevuurde events).
 *
 * De DOM-snapshot draait in de pagina zelf en moet daarom serialiseerbaar
 * zijn: geen functies, geen DOM-nodes, geen circulaire structuren. Alles wat
 * de pagina ons kan aandoen (getters die gooien, gigantische dataLayers) is
 * afgevangen, zodat een rare site nooit een meting laat crashen.
 */

import { isExtern } from './domain.js';
import { classificeerCookie, herkenTagsInCode } from './trackers.js';
import { kort } from './util.js';

const MAX_COOKIE_WAARDE = 120;

// --- Cookies ---------------------------------------------------------------------

/** Alle cookies uit de context, dus ook third-party cookies gezet door iframes en pixels. */
export async function snapshotCookies(context, siteDomeinenSet) {
  const cookies = await context.cookies();
  return cookies.map((cookie) => {
    const { classificatie, tag } = classificeerCookie(cookie.name);
    const sessie = !(cookie.expires > 0);
    return {
      naam: cookie.name,
      waarde: kort(cookie.value, MAX_COOKIE_WAARDE),
      domein: cookie.domain,
      pad: cookie.path,
      is_third_party: isExtern(cookie.domain, siteDomeinenSet),
      is_sessie: sessie,
      verloopt: sessie ? null : new Date(cookie.expires * 1000).toISOString(),
      http_only: cookie.httpOnly,
      secure: cookie.secure,
      same_site: cookie.sameSite,
      classificatie,
      tag,
    };
  });
}

// --- DOM --------------------------------------------------------------------------

export async function snapshotDom(page, { cmpIds = [] } = {}) {
  let snapshot;
  try {
    snapshot = await page.evaluate(domSnapshot, { cmpIds });
  } catch (error) {
    return {
      fout: `DOM-snapshot mislukt: ${error.message.split('\n')[0]}`,
      url: null, titel: null, iframes: [], scripts: [], data_layer: null, google_consent_signalen: null,
      cmp_globals: {}, cmp_elementen: [], cookiescript: null, cookiebot: null, usercentrics: null, events: [], js_cookies: [],
      gtag_aanwezig: null, fbq_aanwezig: null,
    };
  }

  // De tagherkenning gebruikt de complete inline code, maar die hoort niet in
  // de JSON: na het herkennen blijft alleen het fragment over.
  for (const script of snapshot.scripts) {
    script.tags_genoemd = herkenTagsInCode(`${script.src || ''}\n${script.inline_code || ''}`);
    delete script.inline_code;
  }
  for (const iframe of snapshot.iframes) {
    iframe.tags_genoemd = herkenTagsInCode(`${iframe.src || ''}\n${iframe.src_effectief || ''}\n${iframe.data_src || ''}`);
  }
  return snapshot;
}

/**
 * Draait in de browser. Mag niets van buiten deze functie refereren.
 */
function domSnapshot({ cmpIds }) {
  const MAX_INLINE_CODE = 20000;
  const MAX_INLINE_FRAGMENT = 240;
  const MAX_DATALAYER_ENTRIES = 150;

  const kort = (tekst, max) => {
    if (tekst === null || tekst === undefined) return null;
    const s = String(tekst);
    return s.length > max ? `${s.slice(0, max)}…[+${s.length - max} tekens]` : s;
  };

  const zichtbaar = (element) => {
    try {
      const rect = element.getBoundingClientRect();
      const stijl = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && stijl.display !== 'none' && stijl.visibility !== 'hidden' && stijl.opacity !== '0';
    } catch {
      return null;
    }
  };

  const positie = (element) => (element.closest('head') ? 'head' : element.closest('body') ? 'body' : 'onbekend');

  const dataAttributen = (element) => {
    const data = {};
    for (const attribuut of element.attributes) {
      if (attribuut.name.startsWith('data-')) data[attribuut.name] = kort(attribuut.value, 200);
    }
    return data;
  };

  /** JSON-veilige kopie: Arguments worden arrays, DOM-nodes en functies een label, diepte begrensd. */
  const veilig = (waarde) => {
    const gezien = new WeakSet();
    const loop = (x, diepte) => {
      if (x === null || x === undefined) return x ?? null;
      if (typeof x === 'function') return '[function]';
      if (typeof x === 'string') return kort(x, 300);
      if (typeof x !== 'object') return x;
      if (diepte > 4) return '[…]';
      if (gezien.has(x)) return '[circulair]';
      gezien.add(x);
      if (typeof Node !== 'undefined' && x instanceof Node) return '[element]';
      if (Array.isArray(x) || Object.prototype.toString.call(x) === '[object Arguments]') {
        return Array.from(x).slice(0, 30).map((item) => loop(item, diepte + 1));
      }
      const kopie = {};
      let aantal = 0;
      for (const sleutel of Object.keys(x)) {
        if (aantal++ >= 40) {
          kopie['…'] = 'meer velden weggelaten';
          break;
        }
        try {
          kopie[sleutel] = loop(x[sleutel], diepte + 1);
        } catch {
          kopie[sleutel] = '[niet leesbaar]';
        }
      }
      return kopie;
    };
    try {
      return loop(waarde, 0);
    } catch {
      return '[niet serialiseerbaar]';
    }
  };

  const iframes = Array.from(document.querySelectorAll('iframe')).map((frame, index) => {
    const rect = frame.getBoundingClientRect();
    const ouder = frame.parentElement;
    return {
      index,
      src: kort(frame.getAttribute('src'), 500),
      src_effectief: kort(frame.src || '', 500),
      data_src: kort(frame.getAttribute('data-src') || frame.getAttribute('data-lazy-src') || null, 500),
      srcdoc: frame.hasAttribute('srcdoc'),
      id: frame.id || null,
      name: frame.getAttribute('name') || null,
      title: frame.getAttribute('title') || null,
      class: kort(frame.getAttribute('class') || '', 120) || null,
      breedte: Math.round(rect.width),
      hoogte: Math.round(rect.height),
      zichtbaar: zichtbaar(frame),
      positie: positie(frame),
      sandbox: frame.getAttribute('sandbox'),
      loading: frame.getAttribute('loading'),
      data: dataAttributen(frame),
      ouder: ouder ? `${ouder.tagName.toLowerCase()}${ouder.id ? `#${ouder.id}` : ''}` : null,
    };
  });

  const scripts = Array.from(document.scripts).map((script, index) => {
    const inline = script.src ? '' : (script.textContent || '').trim();
    return {
      index,
      src: kort(script.getAttribute('src'), 500),
      type: script.getAttribute('type') || null,
      async: script.async,
      defer: script.defer,
      id: script.id || null,
      charset: script.getAttribute('charset') || null,
      positie: positie(script),
      data: dataAttributen(script),
      inline_lengte: inline.length,
      inline_fragment: inline ? kort(inline, MAX_INLINE_FRAGMENT) : null,
      inline_code: inline ? inline.slice(0, MAX_INLINE_CODE) : null,
    };
  });

  const dataLayer = (() => {
    try {
      const dl = window.dataLayer;
      if (!Array.isArray(dl)) return null;
      const items = dl.slice(0, MAX_DATALAYER_ENTRIES).map((item) => veilig(item));
      if (dl.length > MAX_DATALAYER_ENTRIES) items.push(`[…${dl.length - MAX_DATALAYER_ENTRIES} entries weggelaten]`);
      return items;
    } catch (error) {
      return { fout: String(error) };
    }
  })();

  // Consent Mode-status zoals gtag/GTM hem intern bijhoudt (default én update per type).
  const googleConsentSignalen = (() => {
    try {
      const entries = window.google_tag_data?.ics?.entries;
      return entries ? veilig(entries) : null;
    } catch {
      return null;
    }
  })();

  const cmpGlobals = {
    CookieScript: !!window.CookieScript,
    Cookiebot: !!window.Cookiebot,
    OneTrust: !!window.OneTrust,
    Optanon: !!window.Optanon,
    complianz: Object.keys(window).some((sleutel) => sleutel.startsWith('cmplz')),
    CookieYes: !!(window.CookieYes || window.cookieyes),
    CLI_Cookie: !!window.CLI_Cookie,
    iubenda: !!window._iub,
    UC_UI: !!window.UC_UI,
    Didomi: !!window.Didomi,
    __tcfapi: typeof window.__tcfapi === 'function',
    klaro: !!window.klaro,
    BorlabsCookie: !!window.BorlabsCookie,
    tarteaucitron: !!window.tarteaucitron,
    Osano: !!window.Osano,
    cookieconsent: !!window.cookieconsent,
    CookieFirst: !!window.CookieFirst,
    CookieInformation: !!window.CookieInformation,
    cn_cookie_notice: typeof window.cn_cookie_notice_accepted !== 'undefined',
  };

  const cookiescript = (() => {
    try {
      const cs = window.CookieScript;
      const instance = cs && cs.instance;
      const banner = document.getElementById('cookiescript_injected');
      return {
        aanwezig: !!cs,
        instance: !!instance,
        versie: instance?.version ?? null,
        state: instance && typeof instance.currentState === 'function' ? veilig(instance.currentState()) : null,
        categorieen: instance && typeof instance.categories === 'function' ? veilig(instance.categories()) : null,
        banner_in_dom: !!banner,
        banner_zichtbaar: banner ? zichtbaar(banner) : false,
        data: window.CookieScriptData
          ? veilig({
            enabledConsentMode: window.CookieScriptData.enabledConsentMode,
            useGoogleTemplate: window.CookieScriptData.useGoogleTemplate,
          })
          : null,
      };
    } catch (error) {
      return { aanwezig: !!window.CookieScript, fout: String(error) };
    }
  })();

  const cookiebot = (() => {
    try {
      const cb = window.Cookiebot;
      if (!cb) return null;
      const dialoog = document.getElementById('CybotCookiebotDialog');
      return {
        consented: cb.consented ?? null,
        declined: cb.declined ?? null,
        hasResponse: cb.hasResponse ?? null,
        consent: veilig(cb.consent),
        banner_in_dom: !!dialoog,
        banner_zichtbaar: dialoog ? zichtbaar(dialoog) : false,
      };
    } catch (error) {
      return { fout: String(error) };
    }
  })();

  const usercentrics = (() => {
    try {
      if (!window.UC_UI) return null;
      return {
        init: typeof window.UC_UI.isInitialized === 'function' ? window.UC_UI.isInitialized() : null,
        consent_vereist: typeof window.UC_UI.isConsentRequired === 'function' ? window.UC_UI.isConsentRequired() : null,
        alles_geaccepteerd: typeof window.UC_UI.areAllConsentsAccepted === 'function' ? window.UC_UI.areAllConsentsAccepted() : null,
      };
    } catch (error) {
      return { fout: String(error) };
    }
  })();

  return {
    url: location.href,
    titel: kort(document.title, 200),
    ready_state: document.readyState,
    iframes,
    scripts,
    data_layer: dataLayer,
    google_consent_signalen: googleConsentSignalen,
    gtag_aanwezig: typeof window.gtag === 'function',
    fbq_aanwezig: typeof window.fbq === 'function',
    cmp_globals: cmpGlobals,
    cmp_elementen: (cmpIds || []).filter((id) => !!document.getElementById(id)),
    cookiescript,
    cookiebot,
    usercentrics,
    events: (window.__consentCheck && window.__consentCheck.events) || [],
    js_cookies: document.cookie ? document.cookie.split(';').map((c) => c.trim().split('=')[0]).filter(Boolean) : [],
  };
}
