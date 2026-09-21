/**
 * Zet een afgeronde (of halverwege gestrande) scan om in het JSON-rapport en
 * schrijft dat weg. De structuur volgt de afspraak uit de projectopdracht:
 * `raw_data` met beide metingen, `cmp_info` en `bevindingen`. Alles wat in
 * `raw_data` staat is meting; alles in `bevindingen` is afgeleid, met de
 * details erbij zodat de lezer de afleiding kan controleren.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyseer, consentModeUit } from './analyse.js';
import { STRATEGIEEN, beschrijfMethode } from './cmp/consent.js';
import { kiesPrimaireCmp } from './cmp/detect.js';
import { beschrijfLaadpositie } from './cmp/laadpositie.js';
import { hostVan } from './domain.js';
import { seconden, slug, tijdstempel } from './util.js';

export const TOOL = {
  naam: 'consent-check',
  versie: '1.1.0',
  // Via de officiële API: de eerste negen. De rest via de officiële knop; onbekende banners via tekstherkenning.
  cmp_ondersteuning: STRATEGIEEN.map((strategie) => `${strategie.naam}${strategie.api ? ' (API)' : ' (knop)'}`),
};

export function bouwRapport(scan, instellingen) {
  const html = scan.html?.ontleed || null;
  const meting1 = scan.meting1;
  const meting2 = scan.meting2;
  const waarschuwingen = [...scan.waarschuwingen];

  let laadpositie = null;
  let bevindingen = null;
  let fout = scan.fout;
  let status = scan.status;

  if (meting1) {
    try {
      laadpositie = beschrijfLaadpositie(kiesPrimaireCmp(scan.cmps, scan.consent), {
        html,
        dom: meting1.dom,
        requests: [...meting1.requests, ...(meting2?.requests || [])],
        events: [...(meting1.dom?.events || []), ...(meting2?.dom?.events || [])],
      });
      bevindingen = analyseer({ html, meting1, meting2, cmps: scan.cmps });
    } catch (error) {
      // Een analysefout is een bug in de tool, geen eigenschap van de site: hard markeren.
      status = 'mislukt';
      fout = fout || { stap: 'analyse', melding: `Analyse mislukt: ${error.stack || error.message}` };
      waarschuwingen.push(`Analyse mislukt: ${error.message}`);
    }
  }

  const cmpsActief = scan.cmps.filter((cmp) => cmp.actief);

  return {
    url: scan.url,
    eind_url: scan.eind_url,
    gescand_op: scan.gescand_op,
    duur_ms: scan.duur_ms,
    status,
    fout,
    waarschuwingen,
    tool: TOOL,
    browser: scan.browser
      ? {
        ...scan.browser,
        // Zelfcontrole: zijn er third-party cookies aangekomen? Zo niet, dan blokkeerde de browser mogelijk zelf.
        third_party_cookies_waargenomen: [...(meting1?.cookies || []), ...(meting2?.cookies || [])].some((cookie) => cookie.is_third_party),
      }
      : null,
    instellingen,

    html: scan.html
      ? {
        status: scan.html.status,
        eind_url: scan.html.eind_url,
        content_type: scan.html.content_type,
        lengte: scan.html.lengte,
        duur_ms: scan.html.duur_ms,
        titel: html.titel,
        aantal_scripts: html.aantal_scripts,
        aantal_iframes: html.aantal_iframes,
        gtm_containers: html.gtm_containers,
        resource_hints: html.resource_hints,
      }
      : null,

    raw_data: {
      voor_consent: meting1
        ? {
          navigatie_status: meting1.navigatie_status,
          wachttijd: meting1.wachttijd,
          // Was er al geaccepteerd toen deze meting werd gedaan? Zo ja, dan is
          // dit geen nulmeting en kloppen de bevindingen eronder niet als zodanig.
          consent_al_gegeven: meting1.consent_al_gegeven ?? { gegeven: false, cmp: null, detail: null },
          pagina: paginaInfo(meting1.dom),
          cookies: meting1.cookies,
          requests: meting1.requests,
          iframes_html: html?.iframes ?? null,
          iframes_dom: meting1.dom?.iframes ?? [],
          scripts_html: html?.scripts ?? null,
          scripts_dom: meting1.dom?.scripts ?? [],
          data_layer: meting1.dom?.data_layer ?? null,
          google_consent_signalen: meting1.dom?.google_consent_signalen ?? null,
          cmp_state: cmpState(meting1.dom),
          events: meting1.dom?.events ?? [],
        }
        : null,
      consent: scan.consent,
      na_consent: meting2
        ? {
          wachttijd: meting2.wachttijd,
          pagina: paginaInfo(meting2.dom),
          cookies: meting2.cookies,
          requests: meting2.requests,
          iframes_dom: meting2.dom?.iframes ?? [],
          scripts_dom: meting2.dom?.scripts ?? [],
          data_layer: meting2.dom?.data_layer ?? null,
          google_consent_signalen: meting2.dom?.google_consent_signalen ?? null,
          cmp_state: cmpState(meting2.dom),
          events: meting2.dom?.events ?? [],
        }
        : null,
    },

    cmp_info: {
      detected: cmpsActief.map((cmp) => cmp.naam),
      // Regel 5 gaat over de belangrijkste CMP: die waar consent doorheen ging, anders de eerste actieve.
      primair: laadpositie?.naam ?? null,
      load_position: laadpositie?.load_position ?? null,
      attributes: laadpositie?.attributes ?? [],
      loaded_via_gtm: laadpositie?.loaded_via_gtm ?? null,
      synchroon: laadpositie?.synchroon ?? null,
      laadpositie,
      cmps: scan.cmps,
      google_consent_mode: {
        voor_consent: consentModeUit(meting1?.dom?.data_layer),
        na_consent: meting2 ? consentModeUit(meting2.dom?.data_layer) : null,
      },
    },

    bevindingen,
  };
}

function paginaInfo(dom) {
  if (!dom) return null;
  return {
    url: dom.url,
    titel: dom.titel,
    ready_state: dom.ready_state,
    gtag_aanwezig: dom.gtag_aanwezig,
    fbq_aanwezig: dom.fbq_aanwezig,
    js_cookies: dom.js_cookies,
    fout: dom.fout ?? null,
  };
}

function cmpState(dom) {
  if (!dom) return null;
  return {
    cookiescript: dom.cookiescript ?? null,
    cookiebot: dom.cookiebot ?? null,
    usercentrics: dom.usercentrics ?? null,
    globals: dom.cmp_globals ?? {},
    elementen: dom.cmp_elementen ?? [],
  };
}

// --- Wegschrijven -----------------------------------------------------------------

export async function schrijfRapport(rapport, outputMap) {
  await mkdir(outputMap, { recursive: true });
  const bestandsnaam = `${slug(hostVan(rapport.eind_url || rapport.url) || rapport.url)}-${tijdstempel(new Date(rapport.gescand_op))}.json`;
  const pad = join(outputMap, bestandsnaam);
  await writeFile(pad, JSON.stringify(rapport, null, 2), 'utf-8');
  return pad;
}

// --- Console ------------------------------------------------------------------------

export function samenvatting(rapport) {
  const b = rapport.bevindingen;
  const regels = [];
  if (!b) {
    regels.push(`  Geen bevindingen: de scan strandde vóór meting 1${rapport.fout ? ` (${rapport.fout.stap}: ${rapport.fout.melding})` : ''}.`);
    return regels.join('\n');
  }

  const cmp = rapport.cmp_info;
  const ja = (v) => (v ? 'JA' : 'nee');
  regels.push(`  CMP's actief: ${cmp.detected.length ? cmp.detected.join(', ') : 'geen'}${b.meerdere_cmps_actief.gevonden ? '  <- meerdere CMP\'s' : ''}`);
  regels.push(`  Consent: ${beschrijfMethode(rapport.raw_data.consent)}`);
  const lp = cmp.laadpositie;
  regels.push(`  Laadpositie ${lp?.naam ?? 'CMP'}: ${lp?.detected ? `${lp.load_position ?? '?'}, ${lp.attributes.join(' ') || 'geen attributen'}, geladen via ${lp.geladen_via}` : 'niet aangetroffen'}`);
  regels.push(`  1. Cookies vóór consent: ${ja(b.cookies_voor_consent.gevonden)} (${b.cookies_voor_consent.aantal} van ${b.cookies_voor_consent.aantal_totaal}, ${b.cookies_voor_consent.aantal_third_party} third-party)`);
  regels.push(`  2. Externe requests vóór consent: ${ja(b.externe_requests_voor_consent.gevonden)} (${b.externe_requests_voor_consent.aantal_hosts} hosts, ${b.externe_requests_voor_consent.aantal_tracking_hosts} bekende trackers)`);
  regels.push(`  3. Identifiers in payload vóór consent: ${ja(b.identifiers_in_payload_voor_consent.gevonden)} (${b.identifiers_in_payload_voor_consent.aantal_requests} requests)`);
  const zonderBanner = !!rapport.raw_data.consent && !rapport.raw_data.consent.gegeven;
  regels.push(`  4. Ontbrekende tags ná consent: ${b.ontbrekende_tags_na_consent ? (b.ontbrekende_tags_na_consent.length ? b.ontbrekende_tags_na_consent.map((t) => t.tag).join(', ') : 'geen') : zonderBanner ? 'n.v.t. (geen cookiebanner)' : 'niet gemeten (geen meting 2)'}`);
  regels.push(`  6. Meerdere CMP's actief: ${ja(b.meerdere_cmps_actief.gevonden)} (${b.meerdere_cmps_actief.aantal_actief} actief, ${b.meerdere_cmps_actief.aantal_gesignaleerd} gesignaleerd)`);
  regels.push(`  7. Niet-Google tags: ${b.niet_google_tags_gevonden.length ? b.niet_google_tags_gevonden.map((t) => `${t.tag}${t.vuurt_voor_consent ? ' (vuurt vóór consent)' : ''}`).join(', ') : 'geen'}`);
  regels.push(`  8. JS-gegenereerde iframes: ${b.js_gegenereerde_iframes.bepaald ? `${ja(b.js_gegenereerde_iframes.gevonden)} (${b.js_gegenereerde_iframes.aantal})` : 'niet bepaald'}`);
  if (b.nieuwe_cookies_na_consent) regels.push(`  Ná consent: ${b.nieuwe_cookies_na_consent.length} nieuwe cookies, ${b.nieuwe_hosts_na_consent.length} nieuwe hosts`);
  regels.push(`  Duur: ${seconden(rapport.duur_ms)}`);
  return regels.join('\n');
}
