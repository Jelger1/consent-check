/**
 * Configuratie: standaardwaarden, het lezen van config.json en het opschonen
 * van een ingevoerde URL.
 *
 * Staat apart zodat de CLI (scan.js) en de server (server/server.js) exact
 * dezelfde instellingen en dezelfde URL-controle gebruiken.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECTMAP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Vertraagde tags (een Meta Pixel via een GTM-trigger, een lazy embed) vuren
 * soms pas na een paar seconden; vandaar een minimum van tien seconden vóór
 * consent, los van of het netwerk al rustig is.
 */
export const STANDAARD_WACHTTIJDEN = {
  minimaal_voor_consent_ms: 10_000,
  minimaal_na_consent_ms: 8_000,
  maximaal_ms: 30_000,
  netwerk_rust_ms: 2_000,
  navigatie_timeout_ms: 45_000,
  consent_timeout_ms: 15_000,
  html_timeout_ms: 20_000,
};

/** Leest config.json. Zonder pad en zonder bestand: lege configuratie, de standaarden gelden. */
export async function laadConfig(pad) {
  const bestand = pad ? resolve(pad) : resolve(PROJECTMAP, 'config.json');
  try {
    return JSON.parse(await readFile(bestand, 'utf-8'));
  } catch (error) {
    if (!pad && error.code === 'ENOENT') return {};
    throw new Error(`Configuratie ${bestand} kan niet gelezen worden: ${error.message}`);
  }
}

/** Accepteert ook "www.klant.nl": marketeers kopiëren adressen vaak zonder https://. */
export function normaliseerUrl(invoer) {
  const tekst = String(invoer).trim();
  const metSchema = /^https?:\/\//i.test(tekst) ? tekst : `https://${tekst}`;
  try {
    const url = new URL(metSchema);
    // Een hostnaam zonder punt (zoals "localhost" of een typfout) is geen website.
    const geldig = /^https?:$/.test(url.protocol) && /\.[a-z]{2,}$/i.test(url.hostname);
    return { ok: geldig, invoer: tekst, url: url.href };
  } catch {
    return { ok: false, invoer: tekst, url: null };
  }
}
