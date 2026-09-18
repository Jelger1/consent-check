/**
 * snelkoppeling.js — zet Consent-check als icoon op het bureaublad.
 *
 *   npm run snelkoppeling
 *
 * Daarna start je de tool met een dubbelklik op het bureaublad, in plaats van
 * eerst de projectmap op te zoeken. De snelkoppeling wijst naar start.cmd, dus
 * hij regelt nog steeds zelf de installatie als dat nodig is.
 *
 * Alleen Windows: op macOS zet je start.sh zelf in het Dock.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECTMAP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PNG = join(PROJECTMAP, 'assets', 'favicon.png');
const ICO = join(PROJECTMAP, 'assets', 'consent-check.ico');
const DOEL = join(PROJECTMAP, 'start.cmd');

/**
 * Maakt een .ico met de PNG er ongewijzigd in. Windows accepteert sinds Vista
 * een PNG binnen een ICO-container, dus we hoeven het plaatje niet om te zetten
 * en hebben geen bibliotheek nodig: alleen de 22 bytes kop eromheen.
 */
function maakIco(pngPad, icoPad) {
  const png = readFileSync(pngPad);
  const breedte = png.readUInt32BE(16);
  const hoogte = png.readUInt32BE(20);
  if (breedte > 256 || hoogte > 256) {
    throw new Error(`${pngPad} is ${breedte}x${hoogte}; een icoon mag maximaal 256x256 zijn.`);
  }

  const kop = Buffer.alloc(6);
  kop.writeUInt16LE(0, 0);      // gereserveerd
  kop.writeUInt16LE(1, 2);      // type 1 = icoon
  kop.writeUInt16LE(1, 4);      // aantal afbeeldingen

  const item = Buffer.alloc(16);
  item.writeUInt8(breedte === 256 ? 0 : breedte, 0);  // 0 betekent 256
  item.writeUInt8(hoogte === 256 ? 0 : hoogte, 1);
  item.writeUInt8(0, 2);        // kleuren in het palet (0 = geen palet)
  item.writeUInt8(0, 3);        // gereserveerd
  item.writeUInt16LE(1, 4);     // kleurvlakken
  item.writeUInt16LE(32, 6);    // bits per pixel
  item.writeUInt32LE(png.length, 8);
  item.writeUInt32LE(22, 12);   // de afbeelding begint na kop (6) + item (16)

  writeFileSync(icoPad, Buffer.concat([kop, item, png]));
}

function main() {
  if (process.platform !== 'win32') {
    console.log('Deze snelkoppeling is voor Windows. Op macOS sleep je start.sh naar je Dock.');
    return 0;
  }

  if (!existsSync(DOEL)) {
    console.error(`start.cmd niet gevonden in ${PROJECTMAP}.`);
    return 1;
  }

  try {
    maakIco(PNG, ICO);
  } catch (error) {
    // Zonder eigen icoon werkt de snelkoppeling nog steeds, hij ziet er alleen anders uit.
    console.warn(`Icoon maken mislukt (${error.message}); de snelkoppeling krijgt het standaardicoon.`);
  }

  // PowerShell maakt de snelkoppeling; een .lnk is een binair formaat dat we
  // niet zelf willen schrijven.
  const script = [
    '$bureaublad = [Environment]::GetFolderPath("Desktop")',
    '$pad = Join-Path $bureaublad "Consent-check.lnk"',
    '$shell = New-Object -ComObject WScript.Shell',
    '$link = $shell.CreateShortcut($pad)',
    `$link.TargetPath = "${DOEL}"`,
    `$link.WorkingDirectory = "${PROJECTMAP}"`,
    '$link.Description = "Consent-check: meet cookies en trackers voor en na consent"',
    existsSync(ICO) ? `$link.IconLocation = "${ICO}"` : '',
    '$link.Save()',
    'Write-Output $pad',
  ].filter(Boolean).join('; ');

  const resultaat = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf-8' });
  if (resultaat.status !== 0) {
    console.error('Snelkoppeling maken mislukt:');
    console.error(resultaat.stderr || resultaat.error?.message || 'onbekende fout');
    return 1;
  }

  console.log(`Snelkoppeling gezet: ${resultaat.stdout.trim()}`);
  console.log('Dubbelklik die voortaan om de tool te starten.');
  return 0;
}

process.exit(main());
