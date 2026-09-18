/**
 * CookieScript: hoe de tag is ingeladen (regel 5) en consent geven via de
 * JavaScript-API van CookieScript zelf.
 *
 * De API (window.CookieScript.instance) is stabieler dan knoppen aanklikken:
 * de banner-opmaak verschilt per klant, de API niet. Werkt de API niet, dan
 * probeert de tool nog precies één ding, de officiële knop #cookiescript_accept,
 * en faalt daarna hard. Een scan waarbij niet zéker is dat er consent gegeven
 * is, levert geen bruikbare meting 2 op; dan liever geen meting 2.
 *
 * Bevestigd tegen het CookieScript-script (versie 20260210): instance.acceptAllAction(),
 * instance.currentState() -> { action, categories, key }, cookie CookieScriptConsent,
 * events CookieScriptLoaded / CookieScriptAcceptAll.
 */

import { fail, kort } from '../util.js';

const PATROON = /cookie-script\.com/i;
const HOOFDSCRIPT = /\/s\/[a-f0-9]{32}\.js$/i;

// --- Regel 5: laadpositie ---------------------------------------------------------

export function beschrijfCookieScript({ html, dom, requests, events }) {
  const htmlScript = (html?.scripts || []).find((script) => script.src && PATROON.test(script.src)) || null;
  const domScript = (dom?.scripts || []).find((script) => script.src && PATROON.test(script.src)) || null;
  const scriptRequests = requests.filter((request) => PATROON.test(request.host));
  const hoofdRequest = scriptRequests.find((request) => HOOFDSCRIPT.test(request.pad)) || scriptRequests[0] || null;
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
  const geladenEvent = (events || []).find((event) => event.naam === 'CookieScriptLoaded') || null;

  // Waar het bij de laadpositie om gaat: welke trackers waren al onderweg toen
  // de CMP nog aangevraagd moest worden? Gemeten op dezelfde klok als de requests.
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
      categorie: script.data?.['data-cookiecategory'] || null,
      data_cookiescript: script.data?.['data-cookiescript'] || null,
      positie: script.positie,
      tags_genoemd: script.tags_genoemd || [],
    }));

  return {
    detected: !!(htmlScript || domScript || hoofdRequest || dom?.cookiescript?.aanwezig),
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
    api_beschikbaar: !!dom?.cookiescript?.instance,
    versie: dom?.cookiescript?.versie ?? null,
    banner_in_dom: !!dom?.cookiescript?.banner_in_dom,
    banner_zichtbaar: !!dom?.cookiescript?.banner_zichtbaar,
    state_voor_consent: dom?.cookiescript?.state ?? null,
    categorieen: dom?.cookiescript?.categorieen ?? null,
    consent_mode_instelling: dom?.cookiescript?.data ?? null,
    scripts_ervoor: scriptsErvoor
      ? {
        aantal: scriptsErvoor.length,
        externe_srcs: scriptsErvoor.filter((script) => script.src).map((script) => kort(script.src, 200)),
        tags_genoemd: [...new Set(scriptsErvoor.flatMap((script) => script.tags_genoemd || []))],
      }
      : null,
    gated_scripts: gated,
  };
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

// --- Consent geven ------------------------------------------------------------------

export async function geefConsent(page, context, { timeoutMs }) {
  const gestart = Date.now();

  const apiBeschikbaar = await page
    .waitForFunction(
      () => !!(window.CookieScript && window.CookieScript.instance && typeof window.CookieScript.instance.acceptAllAction === 'function'),
      undefined,
      { timeout: timeoutMs },
    )
    .then(() => true)
    .catch(() => false);

  if (!apiBeschikbaar) {
    throw fail('consent', `CookieScript-API niet beschikbaar binnen ${timeoutMs / 1000} s (window.CookieScript.instance ontbreekt).`);
  }

  const stateVoor = await page.evaluate(() => window.CookieScript.instance.currentState()).catch(() => null);

  let methode = 'cookiescript_api_acceptAllAction';
  try {
    await page.evaluate(() => window.CookieScript.instance.acceptAllAction());
  } catch (error) {
    // De API is er wel, maar gooit. Eén terugvaloptie: de officiële accept-knop.
    const knop = page.locator('#cookiescript_accept');
    const zichtbaar = await knop.isVisible().catch(() => false);
    if (!zichtbaar) {
      throw fail('consent', `acceptAllAction() gaf een fout (${error.message.split('\n')[0]}) en de knop #cookiescript_accept is niet zichtbaar.`);
    }
    await knop.click({ timeout: 5000 });
    methode = 'knop_cookiescript_accept';
  }

  // Bevestigen op twee onafhankelijke plekken: de API-state én het cookie.
  // Een paginaherlaad na consent (sommige configuraties doen dat) mag dit niet breken.
  const bevestigd = await metHerstelNaNavigatie(page, () =>
    page.waitForFunction(
      () => {
        try {
          const state = window.CookieScript.instance.currentState();
          return !!state && state.action === 'accept';
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: timeoutMs },
    ),
  )
    .then(() => true)
    .catch(() => false);

  const stateNa = await page.evaluate(() => window.CookieScript.instance.currentState()).catch(() => null);
  const cookie = (await context.cookies()).find((c) => c.name === 'CookieScriptConsent') || null;

  if (!bevestigd || !cookie) {
    throw fail(
      'consent',
      `Consent niet bevestigd: currentState=${JSON.stringify(stateNa)}, cookie CookieScriptConsent ${cookie ? 'aanwezig' : 'ontbreekt'}.`,
    );
  }

  let inhoud;
  try {
    inhoud = JSON.parse(decodeURIComponent(cookie.value));
  } catch {
    inhoud = kort(cookie.value, 300);
  }

  return {
    cmp: 'CookieScript',
    methode,
    duur_ms: Date.now() - gestart,
    state_voor: stateVoor,
    state_na: stateNa,
    cookie: {
      naam: cookie.name,
      domein: cookie.domain,
      verloopt: cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : null,
      inhoud,
    },
  };
}

async function metHerstelNaNavigatie(page, actie) {
  try {
    return await actie();
  } catch (error) {
    if (!/context was destroyed|navigation|Target closed/i.test(error.message)) throw error;
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return actie();
  }
}
