/**
 * Huisstijl van de gescande site aflezen, voor het PDF-rapport.
 *
 * Het rapport is een Pure Minds-document, maar het gaat over de site van een
 * klant. Door de accentkleur en het logo van díe site over te nemen herkent de
 * ontvanger zijn eigen merk terug. De Pure Minds-opmaak blijft de basis; alleen
 * het accent wisselt mee.
 *
 * De kleur wordt niet klakkeloos overgenomen. Een lichtgele merkkleur op wit
 * levert onleesbare koppen op, dus elke kleur gaat door een contrasttoets
 * (WCAG-verhouding) en wordt zo nodig donkerder gemaakt tot hij leesbaar is.
 * Het logo wordt als data-URL ingesloten, zodat de PDF ook zonder internet
 * klopt en er geen verzoek naar de klantsite gaat bij het openen.
 */

import { kort } from './util.js';

const PM = {
  cyaan: '#1ab9e2',
  magenta: '#b61b50',
  inkt: '#303030',
  grijs: '#5c6670',
};

const MAX_LOGO_BYTES = 400 * 1024; // een logo in een PDF hoeft nooit groter
const LOGO_TIMEOUT_MS = 8000;

// --- Kleurgereedschap ---------------------------------------------------------

/** "#1ab9e2", "rgb(26,185,226)" of "rgba(26,185,226,.5)" -> {r,g,b} of null. */
export function leesKleur(waarde) {
  const tekst = String(waarde || '').trim().toLowerCase();
  if (!tekst || /^(transparent|none|inherit|initial|currentcolor)$/.test(tekst)) return null;

  const hex = tekst.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length < 6) return null;
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    if (alpha < 0.5) return null; // vrijwel doorzichtig telt niet als merkkleur
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  const rgb = tekst.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.%]+))?\s*\)$/);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : parseFloat(rgb[4]) / (rgb[4].includes('%') ? 100 : 1);
    if (alpha < 0.5) return null;
    return { r: Math.round(+rgb[1]), g: Math.round(+rgb[2]), b: Math.round(+rgb[3]) };
  }
  return null;
}

export function naarHex({ r, g, b }) {
  const deel = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${deel(r)}${deel(g)}${deel(b)}`;
}

/** Relatieve helderheid volgens WCAG. */
function helderheid({ r, g, b }) {
  const kanaal = (waarde) => {
    const v = waarde / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * kanaal(r) + 0.7152 * kanaal(g) + 0.0722 * kanaal(b);
}

/** Contrastverhouding tussen twee kleuren: 1 (geen) tot 21 (zwart op wit). */
export function contrast(a, b) {
  const l1 = helderheid(a);
  const l2 = helderheid(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const WIT = { r: 255, g: 255, b: 255 };
const ZWART = { r: 0, g: 0, b: 0 };

/**
 * Maakt een kleur stapsgewijs donkerder tot hij op wit leesbaar is.
 * `doel` 4.5 is de WCAG AA-eis voor gewone tekst; voor grote koppen volstaat 3.
 */
export function leesbaarOpWit(kleur, doel = 4.5) {
  let huidig = { ...kleur };
  for (let stap = 0; stap < 24 && contrast(huidig, WIT) < doel; stap += 1) {
    huidig = { r: huidig.r * 0.88, g: huidig.g * 0.88, b: huidig.b * 0.88 };
  }
  return { r: Math.round(huidig.r), g: Math.round(huidig.g), b: Math.round(huidig.b) };
}

/** Zwarte of witte tekst op deze achtergrond, net welke beter leest. */
export function tekstkleurOp(kleur) {
  return contrast(kleur, WIT) >= contrast(kleur, ZWART) ? '#ffffff' : '#111111';
}

/** Dezelfde kleur, maar sterk verbleekt: voor vlakken en tabelkoppen. */
export function tint(kleur, sterkte = 0.12) {
  return naarHex({
    r: 255 - (255 - kleur.r) * sterkte,
    g: 255 - (255 - kleur.g) * sterkte,
    b: 255 - (255 - kleur.b) * sterkte,
  });
}

// --- Aflezen in de pagina --------------------------------------------------------

/**
 * Draait in de gescande pagina en verzamelt kleur- en logokandidaten.
 * Mag niets van buiten zichzelf gebruiken.
 *
 * De volgorde is bewust: een `theme-color` of een CSS-variabele met "primary"
 * in de naam is een expliciete merkkeuze van de bouwer. Pas als die ontbreekt
 * kijken we naar wat het meest wordt gebruikt op de pagina: de achtergrond van
 * knoppen en de header. Losse tekstkleuren tellen niet mee, want die zijn bijna
 * altijd zwart of grijs.
 */
export function leesHuisstijl() {
  const uit = { theme_color: null, css_variabelen: [], kandidaten: [], logos: [], titel: document.title, lettertype: null };

  try {
    uit.theme_color = (document.querySelector('meta[name="theme-color"]') || {}).content || null;
  } catch { /* niet fataal */ }

  // CSS-variabelen met een merkachtige naam, uit :root.
  try {
    const stijl = getComputedStyle(document.documentElement);
    for (const naam of Array.from(stijl).slice(0, 400)) {
      if (!/^--/.test(naam)) continue;
      if (!/(primary|brand|accent|main|theme|kleur|color)/i.test(naam)) continue;
      if (/(text|font|grey|gray|white|black|border|shadow|bg-light)/i.test(naam)) continue;
      const waarde = stijl.getPropertyValue(naam).trim();
      if (waarde && /^(#|rgb)/i.test(waarde)) uit.css_variabelen.push({ naam, waarde });
      if (uit.css_variabelen.length >= 12) break;
    }
  } catch { /* niet fataal */ }

  // Veelgebruikte achtergrondkleuren van knoppen, links en de header.
  try {
    const telling = new Map();
    const noteer = (waarde, gewicht) => {
      if (!waarde) return;
      telling.set(waarde, (telling.get(waarde) || 0) + gewicht);
    };
    const zichtbaar = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.top < 3000;
    };
    const knoppen = document.querySelectorAll('button, .btn, [class*="button"], a[class*="btn"], input[type="submit"]');
    for (const el of Array.from(knoppen).slice(0, 60)) {
      if (!zichtbaar(el)) continue;
      const s = getComputedStyle(el);
      noteer(s.backgroundColor, 3);
      noteer(s.borderTopColor, 1);
    }
    for (const selector of ['header', '[role="banner"]', 'nav', '.site-header', '#header']) {
      for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 4)) {
        if (!zichtbaar(el)) continue;
        noteer(getComputedStyle(el).backgroundColor, 4);
      }
    }
    // De linkkleur is een goede tweede: die wordt bijna altijd op de merkkleur gezet.
    for (const el of Array.from(document.querySelectorAll('a')).slice(0, 40)) {
      if (!zichtbaar(el)) continue;
      noteer(getComputedStyle(el).color, 1);
    }
    uit.kandidaten = [...telling.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([waarde, score]) => ({ waarde, score }));
  } catch { /* niet fataal */ }

  // Logokandidaten, van meest naar minst betrouwbaar.
  try {
    const voegToe = (bron, src, breedte, hoogte) => {
      if (!src || uit.logos.length >= 10) return;
      uit.logos.push({ bron, src, breedte: breedte || null, hoogte: hoogte || null });
    };
    for (const el of Array.from(document.querySelectorAll('img')).slice(0, 120)) {
      const kenmerk = `${el.className || ''} ${el.id || ''} ${el.alt || ''} ${el.getAttribute('src') || ''}`.toLowerCase();
      if (!/logo|brand|merk/.test(kenmerk)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 16 || r.height < 8) continue;
      voegToe('img[logo]', el.currentSrc || el.src, Math.round(r.width), Math.round(r.height));
    }
    // Een SVG in de header is vaak het logo; die nemen we als losse bron mee.
    for (const el of Array.from(document.querySelectorAll('header svg, [role="banner"] svg, .logo svg')).slice(0, 3)) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 12) continue;
      voegToe('svg-inline', `data:image/svg+xml;utf8,${encodeURIComponent(el.outerHTML)}`, Math.round(r.width), Math.round(r.height));
    }
    const meta = (selector, attribuut) => (document.querySelector(selector) || {})[attribuut] || null;
    voegToe('apple-touch-icon', meta('link[rel="apple-touch-icon"]', 'href'));
    voegToe('og:image', (document.querySelector('meta[property="og:image"]') || {}).content || null);
    voegToe('icon', meta('link[rel~="icon"]', 'href'));
  } catch { /* niet fataal */ }

  try {
    const body = getComputedStyle(document.body).fontFamily;
    uit.lettertype = body ? body.split(',')[0].replace(/["']/g, '').trim() : null;
  } catch { /* niet fataal */ }

  return uit;
}

// --- Samenstellen op de Node-kant ---------------------------------------------------

/**
 * Kiest de accentkleur uit de kandidaten. Wit, zwart en grijstinten vallen af:
 * dat zijn geen merkkleuren maar achtergronden.
 */
function kiesAccent(huisstijl) {
  const bronnen = [
    ...(huisstijl.theme_color ? [{ waarde: huisstijl.theme_color, score: 100, bron: 'theme-color' }] : []),
    ...huisstijl.css_variabelen.map((v, i) => ({ waarde: v.waarde, score: 50 - i, bron: `css-variabele ${v.naam}` })),
    ...huisstijl.kandidaten.map((k) => ({ ...k, bron: 'gemeten op de pagina' })),
  ];

  for (const bron of bronnen) {
    const kleur = leesKleur(bron.waarde);
    if (!kleur) continue;
    const { r, g, b } = kleur;
    const grijsachtig = Math.max(r, g, b) - Math.min(r, g, b) < 24;
    const bijnaWit = r > 240 && g > 240 && b > 240;
    const bijnaZwart = r < 28 && g < 28 && b < 28;
    if (grijsachtig || bijnaWit || bijnaZwart) continue;
    return { kleur, bron: bron.bron, origineel: naarHex(kleur) };
  }
  return null;
}

/**
 * Haalt het logo op en maakt er een data-URL van. Gebruikt de browsercontext
 * van de scan, zodat het verzoek van dezelfde sessie komt als de meting (en
 * bijvoorbeeld niet op een hotlink-blokkade stuit).
 */
async function haalLogo(context, basisUrl, logos) {
  for (const logo of logos.slice(0, 6)) {
    const src = String(logo.src || '');
    if (src.startsWith('data:')) {
      if (src.length < MAX_LOGO_BYTES) return { data_url: src, bron: logo.bron, breedte: logo.breedte, hoogte: logo.hoogte };
      continue;
    }
    let absoluut;
    try {
      absoluut = new URL(src, basisUrl).href;
    } catch {
      continue;
    }
    try {
      const antwoord = await context.request.get(absoluut, { timeout: LOGO_TIMEOUT_MS, failOnStatusCode: false });
      if (!antwoord.ok()) continue;
      const type = (antwoord.headers()['content-type'] || '').split(';')[0].trim();
      if (!/^image\//.test(type)) continue;
      const body = await antwoord.body();
      if (!body.length || body.length > MAX_LOGO_BYTES) continue;
      return {
        data_url: `data:${type};base64,${body.toString('base64')}`,
        bron: logo.bron,
        url: kort(absoluut, 300),
        breedte: logo.breedte,
        hoogte: logo.hoogte,
        bytes: body.length,
      };
    } catch {
      // volgende kandidaat
    }
  }
  return null;
}

/**
 * Hoe licht is dit logo? Veel merken leveren een wit logo met een doorzichtige
 * achtergrond; dat verdwijnt op een wit vlak. Door de gemiddelde helderheid van
 * de zichtbare pixels te meten, weet het rapport of het logo een donkere of een
 * lichte ondergrond nodig heeft.
 */
async function meetLogoHelderheid(page, dataUrl) {
  try {
    return await page.evaluate(async (src) => {
      const afbeelding = new Image();
      afbeelding.src = src;
      await new Promise((klaar, mislukt) => {
        afbeelding.onload = klaar;
        afbeelding.onerror = mislukt;
        setTimeout(mislukt, 5000);
      });
      const breedte = Math.min(afbeelding.naturalWidth || 64, 64);
      const hoogte = Math.min(afbeelding.naturalHeight || 64, 64);
      if (!breedte || !hoogte) return null;

      const canvas = document.createElement('canvas');
      canvas.width = breedte;
      canvas.height = hoogte;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(afbeelding, 0, 0, breedte, hoogte);
      const { data } = ctx.getImageData(0, 0, breedte, hoogte);

      let som = 0;
      let zichtbaar = 0;
      let doorzichtig = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 40) { doorzichtig += 1; continue; }
        // Simpele helderheid; voor "licht of donker" is dit nauwkeurig genoeg.
        som += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        zichtbaar += 1;
      }
      if (!zichtbaar) return null;
      return {
        helderheid: Math.round((som / zichtbaar) * 100) / 100,
        doorzichtig_aandeel: Math.round((doorzichtig / (data.length / 4)) * 100) / 100,
      };
    }, dataUrl);
  } catch {
    return null;
  }
}


/**
 * Leest de huisstijl uit de pagina en zet hem om in een palet voor de PDF.
 * Faalt dit, dan valt alles terug op de Pure Minds-kleuren: een rapport zonder
 * klantkleur is prima, een rapport dat niet gegenereerd wordt niet.
 */
export async function bepaalHuisstijl(page, context) {
  let ruw = null;
  try {
    ruw = await page.evaluate(leesHuisstijl);
  } catch (error) {
    return { ...standaardPalet(), fout: `huisstijl aflezen mislukt: ${error.message.split('\n')[0]}` };
  }

  const accent = kiesAccent(ruw);
  const logo = await haalLogo(context, page.url(), ruw.logos || []).catch(() => null);
  if (logo?.data_url) {
    // Een wit logo op een wit vlak is onzichtbaar. Met de helderheid erbij kan
    // het rapport kiezen tussen een lichte en een donkere ondergrond.
    const meting = await meetLogoHelderheid(page, logo.data_url);
    if (meting) Object.assign(logo, meting);
  }

  if (!accent) {
    return { ...standaardPalet(), logo, titel: ruw.titel || null, lettertype: ruw.lettertype || null, bron: 'geen merkkleur gevonden, Pure Minds-kleuren gebruikt' };
  }

  // Leesbaar maken: koppen moeten op wit minstens AA halen (4.5), vlakken met
  // tekst erop krijgen een eigen tekstkleur naar contrast.
  const leesbaar = leesbaarOpWit(accent.kleur, 4.5);
  return {
    accent: naarHex(leesbaar),
    accent_origineel: accent.origineel,
    accent_bron: accent.bron,
    accent_aangepast: naarHex(leesbaar) !== accent.origineel,
    contrast_op_wit: Math.round(contrast(leesbaar, WIT) * 10) / 10,
    tekst_op_accent: tekstkleurOp(leesbaar),
    vlak: tint(leesbaar, 0.1),
    vlak_sterk: tint(leesbaar, 0.2),
    inkt: PM.inkt,
    grijs: PM.grijs,
    magenta: PM.magenta,
    cyaan: PM.cyaan,
    logo,
    titel: ruw.titel || null,
    lettertype: ruw.lettertype || null,
    bron: `merkkleur uit ${accent.bron}`,
  };
}

export function standaardPalet() {
  const cyaan = leesKleur(PM.cyaan);
  return {
    accent: naarHex(leesbaarOpWit(cyaan, 4.5)),
    accent_origineel: PM.cyaan,
    accent_bron: 'Pure Minds-huisstijl',
    accent_aangepast: false,
    contrast_op_wit: Math.round(contrast(leesbaarOpWit(cyaan, 4.5), WIT) * 10) / 10,
    tekst_op_accent: '#ffffff',
    vlak: tint(cyaan, 0.1),
    vlak_sterk: tint(cyaan, 0.2),
    inkt: PM.inkt,
    grijs: PM.grijs,
    magenta: PM.magenta,
    cyaan: PM.cyaan,
    logo: null,
    titel: null,
    lettertype: null,
    bron: 'Pure Minds-huisstijl',
  };
}
