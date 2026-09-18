/**
 * start.js — regelt alles wat er nodig is en start daarna de tool.
 *
 * Dit script draait achter `start.cmd` (dubbelklik op Windows) en achter
 * `npm run setup`. Het gebruikt alleen ingebouwde Node-modules, want het moet
 * ook werken vóórdat `npm install` heeft gedraaid.
 *
 * Wat het doet:
 *   1. kijkt of de afhankelijkheden er staan, en installeert ze anders;
 *   2. kijkt of Chromium gedownload is, en haalt hem anders op;
 *   3. start de server, die zelf de browser opent.
 *
 * Elke stap meldt in het Nederlands wat er gebeurt en hoe lang het ongeveer
 * duurt, zodat een venster dat even stilstaat niet op een vastloper lijkt.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECTMAP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function kop(tekst) {
  console.log(`\n${tekst}`);
}

/**
 * Draait een npm-opdracht en laat de uitvoer meelopen, zodat je de voortgang ziet.
 *
 * De hele opdracht gaat als één string naar de shell in plaats van als losse
 * argumenten: npm is op Windows een .cmd-bestand dat Node niet rechtstreeks kan
 * starten, en een argumentenlijst mét shell levert een waarschuwing op. De
 * opdrachten hieronder staan vast in de code, er komt geen invoer van buiten in.
 */
function draai(argumenten, omschrijving) {
  const resultaat = spawnSync(`${NPM} ${argumenten.join(' ')}`, {
    cwd: PROJECTMAP,
    stdio: 'inherit',
    shell: true,
  });

  if (resultaat.error || resultaat.status !== 0) {
    console.error(`\n  Mislukt: ${omschrijving}.`);
    console.error(`  Opdracht: npm ${argumenten.join(' ')}`);
    if (resultaat.error) console.error(`  Fout: ${resultaat.error.message}`);
    console.error('\n  Hierboven staat wat er misging. Lukt het niet, stuur die tekst door.');
    return false;
  }
  return true;
}

/** Staat Chromium klaar? Playwright weet zelf waar hij hem neerzet. */
async function chromiumAanwezig() {
  try {
    const { chromium } = await import('playwright');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

async function main() {
  console.log('Consent-check — alles klaarzetten en starten');
  console.log('='.repeat(46));

  if (!existsSync(join(PROJECTMAP, 'node_modules', 'playwright'))) {
    kop('1/3  Onderdelen installeren (eenmalig, ongeveer een halve minuut)...');
    if (!draai(['install', '--no-fund', '--no-audit'], 'de onderdelen installeren')) return 1;
  } else {
    kop('1/3  Onderdelen staan al klaar.');
  }

  if (!(await chromiumAanwezig())) {
    kop('2/3  Chromium downloaden (eenmalig, ongeveer 150 MB)...');
    if (!draai(['run', 'browser'], 'Chromium downloaden')) return 1;
  } else {
    kop('2/3  Chromium staat al klaar.');
  }

  kop('3/3  De tool starten. Je browser gaat zo vanzelf open.');
  console.log('     Laat dit venster openstaan zolang je de tool gebruikt.');
  console.log('     Sluiten (of Ctrl+C) stopt de tool.\n');

  // De server neemt dit venster over: zijn uitvoer is vanaf hier de uitvoer.
  const server = spawn(process.execPath, [join(PROJECTMAP, 'server', 'server.js')], {
    cwd: PROJECTMAP,
    stdio: 'inherit',
  });
  return new Promise((resolveExit) => server.on('exit', (code) => resolveExit(code ?? 0)));
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\nOnverwachte fout: ${error.stack || error.message}`);
    process.exit(1);
  });
