/**
 * Kleine helpers die in meerdere modules terugkomen.
 */

/**
 * Fout mét de stap waarin hij optrad. Het rapport en de console kunnen zo
 * precies zeggen wáár het misging ("consent", "navigatie", "html_ophalen")
 * in plaats van alleen dát het misging.
 */
export function fail(stap, melding, extra = {}) {
  const error = new Error(melding);
  error.stap = stap;
  Object.assign(error, extra);
  return error;
}

/** Kort een string in en maakt zichtbaar hoeveel er is weggelaten. */
export function kort(tekst, max) {
  if (tekst === null || tekst === undefined) return tekst;
  const s = String(tekst);
  return s.length > max ? `${s.slice(0, max)}…[+${s.length - max} tekens]` : s;
}

/** Bestandsnaamveilige variant van een host: "www.klant.nl" -> "www-klant-nl". */
export function slug(tekst) {
  return String(tekst)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'scan';
}

/** "2026-09-18T09-14-05" — sorteerbaar en toegestaan in bestandsnamen op Windows. */
export function tijdstempel(datum = new Date()) {
  return datum.toISOString().slice(0, 19).replace(/:/g, '-');
}

export function wacht(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Seconden met één decimaal, voor de console. */
export function seconden(ms) {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}
