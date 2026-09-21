/**
 * Het rapport als PDF.
 *
 * WAAROM CHROMIUM EN GEEN PDF-BIBLIOTHEEK
 * Deze tool heeft al een Chromium aan boord voor de scan. Die kan `page.pdf()`,
 * en dat is verreweg de beste optie: we schrijven gewoon HTML en CSS (waarin we
 * al denken in dit project), krijgen echte paginering met `@page`, herhalende
 * kop- en voetteksten, vectortekst die doorzoekbaar blijft, en we houden de
 * regel "geen dependencies buiten Playwright". Een bibliotheek als pdfmake zou
 * een eigen opmaaktaal introduceren voor iets wat de browser beter kan.
 *
 * DYNAMISCHE HUISSTIJL
 * De accentkleur en het logo komen uit de gescande site (zie lib/branding.js).
 * De structuur blijft Pure Minds: dit is ons rapport over hun site, geen
 * nabootsing van hun merk. Vandaar: hun logo en kleur op het omslag en als
 * accent, ons logo in de voettekst, onze typografie. Een merkkleur die op wit
 * niet leesbaar is, wordt vooraf donkerder gemaakt; daardoor blijft elke kop
 * leesbaar, ook bij een lichtgeel of knalgroen merk.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { standaardPalet } from './branding.js';
import { hostVan } from './domain.js';
import { slug, tijdstempel } from './util.js';

const PROJECTMAP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Eén browser voor alle PDF's in een sessie; opstarten kost een seconde. */
let pdfBrowser = null;

async function geefBrowser() {
  if (pdfBrowser && pdfBrowser.isConnected()) return pdfBrowser;
  // Altijd headless: page.pdf() werkt alleen in headless Chromium.
  pdfBrowser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chromium', headless: true }));
  return pdfBrowser;
}

export async function sluitPdfBrowser() {
  if (pdfBrowser) await pdfBrowser.close().catch(() => {});
  pdfBrowser = null;
}

let logoCache;

/** Het Pure Minds-logo als data-URL; de PDF mag niets van buiten laden. */
async function puremindsLogo() {
  if (logoCache !== undefined) return logoCache;
  try {
    const bytes = await readFile(join(PROJECTMAP, 'assets', 'pureminds-logo.png'));
    logoCache = `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

// --- Tekst voorbereiden ----------------------------------------------------------

function esc(waarde) {
  return String(waarde ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const getal = (waarde) => Number(waarde || 0).toLocaleString('nl-NL');
const leesbaar = (waarde) => String(waarde || '').replace(/_/g, ' ');

function datum(iso) {
  try {
    return new Date(iso).toLocaleString('nl-NL', { dateStyle: 'long', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

/** "Cookiebot-API" of de tekst van de knop; zelfde logica als in de interface. */
function methodeLabel(consent) {
  if (!consent) return 'geen consent-stap';
  if (!consent.gegeven) {
    return consent.methode === 'geen_cmp' ? 'geen cookiebanner aangetroffen' : 'CMP aanwezig, maar geen banner getoond';
  }
  const gelukt = (consent.geprobeerd || []).filter((p) => p.gelukt);
  if (!gelukt.length) return consent.methode || 'onbekend';
  return gelukt
    .map((p) => (p.methode === 'knop_tekstherkenning' ? `knop "${p.knop_tekst}"` : p.methode.endsWith('_api') ? `${p.cmp}-API` : `${p.cmp}-knop`))
    .join(' + ');
}

/**
 * Welke ondergrond het klantlogo nodig heeft.
 *
 * Veel merken leveren hun logo als wit met een doorzichtige achtergrond, voor
 * gebruik op een donkere foto. Zo'n logo op een wit vlak is een leeg kader.
 * `helderheid` komt uit lib/branding.js: 0 is zwart, 1 is wit. Boven 0,6 zetten
 * we er een donker vlak achter, anders wit.
 */
function logoOndergrond(logo) {
  return (logo?.helderheid ?? 0) > 0.6 ? 'op-donker' : 'op-licht';
}

// --- Bouwstenen -------------------------------------------------------------------

function tabel(koppen, rijen, opties = {}) {
  if (!rijen.length) return '';
  const max = opties.max ?? 25;
  const getoond = rijen.slice(0, max);
  const rest = rijen.length - getoond.length;
  return `
    <table class="data">
      <thead><tr>${koppen.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead>
      <tbody>
        ${getoond.map((rij) => `<tr>${rij.map((cel, i) => `<td${i === 0 ? ' class="naam"' : ''}>${esc(cel)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
    ${rest > 0 ? `<p class="meer">+ ${getal(rest)} meer, zie de JSON-bijlage.</p>` : ''}`;
}

function pillen(teksten, soort = '') {
  if (!teksten.length) return '';
  return `<p class="pillen">${teksten.map((t) => `<span class="pil ${soort}">${esc(t)}</span>`).join(' ')}</p>`;
}

/**
 * Eén bevinding als blok. `toon` bepaalt de kleur van het nummer: dezelfde
 * leeswijzer als in de interface, zodat scherm en PDF hetzelfde verhaal vertellen.
 */
function bevinding(nummer, titel, samenvatting, toon, inhoud) {
  return `
    <section class="bevinding toon-${toon}">
      <div class="bevinding-kop">
        <span class="nummer">${esc(nummer)}</span>
        <div>
          <h3>${esc(titel)}</h3>
          <p class="samenvatting">${esc(samenvatting)}</p>
        </div>
      </div>
      ${inhoud ? `<div class="bevinding-inhoud">${inhoud}</div>` : ''}
    </section>`;
}

// --- De acht regels ----------------------------------------------------------------

function regels(rapport) {
  const b = rapport.bevindingen;
  const cmp = rapport.cmp_info;
  const consent = rapport.raw_data?.consent;
  const zonderBanner = !!consent && !consent.gegeven;
  const stukken = [];

  // 1
  const r1 = b.cookies_voor_consent;
  stukken.push(bevinding(1, 'Cookies vóór consent',
    r1.gevonden
      ? `${getal(r1.aantal)} cookie(s) gezet voordat er toestemming was, waarvan ${getal(r1.aantal_third_party)} van een andere partij.`
      : 'Geen cookies vóór consent, afgezien van de cookie van de CMP zelf en functionele cookies op het eigen domein.',
    r1.gevonden ? 'bad' : 'good',
    tabel(['Cookie', 'Domein', 'Partij', 'Duur', 'Soort'],
      r1.details.map((c) => [c.naam, c.domein, c.is_third_party ? 'third-party' : 'eigen domein', c.is_sessie ? 'sessie' : 'persistent', leesbaar(c.tag || c.classificatie)]))));

  // 2
  const r2 = b.externe_requests_voor_consent;
  stukken.push(bevinding(2, 'Externe requests vóór consent',
    r2.gevonden
      ? `${getal(r2.aantal_requests)} requests naar ${getal(r2.aantal_hosts)} externe hosts, waarvan ${getal(r2.aantal_tracking_hosts)} bekende trackers en ${getal(r2.aantal_onbekende_hosts)} onbekend.`
      : 'Geen requests naar hosts buiten het eigen domein.',
    r2.aantal_tracking_hosts ? 'bad' : r2.gevonden ? 'mid' : 'good',
    tabel(['Host', 'Requests', 'Herkend als', 'Soort'],
      r2.hosts.map((h) => [h.host, getal(h.aantal), h.tag_naam || 'onbekend', leesbaar(h.categorie)]), { max: 30 })));

  // 3
  const r3 = b.identifiers_in_payload_voor_consent;
  stukken.push(bevinding(3, 'Identifiers in de payload vóór consent',
    r3.gevonden
      ? `${getal(r3.aantal_requests)} request(s) sturen een herkenbare identifier mee in de URL of de POST-body, ook zonder cookie.`
      : 'Geen bekende identifiers in de payload vóór consent.',
    r3.gevonden ? 'bad' : 'good',
    tabel(['Host', 'Tag', 'Identifiers'],
      r3.details.map((d) => [d.host, d.bekende_tag || 'onbekend', d.identifiers.map((i) => `${i.parameter}=${i.waarde}`).join('; ')]), { max: 20 })));

  // 4
  const ontbrekend = b.ontbrekende_tags_na_consent;
  stukken.push(bevinding(4, 'Tags ná consent',
    ontbrekend
      ? (ontbrekend.length
        ? `${ontbrekend.length} tag(s) doen ná consent geen enkel request: ${ontbrekend.map((t) => t.naam).join(', ')}.`
        : 'Alle aangetroffen tags doen ook ná consent requests.')
      : zonderBanner ? 'Niet van toepassing: er is geen cookiebanner, dus ook geen consent-stap.' : 'Niet gemeten: de scan is gestopt vóór de tweede meting.',
    ontbrekend ? (ontbrekend.length ? 'mid' : 'good') : 'none',
    b.tag_status?.length
      ? tabel(['Tag', 'In HTML', 'In DOM', 'Requests vóór', 'Requests ná'],
        b.tag_status.map((t) => [t.naam, t.in_html === null ? '?' : t.in_html ? 'ja' : 'nee', t.in_dom_voor_consent ? 'ja' : 'nee', getal(t.requests_voor_consent), t.requests_na_consent === null ? 'n.v.t.' : getal(t.requests_na_consent)]))
      : ''));

  // 5
  const lp = cmp.laadpositie;
  if (lp?.detected) {
    const via = { gtm: 'via Google Tag Manager geïnjecteerd', html: 'rechtstreeks in de HTML', niet_geladen: 'niet geladen' }[lp.geladen_via] || lp.geladen_via;
    const voor = lp.tracking_requests_tot_cmp_aangevraagd;
    stukken.push(bevinding(5, 'Laadpositie van de cookiebanner',
      `${lp.naam}: in de ${lp.load_position || 'onbekende positie'}, ${lp.synchroon ? 'synchroon' : lp.attributes.join(' ') || 'zonder attributen'}, ${via}.`,
      lp.loaded_via_gtm || voor?.aantal ? 'mid' : 'none',
      `<dl class="kv">
        <dt>CMP</dt><dd>${esc(lp.naam)}</dd>
        <dt>Positie</dt><dd>${esc(lp.load_position || 'onbekend')}</dd>
        <dt>Attributen</dt><dd>${esc(lp.attributes.join(', ') || 'geen')}</dd>
        <dt>Via GTM geladen</dt><dd>${lp.loaded_via_gtm === null ? 'onbekend' : lp.loaded_via_gtm ? 'ja' : 'nee'}</dd>
        ${lp.request ? `<dt>Script geladen na</dt><dd>${(lp.request.tijd_ms / 1000).toFixed(1).replace('.', ',')} s</dd>` : ''}
      </dl>
      ${voor?.aantal ? `<p class="let-op"><strong>${getal(voor.aantal)} tracking-request(s) waren al onderweg toen het CMP-script werd opgevraagd.</strong> Hosts: ${esc(voor.hosts.join(', '))}.</p>` : ''}`));
  } else {
    stukken.push(bevinding(5, 'Laadpositie van de cookiebanner',
      cmp.detected.length ? `Het laadscript van ${cmp.detected.join(', ')} is niet teruggevonden in de HTML of de DOM.` : 'Geen CMP op deze pagina aangetroffen.',
      'none', ''));
  }

  // 6
  const r6 = b.meerdere_cmps_actief;
  stukken.push(bevinding(6, "Meerdere cookiebanners actief",
    r6.gevonden ? `${r6.aantal_actief} CMP's draaien tegelijk op deze pagina.` : r6.aantal_actief === 1 ? 'Eén actieve CMP gevonden.' : 'Geen actieve CMP gevonden.',
    r6.gevonden ? 'bad' : 'good',
    r6.cmps.length ? tabel(['CMP', 'Status', 'Signalen'], r6.cmps.map((c) => [c.naam, c.actief ? 'actief' : 'alleen in de HTML', String(c.signalen.length)])) : ''));

  // 7
  const r7 = b.niet_google_tags_gevonden;
  const vuurtVoor = r7.filter((t) => t.vuurt_voor_consent);
  stukken.push(bevinding(7, 'Niet-Google tags',
    r7.length
      ? `${r7.length} niet-Google tag(s) gevonden${vuurtVoor.length ? `, waarvan er ${vuurtVoor.length} al vóór consent ${vuurtVoor.length === 1 ? 'vuurt' : 'vuren'}` : ''}.`
      : 'Geen niet-Google tags aangetroffen.',
    vuurtVoor.length ? 'bad' : r7.length ? 'mid' : 'good',
    r7.length
      ? `<p class="uitleg">Deze tags kennen geen Consent Mode. Ze moeten door de cookiebanner zelf worden tegengehouden of handmatig worden gegate.</p>
         ${tabel(['Tag', 'Leverancier', 'Vóór consent', 'Ná consent', 'Gegate'], r7.map((t) => [t.naam, leesbaar(t.leverancier), t.vuurt_voor_consent ? 'vuurt' : 'stil', t.vuurt_na_consent === null ? 'niet gemeten' : t.vuurt_na_consent ? 'vuurt' : 'stil', t.gated_via_cmp_attribuut ? 'ja' : 'nee']))}`
      : ''));

  // 8
  const r8 = b.js_gegenereerde_iframes;
  stukken.push(bevinding(8, 'JS-gegenereerde iframes',
    r8.bepaald
      ? (r8.gevonden
        ? `${getal(r8.aantal)} iframe(s) staan wel in de gerenderde pagina maar niet in de ruwe HTML.`
        : `Alle ${getal(r8.aantal_iframes_dom)} iframes in de pagina staan ook in de ruwe HTML.`)
      : `Niet bepaald: ${r8.reden}.`,
    r8.gevonden ? 'mid' : r8.bepaald ? 'good' : 'none',
    r8.gevonden
      ? `<p class="uitleg">Iframes die pas door JavaScript ontstaan, ontwijken vaak de autoblocking van een cookiebanner.</p>
         ${tabel(['Bron', 'Herkend als', 'Reden'], r8.iframes.map((f) => [f.src || '(geen src)', f.tag_naam || 'onbekend', f.reden]))}`
      : ''));

  return stukken.join('\n');
}

// --- Het document ---------------------------------------------------------------------

function documentHtml(rapport, palet, pmLogo) {
  const b = rapport.bevindingen;
  const consent = rapport.raw_data?.consent;
  const host = hostVan(rapport.eind_url || rapport.url) || rapport.url;
  const geslaagd = rapport.status === 'geslaagd';
  const zonderBanner = geslaagd && !!consent && !consent.gegeven;

  const kerncijfers = b
    ? [
      { label: 'Cookies vóór consent', waarde: getal(b.cookies_voor_consent.aantal), onder: `van ${getal(b.cookies_voor_consent.aantal_totaal)} totaal`, toon: b.cookies_voor_consent.aantal ? 'bad' : 'good' },
      { label: 'Tracking-hosts', waarde: getal(b.externe_requests_voor_consent.aantal_tracking_hosts), onder: `van ${getal(b.externe_requests_voor_consent.aantal_hosts)} extern`, toon: b.externe_requests_voor_consent.aantal_tracking_hosts ? 'bad' : 'good' },
      { label: 'Requests met identifier', waarde: getal(b.identifiers_in_payload_voor_consent.aantal_requests), onder: 'vóór consent', toon: b.identifiers_in_payload_voor_consent.aantal_requests ? 'bad' : 'good' },
    ]
    : [];

  const meldingen = [];
  if (rapport.blokkade?.geblokkeerd) meldingen.push({ soort: 'fout', titel: 'De site blokkeerde de scanner', tekst: rapport.blokkade.melding });
  if (!geslaagd && rapport.fout) meldingen.push({ soort: 'fout', titel: `Scan gestopt bij stap "${rapport.fout.stap}"`, tekst: rapport.fout.melding });
  if (zonderBanner) meldingen.push({ soort: 'info', titel: consent.methode === 'geen_cmp' ? 'Geen cookiebanner aangetroffen' : 'CMP aanwezig, maar geen banner getoond', tekst: `${consent.reden} Er is daarom één meting: alles hieronder gebeurt zonder dat een bezoeker iets kiest.` });
  for (const w of rapport.waarschuwingen || []) meldingen.push({ soort: 'waarschuwing', titel: 'Let op', tekst: w });

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8" />
<title>Consent-check ${esc(host)}</title>
<style>
  /* De klantkleur komt hier binnen als variabele; de rest van de opmaak is vast. */
  :root {
    --accent: ${palet.accent};
    --accent-tekst: ${palet.tekst_op_accent};
    --vlak: ${palet.vlak};
    --vlak-sterk: ${palet.vlak_sterk};
    --inkt: ${palet.inkt};
    --grijs: ${palet.grijs};
    --lijn: #e1e7ec;
    --goed: #00704f;
    --midden: #8f5600;
    --slecht: #9e1744;
  }

  /* A4 met ruimte voor de vaste voettekst van Chromium. */
  @page {
    size: A4;
    margin: 16mm 14mm 18mm 14mm;
  }
  @page :first { margin: 0; }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Open Sans", -apple-system, "Segoe UI", Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.55;
    color: var(--inkt);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3 { margin: 0; line-height: 1.25; break-after: avoid; }
  p { orphans: 3; widows: 3; }

  /* --- Omslag: de enige pagina met de klantkleur als vlak --- */
  .omslag {
    height: 297mm;
    padding: 24mm 20mm 20mm;
    background: linear-gradient(160deg, var(--accent) 0%, var(--accent) 38%, #ffffff 38%, #ffffff 100%);
    display: flex;
    flex-direction: column;
    break-after: page;
  }
  .omslag-kop { display: flex; align-items: flex-start; justify-content: space-between; gap: 12mm; }
  .omslag-kop .label {
    color: var(--accent-tekst);
    font-size: 8.5pt; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
  }
  /* De ondergrond van het klantlogo wordt gekozen op de gemeten helderheid:
     een wit logo op wit is onzichtbaar, een donker logo op donker ook. */
  .klantlogo {
    max-width: 52mm; max-height: 22mm; object-fit: contain;
    padding: 3mm 4mm; border-radius: 2mm;
  }
  .klantlogo.op-licht { background: #fff; }
  .klantlogo.op-donker { background: rgba(0, 0, 0, .28); }
  .omslag h1 { margin-top: 10mm; color: var(--accent-tekst); font-size: 30pt; letter-spacing: -.02em; }
  .omslag .domein { margin-top: 3mm; color: var(--accent-tekst); font-size: 13pt; opacity: .92; word-break: break-all; }
  .omslag-kaart {
    margin-top: 18mm; background: #fff; border: 1px solid var(--lijn);
    border-top: 3px solid var(--accent); padding: 8mm;
  }
  .omslag-kaart h2 { font-size: 13pt; margin-bottom: 3mm; }
  .omslag-meta { margin-top: 6mm; display: grid; grid-template-columns: 34mm 1fr; gap: 1.5mm 6mm; font-size: 9pt; }
  .omslag-meta dt { color: var(--grijs); text-transform: uppercase; font-size: 7.5pt; letter-spacing: .08em; padding-top: .6mm; }
  .omslag-meta dd { margin: 0; word-break: break-word; }
  .omslag-voet { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 8mm; font-size: 8pt; color: var(--grijs); }
  .omslag-voet img { height: 11mm; }

  /* --- Kerncijfers --- */
  .cijfers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; margin: 0 0 6mm; }
  .cijfer { border: 1px solid var(--lijn); border-left: 3px solid var(--accent); padding: 3.5mm 4mm; }
  .cijfer.bad { border-left-color: var(--slecht); }
  .cijfer.good { border-left-color: var(--goed); }
  .cijfer .label { font-size: 7pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--grijs); min-height: 6mm; }
  .cijfer .waarde { font-size: 20pt; font-weight: 700; line-height: 1.1; letter-spacing: -.02em; }
  .cijfer .onder { font-size: 8pt; color: var(--grijs); }

  /* --- Meldingen --- */
  .melding { border-left: 3px solid var(--accent); background: var(--vlak); padding: 3mm 4mm; margin-bottom: 3mm; break-inside: avoid; }
  .melding.fout { border-left-color: var(--slecht); background: #fbe8ee; }
  .melding.waarschuwing { border-left-color: var(--midden); background: #fdf2de; }
  .melding strong { display: block; }

  /* --- Bevindingen --- */
  h2.sectie {
    font-size: 12pt; margin: 8mm 0 4mm; padding-bottom: 2mm;
    border-bottom: 2px solid var(--accent);
  }
  /* Een bevinding mag over een paginagrens lopen: anders schuift een lange
     tabel in zijn geheel door en blijft de halve pagina ervoor leeg. De kop
     blijft wél bij zijn eerste regels, zodat je nooit een losse tabelkop ziet. */
  .bevinding { border: 1px solid var(--lijn); margin-bottom: 4mm; break-inside: auto; }
  .bevinding-kop { display: flex; gap: 4mm; padding: 3.5mm 4mm; background: var(--vlak); break-inside: avoid; break-after: avoid; }
  .bevinding-kop h3 { font-size: 10pt; }
  .samenvatting { margin: 1mm 0 0; font-size: 9pt; color: #3d4852; }
  .nummer {
    flex: none; width: 7mm; height: 8mm; display: grid; place-items: center;
    font-size: 9pt; font-weight: 800; color: #fff; background: var(--grijs);
    clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  }
  .toon-bad .nummer { background: var(--slecht); }
  .toon-mid .nummer { background: var(--midden); }
  .toon-good .nummer { background: var(--goed); }
  .bevinding-inhoud { padding: 3.5mm 4mm; }
  .bevinding-inhoud:empty { display: none; }
  .uitleg { margin: 0 0 2.5mm; font-size: 8.5pt; color: var(--grijs); }
  .let-op { margin: 3mm 0 0; padding: 2.5mm 3mm; background: #fdf2de; border-left: 3px solid var(--midden); font-size: 8.5pt; }
  .meer { margin: 2mm 0 0; font-size: 8pt; color: var(--grijs); font-style: italic; }

  /* --- Tabellen --- */
  table.data { width: 100%; border-collapse: collapse; font-size: 8pt; break-inside: auto; }
  /* Loopt een tabel door naar de volgende pagina, dan herhaalt de kop zich.
     Zonder dit staat er op pagina 2 een kolom cijfers zonder kopjes. */
  table.data thead { display: table-header-group; }
  table.data tr { break-inside: avoid; }
  table.data th {
    text-align: left; padding: 2mm 2.5mm; background: var(--vlak-sterk);
    border-bottom: 1.5px solid var(--accent); font-weight: 700; vertical-align: bottom;
  }
  table.data td { padding: 1.8mm 2.5mm; border-bottom: .5px solid var(--lijn); vertical-align: top; word-break: break-word; }
  table.data td.naam { white-space: nowrap; }
  table.data tbody tr:nth-child(even) td { background: #f7fafc; }

  dl.kv { display: grid; grid-template-columns: 38mm 1fr; gap: 1mm 5mm; margin: 0; font-size: 8.5pt; }
  dl.kv dt { color: var(--grijs); font-weight: 600; }
  dl.kv dd { margin: 0; word-break: break-word; }

  .pillen { margin: 2mm 0 0; }
  .pil { display: inline-block; padding: .6mm 2mm; margin: 0 1mm 1mm 0; background: #eef2f5; font-size: 7.5pt; }

  .colofon { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid var(--lijn); font-size: 7.5pt; color: var(--grijs); }
</style>
</head>
<body>

<div class="omslag">
  <div class="omslag-kop">
    <div>
      <p class="label">Consent-check</p>
    </div>
    ${palet.logo?.data_url ? `<img class="klantlogo ${logoOndergrond(palet.logo)}" src="${palet.logo.data_url}" alt="" />` : ''}
  </div>

  <h1>Wat gebeurt er vóór<br />de cookiemelding?</h1>
  <p class="domein">${esc(host)}</p>

  <div class="omslag-kaart">
    <h2>Samengevat</h2>
    <p>${b
      ? `Op deze pagina ${b.cookies_voor_consent.gevonden ? `worden <strong>${getal(b.cookies_voor_consent.aantal)} cookie(s)</strong> gezet` : 'worden geen cookies gezet'}
         en ${b.externe_requests_voor_consent.aantal_tracking_hosts
           ? `wordt er contact gelegd met <strong>${getal(b.externe_requests_voor_consent.aantal_tracking_hosts)} bekende tracking-host(s)</strong>`
           : 'wordt er geen contact gelegd met bekende trackers'}
         vóórdat de bezoeker toestemming heeft gegeven.`
      : 'De scan heeft geen meting kunnen afronden.'}</p>
    <dl class="omslag-meta">
      <dt>Gescand op</dt><dd>${esc(datum(rapport.gescand_op))}</dd>
      <dt>URL</dt><dd>${esc(rapport.eind_url || rapport.url)}</dd>
      <dt>Cookiebanner</dt><dd>${esc(rapport.cmp_info?.detected?.length ? rapport.cmp_info.detected.join(', ') : 'geen aangetroffen')}</dd>
      <dt>Consent gegeven</dt><dd>${esc(methodeLabel(consent))}</dd>
      <dt>Duur van de scan</dt><dd>${(rapport.duur_ms / 1000).toFixed(1).replace('.', ',')} seconden</dd>
    </dl>
  </div>

  <div class="omslag-voet">
    <span>Rapport opgesteld door Pure Minds · consent-check ${esc(rapport.tool?.versie || '')}</span>
    ${pmLogo ? `<img src="${pmLogo}" alt="Pure Minds" />` : '<span>Pure Minds</span>'}
  </div>
</div>

${meldingen.length ? meldingen.map((m) => `<div class="melding ${m.soort}"><strong>${esc(m.titel)}</strong>${esc(m.tekst)}</div>`).join('') : ''}

${kerncijfers.length ? `<div class="cijfers">${kerncijfers.map((c) => `
  <div class="cijfer ${c.toon}">
    <div class="label">${esc(c.label)}</div>
    <div class="waarde">${esc(c.waarde)}</div>
    <div class="onder">${esc(c.onder)}</div>
  </div>`).join('')}</div>
<p class="uitleg">Alle drie gemeten vóórdat er toestemming is gegeven.</p>` : ''}

${b ? `<h2 class="sectie">Bevindingen</h2>${regels(rapport)}` : ''}

<div class="colofon">
  <p><strong>Hoe dit rapport tot stand komt.</strong> De tool bezoekt de pagina met een schone browser zonder eerdere cookies,
  meet tien seconden lang alles wat er gebeurt, accepteert daarna de cookiebanner via de officiële API van de
  cookiebanner en meet opnieuw. Er wordt niets weggefilterd: elk verzoek en elke cookie staat in de JSON-bijlage.
  De tool doet feitelijke metingen en geen juridische uitspraken.</p>
  ${palet.bron ? `<p>Accentkleur en logo in dit rapport zijn overgenomen van ${esc(host)} (${esc(palet.bron)}${palet.accent_aangepast ? `, bijgesteld van ${esc(palet.accent_origineel)} naar ${esc(palet.accent)} voor leesbaarheid` : ''}).</p>` : ''}
</div>

</body>
</html>`;
}

// --- Genereren --------------------------------------------------------------------------

/**
 * Bouwt de PDF en geeft de bytes terug. `rapport` is het JSON-rapport zoals
 * lib/report.js het oplevert.
 */
export async function maakPdf(rapport) {
  const palet = { ...standaardPalet(), ...(rapport.huisstijl || {}) };
  const pmLogo = await puremindsLogo();
  const html = documentHtml(rapport, palet, pmLogo);

  const browser = await geefBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Geen netwerk nodig: alles staat in het document, inclusief de logo's.
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.emulateMedia({ media: 'print' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width:100%;padding:0 14mm;font-family:Arial,sans-serif;font-size:7pt;color:#5c6670;display:flex;justify-content:space-between;">
          <span>Consent-check · ${esc(hostVan(rapport.eind_url || rapport.url))}</span>
          <span>Pure Minds · <span class="pageNumber"></span>/<span class="totalPages"></span></span>
        </div>`,
      margin: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' },
    });
  } finally {
    await context.close().catch(() => {});
  }
}

/** Bestandsnaam in dezelfde stijl als de JSON: host + tijdstempel. */
export function pdfBestandsnaam(rapport) {
  return `${slug(hostVan(rapport.eind_url || rapport.url) || rapport.url)}-${tijdstempel(new Date(rapport.gescand_op))}.pdf`;
}
