#!/usr/bin/env node
/**
 * consent-check: meet per website wat er vóór en ná cookie-consent gebeurt.
 *
 *   node scan.js                          alle URL's uit config.json
 *   node scan.js https://klant.nl [...]   alleen deze URL's (instellingen uit config.json)
 *   node scan.js --config pad.json        andere configuratie
 *   node scan.js --output map             andere uitvoermap
 *   node scan.js --headed                 browser zichtbaar, handig bij debuggen
 *
 * Per URL komt er één JSON-bestand in de uitvoermap. De exitcode is 1 zodra
 * één scan mislukt, zodat een pipeline of script dat ziet.
 */

import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { STANDAARD_WACHTTIJDEN, laadConfig, normaliseerUrl } from './lib/config.js';
import { maakPdf, pdfBestandsnaam, sluitPdfBrowser } from './lib/pdf.js';
import { bouwRapport, samenvatting, schrijfRapport } from './lib/report.js';
import { scanUrl } from './lib/scanner.js';
import { seconden } from './lib/util.js';

const HELP = `consent-check: meet per website wat er vóór en ná cookie-consent gebeurt.

Gebruik:
  node scan.js [opties] [url ...]

Opties:
  --config <pad>   configuratiebestand (standaard: config.json naast scan.js)
  --output <map>   uitvoermap voor de JSON-rapporten (standaard: output)
  --headed         browser zichtbaar laten draaien
  --pdf            ook een PDF-rapport schrijven, in de huisstijl van de site
  --geen-stealth   de browser zich als automation laten melden (voor vergelijken)
  -h, --help       deze uitleg

Zonder URL's op de commandoregel worden de URL's uit het configuratiebestand gescand.`;

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      config: { type: 'string' },
      output: { type: 'string' },
      headed: { type: 'boolean', default: false },
      pdf: { type: 'boolean', default: false },
      'geen-stealth': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const config = await laadConfig(values.config);
  const urls = (positionals.length ? positionals : config.urls || []).map(normaliseerUrl);
  const ongeldig = urls.filter((url) => !url.ok);
  if (ongeldig.length) {
    console.error(`Ongeldige URL('s): ${ongeldig.map((url) => url.invoer).join(', ')}`);
    return 2;
  }
  if (!urls.length) {
    console.error('Geen URL\'s om te scannen. Geef ze mee op de commandoregel of zet ze in config.json onder "urls".');
    return 2;
  }

  const instellingen = {
    headless: values.headed ? false : config.headless !== false,
    stealth: values['geen-stealth'] ? false : config.stealth !== false,
    wachttijden: { ...STANDAARD_WACHTTIJDEN, ...(config.wachttijden || {}) },
  };
  const pdfGewenst = values.pdf || config.pdf === true;
  const outputMap = resolve(values.output || config.output_map || 'output');

  console.log(`consent-check: ${urls.length} URL('s), browser ${instellingen.headless ? 'headless' : 'zichtbaar'}, rapporten in ${outputMap}`);

  let mislukt = 0;
  for (const { url } of urls) {
    console.log(`\n> ${url}`);
    const scan = await scanUrl(url, instellingen, (regel) => console.log(`  - ${regel}`));
    const rapport = bouwRapport(scan, instellingen);
    const pad = await schrijfRapport(rapport, outputMap);
    console.log(samenvatting(rapport));
    console.log(`  ${rapport.status === 'geslaagd' ? 'OK' : 'MISLUKT'} -> ${pad} (${seconden(scan.duur_ms)})`);

    if (pdfGewenst) {
      try {
        const bytes = await maakPdf(rapport);
        const pdfPad = join(outputMap, pdfBestandsnaam(rapport));
        await writeFile(pdfPad, bytes);
        console.log(`  PDF -> ${pdfPad} (${Math.round(bytes.length / 1024)} KB)`);
      } catch (error) {
        // Een mislukte PDF mag de scan niet ongeldig maken: de JSON staat er al.
        console.error(`  ! PDF maken mislukt: ${error.message}`);
      }
    }
    if (rapport.status !== 'geslaagd') mislukt += 1;
  }

  await sluitPdfBrowser();
  console.log(`\nKlaar: ${urls.length - mislukt} van ${urls.length} scan(s) geslaagd.`);
  return mislukt ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`Onverwachte fout: ${error.stack || error.message}`);
    process.exit(1);
  });
