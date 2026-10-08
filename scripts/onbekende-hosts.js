/**
 * onbekende-hosts.js — welke externe hosts kent de bibliotheek nog niet?
 *
 *   npm run onbekend            alle rapporten in de uitvoermap
 *   npm run onbekend -- <map>   een andere map
 *
 * Leest alle JSON-rapporten en zet de externe hosts op een rij die
 * lib/trackers.js niet herkent, met op hoeveel sites ze voorkwamen. Zo groeit
 * de bibliotheek mee met wat er in de praktijk langskomt: een host die op vijf
 * sites opduikt, verdient een plek in trackers.js.
 *
 * De herkenning gebeurt opnieuw met de huidige trackers.js, dus een host die
 * sinds de scan is toegevoegd, staat er niet meer tussen.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laadConfig } from '../lib/config.js';
import { herkenTag } from '../lib/trackers.js';

const PROJECTMAP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_REGELS = 60;

/** Alle requests uit een rapport: vóór en ná consent, na herladen en na weigeren. */
function requestsVan(rapport) {
  const r = rapport.raw_data || {};
  return [
    ...(r.voor_consent?.requests || []),
    ...(r.na_consent?.requests || []),
    ...(r.na_herladen?.requests || []),
    ...(r.weigeren?.na_weigeren?.requests || []),
  ];
}

async function main() {
  const config = await laadConfig();
  const map = resolve(process.argv[2] || join(PROJECTMAP, config.output_map || 'output'));
  const bestanden = (await readdir(map).catch(() => [])).filter((naam) => naam.endsWith('.json'));
  if (!bestanden.length) {
    console.log(`Geen rapporten gevonden in ${map}.`);
    return;
  }

  const perHost = new Map();
  for (const naam of bestanden) {
    let rapport;
    try {
      rapport = JSON.parse(await readFile(join(map, naam), 'utf8'));
    } catch {
      continue; // geen geldig rapport
    }
    const site = rapport.eind_url || rapport.url || naam;
    for (const request of requestsVan(rapport)) {
      if (!request.is_extern || !request.host) continue;
      if (herkenTag(`${request.host}${request.pad || ''}`.toLowerCase())) continue;
      const host = perHost.get(request.host) || { host: request.host, requests: 0, sites: new Set(), soorten: new Set(), voorbeeld: request.url };
      host.requests += 1;
      host.sites.add(site);
      host.soorten.add(request.resource_type);
      perHost.set(request.host, host);
    }
  }

  const lijst = [...perHost.values()].sort((a, b) => b.sites.size - a.sites.size || b.requests - a.requests);
  console.log(`${lijst.length} onbekende externe host(s) in ${bestanden.length} rapport(en) uit ${map}\n`);
  console.log('sites  requests  host  (soorten)');
  for (const host of lijst.slice(0, MAX_REGELS)) {
    console.log(`${String(host.sites.size).padStart(5)}  ${String(host.requests).padStart(8)}  ${host.host}  (${[...host.soorten].join(', ')})`);
  }
  if (lijst.length > MAX_REGELS) console.log(`\n… en nog ${lijst.length - MAX_REGELS} met minder voorkomens.`);
  console.log('\nHerken je er een? Voeg hem toe aan TAGS in lib/trackers.js, met de bron erbij.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
