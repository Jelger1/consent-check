/**
 * Regel 5: hoe wordt de CMP ingeladen?
 *
 * Voor de belangrijkste CMP op de pagina: staat het script in de HTML of is
 * het geïnjecteerd (door GTM), in de head of de body, synchroon of async, en
 * welke trackers waren al onderweg toen het CMP-script werd opgevraagd. Dat
 * laatste is waar het bij de laadpositie om gaat: een CMP die na de tags komt,
 * kan die tags niet meer tegenhouden.
 *
 * Werkt voor elke CMP uit lib/cmp/detect.js; CookieScript en Cookiebot leveren
 * daarnaast hun eigen status en versie, omdat de DOM-snapshot die uitleest.
 */

import { kort } from '../util.js';

/**
 * Het script dat de CMP zelf is, per CMP. Nodig omdat de herkenningspatronen
 * uit detect.js ruim zijn: op complianz.io bevat élke script-URL "complianz",
 * en van Cookiebot laden er naast uc.js ook configuratie- en rapportscripts.
 */
const HOOFDSCRIPT = {
  cookiescript: /\/s\/[a-f0-9]{32}\.js$/i,
  cookiebot: /\/uc\.js$/i,
  usercentrics: /\/(loader|bundle)\.js$/i,
  complianz: /\/cookiebanner\/js\/complianz(\.min)?\.js$/i,
  onetrust: /(otSDKStub|scripttemplates\/otSDKStub)\.js$/i,
  didomi: /\/loader\.js$/i,
  cookieyes: /\/script\.js$/i,
  cookiefirst: /consent\.cookiefirst\.com/i,
  klaro: /klaro(-no-css)?(\.min)?\.js$/i,
  tarteaucitron: /tarteaucitron(\.min)?\.js$/i,
};

/** Het CMP-script uit een lijst kandidaten: liefst het hoofdscript, anders het eerste dat past. */
function kiesScript(scripts, past, hoofd) {
  const kandidaten = scripts.filter((script) => script.src && past(script.src));
  return (hoofd && kandidaten.find((script) => hoofd.test(script.src.split('?')[0]))) || kandidaten[0] || null;
}

/** Het event dat de CMP afvuurt als hij klaarstaat, per CMP (vastgelegd door initScript in lib/browser.js). */
const GELADEN_EVENT = {
  cookiescript: 'CookieScriptLoaded',
  cookiebot: 'CookiebotOnLoad',
};

export function beschrijfLaadpositie(cmp, { html, dom, requests, events }) {
  if (!cmp) return null;
  const past = (tekst) => cmp.scripts.some((patroon) => patroon.test(tekst || ''));

  const hoofd = HOOFDSCRIPT[cmp.id];
  const htmlScript = kiesScript(html?.scripts || [], past, hoofd);
  const domScript = kiesScript(dom?.scripts || [], past, hoofd);
  const scriptRequests = requests.filter((request) => past(`${request.host}${request.pad}`));
  const hoofdRequest = (hoofd && scriptRequests.find((request) => hoofd.test(request.pad) || hoofd.test(`${request.host}${request.pad}`)))
    || scriptRequests.find((request) => request.resource_type === 'script')
    || scriptRequests[0]
    || null;
  const initiator = hoofdRequest?.initiator || null;
  const stack = initiator?.stack || [];
  const viaGtmStack = stack.some((url) => /googletagmanager\.com/i.test(url));

  let geladenVia;
  if (viaGtmStack) geladenVia = 'gtm';
  else if (htmlScript && (!initiator || initiator.type === 'parser')) geladenVia = 'html';
  else if (initiator?.type === 'script') geladenVia = `script:${initiator.url || stack[0] || 'onbekend'}`;
  else if (initiator?.type === 'parser') geladenVia = 'html';
  else if (domScript) geladenVia = 'geinjecteerd_bron_onbekend';
  else geladenVia = 'niet_geladen';

  // true/false alleen als we het echt weten; null als het script er is maar de initiator ontbreekt.
  const loadedViaGtm = geladenVia === 'gtm' ? true : initiator || htmlScript ? false : domScript ? null : false;

  const bronScript = htmlScript || domScript;
  const scriptsErvoor = htmlScript ? html.scripts.filter((script) => script.index < htmlScript.index) : null;
  const geladenEvent = GELADEN_EVENT[cmp.id] ? (events || []).find((event) => event.naam === GELADEN_EVENT[cmp.id]) || null : null;

  // Welke trackers waren al onderweg toen het CMP-script werd opgevraagd? Zelfde klok als de requests.
  const trackingVoorCmp = hoofdRequest
    ? requests.filter((request) => request.fase === 'voor_consent' && request.tracking_bekend && request.tijd_ms <= hoofdRequest.tijd_ms)
    : null;

  const gated = [
    ...(html?.scripts || []).map((script) => ({ ...script, bron: 'html' })),
    ...(dom?.scripts || []).map((script) => ({ ...script, bron: 'dom' })),
  ]
    .filter(isGatedScript)
    .map((script) => ({
      bron: script.bron,
      src: script.src,
      inline_fragment: script.src ? null : script.inline_fragment,
      type: script.type,
      categorie: script.data?.['data-cookiecategory'] || script.data?.['data-cookieconsent'] || null,
      data_cookiescript: script.data?.['data-cookiescript'] || null,
      positie: script.positie,
      tags_genoemd: script.tags_genoemd || [],
    }));

  return {
    cmp: cmp.id,
    naam: cmp.naam,
    detected: !!(htmlScript || domScript || hoofdRequest),
    in_html: !!htmlScript,
    in_dom: !!domScript,
    script_src: bronScript?.src || hoofdRequest?.url || null,
    load_position: bronScript?.positie || null,
    attributes: bronScript ? attributenLijst(bronScript) : [],
    synchroon: htmlScript ? !htmlScript.async && !htmlScript.defer && !/module/i.test(htmlScript.type || '') : false,
    loaded_via_gtm: loadedViaGtm,
    geladen_via: geladenVia,
    initiator,
    request: hoofdRequest
      ? { url: kort(hoofdRequest.url, 300), tijd_ms: hoofdRequest.tijd_ms, status: hoofdRequest.status, fase: hoofdRequest.fase }
      : null,
    geladen_event_na_ms: geladenEvent?.tijd_ms ?? null,
    tracking_requests_tot_cmp_aangevraagd: trackingVoorCmp
      ? {
        tot_ms: hoofdRequest.tijd_ms,
        aantal: trackingVoorCmp.length,
        tags: [...new Set(trackingVoorCmp.map((request) => request.bekende_tag))],
        hosts: [...new Set(trackingVoorCmp.map((request) => request.host))],
      }
      : null,
    scripts_ervoor: scriptsErvoor
      ? {
        aantal: scriptsErvoor.length,
        externe_srcs: scriptsErvoor.filter((script) => script.src).map((script) => kort(script.src, 200)),
        tags_genoemd: [...new Set(scriptsErvoor.flatMap((script) => script.tags_genoemd || []))],
      }
      : null,
    gated_scripts: gated,
    ...cmpSpecifiek(cmp.id, dom),
  };
}

/** Wat de DOM-snapshot over deze CMP zelf wist: alleen voor CMP's die we daar uitlezen. */
function cmpSpecifiek(id, dom) {
  if (id === 'cookiescript' && dom?.cookiescript) {
    const cs = dom.cookiescript;
    return {
      api_beschikbaar: !!cs.instance,
      versie: cs.versie ?? null,
      banner_in_dom: !!cs.banner_in_dom,
      banner_zichtbaar: !!cs.banner_zichtbaar,
      state_voor_consent: cs.state ?? null,
      categorieen: cs.categorieen ?? null,
      consent_mode_instelling: cs.data ?? null,
    };
  }
  if (id === 'cookiebot' && dom?.cookiebot) {
    const cb = dom.cookiebot;
    return {
      api_beschikbaar: true,
      banner_in_dom: !!cb.banner_in_dom,
      banner_zichtbaar: !!cb.banner_zichtbaar,
      state_voor_consent: { consented: cb.consented, declined: cb.declined, hasResponse: cb.hasResponse, consent: cb.consent },
    };
  }
  return { api_beschikbaar: null, banner_zichtbaar: null, state_voor_consent: null };
}

/** Scripts die door een CMP zijn "geblokkeerd tot consent": type text/plain of een data-cookie*-attribuut. */
function isGatedScript(script) {
  const data = script.data || {};
  return !!(data['data-cookiescript'] || data['data-cookiecategory'] || data['data-cookieconsent'] || /^text\/plain$/i.test(script.type || ''));
}

function attributenLijst(script) {
  const lijst = [];
  if (script.async) lijst.push('async');
  if (script.defer) lijst.push('defer');
  if (script.type) lijst.push(`type=${script.type}`);
  if (script.charset) lijst.push(`charset=${script.charset}`);
  if (script.id) lijst.push(`id=${script.id}`);
  for (const [naam, waarde] of Object.entries(script.data || {})) lijst.push(waarde === '' ? naam : `${naam}=${waarde}`);
  return lijst;
}
