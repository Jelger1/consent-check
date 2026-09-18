/**
 * De acht detectieregels.
 *
 * Deze module trekt geen conclusies over goed of fout: ze zet de ruwe metingen
 * om in feiten waar een LLM (of een mens) mee verder kan. Elke bevinding heeft
 * daarom naast een `gevonden`-vlag ook de details waarop die vlag rust.
 *
 *   1. cookies_voor_consent                cookies vóór consent, min CMP en functioneel
 *   2. externe_requests_voor_consent       hosts buiten het eigen domein, trackers gemarkeerd
 *   3. identifiers_in_payload_voor_consent fbp=, cid=, ... in URL of POST-body
 *   4. ontbrekende_tags_na_consent         bekende tags die ná consent geen request doen
 *   5. (cmp_info)                          laadpositie CookieScript: lib/cmp/cookiescript.js
 *   6. meerdere_cmps_actief                meer dan één CMP op de pagina
 *   7. niet_google_tags_gevonden           Meta, LinkedIn, Hotjar, TikTok, ... (handmatige gating)
 *   8. js_gegenereerde_iframes             iframes in de DOM die niet in de ruwe HTML staan
 */

import { isExtern, normaliseerBron } from './domain.js';
import { kort } from './util.js';
import {
  IDENTIFIER_PARAMETERS, IDENTIFIER_VOORVOEGSELS, IDENTIFIER_WAARDEN, TRACKING_TAGS,
  herkenTag, vereistHandmatigeGating,
} from './trackers.js';

// --- Requests verrijken ----------------------------------------------------------

/** Voegt per request toe: extern of eigen domein, de herkende tag en de CDP-initiator. */
export function verrijkRequests(requests, siteDomeinenSet, initiators) {
  return requests.map((request) => {
    const tag = herkenTag(request.host ? `${request.host}${request.pad}` : '');
    const extern = isExtern(request.host, siteDomeinenSet);
    return {
      ...request,
      is_extern: extern,
      bekende_tag: tag?.id || null,
      tag_naam: tag?.naam || null,
      categorie: tag?.categorie || (extern ? 'extern_onbekend' : 'eigen_domein'),
      tracking_bekend: !!tag?.tracking,
      // Een tracking-patroon op het eigen domein (of op run.app) wijst op server-side tagging.
      lijkt_server_side_tagging: (!!tag?.tracking && !extern) || /\.run\.app$/.test(request.host),
      initiator: initiators?.get(request._url) || null,
    };
  });
}

// --- Regel 3: identifiers --------------------------------------------------------

function betekenisVan(parameter) {
  const naam = String(parameter).toLowerCase();
  if (Object.hasOwn(IDENTIFIER_PARAMETERS, naam)) return IDENTIFIER_PARAMETERS[naam];
  return IDENTIFIER_VOORVOEGSELS.find(({ patroon }) => patroon.test(naam))?.betekenis || null;
}

export function vindIdentifiers(request) {
  const gevonden = [];
  const noteer = (parameter, waarde, bron, betekenis) => {
    if (waarde === undefined || waarde === null || waarde === '') return;
    gevonden.push({ parameter, waarde: kort(String(waarde), 80), bron, betekenis });
  };

  for (const [parameter, waarde] of Object.entries(request.query_parameters || {})) {
    const betekenis = betekenisVan(parameter);
    if (betekenis) noteer(parameter, waarde, 'query', betekenis);
  }

  const body = request.post_data ? String(request.post_data).trim() : '';
  if (body) {
    if (/^[[{]/.test(body)) {
      try {
        doorloopJson(JSON.parse(body), (sleutel, waarde) => {
          const betekenis = betekenisVan(sleutel);
          if (betekenis) noteer(sleutel, waarde, 'post_body_json', betekenis);
        });
      } catch {
        // afgekapte of geen JSON: de waardepatronen hieronder vangen nog wat er te vangen is
      }
    } else if (/^[^\s=&]+=/.test(body)) {
      // GA4 stuurt meerdere events als regels in querystring-vorm.
      for (const regel of body.split(/\r?\n/)) {
        for (const [parameter, waarde] of new URLSearchParams(regel)) {
          const betekenis = betekenisVan(parameter);
          if (betekenis) noteer(parameter, waarde, 'post_body', betekenis);
        }
      }
    }
  }

  const tekst = `${request.url}\n${body}`;
  for (const { patroon, betekenis } of IDENTIFIER_WAARDEN) {
    const match = tekst.match(patroon);
    if (match && !gevonden.some((item) => item.waarde.includes(match[0]))) noteer('(waardepatroon)', match[0], 'url_of_body', betekenis);
  }

  return gevonden;
}

function doorloopJson(waarde, bezoek, sleutel = '', diepte = 0) {
  if (waarde === null || typeof waarde !== 'object' || diepte > 6) {
    if (sleutel) bezoek(sleutel, waarde);
    return;
  }
  if (Array.isArray(waarde)) {
    for (const item of waarde.slice(0, 50)) doorloopJson(item, bezoek, sleutel, diepte + 1);
    return;
  }
  for (const [k, v] of Object.entries(waarde)) doorloopJson(v, bezoek, k, diepte + 1);
}

// --- Regel 1: cookies vóór consent ------------------------------------------------

function cookiesVoorConsent(cookies) {
  const relevant = cookies.filter((cookie) => {
    // De CMP moet zijn eigen keuze ergens vastleggen; die cookie telt nooit mee.
    if (cookie.classificatie === 'cmp') return false;
    // Een functionele cookie telt alleen niet mee op het eigen domein. Dezelfde
    // cookie op een ander domein (denk aan __cf_bm van een ingesloten dienst)
    // bewijst juist dat er vóór consent contact met die partij is geweest.
    if (cookie.classificatie === 'functioneel' && !cookie.is_third_party) return false;
    return true;
  });
  return {
    gevonden: relevant.length > 0,
    aantal: relevant.length,
    aantal_totaal: cookies.length,
    aantal_third_party: relevant.filter((cookie) => cookie.is_third_party).length,
    details: relevant.map((cookie) => ({
      naam: cookie.naam,
      domein: cookie.domein,
      is_third_party: cookie.is_third_party,
      is_sessie: cookie.is_sessie,
      verloopt: cookie.verloopt,
      classificatie: cookie.classificatie,
      tag: cookie.tag,
    })),
    uitgesloten: cookies
      .filter((cookie) => !relevant.includes(cookie))
      .map((cookie) => ({
        naam: cookie.naam,
        domein: cookie.domein,
        reden: cookie.classificatie === 'cmp' ? 'cookie van de CMP zelf' : 'functionele cookie op het eigen domein',
      })),
  };
}

// --- Regel 2: externe requests vóór consent ---------------------------------------

function externeRequests(requests) {
  const extern = requests.filter((request) => request.is_extern);
  const perHost = new Map();

  for (const request of extern) {
    if (!perHost.has(request.host)) {
      perHost.set(request.host, {
        host: request.host,
        aantal: 0,
        bekende_tag: null,
        tag_naam: null,
        categorie: request.categorie,
        tracking_bekend: false,
        resource_types: new Set(),
        eerste_tijd_ms: request.tijd_ms,
        eerste_url: kort(request.url, 300),
        initiator_type: request.initiator?.type || null,
      });
    }
    const host = perHost.get(request.host);
    host.aantal += 1;
    host.resource_types.add(request.resource_type);
    if (!host.bekende_tag && request.bekende_tag) {
      host.bekende_tag = request.bekende_tag;
      host.tag_naam = request.tag_naam;
      host.categorie = request.categorie;
      host.tracking_bekend = request.tracking_bekend;
    }
  }

  const hosts = [...perHost.values()]
    .map((host) => ({ ...host, resource_types: [...host.resource_types] }))
    .sort((a, b) => Number(b.tracking_bekend) - Number(a.tracking_bekend) || b.aantal - a.aantal);

  return {
    gevonden: hosts.length > 0,
    aantal_requests: extern.length,
    aantal_hosts: hosts.length,
    aantal_tracking_hosts: hosts.filter((host) => host.tracking_bekend).length,
    aantal_onbekende_hosts: hosts.filter((host) => !host.bekende_tag).length,
    hosts,
  };
}

// --- Regel 3: identifiers in de payload ---------------------------------------------

function identifiersInPayload(requests) {
  const details = [];
  for (const request of requests) {
    const identifiers = vindIdentifiers(request);
    if (identifiers.length === 0) continue;
    details.push({
      url: kort(request.url, 400),
      host: request.host,
      is_extern: request.is_extern,
      bekende_tag: request.bekende_tag,
      method: request.method,
      tijd_ms: request.tijd_ms,
      identifiers,
    });
  }
  return { gevonden: details.length > 0, aantal_requests: details.length, details };
}

// --- Regel 4: tags ná consent -------------------------------------------------------

/** Per bekende tag: staat hij op de pagina, vuurde hij vóór consent, vuurde hij ná consent? */
function tagStatus({ html, meting1, meting2 }) {
  const htmlScripts = html?.scripts || [];
  const htmlIframes = html?.iframes || [];
  const domScripts = meting1.dom?.scripts || [];
  const domIframes = meting1.dom?.iframes || [];
  const noemt = (items, id) => items.some((item) => (item.tags_genoemd || []).includes(id));
  const isGated = (script) => !!(
    script.data?.['data-cookiescript'] || script.data?.['data-cookiecategory'] || script.data?.['data-cookieconsent'] || /^text\/plain$/i.test(script.type || '')
  );

  const status = TRACKING_TAGS.map((tag) => {
    const inHtml = html ? noemt(htmlScripts, tag.id) || noemt(htmlIframes, tag.id) : null;
    const inDom = noemt(domScripts, tag.id) || noemt(domIframes, tag.id);
    const gated = [...htmlScripts, ...domScripts].some((script) => (script.tags_genoemd || []).includes(tag.id) && isGated(script));
    const voor = meting1.requests.filter((request) => request.bekende_tag === tag.id).length;
    const na = meting2 ? meting2.requests.filter((request) => request.bekende_tag === tag.id).length : null;
    const cookiesVoor = [...new Set(meting1.cookies.filter((cookie) => cookie.tag === tag.id).map((cookie) => cookie.naam))];
    const cookiesNa = meting2 ? [...new Set(meting2.cookies.filter((cookie) => cookie.tag === tag.id).map((cookie) => cookie.naam))] : null;
    return {
      tag: tag.id,
      naam: tag.naam,
      leverancier: tag.leverancier,
      categorie: tag.categorie,
      vereist_handmatige_gating: vereistHandmatigeGating(tag),
      in_html: inHtml,
      in_dom_voor_consent: inDom,
      gated_via_cmp_attribuut: gated,
      requests_voor_consent: voor,
      requests_na_consent: na,
      cookies_voor_consent: cookiesVoor,
      cookies_na_consent: cookiesNa,
    };
  });

  // Alleen tags waar íets van gezien is; de rest zou de JSON alleen maar vullen.
  return status.filter((s) =>
    s.in_html || s.in_dom_voor_consent || s.requests_voor_consent > 0 || (s.requests_na_consent ?? 0) > 0
    || s.cookies_voor_consent.length > 0 || (s.cookies_na_consent?.length ?? 0) > 0);
}

function ontbrekendeTags(status, meting2) {
  if (!meting2) return null;
  return status
    .filter((s) => s.requests_na_consent === 0 && (s.in_html || s.in_dom_voor_consent || s.requests_voor_consent > 0))
    .map((s) => ({
      tag: s.tag,
      naam: s.naam,
      reden: s.requests_voor_consent > 0 ? 'vuurde_voor_consent_maar_niet_na' : 'aanwezig_in_html_of_dom_maar_geen_requests_na_consent',
      in_html: s.in_html,
      in_dom_voor_consent: s.in_dom_voor_consent,
      gated_via_cmp_attribuut: s.gated_via_cmp_attribuut,
      requests_voor_consent: s.requests_voor_consent,
    }));
}

// --- Regel 6: meerdere CMP's ---------------------------------------------------------

function meerdereCmps(cmps) {
  const actief = cmps.filter((cmp) => cmp.actief);
  return {
    gevonden: actief.length > 1,
    aantal_actief: actief.length,
    aantal_gesignaleerd: cmps.length,
    cmps: cmps.map((cmp) => ({ id: cmp.id, naam: cmp.naam, actief: cmp.actief, signalen: cmp.signalen })),
  };
}

// --- Regel 7: niet-Google tags ---------------------------------------------------------

function nietGoogleTags(status) {
  return status
    .filter((s) => s.vereist_handmatige_gating)
    .map((s) => {
      const gevondenIn = [];
      if (s.in_html) gevondenIn.push('html');
      if (s.in_dom_voor_consent) gevondenIn.push('dom_voor_consent');
      if (s.requests_voor_consent > 0) gevondenIn.push('requests_voor_consent');
      if (s.requests_na_consent > 0) gevondenIn.push('requests_na_consent');
      if (s.cookies_voor_consent.length > 0) gevondenIn.push('cookies_voor_consent');
      if (s.cookies_na_consent?.length > 0) gevondenIn.push('cookies_na_consent');
      return {
        tag: s.tag,
        naam: s.naam,
        leverancier: s.leverancier,
        categorie: s.categorie,
        vereist_handmatige_gating: true,
        gated_via_cmp_attribuut: s.gated_via_cmp_attribuut,
        vuurt_voor_consent: s.requests_voor_consent > 0,
        vuurt_na_consent: s.requests_na_consent === null ? null : s.requests_na_consent > 0,
        gevonden_in: gevondenIn,
      };
    });
}

// --- Regel 8: JS-gegenereerde iframes ------------------------------------------------

function jsGegenereerdeIframes(html, domIframes) {
  if (!html) {
    return { bepaald: false, gevonden: null, reden: 'ruwe HTML niet beschikbaar', iframes: [] };
  }

  const inHtml = new Set();
  const inNoscript = new Set();
  for (const iframe of html.iframes) {
    for (const bron of [iframe.src, iframe.data_src]) {
      const genormaliseerd = normaliseerBron(bron);
      if (genormaliseerd) (iframe.in_noscript ? inNoscript : inHtml).add(genormaliseerd);
    }
  }
  const htmlZonderSrc = html.iframes.filter((iframe) => !iframe.in_noscript && !normaliseerBron(iframe.src) && !normaliseerBron(iframe.data_src)).length;

  let domZonderSrc = 0;
  const iframes = [];
  for (const iframe of domIframes) {
    const bron = normaliseerBron(iframe.src) || normaliseerBron(iframe.src_effectief) || normaliseerBron(iframe.data_src);
    let reden = null;
    if (!bron) {
      domZonderSrc += 1;
      if (domZonderSrc > htmlZonderSrc) reden = 'iframe zonder src (about:blank of srcdoc) dat niet in de HTML staat';
    } else if (inHtml.has(bron)) {
      continue;
    } else if (inNoscript.has(bron)) {
      reden = 'staat in de HTML alleen binnen <noscript>, in de DOM als echt iframe';
    } else {
      reden = 'src komt niet voor in de ruwe HTML';
    }
    if (!reden) continue;

    const tag = herkenTag(bron);
    iframes.push({
      src: kort(iframe.src || iframe.src_effectief || '', 400),
      data_src: iframe.data_src,
      srcdoc: iframe.srcdoc,
      id: iframe.id,
      name: iframe.name,
      title: iframe.title,
      zichtbaar: iframe.zichtbaar,
      breedte: iframe.breedte,
      hoogte: iframe.hoogte,
      ouder: iframe.ouder,
      bekende_tag: tag?.id || null,
      tag_naam: tag?.naam || null,
      reden,
    });
  }

  return {
    bepaald: true,
    gevonden: iframes.length > 0,
    aantal: iframes.length,
    aantal_iframes_html: html.iframes.filter((iframe) => !iframe.in_noscript).length,
    aantal_iframes_html_noscript: html.iframes.filter((iframe) => iframe.in_noscript).length,
    aantal_iframes_dom: domIframes.length,
    iframes,
  };
}

// --- Extra feiten: wat veranderde er door consent? ------------------------------------

function nieuweCookies(meting1, meting2) {
  if (!meting2) return null;
  const sleutel = (cookie) => `${cookie.naam}@${cookie.domein}`;
  const bestond = new Set(meting1.cookies.map(sleutel));
  return meting2.cookies
    .filter((cookie) => !bestond.has(sleutel(cookie)))
    .map((cookie) => ({ naam: cookie.naam, domein: cookie.domein, is_third_party: cookie.is_third_party, classificatie: cookie.classificatie, tag: cookie.tag }));
}

function nieuweHosts(meting1, meting2) {
  if (!meting2) return null;
  const bestond = new Set(meting1.requests.map((request) => request.host));
  const nieuw = new Map();
  for (const request of meting2.requests) {
    if (!request.host || bestond.has(request.host)) continue;
    if (!nieuw.has(request.host)) {
      nieuw.set(request.host, { host: request.host, is_extern: request.is_extern, bekende_tag: request.bekende_tag, tag_naam: request.tag_naam, aantal: 0 });
    }
    nieuw.get(request.host).aantal += 1;
  }
  return [...nieuw.values()];
}

// --- Consent Mode uit de dataLayer ----------------------------------------------------

/** gtag('consent', 'default'|'update', {...}) komt als array in de dataLayer terecht. */
export function consentModeUit(dataLayer) {
  if (!Array.isArray(dataLayer)) return { default_gevonden: false, default_instellingen: [], update_gevonden: false, update_instellingen: [] };
  const defaults = [];
  const updates = [];
  for (const entry of dataLayer) {
    if (!Array.isArray(entry) || entry[0] !== 'consent') continue;
    if (entry[1] === 'default') defaults.push(entry[2] ?? null);
    if (entry[1] === 'update') updates.push(entry[2] ?? null);
  }
  return { default_gevonden: defaults.length > 0, default_instellingen: defaults, update_gevonden: updates.length > 0, update_instellingen: updates };
}

// --- Alles samen ---------------------------------------------------------------------

export function analyseer({ html, meting1, meting2, cmps }) {
  const status = tagStatus({ html, meting1, meting2 });
  return {
    cookies_voor_consent: cookiesVoorConsent(meting1.cookies),
    externe_requests_voor_consent: externeRequests(meting1.requests),
    identifiers_in_payload_voor_consent: identifiersInPayload(meting1.requests),
    ontbrekende_tags_na_consent: ontbrekendeTags(status, meting2),
    tag_status: status,
    meerdere_cmps_actief: meerdereCmps(cmps),
    niet_google_tags_gevonden: nietGoogleTags(status),
    js_gegenereerde_iframes: jsGegenereerdeIframes(html, meting1.dom?.iframes || []),
    nieuwe_cookies_na_consent: nieuweCookies(meting1, meting2),
    nieuwe_hosts_na_consent: nieuweHosts(meting1, meting2),
    identifiers_in_payload_na_consent: meting2 ? identifiersInPayload(meting2.requests) : null,
  };
}
