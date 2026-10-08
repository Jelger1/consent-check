/**
 * De detectieregels (acht uit de projectopdracht, vier sinds versie 1.4).
 *
 * Deze module trekt geen conclusies over goed of fout: ze zet de ruwe metingen
 * om in feiten waar een LLM (of een mens) mee verder kan. Elke bevinding heeft
 * daarom naast een `gevonden`-vlag ook de details waarop die vlag rust.
 *
 *   1. cookies_voor_consent                cookies vóór consent, min CMP en functioneel
 *   2. externe_requests_voor_consent       hosts buiten het eigen domein, trackers gemarkeerd
 *   3. identifiers_in_payload_voor_consent fbp=, cid=, ... in URL of POST-body
 *   4. ontbrekende_tags_na_consent         bekende tags die ná consent geen request doen
 *   5. (cmp_info)                          laadpositie van de CMP: lib/cmp/laadpositie.js
 *   6. meerdere_cmps_actief                meer dan één CMP op de pagina
 *   7. niet_google_tags_gevonden           Meta, LinkedIn, Hotjar, TikTok, ... (handmatige gating)
 *   8. js_gegenereerde_iframes             iframes in de DOM die niet in de ruwe HTML staan
 *   9. tracking_na_weigeren                wat er nog vuurt nadat in een tweede browser alles is geweigerd
 *  10. cookiebanner                        de banner zelf: knoppen, vakjes, bedekking, intrekken
 *  11. opslag_voor_consent                 localStorage, sessionStorage en IndexedDB, met wie er schreef
 *  12. eigen_subdomeinen                   CNAME-keten van eigen subdomeinen (cloaking, server-side tagging)
 */

import { hostEnPad, isExtern, normaliseerBron, ontleedUrl } from './domain.js';
import { kort } from './util.js';
import {
  GENERIEKE_PARAMETERS, IDENTIFIER_PARAMETERS, IDENTIFIER_VOORVOEGSELS, IDENTIFIER_WAARDEN, TRACKING_TAGS,
  classificeerCookie, consentModeVanHit, herkenCnameDoel, herkenTag, tagPerId, tagVanDomein, vereistHandmatigeGating, volgtTrackerProtocol,
} from './trackers.js';

/** Waarden korter dan dit uit de landings-URL negeren we: "nl" of "1" komt overal voor. */
const MIN_LANDINGSWAARDE = 6;

/**
 * Requests die een bestand ophalen in plaats van iets te versturen: geen hit.
 * Afbeeldingen horen hier bewust niet bij: een trackingpixel ís een afbeelding.
 */
const DOWNLOADS = new Set(['script', 'stylesheet', 'font']);

// --- Requests verrijken ----------------------------------------------------------

/**
 * Voegt per request toe: extern of eigen domein, de herkende tag, het
 * tracker-protocol, de Consent Mode-status en de CDP-initiator.
 */
export function verrijkRequests(requests, siteDomeinenSet, initiators) {
  return requests.map((request) => {
    const protocol = volgtTrackerProtocol(request.query_parameters);
    // Een GA4-hit naar een onbekende host (server-side tagging met een eigen
    // pad, een proxy) is aan zijn protocol nog steeds als GA4 te herkennen.
    const tag = herkenTag(request.host ? `${request.host}${request.pad}` : '')
      || (protocol === 'ga4' || protocol === 'universal_analytics' ? tagPerId('google_analytics') : null)
      || (protocol === 'meta_pixel' ? tagPerId('meta_pixel') : null);
    const extern = isExtern(request.host, siteDomeinenSet);
    return {
      ...request,
      is_extern: extern,
      // De URL waarmee de bezoeker de pagina opent (en de redirects daarvan).
      // Een click-id daarin is de bezoeker die binnenkomt, geen tag die iets verstuurt.
      is_hoofddocument: !!request.is_navigatie && !request.iframe_url && request.resource_type === 'document',
      bekende_tag: tag?.id || null,
      tag_naam: tag?.naam || null,
      categorie: tag?.categorie || (extern ? 'extern_onbekend' : 'eigen_domein'),
      tracking_bekend: !!tag?.tracking,
      protocol,
      consent_mode: consentModeVanHit(request.query_parameters, request.host),
      // Een tracking-patroon op het eigen domein (of op run.app) wijst op server-side tagging.
      lijkt_server_side_tagging: (!!tag?.tracking && !extern) || /\.run\.app$/.test(request.host),
      initiator: initiators?.get(request._url) || null,
    };
  });
}

/** Alle querywaarden uit de URL's waarmee de pagina geopend is (start en eind na redirects). */
function landingsWaarden(urls) {
  const waarden = new Set();
  for (const url of urls || []) {
    for (const waarde of ontleedUrl(url)?.searchParams.values() || []) {
      if (waarde.length >= MIN_LANDINGSWAARDE) waarden.add(kort(waarde, 80));
    }
  }
  return waarden;
}

// --- Regel 3: identifiers --------------------------------------------------------

function betekenisVan(parameter) {
  const naam = String(parameter).toLowerCase();
  if (Object.hasOwn(IDENTIFIER_PARAMETERS, naam)) return IDENTIFIER_PARAMETERS[naam];
  return IDENTIFIER_VOORVOEGSELS.find(({ patroon }) => patroon.test(naam))?.betekenis || null;
}

/**
 * Alle identifiers in een request, elk met `generiek: true` als de naam of het
 * waardepatroon ook buiten tracking voorkomt. Welke er meetellen, beslist
 * identifiersInPayload; hier wordt alleen gevonden.
 */
export function vindIdentifiers(request) {
  const gevonden = [];
  const noteer = (parameter, waarde, bron, betekenis, generiek = GENERIEKE_PARAMETERS.has(String(parameter).toLowerCase())) => {
    if (waarde === undefined || waarde === null || waarde === '') return;
    gevonden.push({ parameter, waarde: kort(String(waarde), 80), bron, betekenis, generiek });
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
  for (const { patroon, betekenis, generiek } of IDENTIFIER_WAARDEN) {
    const match = tekst.match(patroon);
    if (match && !gevonden.some((item) => item.waarde.includes(match[0]))) noteer('(waardepatroon)', match[0], 'url_of_body', betekenis, !!generiek);
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

/**
 * Waarom een cookie niet meetelt, of null als hij wél meetelt.
 *
 * Een functionele cookie telt niet mee op het eigen domein. Op een ander
 * domein wel (denk aan __cf_bm van een ingesloten dienst): die bewijst dat er
 * vóór consent contact met die partij was. Behalve als die partij zelf geen
 * tracker is, zoals de CMP of een CDN: dan is het contact juist bedoeld.
 */
function redenNietMeegeteld(cookie) {
  if (cookie.classificatie === 'cmp') return 'cookie van de CMP zelf';
  if (cookie.classificatie !== 'functioneel') return null;
  if (!cookie.is_third_party) return `functionele cookie op het eigen domein: ${cookie.functie || 'sessie of beveiliging'}`;
  const partij = tagVanDomein(cookie.domein);
  if (partij && !partij.tracking) return `functionele cookie (${cookie.functie || 'beveiliging'}) van ${partij.naam}, geen tracker`;
  return null;
}

function cookiesVoorConsent(cookies) {
  const relevant = cookies.filter((cookie) => !redenNietMeegeteld(cookie));
  const tracking = relevant.filter((cookie) => cookie.classificatie === 'tracking');
  return {
    gevonden: relevant.length > 0,
    aantal: relevant.length,
    // Uitgesplitst, zodat een onbekende cookie nooit als tracking wordt geteld:
    // alleen een cookie die aan een bekende tracker is toe te wijzen, telt daar.
    aantal_tracking: tracking.length,
    aantal_onbekend: relevant.filter((cookie) => cookie.classificatie === 'onbekend').length,
    aantal_functioneel_extern: relevant.filter((cookie) => cookie.classificatie === 'functioneel').length,
    aantal_overig: relevant.length - tracking.length,
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
      tag_naam: cookie.tag ? tagPerId(cookie.tag)?.naam || null : null,
      functie: cookie.functie || null,
    })),
    uitgesloten: cookies
      .filter((cookie) => !relevant.includes(cookie))
      .map((cookie) => ({ naam: cookie.naam, domein: cookie.domein, reden: redenNietMeegeteld(cookie) })),
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
        consentCodes: new Map(),
        hits_zonder_status: 0,
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
    if (request.consent_mode) {
      const cm = request.consent_mode;
      const teller = host.consentCodes.get(cm.code) || { code: cm.code, systeem: cm.systeem, geweigerd: cm.geweigerd, betekenis: cm.betekenis, aantal: 0 };
      teller.aantal += 1;
      host.consentCodes.set(cm.code, teller);
    } else if (!DOWNLOADS.has(request.resource_type)) {
      // Een script downloaden is geen hit; een pixel, beacon of XHR zonder consentstatus wel.
      host.hits_zonder_status += 1;
    }
  }

  const hosts = [...perHost.values()]
    .map(({ consentCodes, hits_zonder_status: zonderStatus, ...host }) => {
      const consentMode = [...consentCodes.values()];
      return {
        ...host,
        resource_types: [...host.resource_types],
        // Welke consentstatus de hits zelf meestuurden (gcs bij Google, asc bij Microsoft UET); leeg als er geen in zat.
        consent_mode: consentMode,
        // Alleen hits met "alles geweigerd" (G100, asc=D), en geen andere hits: dat
        // zijn de cookieloze pings van Consent Mode advanced. Contact is er wél;
        // de lezer weegt of dat ertoe doet.
        alleen_geweigerde_pings: consentMode.length > 0 && consentMode.every((c) => c.geweigerd) && zonderStatus === 0,
      };
    })
    .sort((a, b) => Number(b.tracking_bekend) - Number(a.tracking_bekend) || b.aantal - a.aantal);

  const perCode = {};
  for (const request of extern) {
    if (request.consent_mode) perCode[request.consent_mode.code] = (perCode[request.consent_mode.code] || 0) + 1;
  }

  return {
    gevonden: hosts.length > 0,
    aantal_requests: extern.length,
    aantal_hosts: hosts.length,
    aantal_tracking_hosts: hosts.filter((host) => host.tracking_bekend).length,
    aantal_tracking_hosts_alleen_geweigerd: hosts.filter((host) => host.tracking_bekend && host.alleen_geweigerde_pings).length,
    aantal_onbekende_hosts: hosts.filter((host) => !host.bekende_tag).length,
    consent_mode_hits: { aantal: Object.values(perCode).reduce((som, n) => som + n, 0), per_code: perCode },
    hosts,
  };
}

// --- Regel 3: identifiers in de payload ---------------------------------------------

/**
 * Requests die een identifier meesturen. Wat níet meetelt, staat apart in
 * `niet_meegeteld`, met de reden; meten filtert niets, tellen wel:
 *
 * - de navigatie van de bezoeker zelf: een click-id in de landings-URL is
 *   iemand die via een advertentie binnenkomt, geen tag die iets verstuurt;
 * - een algemene naam (`sid`, `uid`, `em`) buiten een bekende tracker of
 *   tracker-protocol: dat is net zo goed de eigen API van de site;
 * - een waarde uit de landings-URL die naar het eigen domein gaat, buiten een
 *   tracker om: de site krijgt terug wat de bezoeker hem al gaf.
 *
 * Stuurt een pixel die click-id door naar een tracker, dan telt dat wél.
 */
function identifiersInPayload(requests, landingsUrls = []) {
  const uitLanding = landingsWaarden(landingsUrls);
  const details = [];
  const nietMeegeteld = [];
  const basis = (request) => ({
    url: kort(request.url, 400),
    host: request.host,
    is_extern: request.is_extern,
    bekende_tag: request.bekende_tag,
    method: request.method,
    tijd_ms: request.tijd_ms,
    consent_mode: request.consent_mode?.code || null,
    consent_mode_geweigerd: request.consent_mode ? request.consent_mode.geweigerd : null,
  });

  for (const request of requests) {
    const identifiers = vindIdentifiers(request);
    if (identifiers.length === 0) continue;

    if (request.is_hoofddocument) {
      nietMeegeteld.push({ ...basis(request), identifiers, reden: 'navigatie van de bezoeker zelf: de URL waarmee de pagina geopend werd' });
      continue;
    }

    const trackercontext = request.tracking_bekend || !!request.protocol;
    const telt = [];
    const telNiet = [];
    for (const identifier of identifiers) {
      if (identifier.generiek && !trackercontext) telNiet.push({ ...identifier, reden: 'algemene parameternaam, niet naar een bekende tracker' });
      else if (!request.is_extern && !trackercontext && uitLanding.has(identifier.waarde)) telNiet.push({ ...identifier, reden: 'waarde uit de landings-URL, teruggestuurd naar het eigen domein' });
      else telt.push(identifier);
    }

    if (telt.length) details.push({ ...basis(request), identifiers: telt });
    if (telNiet.length) {
      nietMeegeteld.push({
        ...basis(request),
        identifiers: telNiet.map(({ reden, ...identifier }) => identifier),
        reden: [...new Set(telNiet.map((identifier) => identifier.reden))].join('; '),
      });
    }
  }
  return { gevonden: details.length > 0, aantal_requests: details.length, details, niet_meegeteld: nietMeegeteld };
}

// --- Regel 4: tags ná consent -------------------------------------------------------

/** Per bekende tag: staat hij op de pagina, vuurde hij vóór consent, vuurde hij ná consent? */
function tagStatus({ html, meting1, meting2, meting3 = null, opslag = null }) {
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
    const voorRequests = meting1.requests.filter((request) => request.bekende_tag === tag.id);
    const voor = voorRequests.length;
    const na = meting2 ? meting2.requests.filter((request) => request.bekende_tag === tag.id).length : null;
    // Consent Mode per tag over álle requests, ook first-party (server-side tagging op een eigen subdomein).
    const statusVoor = {};
    for (const request of voorRequests) {
      if (request.consent_mode) statusVoor[request.consent_mode.code] = (statusVoor[request.consent_mode.code] || 0) + 1;
    }
    // Alleen geweigerde pings (G100, asc=D), plus hooguit het ophalen van scripts: geen enkele hit met cookies.
    const alleenGeweigerd = voorRequests.some((request) => request.consent_mode?.geweigerd)
      && voorRequests.every((request) => request.consent_mode?.geweigerd || DOWNLOADS.has(request.resource_type));
    const cookiesVoor = [...new Set(meting1.cookies.filter((cookie) => cookie.tag === tag.id).map((cookie) => cookie.naam))];
    const opslagVoor = [...new Set((opslag?.items || []).filter((item) => item.tag === tag.id).map((item) => item.sleutel))];
    const cookiesNa = meting2 ? [...new Set(meting2.cookies.filter((cookie) => cookie.tag === tag.id).map((cookie) => cookie.naam))] : null;
    return {
      tag: tag.id,
      naam: tag.naam,
      leverancier: tag.leverancier,
      categorie: tag.categorie,
      consent_api: tag.consent_api || null,
      laadscript: !!tag.laadscript,
      vereist_handmatige_gating: vereistHandmatigeGating(tag),
      in_html: inHtml,
      in_dom_voor_consent: inDom,
      gated_via_cmp_attribuut: gated,
      requests_voor_consent: voor,
      requests_na_consent: na,
      // Alleen de herlaadmeting (meting 3); zit ook al in requests_na_consent.
      requests_na_herladen: meting3 ? meting3.requests.filter((request) => request.bekende_tag === tag.id).length : null,
      opslag_voor_consent: opslagVoor,
      consent_mode_voor_consent: statusVoor,
      // Requests die iets versturen in plaats van een bestand op te halen.
      hits_voor_consent: voorRequests.filter((request) => !DOWNLOADS.has(request.resource_type)).length,
      // Hits (geen scriptdownloads) die géén consentstatus meesturen.
      hits_zonder_consentstatus_voor_consent: voorRequests.filter((request) => !request.consent_mode && !DOWNLOADS.has(request.resource_type)).length,
      alleen_geweigerde_pings_voor_consent: alleenGeweigerd,
      cookies_voor_consent: cookiesVoor,
      cookies_na_consent: cookiesNa,
    };
  });

  // Alleen tags waar íets van gezien is; de rest zou de JSON alleen maar vullen.
  return status.filter((s) =>
    s.in_html || s.in_dom_voor_consent || s.requests_voor_consent > 0 || (s.requests_na_consent ?? 0) > 0
    || s.cookies_voor_consent.length > 0 || (s.cookies_na_consent?.length ?? 0) > 0 || s.opslag_voor_consent.length > 0);
}

/**
 * Bekende tags die ná consent geen request doen. Een laadscript (gtag.js) telt
 * niet: die wordt één keer opgehaald en hoeft daarna nooit meer.
 */
function ontbrekendeTags(status, meting2) {
  if (!meting2) return null;
  return status
    .filter((s) => !s.laadscript)
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
        // Valt buiten Google Consent Mode; heeft de tag een eigen consent-API, dan staat die hier.
        consent_api: s.consent_api,
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

// --- Herkomst van cookies ---------------------------------------------------------------

/**
 * Wie zette deze cookie? Een server met `Set-Cookie` (welke host), of een
 * script via `document.cookie` (welk script, uit het logboek van initScript).
 *
 * Een cookie die op naam onbekend is, maar aantoonbaar door een trackerscript
 * of in het antwoord van een tracker werd gezet, wordt daarmee een bewezen
 * trackingcookie. Dat is herkenning op bewijs in plaats van op naam; een
 * onbekende cookie van het eigen CMS blijft onbekend.
 */
export function verrijkCookies(cookies, requests = [], logboek = []) {
  return cookies.map((cookie) => {
    const domein = String(cookie.domein || '').replace(/^\.+/, '');
    const viaScript = logboek.filter((item) => item.soort === 'cookie' && item.sleutel === cookie.naam && item.script);
    const viaHttp = requests.filter((request) => (request.zet_cookies || []).includes(cookie.naam)
      && (request.host === domein || request.host.endsWith(`.${domein}`) || domein.endsWith(`.${request.host}`) || domein === request.host));

    let herkomst = null;
    let tag = null;
    if (viaHttp.length) {
      const bron = viaHttp.find((request) => request.tracking_bekend) || viaHttp[0];
      herkomst = { via: 'http', host: bron.host, tag: bron.bekende_tag || null };
      if (bron.tracking_bekend) tag = tagPerId(bron.bekende_tag);
    } else if (viaScript.length) {
      const scripts = [...new Set(viaScript.map((item) => item.script))];
      const tags = scripts.map((script) => herkenTag(hostEnPad(script))).filter(Boolean);
      const trackerTag = tags.find((t) => t.tracking) || null;
      herkomst = { via: 'javascript', script: kort(scripts[0], 300), tag: trackerTag?.id || tags[0]?.id || null };
      tag = trackerTag;
    }

    if (cookie.classificatie === 'onbekend' && tag) {
      return { ...cookie, classificatie: 'tracking', tag: tag.id, herkend_via: 'herkomst', herkomst };
    }
    return herkomst ? { ...cookie, herkomst } : cookie;
  });
}

// --- Opslag buiten cookies -----------------------------------------------------------

/**
 * localStorage, sessionStorage en IndexedDB vóór consent. De toestemmingsplicht
 * geldt voor elke opslag op het apparaat, niet alleen voor cookies. Een sleutel
 * wordt aan een tracker toegeschreven op naam (dezelfde patronen als cookies)
 * of op het script dat hem schreef.
 */
function analyseerOpslag(opslag) {
  if (!opslag) return null;
  const logboek = opslag.logboek || [];
  const items = [];
  for (const [soort, lijst] of [['localStorage', opslag.local_storage || []], ['sessionStorage', opslag.session_storage || []]]) {
    for (const { sleutel, lengte } of lijst) {
      const opNaam = classificeerCookie(sleutel);
      const schrijvers = [...new Set(logboek.filter((item) => item.soort === soort && item.sleutel === sleutel && item.script).map((item) => item.script))];
      const scriptTags = schrijvers.map((script) => herkenTag(hostEnPad(script))).filter(Boolean);
      const opScript = scriptTags.find((t) => t.tracking) || scriptTags[0] || null;
      // Op naam een tracker wint; anders bepaalt het script dat schreef het label:
      // een tracker, de CMP zelf, of een bekende dienst die geen tracker is (GTM).
      const tag = opNaam.classificatie === 'tracking' ? tagPerId(opNaam.tag) : opScript;
      const classificatie = tag?.tracking ? 'tracking'
        : tag?.categorie === 'cmp' ? 'cmp'
          : opNaam.classificatie !== 'onbekend' ? opNaam.classificatie
            : tag ? 'bekende_dienst' : 'onbekend';
      items.push({
        soort,
        sleutel,
        lengte,
        classificatie,
        tag: tag?.id || null,
        tag_naam: tag?.naam || null,
        script: schrijvers[0] ? kort(schrijvers[0], 300) : null,
      });
    }
  }
  // Trackers bovenaan: daar gaat het om.
  items.sort((a, b) => Number(b.classificatie === 'tracking') - Number(a.classificatie === 'tracking'));
  const tracking = items.filter((item) => item.classificatie === 'tracking');
  return {
    gevonden: tracking.length > 0,
    aantal: items.length,
    aantal_tracking: tracking.length,
    items,
    indexeddb: opslag.indexeddb || [],
    fout: opslag.fout || null,
  };
}

// --- Weigeren ------------------------------------------------------------------------

/**
 * Wat er gebeurt nadat een bezoeker alles weigert, gemeten in een aparte,
 * schone browser. Per bekende tracker: hits, nieuwe cookies, identifiers en
 * nieuwe opslag ná het weigeren. Pings met de status "geweigerd" (G100,
 * asc=D) en scriptdownloads staan er wel bij, maar maken een tag niet actief.
 */
function analyseerWeigeren(weigeren, landingsUrls) {
  if (!weigeren) return null;
  const { keuze, meting, cookies_voor: cookiesVoor = [], opslag_voor: opslagVoor = [] } = weigeren;
  if (weigeren.fout) return { bepaald: false, reden: weigeren.fout, methode: null, gevonden: null, tags: [] };
  if (!keuze?.gelukt) {
    return {
      bepaald: false,
      reden: keuze?.reden || 'weigeren is niet gelukt',
      methode: keuze?.methode || null,
      gevonden: null,
      tags: [],
      geprobeerd: keuze?.geprobeerd || [],
    };
  }

  const bestond = new Set(cookiesVoor.map((c) => `${c.naam}@${c.domein}`));
  const nieuweCookies = (meting.cookies || []).filter((c) => !bestond.has(`${c.naam}@${c.domein}`));
  const opslagBestond = new Set(opslagVoor);
  const nieuweOpslag = (analyseerOpslag(meting.opslag)?.items || []).filter((item) => !opslagBestond.has(`${item.soort}:${item.sleutel}`));
  const ids = identifiersInPayload(meting.requests || [], landingsUrls).details;

  const tags = TRACKING_TAGS.filter((tag) => !tag.laadscript).map((tag) => {
    const requests = (meting.requests || []).filter((request) => request.bekende_tag === tag.id);
    const hits = requests.filter((request) => !DOWNLOADS.has(request.resource_type));
    const codes = {};
    for (const request of requests) if (request.consent_mode) codes[request.consent_mode.code] = (codes[request.consent_mode.code] || 0) + 1;
    const alleenGeweigerd = hits.length > 0 && hits.every((request) => request.consent_mode?.geweigerd);
    const cookies = [...new Set(nieuweCookies.filter((c) => c.tag === tag.id).map((c) => c.naam))];
    const opslag = [...new Set(nieuweOpslag.filter((item) => item.tag === tag.id).map((item) => item.sleutel))];
    const identifiers = ids.filter((d) => d.bekende_tag === tag.id && d.consent_mode_geweigerd !== true).length;
    const actief = (hits.length > 0 && !alleenGeweigerd) || cookies.length > 0 || opslag.length > 0 || identifiers > 0;
    return {
      tag: tag.id,
      naam: tag.naam,
      categorie: tag.categorie,
      sessie_opname: !!tag.sessie_opname,
      requests: requests.length,
      hits: hits.length,
      consent_mode: codes,
      alleen_geweigerde_pings: alleenGeweigerd,
      nieuwe_cookies: cookies,
      nieuwe_opslag: opslag,
      identifiers,
      actief,
    };
  }).filter((t) => t.requests > 0 || t.nieuwe_cookies.length || t.nieuwe_opslag.length);

  return {
    bepaald: true,
    methode: keuze.methode,
    cmps: keuze.cmps,
    gevonden: tags.some((t) => t.actief),
    aantal_requests: (meting.requests || []).length,
    aantal_requests_extern: (meting.requests || []).filter((request) => request.is_extern).length,
    tags,
    nieuwe_cookies: nieuweCookies.map((c) => ({ naam: c.naam, domein: c.domein, is_third_party: c.is_third_party, classificatie: c.classificatie, tag: c.tag })),
  };
}

// --- Eigen subdomeinen (CNAME) ---------------------------------------------------------

/**
 * Eigen subdomeinen die via DNS naar een trackingdienst of een server-side
 * tagging-server wijzen. Requests ernaartoe zien eruit als first-party, maar
 * komen bij een andere partij uit. `dns` komt uit de scanner: per host de CNAME-keten.
 */
function eigenSubdomeinen(dns, requests) {
  if (!dns) return null;
  const items = dns.map((item) => {
    const naarHost = requests.filter((request) => request.host === item.host);
    // Zonder CNAME (een A-record naar de server) verraden de hits zelf het vaak:
    // een GA4-hit of een tracking-pad op een eigen subdomein.
    const herkend = item.cname.map(herkenCnameDoel).find(Boolean)
      || (naarHost.some((request) => request.lijkt_server_side_tagging) ? { naam: 'server-side tagging (herkend aan de hits zelf, geen CNAME)', soort: 'server_side_tagging' } : null);
    return {
      host: item.host,
      cname: item.cname,
      herkend_als: herkend?.naam || null,
      soort: herkend?.soort || null,
      requests_voor_consent: naarHost.length,
      hits_voor_consent: naarHost.filter((request) => !DOWNLOADS.has(request.resource_type)).length,
      fout: item.fout || null,
    };
  });
  return { bepaald: true, gevonden: items.some((item) => item.herkend_als), items };
}

// --- De cookiebanner zelf ---------------------------------------------------------------

/** Wat de bannerinspectie zag, plus of de keuze later nog te wijzigen is. Feiten, geen weging. */
function cookiebanner(banner, intrekken) {
  if (!banner) return null;
  return { ...banner, intrekken: intrekken ?? null };
}

/**
 * `landingsUrls`: de start- en eind-URL, om waarden uit de landings-URL te herkennen in regel 3.
 * `meting3`: de meting na herladen met consent; telt mee als "ná consent".
 * `weigeren`, `banner`, `intrekken`, `dns`, `opslag`: de aanvullende metingen uit de scanner.
 */
export function analyseer({ html, meting1, meting2, meting3 = null, cmps, landingsUrls = [], weigeren = null, banner = null, intrekken = null, dns = null }) {
  // Meting 2 en 3 samen zijn "ná consent": wat pas bij de volgende paginaweergave
  // vuurt, telt ook. De cookies van meting 3 bevatten die van meting 2 al.
  const na = meting2
    ? { ...meting2, requests: [...meting2.requests, ...(meting3?.requests || [])], cookies: (meting3 || meting2).cookies }
    : null;
  const opslag = analyseerOpslag(meting1.opslag);
  const status = tagStatus({ html, meting1, meting2: na, meting3, opslag });
  return {
    cookies_voor_consent: cookiesVoorConsent(meting1.cookies),
    externe_requests_voor_consent: externeRequests(meting1.requests),
    identifiers_in_payload_voor_consent: identifiersInPayload(meting1.requests, landingsUrls),
    ontbrekende_tags_na_consent: ontbrekendeTags(status, na),
    tag_status: status,
    meerdere_cmps_actief: meerdereCmps(cmps),
    niet_google_tags_gevonden: nietGoogleTags(status),
    js_gegenereerde_iframes: jsGegenereerdeIframes(html, meting1.dom?.iframes || []),
    tracking_na_weigeren: analyseerWeigeren(weigeren, landingsUrls),
    cookiebanner: cookiebanner(banner, intrekken),
    opslag_voor_consent: opslag,
    eigen_subdomeinen: eigenSubdomeinen(dns, meting1.requests),
    nieuwe_cookies_na_consent: nieuweCookies(meting1, na),
    nieuwe_hosts_na_consent: nieuweHosts(meting1, na),
    identifiers_in_payload_na_consent: na ? identifiersInPayload(na.requests, landingsUrls) : null,
    herladen_na_consent: meting3 ? { gemeten: true, aantal_requests: meting3.requests.length } : { gemeten: false, aantal_requests: null },
  };
}
