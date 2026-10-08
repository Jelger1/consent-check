/**
 * Het rapport als PDF, in de huisstijl van Pure Minds.
 *
 * WAAROM CHROMIUM EN GEEN PDF-BIBLIOTHEEK
 * Deze tool heeft al een Chromium aan boord voor de scan. Die kan `page.pdf()`,
 * en dat is verreweg de beste optie: we schrijven gewoon HTML en CSS (waarin we
 * al denken in dit project), krijgen echte paginering met herhalende
 * tabelkoppen en een vaste voettekst, vectortekst die doorzoekbaar blijft, en we
 * houden de regel "geen dependencies buiten Playwright". De Landingpage & Ads
 * Optimizer gebruikt pdfmake in de browser; die heeft geen Chromium.
 *
 * ZELFDE OPMAAK ALS DE ANDERE TOOLS
 * Open Sans, de cyaan-blauwe balk bovenaan elke pagina, het logo met daarnaast
 * het label en de datum, metakolommen en scoretegels op het voorblad, cyaan
 * tabelkoppen en "pure minds" in de voettekst: zo ziet een PDF uit de
 * Landingpage & Ads Optimizer eruit, en zo hoort deze er ook uit te zien.
 * Van de gescande site komt alleen het logo, klein op het voorblad, zodat de
 * ontvanger ziet over welke site het gaat. Hun kleur nemen we niet over.
 *
 * VOLLEDIG, NIET SAMENGEVAT
 * De PDF toont alles wat de interface toont, zonder afkappen: elke cookie, elke
 * host, elke identifier, elk CMP-signaal. Alleen URL's en waarden worden
 * ingekort, zoals in de JSON (zie AFKAP_URL).
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { hostVan } from './domain.js';
import { kort, slug, tijdstempel } from './util.js';

const PROJECTMAP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Kleuren van pureminds.nl; dezelfde waarden als in de Landingpage & Ads Optimizer. */
const MERK = {
  inkt: '#303030',
  grijs: '#5c6670',
  lijn: '#e1e7ec',
  zebra: '#f7fafc',
  spoor: '#eef2f5',
  cyaan: '#1ab9e2',
  cyaanTint: '#e8f7fc',
  cyaanZacht: '#f2fbfe',
  blauw: '#1b71a8',
  diep: '#005aaf',
};

/**
 * Leeswijzerkleuren, gelijk aan de interface: magenta = aangetroffen, oranje =
 * loop na, groen = niets gevonden, grijs = niets te melden. Geen oordeel.
 */
const TONEN = {
  bad: { vol: '#b61b50', vlak: '#fbe8ee', tekst: '#9e1744' },
  mid: { vol: '#e0951f', vlak: '#fdf2de', tekst: '#8f5600' },
  good: { vol: '#009670', vlak: '#e3f4ee', tekst: '#00704f' },
  none: { vol: '#9aa5ad', vlak: '#eef2f5', tekst: '#5c6670' },
};

/** Een volledige tracking-URL kan duizenden tekens zijn; 260 is genoeg om hem te herkennen. */
const AFKAP_URL = 260;

/** Marges van de pagina; de bovenmarge laat ruimte voor de balk, de ondermarge voor de voettekst. */
const MARGE = { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' };

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

// --- Logo en lettertype -------------------------------------------------------------
// Alles gaat als data-URL het document in: de PDF mag niets van buiten laden.

const LETTERTYPEN = [
  { bestand: 'OpenSans-Regular.ttf', gewicht: 400, stijl: 'normal' },
  { bestand: 'OpenSans-SemiBold.ttf', gewicht: 600, stijl: 'normal' },
  { bestand: 'OpenSans-Bold.ttf', gewicht: 700, stijl: 'normal' },
  { bestand: 'OpenSans-Italic.ttf', gewicht: 400, stijl: 'italic' },
];

let bronnenCache;

async function bronnen() {
  if (bronnenCache) return bronnenCache;
  const lees = (pad) => readFile(join(PROJECTMAP, 'assets', pad)).catch(() => null);

  const logo = await lees('pureminds-logo.png');
  const fonts = await Promise.all(LETTERTYPEN.map(async (f) => ({ ...f, bytes: await lees(join('fonts', f.bestand)) })));

  // Ontbreekt een lettertype, dan valt de browser terug op een systeemletter.
  // Lelijker, maar de PDF komt er wel.
  const fontFaces = fonts
    .filter((f) => f.bytes)
    .map((f) => `@font-face { font-family: "Open Sans"; font-weight: ${f.gewicht}; font-style: ${f.stijl};
      src: url(data:font/ttf;base64,${f.bytes.toString('base64')}) format("truetype"); }`)
    .join('\n');

  bronnenCache = {
    logo: logo ? `data:image/png;base64,${logo.toString('base64')}` : null,
    fontFaces,
  };
  return bronnenCache;
}

// --- Tekst voorbereiden ----------------------------------------------------------

/** Alles uit een rapport komt van een vreemde website: altijd escapen. */
function esc(waarde) {
  return String(waarde ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const getal = (waarde) => Number(waarde || 0).toLocaleString('nl-NL');
const leesbaar = (waarde) => String(waarde || '').replace(/_/g, ' ');
const seconden = (ms) => `${(Number(ms || 0) / 1000).toFixed(1).replace('.', ',')} s`;
const jaNee = (waarde) => (waarde === null || waarde === undefined ? 'onbekend' : waarde ? 'ja' : 'nee');

function datum(iso, metTijd = true) {
  try {
    return new Date(iso).toLocaleString('nl-NL', metTijd ? { dateStyle: 'long', timeStyle: 'short' } : { dateStyle: 'long' });
  } catch {
    return String(iso);
  }
}

/** "Cookiebot-API" of de tekst van de knop; zelfde logica als in de interface. */
function methodeLabel(consent) {
  if (!consent) return 'geen consent-stap (scan gestopt)';
  if (!consent.gegeven) {
    return consent.methode === 'geen_cmp' ? 'geen cookiebanner aangetroffen' : 'CMP aanwezig, maar geen banner getoond';
  }
  const gelukt = (consent.geprobeerd || []).filter((p) => p.gelukt);
  if (!gelukt.length) return consent.methode || 'onbekend';
  return gelukt
    .map((p) => (p.methode === 'knop_tekstherkenning' ? `knop "${p.knop_tekst}"` : p.methode.endsWith('_api') ? `${p.cmp}-API` : `${p.cmp}-knop`))
    .join(' + ');
}

// --- Bouwstenen -------------------------------------------------------------------

/** Een cel is tekst (wordt geëscapet) of `{ html }` (al veilig opgebouwd). */
const html = (inhoud) => ({ html: inhoud });
const cel = (waarde) => (waarde && typeof waarde === 'object' && 'html' in waarde ? waarde.html : esc(waarde));

/** Gekleurd label, zoals de impact-labels in de Landingpage-PDF. */
function label(tekst, toon = 'none') {
  return `<span class="label toon-${toon}">${esc(tekst)}</span>`;
}

/** Hoofdwaarde met een toelichting eronder, zodat een tabel een kolom minder nodig heeft. */
function stapel(hoofd, onder) {
  return html(`${esc(hoofd)}${onder ? `<span class="onder">${esc(onder)}</span>` : ''}`);
}

/**
 * Tabel in de huisstijl. `breedtes` zet kolombreedtes; `strak` zijn kolommen
 * met één ondeelbaar woord (hostnaam, cookienaam) die liever niet afbreken.
 */
function tabel(koppen, rijen, { breedtes = [], strak = [] } = {}) {
  if (!rijen.length) return '';
  return `
    <table class="data">
      ${breedtes.length ? `<colgroup>${koppen.map((_, i) => `<col${breedtes[i] ? ` style="width:${breedtes[i]}"` : ''} />`).join('')}</colgroup>` : ''}
      <thead><tr>${koppen.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rijen.map((rij) => `<tr>${rij.map((waarde, i) => `<td${strak.includes(i) ? ' class="strak"' : ''}>${cel(waarde)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>`;
}

function kv(paren) {
  const rijen = paren.filter(([, waarde]) => waarde !== null && waarde !== undefined && waarde !== '');
  return `<dl class="kv">${rijen.map(([sleutel, waarde]) => `<dt>${esc(sleutel)}</dt><dd>${cel(waarde)}</dd>`).join('')}</dl>`;
}

function kader(soort, titel, inhoud) {
  return `<div class="kader ${soort}">${titel ? `<p class="kader-titel">${esc(titel)}</p>` : ''}${inhoud}</div>`;
}

function tussenkop(tekst) {
  return `<p class="tussenkop">${esc(tekst)}</p>`;
}

/** Sectiekop met het kleurverloop eronder, zoals de h2 in de Landingpage-PDF. */
function sectie(titel) {
  return `<h2>${esc(titel)}</h2><div class="verloop"></div>`;
}

/** Het zeshoekige nummer in de leeswijzerkleur; hetzelfde teken als in de interface. */
function nummer(waarde, toon) {
  return `<span class="hex toon-${toon}">${esc(waarde)}</span>`;
}

/**
 * Eén regel: nummer, titel, samenvatting en de details. Kop en eerste regels
 * blijven bij elkaar; de details mogen over een paginagrens lopen, anders
 * schuift een lange tabel in zijn geheel door en blijft er een halve pagina leeg.
 */
function regelBlok(r) {
  return `
    <section class="regel">
      <div class="regel-kop">
        ${nummer(r.nummer, r.toon)}
        <div>
          <h3>${esc(r.titel)}</h3>
          <p class="samenvatting">${esc(r.samenvatting)}</p>
        </div>
      </div>
      ${r.inhoud ? `<div class="regel-inhoud">${r.inhoud}</div>` : ''}
    </section>`;
}

// --- De detectieregels ----------------------------------------------------------------
// Teksten en tonen zijn gelijk aan die in app.js: scherm en PDF vertellen hetzelfde.

function regels(rapport) {
  const b = rapport.bevindingen;
  const cmp = rapport.cmp_info;
  const consent = rapport.raw_data?.consent;
  const zonderBanner = !!consent && !consent.gegeven;
  const lijst = [];

  // 1
  const r1 = b.cookies_voor_consent;
  // Rapporten van vóór versie 1.4 kennen de uitsplitsing tracking/onbekend nog niet.
  const uitgesplitst = r1.aantal_tracking !== undefined;
  lijst.push({
    nummer: 1,
    titel: 'Cookies vóór consent',
    samenvatting: !r1.gevonden
      ? 'Geen cookies vóór consent, afgezien van de cookie van de CMP zelf en functionele cookies op het eigen domein.'
      : uitgesplitst
        ? `${getal(r1.aantal)} cookie(s) gezet vóór consent: ${getal(r1.aantal_tracking)} van een bekende tracker, ${getal(r1.aantal_onbekend)} onbekend${r1.aantal_functioneel_extern ? `, ${getal(r1.aantal_functioneel_extern)} functioneel bij een andere partij` : ''}. ${getal(r1.aantal_third_party)} daarvan third-party.`
        : `${getal(r1.aantal)} cookie(s) gezet vóór consent, waarvan ${getal(r1.aantal_third_party)} third-party. Niet meegeteld: de cookie van de CMP zelf en functionele cookies op het eigen domein.`,
    toon: uitgesplitst ? (r1.aantal_tracking ? 'bad' : r1.gevonden ? 'mid' : 'good') : r1.gevonden ? 'bad' : 'good',
    inhoud: [
      uitgesplitst && r1.aantal_onbekend
        ? '<p>Onbekend betekent: niet aan een tracker toe te wijzen en ook geen bekende functionele cookie. Dat is geen oordeel; controleer waarvoor de site hem gebruikt.</p>'
        : '',
      tabel(['Cookie', 'Domein', 'Partij', 'Duur', 'Soort'],
        r1.details.map((c) => [
          c.naam,
          c.domein,
          c.is_third_party ? html(label('third-party', 'bad')) : 'eigen domein',
          c.is_sessie ? 'sessie' : c.verloopt ? stapel('persistent', `tot ${datum(c.verloopt, false)}`) : 'persistent',
          c.classificatie === 'tracking'
            ? html(`${label(c.tag_naam || leesbaar(c.tag), 'bad')}<span class="onder">tracking</span>`)
            : c.classificatie === 'functioneel' ? stapel('functioneel', c.functie) : leesbaar(c.tag || c.classificatie),
        ]),
        { breedtes: ['22%', '24%', '14%', '16%', '24%'], strak: [0] }),
      r1.uitgesloten?.length
        ? `${tussenkop(`${r1.uitgesloten.length} cookie(s) niet meegeteld`)}
           ${tabel(['Cookie', 'Domein', 'Reden'], r1.uitgesloten.map((c) => [c.naam, c.domein, c.reden]), { breedtes: ['26%', '28%', '46%'], strak: [0] })}`
        : '',
    ].join(''),
  });

  // 2
  const r2 = b.externe_requests_voor_consent;
  const alleenGeweigerd = r2.aantal_tracking_hosts_alleen_geweigerd || 0;
  lijst.push({
    nummer: 2,
    titel: 'Externe requests vóór consent',
    samenvatting: r2.gevonden
      ? `${getal(r2.aantal_requests)} requests naar ${getal(r2.aantal_hosts)} externe hosts, waarvan ${getal(r2.aantal_tracking_hosts)} bekende trackers en ${getal(r2.aantal_onbekende_hosts)} onbekend.${alleenGeweigerd ? ` ${getal(alleenGeweigerd)} tracking-host(s) kregen alleen cookieloze Consent Mode-pings (status geweigerd).` : ''}`
      : 'Geen requests naar hosts buiten het eigen domein.',
    toon: hostToon(r2),
    inhoud: [
      r2.consent_mode_hits?.aantal
        ? '<p>Google- en Microsoft-hits vertellen zelf hoe Consent Mode stond (gcs bij Google, asc bij Microsoft UET). G100 of asc=D betekent: opslag geweigerd, de hit gaat zonder cookies. Contact met het platform is er dan wél.</p>'
        : '',
      tabel(['Host', 'Requests', 'Herkend als', 'Eerste request'],
        r2.hosts.map((h) => {
          const onder = [leesbaar(h.categorie), ...(h.consent_mode || []).map((c) => `Consent Mode ${c.code} ×${c.aantal}: ${c.betekenis}`)];
          return [
            h.host,
            getal(h.aantal),
            h.tracking_bekend
              ? html(`${label(h.tag_naam || 'tracker', h.alleen_geweigerde_pings ? 'mid' : 'bad')}${onder.map((o) => `<span class="onder">${esc(o)}</span>`).join('')}`)
              : html(`${esc(h.tag_naam || 'onbekend')}${onder.map((o) => `<span class="onder">${esc(o)}</span>`).join('')}`),
            h.eerste_tijd_ms === undefined || h.eerste_tijd_ms === null ? '' : `na ${seconden(h.eerste_tijd_ms)}`,
          ];
        }),
        { breedtes: ['34%', '11%', '39%', '16%'], strak: [0] }),
    ].join(''),
  });

  // 3
  const r3 = b.identifiers_in_payload_voor_consent;
  lijst.push({
    nummer: 3,
    titel: 'Identifiers in de payload vóór consent',
    samenvatting: r3.gevonden
      ? `${getal(r3.aantal_requests)} request(s) sturen een identifier mee in de URL of de POST-body.`
      : 'Geen bekende identifiers in de payload vóór consent.',
    toon: r3.gevonden ? 'bad' : 'good',
    inhoud: [
      r3.details.map(identifierBlok).join(''),
      r3.niet_meegeteld?.length
        ? `${tussenkop(`${r3.niet_meegeteld.length} request(s) met een identifier niet meegeteld`)}
           ${tabel(['Host', 'Parameters', 'Reden'],
            r3.niet_meegeteld.map((n) => [n.host, n.identifiers.map((i) => i.parameter).join(', '), n.reden]),
            { breedtes: ['30%', '22%', '48%'], strak: [0] })}`
        : '',
    ].join(''),
  });

  // 4
  const ontbrekend = b.ontbrekende_tags_na_consent;
  const tagTabel = b.tag_status?.length
    ? `${tussenkop('Alle herkende tags, vóór en ná consent')}
       ${tabel(['Tag', 'In HTML', 'In DOM', 'Requests vóór', 'Requests ná'],
        b.tag_status.map((t) => [
          t.naam,
          t.in_html === null ? '?' : t.in_html ? 'ja' : 'nee',
          t.in_dom_voor_consent ? 'ja' : 'nee',
          getal(t.requests_voor_consent),
          t.requests_na_consent === null ? 'n.v.t.' : getal(t.requests_na_consent),
        ]),
        { breedtes: ['40%', '12%', '12%', '18%', '18%'] })}`
    : '';
  if (!ontbrekend) {
    lijst.push({
      nummer: 4,
      titel: 'Tags ná consent',
      samenvatting: zonderBanner ? 'Niet van toepassing: er is geen cookiebanner, dus ook geen consent-stap.' : 'Niet gemeten: de scan is gestopt vóór meting 2.',
      toon: 'none',
      inhoud: `<p>${esc(zonderBanner
        ? 'Zonder banner kan een bezoeker niets accepteren of weigeren; wat hier vuurt, vuurt altijd. Zie regel 2, 3 en 7.'
        : 'Zonder consent is er geen tweede meting, dus valt niet te zeggen welke tags ná consent vuren.')}</p>${tagTabel}`,
    });
  } else {
    lijst.push({
      nummer: 4,
      titel: 'Tags ná consent',
      samenvatting: ontbrekend.length
        ? `${ontbrekend.length} tag(s) doen ná consent geen enkel request: ${ontbrekend.map((t) => t.naam).join(', ')}.`
        : 'Alle aangetroffen tags doen ook ná consent requests.',
      toon: ontbrekend.length ? 'mid' : 'good',
      inhoud: [
        ontbrekend.length
          ? `<p>Ná consent geen nieuw request binnen de meettijd. Dat kan betekenen dat de tag wordt tegengehouden, maar ook dat hij vóór consent al alles verstuurde of pas bij een volgende paginaweergave weer vuurt. Controleer deze handmatig.</p>
             ${tabel(['Tag', 'Reden'], ontbrekend.map((t) => [t.naam, leesbaar(t.reden)]), { breedtes: ['40%', '60%'] })}`
          : '',
        tagTabel,
      ].join(''),
    });
  }

  // 5
  const lp = cmp.laadpositie;
  if (!lp?.detected) {
    lijst.push({
      nummer: 5,
      titel: 'Laadpositie van de CMP',
      samenvatting: cmp.detected.length ? `Het laadscript van ${cmp.detected.join(', ')} is niet in de HTML of de DOM teruggevonden.` : 'Geen CMP op deze pagina aangetroffen.',
      toon: 'none',
      inhoud: `<p>${esc(cmp.detected.length
        ? 'De CMP is herkend aan zijn requests of globals, maar het script zelf niet; de laadpositie is daarom niet te bepalen.'
        : 'Zonder CMP is er geen laadpositie te meten.')}</p>`,
    });
  } else {
    const via = { gtm: 'via Google Tag Manager geïnjecteerd', html: 'rechtstreeks in de HTML', niet_geladen: 'niet geladen' }[lp.geladen_via] || lp.geladen_via;
    const voor = lp.tracking_requests_tot_cmp_aangevraagd;
    lijst.push({
      nummer: 5,
      titel: 'Laadpositie van de CMP',
      samenvatting: `${lp.naam}: in de ${lp.load_position || 'onbekende positie'}, ${lp.synchroon ? 'synchroon' : lp.attributes.join(' ') || 'zonder attributen'}, ${via}.`,
      toon: lp.loaded_via_gtm || voor?.aantal ? 'mid' : 'none',
      inhoud: [
        kv([
          ['CMP', lp.naam],
          ['Script', lp.script_src ? kort(lp.script_src, AFKAP_URL) : null],
          ['Positie', lp.load_position || 'onbekend'],
          ['Attributen', lp.attributes.join(', ') || 'geen'],
          ['Synchroon', lp.synchroon ? 'ja' : 'nee'],
          ['Via GTM geladen', jaNee(lp.loaded_via_gtm)],
          ['Gestart door', lp.initiator ? `${lp.initiator.type}${lp.initiator.url ? ` · ${kort(lp.initiator.url, AFKAP_URL)}` : ''}` : null],
          ['Script geladen na', lp.request ? seconden(lp.request.tijd_ms) : null],
          ['CMP klaar na', lp.geladen_event_na_ms !== null && lp.geladen_event_na_ms !== undefined ? seconden(lp.geladen_event_na_ms) : null],
          ['Banner zichtbaar', lp.banner_zichtbaar !== null && lp.banner_zichtbaar !== undefined ? jaNee(lp.banner_zichtbaar) : null],
          ['Versie', lp.versie || null],
          ['Consent Mode', lp.consent_mode_instelling ? (lp.consent_mode_instelling.enabledConsentMode ? 'aan' : 'uit') : null],
        ]),
        voor?.aantal
          ? kader('waarschuwing', `${voor.aantal} tracking-request(s) waren al onderweg toen het CMP-script werd opgevraagd`,
            `<p>Hosts: ${esc(voor.hosts.join(', '))}.</p>`)
          : '',
      ].join(''),
    });
  }

  // 6
  const r6 = b.meerdere_cmps_actief;
  lijst.push({
    nummer: 6,
    titel: "Meerdere CMP's actief",
    samenvatting: r6.gevonden
      ? `${r6.aantal_actief} CMP's draaien tegelijk op deze pagina.`
      : r6.aantal_actief === 1 ? 'Eén actieve CMP gevonden.' : 'Geen actieve CMP gevonden.',
    toon: r6.gevonden ? 'bad' : 'good',
    inhoud: r6.cmps.map((c) => `
      <div class="blok">
        <p class="blok-kop"><strong>${esc(c.naam)}</strong> ${label(c.actief ? 'actief' : 'alleen in de HTML', c.actief ? 'bad' : 'none')}</p>
        ${c.signalen.length
          ? `<ul class="signalen">${c.signalen.map((s) => `<li><span class="bron">${esc(leesbaar(s.bron))}</span> ${esc(kort(String(s.detail ?? ''), AFKAP_URL))}${s.positie ? ` <span class="grijs">(${esc(s.positie)})</span>` : ''}</li>`).join('')}</ul>`
          : ''}
      </div>`).join(''),
  });

  // 7
  const r7 = b.niet_google_tags_gevonden;
  const vuurtVoor = r7.filter((t) => t.vuurt_voor_consent);
  lijst.push({
    nummer: 7,
    titel: 'Niet-Google tags',
    samenvatting: r7.length
      ? `${r7.length} niet-Google tag(s) gevonden${vuurtVoor.length ? `, waarvan er ${vuurtVoor.length} al vóór consent ${vuurtVoor.length === 1 ? 'vuurt' : 'vuren'}` : ''}.`
      : 'Geen niet-Google tags aangetroffen.',
    toon: vuurtVoor.length ? 'bad' : r7.length ? 'mid' : 'good',
    inhoud: r7.length
      ? `<p>Deze tags vallen buiten Google Consent Mode. Heeft een tag geen eigen consent-API, of gebruikt de site die niet, dan moet de CMP hem tegenhouden of moet hij handmatig worden gegate.</p>
         ${tabel(['Tag', 'Vóór consent', 'Ná consent', 'Gegate door CMP', 'Eigen consent-API'],
          r7.map((t) => [
            stapel(t.naam, leesbaar(t.leverancier)),
            html(t.vuurt_voor_consent ? label('vuurt', 'bad') : label('stil', 'good')),
            t.vuurt_na_consent === null ? 'niet gemeten' : t.vuurt_na_consent ? 'vuurt' : 'stil',
            t.gated_via_cmp_attribuut ? 'ja' : 'nee',
            t.consent_api || 'geen bekend',
          ]),
          { breedtes: ['28%', '13%', '13%', '14%', '32%'] })}`
      : '',
  });

  // 8
  const r8 = b.js_gegenereerde_iframes;
  if (!r8.bepaald) {
    lijst.push({ nummer: 8, titel: 'JS-gegenereerde iframes', samenvatting: `Niet bepaald: ${r8.reden}.`, toon: 'none', inhoud: '' });
  } else {
    lijst.push({
      nummer: 8,
      titel: 'JS-gegenereerde iframes',
      samenvatting: r8.gevonden
        ? `${getal(r8.aantal)} iframe(s) staan wel in de DOM maar niet in de ruwe HTML (${getal(r8.aantal_iframes_dom)} in de DOM, ${getal(r8.aantal_iframes_html)} in de HTML).`
        : `Alle ${getal(r8.aantal_iframes_dom)} iframes in de DOM staan ook in de ruwe HTML.`,
      toon: r8.gevonden ? 'mid' : 'good',
      inhoud: r8.gevonden
        ? `<p>Iframes die pas door JavaScript ontstaan, ontwijken vaak de autoblocking van een CMP.</p>
           ${tabel(['Bron', 'Herkend als', 'Zichtbaar', 'Reden'],
            r8.iframes.map((f) => [
              html(`<span class="url">${esc(f.src ? kort(f.src, AFKAP_URL) : '(geen src)')}</span>`),
              f.tag_naam || 'onbekend',
              f.zichtbaar === null || f.zichtbaar === undefined ? '?' : f.zichtbaar ? `ja, ${f.breedte}×${f.hoogte}` : 'nee',
              f.reden,
            ]),
            { breedtes: ['34%', '18%', '14%', '34%'] })}`
        : '',
    });
  }

  // 9 tot en met 12 (sinds versie 1.4; oudere rapporten hebben ze niet)
  if ('tracking_na_weigeren' in b) {
    const r9 = b.tracking_na_weigeren;
    if (!r9) {
      lijst.push({ nummer: 9, titel: 'Na weigeren', samenvatting: 'Niet gemeten: er was geen banner om te weigeren, of het weigeren-scenario stond uit.', toon: 'none', inhoud: '' });
    } else if (!r9.bepaald) {
      lijst.push({ nummer: 9, titel: 'Na weigeren', samenvatting: `Weigeren lukte niet automatisch: ${r9.reden}`, toon: 'mid', inhoud: '<p>Controleer handmatig of weigeren kan, en wat er daarna nog vuurt.</p>' });
    } else {
      const actief = r9.tags.filter((t) => t.actief);
      lijst.push({
        nummer: 9,
        titel: 'Na weigeren',
        samenvatting: actief.length
          ? `${actief.length} tracker(s) blijven actief nadat in een aparte browser alles is geweigerd (ook na herladen): ${actief.map((t) => t.naam).join(', ')}.`
          : 'Na "alles weigeren" (ook na herladen) is geen enkele bekende tracker meer actief.',
        toon: actief.length ? 'bad' : 'good',
        inhoud: `<p>Geweigerd via ${esc(r9.methode)}. Pings met de status "geweigerd" en scriptdownloads staan erbij, maar tellen niet als actief.</p>
          ${tabel(['Tag', 'Hits', 'Consentstatus', 'Nieuw opgeslagen', 'Actief'],
            r9.tags.map((t) => [
              t.naam,
              `${getal(t.hits)}${t.identifiers ? ` (${t.identifiers} met id)` : ''}`,
              Object.entries(t.consent_mode).map(([code, aantal]) => `${code} ×${aantal}`).join(', ') || 'geen',
              [...t.nieuwe_cookies, ...t.nieuwe_opslag].join(', ') || '—',
              html(t.actief ? label('ja', 'bad') : label('nee', 'good')),
            ]),
            { breedtes: ['30%', '14%', '20%', '24%', '12%'] })}`,
      });
    }

    const r10 = b.cookiebanner;
    if (!r10 || !r10.gevonden) {
      lijst.push({ nummer: 10, titel: 'De cookiebanner zelf', samenvatting: r10?.fout ? `Niet bekeken: ${r10.fout}` : 'Geen cookiebanner gezien om te bekijken.', toon: 'none', inhoud: '' });
    } else {
      const delen = [
        r10.accepteerknop ? `accepteren: "${r10.accepteerknop.tekst}"` : 'geen accepteerknop herkend',
        r10.weigerknop_eerste_laag ? `weigeren: "${r10.weigerknop.tekst}"` : 'geen weigerknop in de eerste laag',
      ];
      if (r10.vooraf_aangevinkt?.length) delen.push(`${r10.vooraf_aangevinkt.length} vakje(s) vooraf aangevinkt`);
      if (r10.intrekken) delen.push(r10.intrekken.gevonden ? `later te wijzigen via ${r10.intrekken.hoe}` : 'geen manier gevonden om de keuze later te wijzigen');
      const misleidend = r10.accepteerknop?.officieel && r10.accepteerknop_tekst_duidelijk === false;
      lijst.push({
        nummer: 10,
        titel: 'De cookiebanner zelf',
        samenvatting: `${delen.join('; ')}.`,
        toon: misleidend || (!r10.weigerknop_eerste_laag && !r10.instellingenknop) ? 'bad'
          : (!r10.weigerknop_eerste_laag || r10.vooraf_aangevinkt?.some((v) => v.zichtbaar) || (r10.weiger_t_o_v_accepteer ?? 1) < 0.5 || r10.intrekken?.gevonden === false) ? 'mid' : 'good',
        inhoud: [
          kv([
            ['CMP', r10.cmp],
            ['Accepteerknop', r10.accepteerknop ? `"${r10.accepteerknop.tekst}"${r10.accepteerknop.officieel ? ' (officiële knop van de CMP)' : ''}` : 'niet herkend'],
            ['Zegt dat hij accepteert', r10.accepteerknop ? (r10.accepteerknop_tekst_duidelijk ? 'ja' : 'nee') : null],
            ['Weigerknop in eerste laag', r10.weigerknop_eerste_laag ? `ja, "${r10.weigerknop.tekst}"` : 'nee'],
            ['Grootte weigeren t.o.v. accepteren', r10.weiger_t_o_v_accepteer !== null ? `${Math.round(r10.weiger_t_o_v_accepteer * 100)}%` : null],
            ['Knop naar instellingen', r10.instellingenknop ? 'ja' : 'nee'],
            ['Vooraf aangevinkt', r10.vooraf_aangevinkt?.length ? r10.vooraf_aangevinkt.map((v) => `${v.label || '(zonder label)'}${v.zichtbaar ? '' : ' (in instellingen)'}`).join(', ') : 'niets'],
            ['Bedekt van het scherm', `${r10.bedekking_procent}%${r10.scroll_geblokkeerd ? ', scrollen geblokkeerd' : ''}`],
            ['Keuze later wijzigen', r10.intrekken ? (r10.intrekken.gevonden ? r10.intrekken.hoe : 'niet gevonden') : null],
          ]),
          (r10.knoppen || []).some((k) => k.zichtbaar)
            ? `${tussenkop('Zichtbare knoppen')}<p>${(r10.knoppen || []).filter((k) => k.zichtbaar).map((k) => label(`${k.tekst} · ${k.soort}`, k.soort === 'weiger' ? 'good' : k.soort === 'accepteer' ? 'mid' : 'none')).join(' ')}</p>`
            : '',
        ].join(''),
      });
    }

    const r11 = b.opslag_voor_consent;
    if (r11) {
      lijst.push({
        nummer: 11,
        titel: 'Opslag buiten cookies',
        samenvatting: r11.aantal
          ? `${getal(r11.aantal)} sleutel(s) in localStorage of sessionStorage vóór consent, waarvan ${getal(r11.aantal_tracking)} van een bekende tracker${r11.indexeddb?.length ? `; ${r11.indexeddb.length} IndexedDB-database(s)` : ''}.`
          : 'Geen localStorage of sessionStorage gebruikt vóór consent.',
        toon: r11.aantal_tracking ? 'bad' : 'good',
        inhoud: r11.items.length
          ? `<p>De toestemmingsplicht geldt voor alle opslag op het apparaat, niet alleen voor cookies. Alleen sleutels, geen waarden.</p>
             ${tabel(['Sleutel', 'Soort', 'Herkend als', 'Geschreven door'],
              r11.items.map((item) => [item.sleutel, item.soort, item.tag_naam || leesbaar(item.classificatie), item.script ? (hostVan(item.script) || item.script) : '—']),
              { breedtes: ['32%', '18%', '25%', '25%'], strak: [0] })}`
          : '',
      });
    }

    const r12 = b.eigen_subdomeinen;
    if (r12) {
      const herkend = r12.items.filter((item) => item.herkend_als);
      lijst.push({
        nummer: 12,
        titel: 'Eigen subdomeinen (CNAME)',
        samenvatting: !r12.items.length
          ? 'Geen eigen subdomeinen (naast de pagina zelf) die requests kregen.'
          : herkend.length
            ? `${herkend.length} eigen subdomein(en) leiden naar een trackingdienst of server-side tagging: ${herkend.map((item) => item.host).join(', ')}.`
            : `${r12.items.length} eigen subdomein(en) gecontroleerd; geen wijst naar een bekende trackingdienst.`,
        toon: herkend.length ? 'mid' : 'good',
        inhoud: r12.items.length
          ? tabel(['Host', 'CNAME', 'Herkend als', 'Requests vóór consent'],
            r12.items.map((item) => [item.host, item.cname.join(' → ') || '—', item.herkend_als || 'niets bijzonders', getal(item.requests_voor_consent)]),
            { breedtes: ['28%', '28%', '28%', '16%'], strak: [0] })
          : '',
      });
    }
  }

  return lijst;
}

/** Oranje in plaats van magenta als élke tracking-host alleen cookieloze Consent Mode-pings (G100, asc=D) kreeg; zelfde als app.js. */
function hostToon(r) {
  if (!r.aantal_tracking_hosts) return r.gevonden ? 'mid' : 'good';
  return r.aantal_tracking_hosts === r.aantal_tracking_hosts_alleen_geweigerd ? 'mid' : 'bad';
}

/** Wat de cookietegel toont; zelfde als cookieTelling in app.js. */
function cookieTegel(r) {
  if (r.aantal_tracking === undefined) {
    return { label: 'Cookies vóór consent', waarde: r.aantal, onder: `van ${getal(r.aantal_totaal)}`, toon: r.aantal ? 'bad' : 'good' };
  }
  return {
    label: 'Tracking-cookies',
    waarde: r.aantal_tracking,
    onder: r.aantal_overig ? `+ ${getal(r.aantal_overig)} overig` : `van ${getal(r.aantal_totaal)}`,
    toon: r.aantal_tracking ? 'bad' : r.aantal_overig ? 'mid' : 'good',
  };
}

/** Eén request met identifiers: wie, wanneer, welke parameters, en de URL zelf. */
function identifierBlok(d) {
  return `
    <div class="blok">
      <p class="blok-kop">
        ${label(d.bekende_tag || 'onbekende host', d.bekende_tag ? 'bad' : 'none')}
        <strong>${esc(d.host)}</strong>
        <span class="grijs">${esc(d.method)} · na ${esc(seconden(d.tijd_ms))}${d.consent_mode ? ` · Consent Mode ${esc(d.consent_mode)}` : ''}</span>
      </p>
      ${tabel(['Parameter', 'Waarde', 'Betekenis', 'Bron'],
        d.identifiers.map((i) => [i.parameter, html(`<span class="url">${esc(i.waarde)}</span>`), i.betekenis, leesbaar(i.bron)]),
        { breedtes: ['19%', '31%', '36%', '14%'], strak: [0] })}
      <p class="url grijs">${esc(kort(d.url, AFKAP_URL))}</p>
    </div>`;
}

/** Geen detectieregel, maar wel het antwoord op "wat deed consent nu eigenlijk?". */
function naConsent(b) {
  const cookies = b.nieuwe_cookies_na_consent;
  const hosts = b.nieuwe_hosts_na_consent || [];
  const ids = b.identifiers_in_payload_na_consent;
  return regelBlok({
    nummer: '+',
    titel: 'Wat consent veranderde',
    samenvatting: `${getal(cookies.length)} nieuwe cookie(s) en ${getal(hosts.length)} nieuwe host(s) na het accepteren.${ids?.gevonden ? ` ${getal(ids.aantal_requests)} request(s) sturen ná consent een identifier mee.` : ''}`,
    toon: 'none',
    inhoud: [
      cookies.length
        ? `${tussenkop('Nieuwe cookies')}
           ${tabel(['Cookie', 'Domein', 'Partij', 'Soort'],
            cookies.map((c) => [c.naam, c.domein, c.is_third_party ? 'third-party' : 'eigen domein', leesbaar(c.tag || c.classificatie)]),
            { breedtes: ['30%', '32%', '16%', '22%'], strak: [0] })}`
        : '',
      hosts.length
        ? `${tussenkop('Nieuwe hosts')}
           ${tabel(['Host', 'Requests', 'Herkend als'],
            hosts.map((h) => [h.host, getal(h.aantal), h.tag_naam || 'onbekend']),
            { breedtes: ['50%', '14%', '36%'], strak: [0] })}`
        : '',
    ].join(''),
  });
}

// --- Waar actie nodig is ---------------------------------------------------------------

/** Zelfde labels als in app.js: de niveaus uit lib/prioriteit.js in gewone woorden. */
const NIVEAU = {
  hoog: { label: 'eerst oplossen', toon: 'bad' },
  middel: { label: 'nalopen', toon: 'mid' },
  laag: { label: 'ter info', toon: 'none' },
};

function prioriteiten(p) {
  if (!p?.bepaald) return '';
  const geenActie = !p.aantal.hoog && !p.aantal.middel;
  return `
    ${sectie('Waar actie nodig is')}
    ${p.voorbehoud.map((tekst) => kader('waarschuwing', 'Voorbehoud', `<p>${esc(tekst)}</p>`)).join('')}
    ${geenActie ? `<p>${esc(p.punten.length ? 'Geen punten met hoge of middelhoge prioriteit. Hieronder alleen wat ter informatie.' : 'Geen punten gevonden die om actie vragen.')}</p>` : ''}
    ${p.punten.map((punt) => `
      <div class="prio niveau-${punt.niveau}">
        <div class="prio-kop">${label(NIVEAU[punt.niveau].label, NIVEAU[punt.niveau].toon)}<strong>${esc(punt.titel)}</strong></div>
        <p>${esc(punt.waarom)}</p>
        <p><strong>Wat te doen:</strong> ${esc(punt.actie)}</p>
        ${punt.bewijs.length ? `<ul>${punt.bewijs.map((b) => `<li>${esc(kort(b, AFKAP_URL))}</li>`).join('')}</ul>` : ''}
        <p class="voet">${esc([punt.regels?.length ? `Zie regel ${punt.regels.join(', ')}.` : '', punt.bron || ''].filter(Boolean).join(' '))}</p>
      </div>`).join('')}
    <p class="legenda">Weging volgens vaste regels van deze tool, op basis van de metingen. Geen juridisch advies: de context van de site kan de afweging veranderen.</p>`;
}

// --- Overzicht en meldingen ---------------------------------------------------------

function meldingen(rapport) {
  const consent = rapport.raw_data?.consent;
  const geslaagd = rapport.status === 'geslaagd';
  const uit = [];

  if (rapport.blokkade?.geblokkeerd) {
    uit.push(kader('fout', 'De site blokkeerde de scanner', `<p>${esc(rapport.blokkade.melding)}</p>`));
  }
  if (!geslaagd && rapport.fout) {
    const geprobeerd = rapport.fout.geprobeerd || [];
    uit.push(kader('fout', `Gestopt bij stap "${rapport.fout.stap}"`, `
      <p>${esc(rapport.fout.melding)}</p>
      ${geprobeerd.length ? `<ul>${geprobeerd.map((p) => `<li>${esc(`${p.cmp}: ${p.reden || p.methode || 'geen resultaat'}`)}</li>`).join('')}</ul>` : ''}
      <p class="grijs">Alles wat vóór deze stap gemeten is, staat hieronder en in de JSON.</p>`));
  }
  if (geslaagd && consent && !consent.gegeven) {
    uit.push(kader('info', consent.methode === 'geen_cmp' ? 'Geen cookiebanner aangetroffen' : 'CMP aanwezig, maar geen banner getoond', `
      <p>${esc(consent.reden)}</p>
      <p class="grijs">Er is daarom één meting. Alles hieronder gebeurt zonder dat een bezoeker iets kiest; een tweede meting "ná consent" is niet van toepassing.</p>`));
  }
  if (consent?.gegeven) {
    const overgeslagen = (consent.geprobeerd || []).filter((p) => !p.gelukt && p.reden);
    if (overgeslagen.length) {
      uit.push(kader('waarschuwing', `${overgeslagen.length === 1 ? 'Eén CMP' : `${overgeslagen.length} CMP's`} niet bediend`,
        `<ul>${overgeslagen.map((p) => `<li>${esc(`${p.cmp}: ${p.reden}`)}</li>`).join('')}</ul>`));
    }
  }
  for (const w of rapport.waarschuwingen || []) {
    // De blokkade staat er al als eigen kader; de scanner zet hem ook bij de waarschuwingen.
    if (rapport.blokkade?.melding && w.includes(rapport.blokkade.melding)) continue;
    uit.push(kader('waarschuwing', 'Let op', `<p>${esc(w.replace(/^let op:s*/i, ''))}</p>`));
  }
  return uit.join('');
}

/** De detectieregels in één tabel: wie alleen pagina 1 leest, weet waar hij moet kijken. */
function overzicht(lijst) {
  return `
    <table class="data overzicht">
      <colgroup><col style="width:9mm" /><col style="width:32%" /><col /></colgroup>
      <thead><tr><th></th><th>Regel</th><th>Uitkomst</th></tr></thead>
      <tbody>
        ${lijst.map((r) => `<tr><td>${nummer(r.nummer, r.toon)}</td><td><strong>${esc(r.titel)}</strong></td><td>${esc(r.samenvatting)}</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="legenda">
      Kleur van het nummer: ${label('aangetroffen', 'bad')} ${label('loop na', 'mid')} ${label('niets gevonden', 'good')} ${label('niets te melden', 'none')}.
      De kleur is een leeswijzer, geen oordeel.
    </p>`;
}

function consentModeTekst(gcm) {
  if (!gcm) return null;
  const fase = (m) => (m
    ? `default ${m.default_gevonden ? 'gevonden' : 'niet gevonden'}, update ${m.update_gevonden ? 'gevonden' : 'niet gevonden'}`
    : 'niet gemeten');
  return html(`vóór consent: ${esc(fase(gcm.voor_consent))}<span class="onder">ná consent: ${esc(fase(gcm.na_consent))}</span>`);
}

/** Hoe de meting liep: genoeg om het rapport te kunnen herhalen of te controleren. */
function scanGegevens(rapport) {
  const consent = rapport.raw_data?.consent;
  const br = rapport.browser || {};
  const w = rapport.instellingen?.wachttijden;
  return kv([
    ['Opgegeven URL', rapport.url],
    ['Eind-URL', rapport.eind_url && rapport.eind_url !== rapport.url ? rapport.eind_url : null],
    ['Gescand op', datum(rapport.gescand_op)],
    ['Duur van de scan', seconden(rapport.duur_ms)],
    ['Status', rapport.status],
    ['Browser', br.engine ? `${br.bron || br.engine}${br.versie ? ` ${br.versie}` : ''}${br.headless ? ', headless' : ', met venster'}${br.stealth ? ', zonder automation-signalen' : ''}` : null],
    ['Venster', br.viewport ? `${br.viewport.width}×${br.viewport.height}, ${br.locale || ''}`.replace(/, $/, '') : null],
    ['Wachttijd', w ? `minimaal ${seconden(w.minimaal_voor_consent_ms)} vóór en ${seconden(w.minimaal_na_consent_ms)} ná consent, tot het netwerk ${seconden(w.netwerk_rust_ms)} rustig is` : null],
    ["CMP's aangetroffen", rapport.cmp_info?.detected?.length ? rapport.cmp_info.detected.join(', ') : 'geen'],
    ['Consent', consent?.gegeven ? `gegeven via ${methodeLabel(consent)}${consent.duur_ms ? ` (${seconden(consent.duur_ms)})` : ''}` : methodeLabel(consent)],
    ['Google Consent Mode', consentModeTekst(rapport.cmp_info?.google_consent_mode)],
    ['Storingen', rapport.storingen?.length ? `${rapport.storingen.length} (dialoogvensters, pop-ups of crashes; zie de JSON)` : null],
    ['Versie van de tool', rapport.tool?.versie ? `consent-check ${rapport.tool.versie}` : null],
  ]);
}

/** Een advertentieklik-URL is honderden tekens; het voorblad toont alleen de pagina, "Over de scan" de hele URL. */
function zonderParameters(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

// --- Het document ---------------------------------------------------------------------

function documentHtml(rapport, { logo, fontFaces }) {
  const b = rapport.bevindingen;
  const host = hostVan(rapport.eind_url || rapport.url) || rapport.url;
  const consent = rapport.raw_data?.consent;
  // Alleen een data-URL van een afbeelding; alles anders zou de PDF iets van buiten laten laden.
  const klantlogo = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(rapport.huisstijl?.logo?.data_url || '') ? rapport.huisstijl.logo : null;
  const lijst = b ? regels(rapport) : [];

  const meta = [
    ['Website', zonderParameters(rapport.eind_url || rapport.url)],
    ['Cookiebanner', rapport.cmp_info?.detected?.length ? rapport.cmp_info.detected.join(', ') : 'geen aangetroffen'],
    ['Consent', consent?.gegeven ? `gegeven via ${methodeLabel(consent)}` : methodeLabel(consent)],
  ];

  const tegels = b
    ? [
      cookieTegel(b.cookies_voor_consent),
      { label: 'Tracking-hosts', waarde: b.externe_requests_voor_consent.aantal_tracking_hosts, onder: `van ${getal(b.externe_requests_voor_consent.aantal_hosts)} extern`, toon: hostToon(b.externe_requests_voor_consent) },
      { label: 'Requests met identifier', waarde: b.identifiers_in_payload_voor_consent.aantal_requests, onder: 'vóór consent', toon: b.identifiers_in_payload_voor_consent.aantal_requests ? 'bad' : 'good' },
    ]
    : [];

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8" />
<title>Consent-check ${esc(host)}</title>
<style>
  ${fontFaces}

  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    font-family: "Open Sans", "Segoe UI", Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.4;
    color: ${MERK.inkt};
  }
  h1, h2, h3 { margin: 0; break-after: avoid; }
  p { margin: 0 0 6pt; orphans: 3; widows: 3; }
  ul { margin: 0 0 6pt; padding-left: 12pt; }
  li { margin-bottom: 2pt; }
  strong { font-weight: 700; }
  .grijs { color: ${MERK.grijs}; }

  /* --- Voorblad: logo, label en datum, titel, metakolommen, tegels --- */
  .voorblad-kop { display: flex; justify-content: space-between; align-items: flex-start; }
  .pm-logo { width: 124pt; height: auto; display: block; }
  .voorblad-kop .rechts { text-align: right; padding-top: 12pt; }
  .eyebrow { margin: 0; font-size: 7.5pt; font-weight: 700; letter-spacing: 1.6pt; color: ${MERK.blauw}; }
  .datum { margin: 2pt 0 0; font-size: 8.5pt; color: ${MERK.grijs}; }

  .titel-rij { display: flex; align-items: flex-end; justify-content: space-between; gap: 16pt; margin-top: 34pt; }
  h1 { font-size: 25pt; font-weight: 700; line-height: 1.12; letter-spacing: -.01em; word-break: break-word; }
  h1 .punt { color: ${MERK.cyaan}; }
  .ondertitel { margin: 4pt 0 0; font-size: 10pt; color: ${MERK.grijs}; word-break: break-all; }
  /* Een wit logo op wit is onzichtbaar: lib/branding.js meet de helderheid. */
  .klantlogo { flex: none; max-width: 120pt; max-height: 44pt; object-fit: contain; padding: 5pt 7pt; border: .75pt solid ${MERK.lijn}; }
  .klantlogo.op-donker { background: ${MERK.inkt}; border-color: ${MERK.inkt}; }

  .meta { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 24pt; margin-top: 14pt; }
  .meta-label { font-size: 7pt; font-weight: 700; letter-spacing: .8pt; text-transform: uppercase; color: ${MERK.grijs}; }
  .meta-waarde { margin-top: 2pt; font-size: 9.5pt; font-weight: 700; line-height: 1.25; word-break: break-word; }

  .tegels { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12pt; margin-top: 20pt; }
  .tegel { border: .75pt solid ${MERK.lijn}; border-left-width: 3.5pt; padding: 10pt 12pt 11pt 13pt; break-inside: avoid; }
  .tegel-label { font-size: 7pt; font-weight: 700; letter-spacing: .8pt; text-transform: uppercase; color: ${MERK.grijs}; }
  .tegel-waarde { margin-top: 1pt; font-size: 22pt; font-weight: 700; line-height: 1.15; }
  .tegel-waarde small { font-size: 10pt; font-weight: 400; color: ${MERK.grijs}; }
  .tegels-uitleg { margin: 6pt 0 0; font-size: 8pt; color: ${MERK.grijs}; }

  .scheiding { height: 0; border-top: .75pt solid ${MERK.lijn}; margin: 22pt 0 0; }

  /* --- Secties: kop met het kleurverloop eronder --- */
  h2 { font-size: 15pt; font-weight: 700; margin-top: 24pt; break-after: avoid; }
  .verloop { width: 42pt; height: 3pt; margin: 6pt 0 12pt; background: linear-gradient(90deg, ${MERK.cyaan}, ${MERK.diep}); break-after: avoid; }
  .nieuwe-pagina { break-before: page; }
  .nieuwe-pagina h2 { margin-top: 0; }

  /* --- Kaders voor meldingen, zoals het citaatblok in de Landingpage-PDF --- */
  .kader { background: ${MERK.cyaanZacht}; border-left: 3pt solid ${MERK.cyaan}; padding: 7pt 10pt 2pt; margin: 10pt 0; break-inside: avoid; }
  .kader.waarschuwing { background: ${TONEN.mid.vlak}; border-left-color: ${TONEN.mid.vol}; }
  .kader.fout { background: ${TONEN.bad.vlak}; border-left-color: ${TONEN.bad.vol}; }
  .kader-titel { font-weight: 700; margin-bottom: 3pt; }

  /* --- Regels --- */
  .regel { margin-top: 16pt; padding-top: 12pt; border-top: .75pt solid ${MERK.lijn}; }
  .regel:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
  .regel-kop { display: flex; gap: 9pt; align-items: flex-start; break-inside: avoid; break-after: avoid; margin-bottom: 8pt; }
  h3 { font-size: 11pt; font-weight: 700; line-height: 1.25; }
  .samenvatting { margin: 2pt 0 0; color: #3d4852; }
  .regel-inhoud > p { font-size: 9pt; }

  .hex {
    flex: none; display: inline-grid; place-items: center; width: 17pt; height: 19pt;
    font-size: 8.5pt; font-weight: 700; color: #fff; background: ${TONEN.none.vol};
    clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  }
  .hex.toon-bad { background: ${TONEN.bad.vol}; }
  .hex.toon-mid { background: ${TONEN.mid.vol}; }
  .hex.toon-good { background: ${TONEN.good.vol}; }

  .tussenkop { margin: 12pt 0 4pt; font-size: 7.5pt; font-weight: 700; letter-spacing: .8pt; text-transform: uppercase; color: ${MERK.grijs}; break-after: avoid; }

  .label { display: inline-block; padding: 0 4pt; font-size: 8pt; font-weight: 700; line-height: 1.5; white-space: nowrap; }
  .label.toon-bad { background: ${TONEN.bad.vlak}; color: ${TONEN.bad.tekst}; }
  .label.toon-mid { background: ${TONEN.mid.vlak}; color: ${TONEN.mid.tekst}; }
  .label.toon-good { background: ${TONEN.good.vlak}; color: ${TONEN.good.tekst}; }
  .label.toon-none { background: ${TONEN.none.vlak}; color: ${TONEN.none.tekst}; }

  /* --- Tabellen: cyaan tint in de kop, cyaan lijn eronder, zebra --- */
  table.data { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 4pt 0 10pt; font-size: 8.5pt; line-height: 1.3; }
  /* Loopt een tabel door naar de volgende pagina, dan herhaalt de kop zich. */
  table.data thead { display: table-header-group; }
  table.data tr { break-inside: avoid; }
  table.data th { text-align: left; font-weight: 700; padding: 5pt 6pt; background: ${MERK.cyaanTint}; border-bottom: 1.25pt solid ${MERK.cyaan}; vertical-align: bottom; }
  table.data td { padding: 5pt 6pt; border-bottom: .5pt solid ${MERK.lijn}; vertical-align: top; overflow-wrap: anywhere; }
  table.data tbody tr:nth-child(even) td { background: ${MERK.zebra}; }
  table.data td.strak { overflow-wrap: anywhere; word-break: normal; }
  .onder { display: block; font-size: 7.5pt; color: ${MERK.grijs}; }
  .url { overflow-wrap: anywhere; word-break: break-all; font-size: 7.5pt; }
  table.overzicht td { vertical-align: middle; }

  .legenda { font-size: 8pt; color: ${MERK.grijs}; }
  .legenda .label { font-size: 7.5pt; }

  dl.kv { display: grid; grid-template-columns: 34mm 1fr; gap: 3pt 10pt; margin: 0 0 8pt; font-size: 9pt; }
  dl.kv dt { color: ${MERK.grijs}; font-weight: 600; }
  dl.kv dd { margin: 0; overflow-wrap: anywhere; }

  .blok { border: .75pt solid ${MERK.lijn}; border-left: 3pt solid ${MERK.lijn}; padding: 7pt 9pt 1pt; margin: 0 0 8pt; }
  .blok-kop { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4pt 7pt; margin-bottom: 4pt; break-after: avoid; }
  .blok table.data { margin: 2pt 0 5pt; }
  .blok > p.url { margin-bottom: 6pt; }
  ul.signalen { list-style: none; padding: 0; font-size: 8pt; }
  ul.signalen li { overflow-wrap: anywhere; break-inside: avoid; }
  ul.signalen .bron { font-weight: 700; }

  /* --- Waar actie nodig is: per punt een rand in de kleur van het niveau --- */
  .prio { border: .75pt solid ${MERK.lijn}; border-left: 3.5pt solid ${TONEN.none.vol}; padding: 8pt 10pt 3pt; margin: 0 0 8pt; break-inside: avoid; }
  .prio.niveau-hoog { border-left-color: ${TONEN.bad.vol}; }
  .prio.niveau-middel { border-left-color: ${TONEN.mid.vol}; }
  .prio-kop { display: flex; align-items: baseline; gap: 7pt; margin-bottom: 4pt; }
  .prio-kop strong { font-size: 10pt; }
  .prio p { font-size: 9pt; margin-bottom: 4pt; }
  .prio ul { font-size: 8pt; color: ${MERK.grijs}; margin-bottom: 4pt; }
  .prio .voet { font-size: 7.5pt; color: ${MERK.grijs}; }

  .colofon { margin-top: 18pt; padding-top: 8pt; border-top: .75pt solid ${MERK.lijn}; font-size: 8pt; color: ${MERK.grijs}; }
</style>
</head>
<body>

<div class="voorblad-kop">
  ${logo ? `<img class="pm-logo" src="${logo}" alt="Pure Minds" />` : '<strong>pure minds</strong>'}
  <div class="rechts">
    <p class="eyebrow">CONSENT-CHECK</p>
    <p class="datum">${esc(datum(rapport.gescand_op, false))}</p>
  </div>
</div>

<div class="titel-rij">
  <div>
    <h1>Cookies en consent<span class="punt">.</span></h1>
    <p class="ondertitel">${esc(host)}</p>
  </div>
  ${klantlogo ? `<img class="klantlogo ${(klantlogo.helderheid ?? 0) > 0.6 ? 'op-donker' : ''}" src="${esc(klantlogo.data_url)}" alt="" />` : ''}
</div>

<div class="meta">
  ${meta.map(([sleutel, waarde]) => `<div><div class="meta-label">${esc(sleutel)}</div><div class="meta-waarde">${esc(waarde)}</div></div>`).join('')}
</div>

${tegels.length ? `
<div class="tegels">
  ${tegels.map((t) => `
  <div class="tegel" style="border-left-color:${TONEN[t.toon].vol}">
    <div class="tegel-label">${esc(t.label)}</div>
    <div class="tegel-waarde">${esc(getal(t.waarde))} <small>${esc(t.onder)}</small></div>
  </div>`).join('')}
</div>
<p class="tegels-uitleg">Alle drie gemeten vóórdat er consent is gegeven.</p>` : ''}

<div class="scheiding"></div>

${meldingen(rapport)}

${prioriteiten(rapport.prioriteiten)}

${lijst.length ? `${sectie('Overzicht')}${overzicht(lijst)}` : ''}

${lijst.length ? `
<div class="nieuwe-pagina">
  ${sectie('Bevindingen in detail')}
  ${lijst.map(regelBlok).join('')}
  ${b.nieuwe_cookies_na_consent ? naConsent(b) : ''}
</div>` : ''}

${sectie('Over de scan')}
${scanGegevens(rapport)}

<div class="colofon">
  <p><strong>Hoe dit rapport tot stand komt.</strong> De tool bezoekt de pagina met een schone browser zonder eerdere cookies,
  meet minstens tien seconden lang alles wat er gebeurt, accepteert daarna de cookiebanner (via de officiële API van de
  CMP, anders via zijn eigen knop) en meet opnieuw. Er wordt niets weggefilterd: elk request en elke cookie staat in de
  JSON van deze scan. De tool doet feitelijke metingen en geen juridische uitspraken.</p>
</div>

</body>
</html>`;
}

// --- Kop- en voettekst ---------------------------------------------------------------
// Chromium tekent deze in de paginamarge, los van het document: ze krijgen geen
// CSS en geen lettertypen van de pagina mee, dus alles staat er inline in.

/** De cyaan-blauwe balk bovenaan elke pagina, zoals de balk op pureminds.nl. */
const KOPTEKST = `
  <div style="position:absolute;top:0;left:0;right:0;height:6px;background:linear-gradient(90deg,${MERK.cyaan},${MERK.diep});-webkit-print-color-adjust:exact;"></div>`;

function voettekst(host) {
  return `
    <div style="width:100%;margin:0 ${MARGE.left};padding-top:7px;border-top:0.5px solid ${MERK.lijn};font-family:'Open Sans','Segoe UI',Arial,sans-serif;font-size:7.5pt;color:${MERK.grijs};display:flex;justify-content:space-between;-webkit-print-color-adjust:exact;">
      <span><b>pure minds</b>&nbsp;&nbsp;·&nbsp;&nbsp;Consent-check&nbsp;&nbsp;·&nbsp;&nbsp;${esc(host)}</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`;
}

// --- Genereren --------------------------------------------------------------------------

/**
 * Bouwt de PDF en geeft de bytes terug. `rapport` is het JSON-rapport zoals
 * lib/report.js het oplevert.
 */
export async function maakPdf(rapport) {
  const inhoud = documentHtml(rapport, await bronnen());

  const browser = await geefBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Geen netwerk nodig: alles staat in het document, inclusief logo's en lettertype.
    await page.setContent(inhoud, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: 'print' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: KOPTEKST,
      footerTemplate: voettekst(hostVan(rapport.eind_url || rapport.url) || rapport.url),
      margin: MARGE,
    });
  } finally {
    await context.close().catch(() => {});
  }
}

/** Bestandsnaam in dezelfde stijl als de JSON: host + tijdstempel. */
export function pdfBestandsnaam(rapport) {
  return `${slug(hostVan(rapport.eind_url || rapport.url) || rapport.url)}-${tijdstempel(new Date(rapport.gescand_op))}.pdf`;
}
