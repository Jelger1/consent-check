/**
 * Ruwe HTML: ophalen met een gewone HTTP-request (zonder JavaScript) en
 * ontleden op wat de vergelijking met de gerenderde DOM nodig heeft.
 *
 * Bewust geen DOM-parser (scheelt een dependency): voor script- en iframe-tags
 * met hun attributen is regex ruim genoeg. HTML-commentaar wordt eerst
 * vervangen door spaties van dezelfde lengte, zodat de offsets blijven kloppen
 * en een uitgecommentarieerde pixel niet als aanwezig telt.
 */

import { fail, kort } from './util.js';
import { herkenTagsInCode } from './trackers.js';

const MAX_INLINE_FRAGMENT = 240;

// --- Ophalen -----------------------------------------------------------------

export async function haalHtmlOp(url, { userAgent, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const gestart = Date.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
      },
    });
    const html = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      eind_url: response.url,
      content_type: response.headers.get('content-type') || '',
      lengte: html.length,
      duur_ms: Date.now() - gestart,
      html,
    };
  } catch (error) {
    const reden = error.name === 'AbortError' ? `time-out na ${timeoutMs / 1000} seconden` : error.message;
    throw fail('html_ophalen', `Ruwe HTML ophalen mislukt: ${reden}.`);
  } finally {
    clearTimeout(timer);
  }
}

// --- Ontleden -----------------------------------------------------------------

export function ontleedHtml(html) {
  const schoon = html.replace(/<!--[\s\S]*?-->/g, (commentaar) => ' '.repeat(commentaar.length));
  const headEinde = schoon.search(/<\/head\s*>/i);
  const bodyBegin = schoon.search(/<body\b/i);
  const noscript = bereiken(schoon, /<noscript\b[^>]*>/gi, /<\/noscript\s*>/gi);
  const positieVan = (offset) => positie(offset, headEinde, bodyBegin);
  const inNoscript = (offset) => noscript.some(([van, tot]) => offset > van && offset < tot);

  const scripts = [];
  const scriptPatroon = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scriptPatroon.exec(schoon)) !== null) {
    const attributen = parseAttributen(match[1]);
    const inline = match[2].trim();
    scripts.push({
      index: scripts.length,
      offset: match.index,
      positie: positieVan(match.index),
      in_noscript: inNoscript(match.index),
      src: attributen.src || null,
      type: attributen.type || null,
      async: 'async' in attributen,
      defer: 'defer' in attributen,
      id: attributen.id || null,
      charset: attributen.charset || null,
      data: dataAttributen(attributen),
      inline_lengte: inline.length,
      inline_fragment: inline ? kort(inline, MAX_INLINE_FRAGMENT) : null,
      tags_genoemd: herkenTagsInCode(`${attributen.src || ''}\n${inline}`),
    });
  }

  const iframes = [];
  const iframePatroon = /<iframe\b([^>]*)>/gi;
  while ((match = iframePatroon.exec(schoon)) !== null) {
    const attributen = parseAttributen(match[1]);
    const src = attributen.src || null;
    const dataSrc = attributen['data-src'] || attributen['data-lazy-src'] || attributen['data-lazyload'] || null;
    iframes.push({
      index: iframes.length,
      offset: match.index,
      positie: positieVan(match.index),
      in_noscript: inNoscript(match.index),
      src,
      data_src: dataSrc,
      srcdoc: 'srcdoc' in attributen,
      id: attributen.id || null,
      name: attributen.name || null,
      title: attributen.title || null,
      class: attributen.class || null,
      width: attributen.width || null,
      height: attributen.height || null,
      loading: attributen.loading || null,
      sandbox: 'sandbox' in attributen ? attributen.sandbox : null,
      data: dataAttributen(attributen),
      tags_genoemd: herkenTagsInCode(`${src || ''}\n${dataSrc || ''}`),
    });
  }

  // Resource hints verraden welke externe hosts de site verwacht te gebruiken,
  // ook als het bijbehorende script pas later (of via GTM) wordt ingeladen.
  const resourceHints = [];
  const linkPatroon = /<link\b([^>]*)>/gi;
  while ((match = linkPatroon.exec(schoon)) !== null) {
    const attributen = parseAttributen(match[1]);
    if (/^(dns-prefetch|preconnect|preload|modulepreload|prefetch)$/i.test(attributen.rel || '') && attributen.href) {
      resourceHints.push({ rel: attributen.rel.toLowerCase(), href: kort(attributen.href, 300) });
    }
  }

  const titel = decodeer((schoon.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '');

  return {
    titel: kort(titel, 200),
    head_einde: headEinde,
    body_begin: bodyBegin,
    aantal_scripts: scripts.length,
    aantal_iframes: iframes.length,
    scripts,
    iframes,
    gtm_containers: [...new Set(schoon.match(/\bGTM-[A-Z0-9]{4,}\b/g) || [])],
    resource_hints: resourceHints,
  };
}

/** head, body of onbekend; alles vóór <body> telt als head als </head> ontbreekt. */
function positie(offset, headEinde, bodyBegin) {
  if (bodyBegin !== -1) return offset >= bodyBegin ? 'body' : 'head';
  if (headEinde !== -1) return offset < headEinde ? 'head' : 'body';
  return 'onbekend';
}

/** Paren [open, sluit] voor tags die niet nesten, zoals <noscript>. */
function bereiken(tekst, openPatroon, sluitPatroon) {
  const opens = [];
  const sluiten = [];
  let match;
  const open = new RegExp(openPatroon.source, 'gi');
  while ((match = open.exec(tekst)) !== null) opens.push(match.index);
  const sluit = new RegExp(sluitPatroon.source, 'gi');
  while ((match = sluit.exec(tekst)) !== null) sluiten.push(match.index);
  return opens.map((van) => [van, sluiten.find((tot) => tot > van) ?? tekst.length]);
}

/**
 * Attributen uit de binnenkant van een tag: name="value", name='value',
 * name=value en losse booleans zoals async. Sleutels in kleine letters.
 */
export function parseAttributen(tekst) {
  const attributen = {};
  const patroon = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  let match;
  while ((match = patroon.exec(tekst || '')) !== null) {
    attributen[match[1].toLowerCase()] = decodeer(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributen;
}

function dataAttributen(attributen) {
  const data = {};
  for (const [naam, waarde] of Object.entries(attributen)) {
    if (naam.startsWith('data-')) data[naam] = kort(waarde, 200);
  }
  return data;
}

/** Alleen de entities die in attribuutwaarden (src, href) voorkomen; &amp; als laatste. */
function decodeer(tekst) {
  return String(tekst)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
