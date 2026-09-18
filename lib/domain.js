/**
 * Domeinhelpers.
 *
 * "Extern" betekent in deze tool: een ander registreerbaar domein dan de site
 * zelf. cdn.klant.nl hoort dus bij klant.nl, static.doubleclick.net niet.
 * Bewust geen Public Suffix List als dependency: de korte lijst hieronder dekt
 * de tweeledige achtervoegsels die we in de praktijk tegenkomen.
 */

const TWEELEDIGE_SUFFIXEN = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz',
  'com.br', 'co.jp', 'co.za', 'com.mx', 'com.ar', 'co.in', 'com.sg', 'com.tr',
]);

/** "www.klant.nl" -> "klant.nl", "a.b.co.uk" -> "b.co.uk". IP-adressen blijven zoals ze zijn. */
export function registreerbaarDomein(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  if (!host) return '';
  if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const aantal = TWEELEDIGE_SUFFIXEN.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-aantal).join('.');
}

/** Registreerbare domeinen die bij de site horen: start-URL én eind-URL na redirects. */
export function siteDomeinen(...urls) {
  const set = new Set();
  for (const url of urls) {
    const host = hostVan(url);
    if (host) set.add(registreerbaarDomein(host));
  }
  return set;
}

/** Cookies hebben een domein met of zonder punt ervoor; requests een gewone host. Beide kunnen hierin. */
export function isExtern(hostname, siteDomeinenSet) {
  if (!hostname) return false; // data:, blob:, about: hebben geen host
  return !siteDomeinenSet.has(registreerbaarDomein(hostname));
}

/** Veilige URL-ontleding: null voor data:, blob:, about: en kapotte adressen. */
export function ontleedUrl(url) {
  try {
    const parsed = new URL(url);
    return /^(https?|wss?):$/.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

export function hostVan(url) {
  return ontleedUrl(url)?.hostname.toLowerCase() || '';
}

/** Host + pad zonder query, in kleine letters: de string waar de tag-patronen op testen. */
export function hostEnPad(url) {
  const parsed = ontleedUrl(url);
  if (!parsed) return '';
  return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
}

/**
 * Normaliseert een iframe-src voor de vergelijking HTML versus DOM: schema en
 * query eraf, want lazy-loaders en cachebusters veranderen die, terwijl het
 * om dezelfde embed gaat.
 */
export function normaliseerBron(src) {
  const s = String(src || '').trim();
  if (!s || s === 'about:blank') return '';
  const parsed = ontleedUrl(s.startsWith('//') ? `https:${s}` : s);
  if (!parsed) return s.toLowerCase();
  return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/+$/, '');
}
