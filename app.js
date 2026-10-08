/**
 * Consent-check — frontend
 *
 * Praat met /api/scan en zet de rapporten om in kaarten: per URL de scanmeta,
 * de CMP-informatie en de twaalf detectieregels als uitklapbare regels.
 *
 * De server stuurt NDJSON terug: één JSON-object per regel, zodat de log
 * meeloopt terwijl de scan draait (een scan duurt ongeveer een minuut per URL).
 *
 * Alle tekst uit een rapport komt via textContent in de DOM, nooit via
 * innerHTML: de inhoud komt van een vreemde website.
 */

const form = document.getElementById('scan-form');
const urlsField = document.getElementById('urls');
const urlsHint = document.getElementById('urls-hint');
const headedField = document.getElementById('headed');
const weigerenField = document.getElementById('weigeren');
const submitBtn = document.getElementById('submit-btn');
const submitLabel = document.getElementById('submit-label');
const submitSpinner = document.getElementById('submit-spinner');
const submitArrow = document.getElementById('submit-arrow');
const resetBtn = document.getElementById('reset-btn');
const duurHint = document.getElementById('duur-hint');
const resultCard = document.getElementById('result-card');
const resultScroll = document.getElementById('result-scroll');
const output = document.getElementById('result-output');
const actions = document.getElementById('result-actions');
const statusBadge = document.getElementById('status-badge');
const progressBar = document.getElementById('progress-bar');
const invoerKolom = document.getElementById('invoer-kolom');
const logCard = document.getElementById('log-card');
const logBox = document.getElementById('log');
const logToggle = document.getElementById('log-toggle');
const logKopieer = document.getElementById('log-kopieer');
const logTeller = document.getElementById('log-teller');
const backendMelding = document.getElementById('backend-melding');
const headedWaarschuwing = document.getElementById('headed-waarschuwing');

const EMPTY_STATE = output.innerHTML; // de lege staat staat in index.html en komt hier terug

const STORAGE = {
  draft: 'consent-check-draft',
  headed: 'consent-check-headed',
  weigeren: 'consent-check-weigeren',
  rapporten: 'consent-check-rapporten',
};

/** Zelfde herkenning als in scan.js, zodat de hint klopt met wat de server accepteert. */
const URL_PATTERN = /^(https?:\/\/\S+|([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?)$/i;

let rapporten = [];
let isLoading = false;
let timer = null;
let backendKlaar = false;

/**
 * Adressen van de API, relatief aan de pagina. Zo werkt de tool ook als hij
 * onder een submap wordt geserveerd in plaats van op de hoofdmap.
 */
function api(pad) {
  return new URL(pad, document.baseURI).href;
}

// --- Kleine DOM-helpers --------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function card(title, subtitle) {
  const wrapper = el('section', 'card');
  const head = el('div', 'card-head');
  const left = el('div', 'min-w-0');
  left.append(el('h3', 'card-title break-anywhere', title));
  if (subtitle) left.append(el('p', 'text-xs text-pm-muted mt-0.5 break-anywhere', subtitle));
  head.append(left);
  wrapper.append(head);
  return { wrapper, head };
}

const CLIPBOARD_ICON =
  '<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12"/><path d="M5 15H3V3h12v2"/></svg>';

/**
 * Kopieerknop met directe terugkoppeling: het icoon maakt plaats voor "gekopieerd"
 * en er verschijnt kort een tooltip boven de knop.
 */
function copyButton(getText, label = 'kopieer', className = 'btn btn-quiet btn-xs relative') {
  const button = el('button', className);
  button.type = 'button';
  button.innerHTML = CLIPBOARD_ICON;
  const text = el('span', null, label);
  button.append(text);

  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      showTooltip(button, 'Gekopieerd naar klembord');
      button.classList.add('is-done');
      text.textContent = 'gekopieerd';
      setTimeout(() => {
        button.classList.remove('is-done');
        text.textContent = label;
      }, 1800);
    } catch {
      showTooltip(button, 'Kopiëren geblokkeerd door de browser');
    }
  });

  return button;
}

function showTooltip(anchor, message) {
  anchor.querySelector('.tooltip')?.remove();
  const tip = el('span', 'tooltip', message);
  tip.setAttribute('role', 'status');
  anchor.append(tip);
  setTimeout(() => tip.remove(), 1800);
}

/**
 * PDF-knop: het volledige rapport in de huisstijl van Pure Minds, om door te
 * sturen. De hoofdactie van een rapport, dus magenta, net als in de andere
 * tools. De server rendert hem met Chromium, dus dat duurt een seconde; zolang
 * toont de knop dat er iets gebeurt.
 */
function pdfButton(rapport) {
  const button = el('button', 'btn btn-primary btn-xs relative');
  button.type = 'button';
  button.title = 'Volledig rapport als PDF in de huisstijl van Pure Minds, met alle details per regel';
  button.innerHTML =
    '<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/></svg>';
  const label = el('span', null, 'pdf');
  button.append(label);

  button.addEventListener('click', async () => {
    button.disabled = true;
    label.textContent = 'pdf maken…';
    try {
      let response;
      try {
        response = await fetch(api('api/pdf'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rapport),
        });
      } catch {
        // Zonder server geen Chromium, en dus geen PDF.
        throw new Error('PDF maken kan alleen als de server draait');
      }
      if (!response.ok) {
        let melding = `De server gaf een fout (HTTP ${response.status}).`;
        try { melding = (await response.json()).error || melding; } catch { /* geen JSON */ }
        throw new Error(melding);
      }
      const blob = await response.blob();
      const link = el('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${hostVan(rapport.eind_url || rapport.url)}-consent-check.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
      showTooltip(button, 'PDF gedownload');
    } catch (error) {
      showTooltip(button, error.message.slice(0, 80));
    } finally {
      button.disabled = false;
      label.textContent = 'pdf';
    }
  });

  return button;
}

function downloadButton(rapport) {
  const button = el('button', 'btn btn-quiet btn-xs');
  button.type = 'button';
  button.innerHTML =
    '<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>';
  button.append(el('span', null, 'download json'));
  button.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(rapport, null, 2)], { type: 'application/json' });
    const link = el('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${hostVan(rapport.eind_url || rapport.url)}-consent-check.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  return button;
}

function hostVan(url) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '') || 'scan';
  } catch {
    return 'scan';
  }
}

function getal(waarde) {
  return Number(waarde || 0).toLocaleString('nl-NL');
}

function seconden(ms) {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

// --- Formulier -----------------------------------------------------------------

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isLoading) return;

  const urls = leesUrls();
  if (urls.length === 0) {
    renderError({ message: 'Vul minstens één URL in.', code: 'geen_urls' });
    return;
  }

  rapporten = [];
  storageRemove(STORAGE.rapporten);
  setLoading(true, urls.length);
  showSkeleton();
  wisLog();
  resultScroll.scrollTop = 0;
  if (!isDesktop()) resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    await scan(urls, headedField.checked, weigerenField.checked);
    const mislukt = rapporten.filter((rapport) => rapport.status !== 'geslaagd').length;
    setStatus(mislukt ? 'error' : 'done', mislukt ? `${mislukt} van ${rapporten.length} mislukt` : 'Klaar');
    storageSet(STORAGE.rapporten, JSON.stringify(rapporten));
  } catch (error) {
    if (rapporten.length === 0) renderError(error);
    else {
      logRegel(error.message, 'fout');
      setStatus('error', 'Afgebroken');
    }
  } finally {
    setLoading(false);
  }
});

function leesUrls() {
  return urlsField.value
    .split(/[\r\n,;]+/)
    .map((regel) => regel.trim())
    .filter(Boolean);
}

/**
 * Stuurt de URL's naar de server en leest de NDJSON-stroom regel voor regel.
 * Elke regel is een gebeurtenis: start, log, rapport of fout.
 */
async function scan(urls, headed, weigeren) {
  let response;
  try {
    response = await fetch(api('api/scan'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, headed, weigeren }),
    });
  } catch {
    throw Object.assign(new Error('Geen verbinding met de scanner.'), { code: 'offline' });
  }

  if (!response.ok || !response.body) {
    let melding = `De server gaf een fout (HTTP ${response.status}).`;
    let code = 'server_fout';
    try {
      const payload = await response.json();
      melding = payload.error || melding;
      code = payload.code || code;
    } catch {
      // geen JSON in het antwoord: de standaardmelding volstaat
    }
    throw Object.assign(new Error(melding), { code });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // NDJSON: alles tot de laatste regelovergang is compleet, de rest is nog onderweg.
    const regels = buffer.split('\n');
    buffer = regels.pop() ?? '';
    for (const regel of regels) {
      if (regel.trim()) verwerk(JSON.parse(regel));
    }
  }
  if (buffer.trim()) verwerk(JSON.parse(buffer));
}

function verwerk(gebeurtenis) {
  switch (gebeurtenis.type) {
    case 'start':
      logRegel(gebeurtenis.url, 'url');
      setStatus('busy', `${gebeurtenis.nummer} van ${gebeurtenis.totaal}`);
      // Alleen zolang er nog geen rapport binnen is; daarna staan de kaarten er.
      if (rapporten.length === 0) toonBezig(gebeurtenis);
      break;
    case 'log':
      logRegel(gebeurtenis.melding, gebeurtenis.melding.startsWith('!') ? 'fout' : null);
      break;
    case 'rapport':
      rapporten.push(gebeurtenis.rapport);
      renderRapporten();
      break;
    case 'fout':
      logRegel(gebeurtenis.melding, 'fout');
      break;
    default:
      break;
  }
}

// --- Staat de scanner klaar? ------------------------------------------------------

/**
 * De interface is een gewone HTML-pagina en kan dus overal geopend worden: op
 * GitHub Pages, rechtstreeks vanaf schijf, of via de lokale server. Alleen in
 * dat laatste geval is er een scanner. Wat er moet gebeuren verschilt per
 * geval, dus dat zoeken we hier uit en zetten we bovenaan het scherm.
 */
async function controleerBackend() {
  if (location.protocol === 'file:') {
    toonBackendMelding({
      titel: 'Open de tool via de server, niet als bestand',
      uitleg: 'Je hebt index.html rechtstreeks geopend. De scan heeft een lokale server nodig die een echte browser start.',
      stappen: ['npm install', 'npm run browser', 'npm start'],
      slot: 'Ga daarna naar http://localhost:3000. Die pagina ziet er hetzelfde uit, maar kan wél scannen.',
    });
    return;
  }

  let data;
  try {
    const response = await fetch(api('api/health'), { cache: 'no-store' });
    data = await response.json();
  } catch {
    // Geen /api/health: dit is een statische kopie, of de server ligt eruit.
    const lokaal = ['localhost', '127.0.0.1'].includes(location.hostname);
    toonBackendMelding(lokaal
      ? {
        titel: 'De server draait niet',
        uitleg: 'Deze pagina staat nog in je browser, maar de server erachter is gestopt.',
        stappen: ['npm start'],
        slot: 'Draai dat in de map consent-check en ververs deze pagina.',
      }
      : {
        titel: 'Dit is een statische kopie: scannen kan hier niet',
        uitleg: 'Deze pagina wordt geserveerd als los bestand, bijvoorbeeld door GitHub Pages. '
          + 'Scannen kan daar niet: de tool start een echte browser en meet het netwerkverkeer, en dat draait op een computer, niet op een webpagina. '
          + 'De interface werkt verder gewoon; alleen de knop "start scan" doet hier niets.',
        stappen: ['git clone https://github.com/Jelger1/consent-check.git', 'cd consent-check', 'npm install', 'npm run browser', 'npm start'],
        slot: 'De laatste opdracht opent de tool op http://localhost:3000, met een werkende scanner.',
      });
    return;
  }

  if (!data.klaar) {
    // De server draait wel, maar mist Playwright of Chromium.
    toonBackendMelding({
      titel: 'De scanner is nog niet compleet',
      uitleg: data.melding,
      stappen: data.code === 'geen_playwright' ? ['npm install', 'npm run browser'] : ['npm run browser'],
      slot: 'Draai dat in de map consent-check. De server hoeft niet opnieuw op te starten.',
    });
    return;
  }

  backendKlaar = true;
  backendMelding.classList.add('hidden');
  submitBtn.disabled = false;
  updateFieldState(); // nu pas kan de duurschatting getoond worden
}

function toonBackendMelding({ titel, uitleg, stappen, slot }) {
  backendKlaar = false;
  const box = el('div', 'notice notice-warn card');
  box.append(el('p', 'notice-title', titel));
  box.append(el('p', 'mt-1 text-sm leading-6', uitleg));
  if (stappen?.length) {
    const code = el('pre', 'mt-2 bg-pm-ink text-[#cfe6f2] p-3 text-xs leading-6 overflow-x-auto');
    code.textContent = stappen.join('\n');
    box.append(code);
  }
  if (slot) box.append(el('p', 'mt-2 text-sm leading-6', slot));

  backendMelding.replaceChildren(box);
  backendMelding.classList.remove('hidden');
  // De knop uitzetten is eerlijker dan hem te laten klikken en falen.
  submitBtn.disabled = true;
  duurHint.textContent = 'Scannen kan pas als de scanner draait';
}

// --- Log -----------------------------------------------------------------------

let logRegels = [];

function wisLog() {
  logRegels = [];
  logBox.replaceChildren();
  logBox.classList.remove('hidden');
  logToggle.textContent = 'verberg';
  logTeller.classList.add('hidden');
  logCard.classList.remove('hidden');
  // Het venster staat onder het formulier; op een laptopscherm valt het anders
  // buiten beeld terwijl daar juist te zien is wat er gebeurt.
  logCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function logRegel(tekst, soort) {
  const tijd = new Date().toTimeString().slice(0, 8);
  logRegels.push(`${tijd}  ${tekst}`);

  const regel = el('div', `log-regel${soort ? ` is-${soort}` : ''}`);
  regel.append(el('span', 'log-tijd', tijd));
  regel.append(el('span', 'min-w-0 break-anywhere', tekst));

  // Alleen meescrollen als de lezer onderaan staat; anders houd je hem niet
  // meer tegen als hij zelf terugbladert in de log.
  const onderaan = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 40;
  logBox.append(regel);
  if (onderaan) logBox.scrollTop = logBox.scrollHeight;

  logTeller.textContent = `${logRegels.length} regels`;
  logTeller.classList.remove('hidden');
}

logToggle.addEventListener('click', () => {
  const verborgen = logBox.classList.toggle('hidden');
  logToggle.textContent = verborgen ? 'toon' : 'verberg';
});

logKopieer.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logRegels.join('\n'));
    showTooltip(logKopieer, 'Log gekopieerd');
  } catch {
    showTooltip(logKopieer, 'Kopiëren geblokkeerd door de browser');
  }
});

// --- Rapporten renderen ---------------------------------------------------------

function renderRapporten() {
  output.className = 'space-y-4';
  output.replaceChildren(...rapporten.map(rapportCard));

  actions.replaceChildren(
    copyButton(() => JSON.stringify(rapporten.length === 1 ? rapporten[0] : rapporten, null, 2), 'kopieer json', 'btn btn-outline btn-sm relative'),
    copyButton(() => rapporten.map(samenvattingMarkdown).join('\n\n---\n\n'), 'kopieer samenvatting', 'btn btn-quiet btn-sm relative'),
  );
}

function rapportCard(rapport) {
  const geslaagd = rapport.status === 'geslaagd';
  const consent = rapport.raw_data?.consent || null;
  // Geen banner is een gewoon resultaat: de scan is klaar, alleen zonder tweede meting.
  const zonderBanner = geslaagd && !!consent && !consent.gegeven;
  const { wrapper, head } = card(hostVan(rapport.eind_url || rapport.url), rapport.eind_url || rapport.url);

  const badge = el(
    'span',
    `pill ${geslaagd ? (zonderBanner ? 'pill-info' : 'pill-good') : 'pill-bad'}`,
    geslaagd ? (zonderBanner ? 'geen cookiebanner' : 'volledig gescand') : 'mislukt',
  );
  head.querySelector('div').append(el('div', 'mt-1.5 flex flex-wrap gap-1.5', null));
  const badges = head.querySelector('.mt-1\\.5');
  badges.append(badge, el('span', 'pill', seconden(rapport.duur_ms)));
  if (consent?.gegeven) badges.append(el('span', 'pill', `consent via ${methodeLabel(consent)}`));
  if (rapport.bestand) badges.append(el('span', 'pill', `opgeslagen: ${rapport.bestand}`));

  const acties = el('div', 'flex flex-wrap items-center gap-2');
  acties.append(pdfButton(rapport), downloadButton(rapport), copyButton(() => JSON.stringify(rapport, null, 2), 'json'));
  head.append(acties);

  const body = el('div', 'p-4 sm:p-5 space-y-4');

  if (!geslaagd && rapport.fout) {
    const box = el('div', 'notice notice-error');
    box.append(el('p', 'notice-title', `Gestopt bij stap "${rapport.fout.stap}"`));
    box.append(el('p', 'mt-1 text-sm leading-6', rapport.fout.melding));
    if (rapport.fout.geprobeerd?.length) {
      box.append(el('p', 'mt-2 text-xs font-bold uppercase tracking-wide text-pm-muted', 'Geprobeerd'));
      box.append(pillen(rapport.fout.geprobeerd.map((p) => `${p.cmp}: ${p.reden || p.methode || 'geen resultaat'}`)));
    }
    box.append(el('p', 'mt-2 text-xs leading-5 text-pm-muted',
      "Alles wat vóór deze stap gemeten is, staat hieronder en in de JSON. De tool kent de API's van CookieScript, Cookiebot, Usercentrics, Complianz, OneTrust en meer, en probeert anders de accept-knop."));
    body.append(box);
  }

  if (zonderBanner) {
    const box = el('div', 'notice');
    box.append(el('p', 'notice-title', consent.methode === 'geen_cmp' ? 'Geen cookiebanner aangetroffen' : 'CMP aanwezig, maar geen banner getoond'));
    box.append(el('p', 'mt-1 text-sm leading-6', consent.reden));
    box.append(el('p', 'mt-1 text-xs leading-5 text-pm-muted',
      'Er is daarom één meting. Alles hieronder gebeurt zonder dat een bezoeker iets kiest; een tweede meting "ná consent" is niet van toepassing.'));
    body.append(box);
  }

  if (consent?.gegeven) {
    const overgeslagen = (consent.geprobeerd || []).filter((p) => !p.gelukt && p.reden);
    if (overgeslagen.length) {
      const box = el('div', 'notice notice-warn');
      box.append(el('p', 'notice-title', `${overgeslagen.length === 1 ? 'Eén CMP' : `${overgeslagen.length} CMP's`} niet bediend`));
      box.append(pillen(overgeslagen.map((p) => `${p.cmp}: ${p.reden}`)));
      body.append(box);
    }
  }

  for (const waarschuwing of rapport.waarschuwingen || []) {
    const box = el('div', 'notice notice-warn');
    box.append(el('p', null, waarschuwing));
    body.append(box);
  }

  if (rapport.prioriteiten?.bepaald) body.append(prioriteitenBlok(rapport.prioriteiten));
  if (rapport.bevindingen) {
    body.append(tegels(rapport));
    body.append(bevindingenLijst(rapport));
  }

  wrapper.append(body);
  return wrapper;
}

// --- Waar actie nodig is ----------------------------------------------------------

const NIVEAU = {
  hoog: { label: 'eerst oplossen', pill: 'pill-bad', rand: '#b61b50' },
  middel: { label: 'nalopen', pill: 'pill-mid', rand: '#e0951f' },
  laag: { label: 'ter info', pill: 'pill', rand: '#9aa7b1' },
};

/**
 * De weging uit lib/prioriteit.js: wat moet er als eerste gebeuren? De
 * interface rekent hier niets; niveau, uitleg en bewijs komen uit het rapport.
 */
function prioriteitenBlok(p) {
  const blok = el('section', 'border border-pm-line bg-white');
  const kop = el('div', 'flex flex-wrap items-center justify-between gap-2 border-b border-pm-line px-4 py-3');
  kop.append(el('h4', 'text-sm font-bold', 'Waar actie nodig is'));
  const tellers = el('div', 'flex flex-wrap gap-1.5');
  for (const niveau of ['hoog', 'middel', 'laag']) {
    if (p.aantal[niveau]) tellers.append(el('span', `pill ${NIVEAU[niveau].pill}`, `${p.aantal[niveau]} ${NIVEAU[niveau].label}`));
  }
  kop.append(tellers);
  blok.append(kop);

  const lijst = el('div', 'px-4 py-3 space-y-2');
  for (const tekst of p.voorbehoud) lijst.append(el('p', 'notice notice-warn text-sm', tekst));
  if (!p.aantal.hoog && !p.aantal.middel) {
    lijst.append(el('p', 'text-sm', p.punten.length
      ? 'Geen punten met hoge of middelhoge prioriteit. Hieronder alleen wat ter informatie.'
      : 'Geen punten gevonden die om actie vragen.'));
  }
  for (const punt of p.punten) lijst.append(prioriteitPunt(punt));
  lijst.append(el('p', 'pt-1 text-xs text-pm-muted',
    'Weging volgens vaste regels van deze tool, op basis van de metingen hieronder. Geen juridisch advies: de context van de site kan de afweging veranderen.'));
  blok.append(lijst);
  return blok;
}

function prioriteitPunt(punt) {
  const details = el('details', 'border border-pm-line border-l-4');
  details.style.borderLeftColor = NIVEAU[punt.niveau].rand;
  details.open = punt.niveau === 'hoog';

  const summary = el('summary', 'flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2');
  summary.append(el('span', `pill ${NIVEAU[punt.niveau].pill}`, NIVEAU[punt.niveau].label));
  summary.append(el('span', 'text-sm font-semibold', punt.titel));
  details.append(summary);

  const body = el('div', 'space-y-1.5 px-3 pb-3 text-sm leading-6');
  body.append(el('p', null, punt.waarom));
  const actie = el('p');
  actie.append(el('strong', null, 'Wat te doen: '), document.createTextNode(punt.actie));
  body.append(actie);
  if (punt.bewijs.length) {
    const ul = el('ul', 'list-disc pl-5 text-xs text-pm-muted');
    for (const regel of punt.bewijs) ul.append(el('li', 'break-anywhere', regel));
    body.append(ul);
  }
  const voet = [punt.regels?.length ? `Zie regel ${punt.regels.join(', ')}.` : '', punt.bron || ''].filter(Boolean).join(' ');
  if (voet) body.append(el('p', 'text-xs text-pm-muted', voet));
  details.append(body);
  return details;
}

/** De drie cijfers die je als eerste wilt zien: cookies, trackers en identifiers vóór consent. */
function tegels(rapport) {
  const b = rapport.bevindingen;
  const ck = cookieTelling(b.cookies_voor_consent);
  const ex = b.externe_requests_voor_consent;
  const grid = el('div', 'grid gap-3 sm:grid-cols-3');
  grid.append(
    tegel(ck.label, ck.waarde, ck.onder, ck.toon),
    tegel('Tracking-hosts', ex.aantal_tracking_hosts, `van ${ex.aantal_hosts} extern`, hostToon(ex)),
    tegel('Identifiers', b.identifiers_in_payload_voor_consent.aantal_requests, 'requests', b.identifiers_in_payload_voor_consent.aantal_requests ? 'bad' : 'good'),
  );
  grid.append(el('p', 'sm:col-span-3 text-xs text-pm-muted -mt-1', 'Alle drie gemeten vóórdat er consent is gegeven.'));
  return grid;
}

/**
 * Wat de cookietegel toont. Alleen cookies die aan een bekende tracker zijn
 * toe te wijzen tellen als tracking; onbekende staan als "overig" ernaast en
 * kleuren hooguit oranje. Een rapport van vóór versie 1.4 kent die
 * uitsplitsing nog niet; dan blijft het oude totaal staan.
 */
function cookieTelling(r) {
  if (r.aantal_tracking === undefined) {
    return { label: 'Cookies', waarde: r.aantal, onder: `van ${r.aantal_totaal}`, toon: r.aantal ? 'bad' : 'good' };
  }
  return {
    label: 'Tracking-cookies',
    waarde: r.aantal_tracking,
    onder: r.aantal_overig ? `+ ${r.aantal_overig} overig` : `van ${r.aantal_totaal}`,
    toon: r.aantal_tracking ? 'bad' : r.aantal_overig ? 'mid' : 'good',
  };
}

/** Oranje in plaats van rood als élke tracking-host alleen cookieloze Consent Mode-pings (G100, asc=D) kreeg. */
function hostToon(r) {
  if (!r.aantal_tracking_hosts) return r.gevonden ? 'mid' : 'good';
  return r.aantal_tracking_hosts === r.aantal_tracking_hosts_alleen_geweigerd ? 'mid' : 'bad';
}

/** "Consent Mode G100 ×3: advertentie- en analyse-opslag geweigerd" per consentstatus van een host. */
function consentModeTekst(consentMode) {
  return (consentMode || []).map((c) => `Consent Mode ${c.code} ×${c.aantal}: ${c.betekenis}`).join(' · ');
}

const TONEN = {
  good: '#009670',
  mid: '#e0951f',
  bad: '#b61b50',
  none: '#9aa7b1',
};

function tegel(label, waarde, onder, toon) {
  const tile = el('div', 'score-tile');
  tile.style.borderLeftColor = TONEN[toon];
  tile.append(el('div', 'score-label', label));
  const value = el('div', 'score-value', getal(waarde));
  if (onder) value.append(el('small', null, ` ${onder}`));
  tile.append(value);
  return tile;
}

// --- De detectieregels ---------------------------------------------------------------

function bevindingenLijst(rapport) {
  const b = rapport.bevindingen;
  const cmp = rapport.cmp_info;
  const lijst = el('div');

  lijst.append(regel1(b), regel2(b), regel3(b), regel4(b, rapport), regel5(cmp), regel6(b), regel7(b), regel8(b));
  // Regels 9 tot en met 12 bestaan pas sinds versie 1.4; oudere rapporten hebben ze niet.
  if ('tracking_na_weigeren' in b) lijst.append(regel9(b), regel10(b), regel11(b), regel12(b));

  if (b.nieuwe_cookies_na_consent) lijst.append(naConsent(b));
  return lijst;
}

/**
 * Eén uitklapbare regel. `toon` kleurt het nummer: rood als er iets is
 * aangetroffen dat aandacht vraagt, groen als er niets gevonden is, grijs als
 * er niets te melden valt. De tool oordeelt niet; de kleur is een leeswijzer.
 */
function bevinding(nummer, titel, samenvatting, toon, inhoud) {
  const details = el('details', 'finding');
  details.dataset.tone = toon;

  const summary = el('summary');
  summary.append(el('span', 'finding-num hex', nummer));
  const tekst = el('div', 'min-w-0');
  tekst.append(el('p', 'finding-title', titel));
  tekst.append(el('p', 'finding-sub', samenvatting));
  summary.append(tekst);
  const chevron = el('span', 'finding-chevron');
  chevron.innerHTML =
    '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  summary.append(chevron);
  details.append(summary);

  const body = el('div', 'finding-body');
  const knopen = Array.isArray(inhoud) ? inhoud : [inhoud];
  for (const knoop of knopen) if (knoop) body.append(knoop);
  details.append(body);
  return details;
}

function regel1(b) {
  const r = b.cookies_voor_consent;
  const uitgesplitst = r.aantal_tracking !== undefined;
  const samenvatting = !r.gevonden
    ? 'Geen cookies vóór consent, afgezien van de cookie van de CMP zelf en functionele cookies op het eigen domein.'
    : uitgesplitst
      ? `${getal(r.aantal)} cookie(s) gezet vóór consent: ${getal(r.aantal_tracking)} van een bekende tracker, ${getal(r.aantal_onbekend)} onbekend${r.aantal_functioneel_extern ? `, ${getal(r.aantal_functioneel_extern)} functioneel bij een andere partij` : ''}. ${getal(r.aantal_third_party)} daarvan third-party.`
      : `${getal(r.aantal)} cookie(s) gezet vóór consent, waarvan ${getal(r.aantal_third_party)} third-party. Niet meegeteld: de cookie van de CMP zelf en functionele cookies op het eigen domein.`;

  const inhoud = [];
  if (uitgesplitst && r.aantal_onbekend) {
    inhoud.push(el('p', 'mb-2', 'Onbekend betekent: niet aan een tracker toe te wijzen en ook geen bekende functionele cookie. Dat is geen oordeel; controleer waarvoor de site hem gebruikt.'));
  }
  if (r.details.length) {
    inhoud.push(tabel(
      ['Cookie', 'Domein', 'Partij', 'Duur', 'Soort'],
      r.details.map((cookie) => [
        strak(cookie.naam),
        strak(cookie.domein),
        cookie.is_third_party ? 'third-party' : 'eigen domein',
        cookie.is_sessie ? 'sessie' : 'persistent',
        cookieSoort(cookie),
      ]),
    ));
  }
  if (r.uitgesloten.length) {
    inhoud.push(inklapbaar(`${r.uitgesloten.length} cookie(s) niet meegeteld`, [
      pillen(r.uitgesloten.map((cookie) => `${cookie.naam} · ${cookie.reden}`)),
    ]));
  }
  const toon = uitgesplitst ? (r.aantal_tracking ? 'bad' : r.gevonden ? 'mid' : 'good') : r.gevonden ? 'bad' : 'good';
  return bevinding(1, 'Cookies vóór consent', samenvatting, toon, inhoud);
}

/** "Meta Pixel" voor een tracker, de functie voor een functionele cookie, anders "onbekend". */
function cookieSoort(cookie) {
  if (cookie.classificatie === 'tracking') return stapel(cookie.tag_naam || leesbaar(cookie.tag), 'tracking');
  if (cookie.classificatie === 'functioneel') return stapel('functioneel', cookie.functie);
  return leesbaar(cookie.tag || cookie.classificatie);
}

function regel2(b) {
  const r = b.externe_requests_voor_consent;
  const alleenGeweigerd = r.aantal_tracking_hosts_alleen_geweigerd || 0;
  const samenvatting = r.gevonden
    ? `${getal(r.aantal_requests)} requests naar ${getal(r.aantal_hosts)} externe hosts, waarvan ${getal(r.aantal_tracking_hosts)} bekende trackers en ${getal(r.aantal_onbekende_hosts)} onbekend.${alleenGeweigerd ? ` ${getal(alleenGeweigerd)} tracking-host(s) kregen alleen cookieloze Consent Mode-pings (status geweigerd).` : ''}`
    : 'Geen requests naar hosts buiten het eigen domein.';

  const inhoud = [];
  if (r.consent_mode_hits?.aantal) {
    inhoud.push(el('p', 'mb-2', 'Google- en Microsoft-hits vertellen zelf hoe Consent Mode stond (gcs bij Google, asc bij Microsoft UET). G100 of asc=D betekent: opslag geweigerd, de hit gaat zonder cookies. Contact met het platform is er dan wél.'));
  }
  if (r.hosts.length) {
    inhoud.push(tabel(
      ['Host', 'Requests', 'Herkend als'],
      r.hosts.map((host) => [
        strak(host.host),
        getal(host.aantal),
        stapel(host.tag_naam || 'onbekend', [leesbaar(host.categorie), consentModeTekst(host.consent_mode)].filter(Boolean).join(' · ')),
      ]),
    ));
  }
  return bevinding(2, 'Externe requests vóór consent', samenvatting, hostToon(r), inhoud);
}

function regel3(b) {
  const r = b.identifiers_in_payload_voor_consent;
  const samenvatting = r.gevonden
    ? `${getal(r.aantal_requests)} request(s) sturen een identifier mee in de URL of de POST-body.`
    : 'Geen bekende identifiers in de payload vóór consent.';

  const inhoud = r.details.map((detail) => {
    const blok = el('div', 'border border-pm-line bg-white p-3 mb-2');
    const kop = el('div', 'flex flex-wrap items-center gap-1.5');
    kop.append(el('span', 'pill pill-info', detail.bekende_tag || 'onbekende host'));
    kop.append(el('span', 'pill', detail.host));
    kop.append(el('span', 'pill', `${detail.method} · ${Math.round(detail.tijd_ms / 100) / 10} s`));
    if (detail.consent_mode) kop.append(el('span', 'pill', `Consent Mode ${detail.consent_mode}`));
    blok.append(kop);
    const lijst = el('ul', 'mt-2 space-y-1');
    for (const identifier of detail.identifiers) {
      const item = el('li', 'flex flex-wrap items-baseline gap-x-2 text-[13px]');
      item.append(el('span', 'pill pill-bad', `${identifier.parameter}=${identifier.waarde}`));
      item.append(el('span', 'text-pm-muted text-xs', `${identifier.betekenis} (${identifier.bron})`));
      lijst.append(item);
    }
    blok.append(lijst);
    blok.append(el('p', 'mt-2 text-xs text-pm-muted break-anywhere', detail.url));
    return blok;
  });
  if (r.niet_meegeteld?.length) {
    inhoud.push(inklapbaar(`${r.niet_meegeteld.length} request(s) met een identifier niet meegeteld`, [
      el('p', 'mb-2 text-xs text-pm-muted', 'De eigen navigatie van de bezoeker, een algemene parameternaam buiten een bekende tracker, of een waarde uit de landings-URL die naar het eigen domein teruggaat.'),
      pillen(r.niet_meegeteld.map((n) => `${n.host} · ${n.identifiers.map((i) => i.parameter).join(', ')} · ${n.reden}`)),
    ]));
  }
  return bevinding(3, 'Identifiers in de payload vóór consent', samenvatting, r.gevonden ? 'bad' : 'good', inhoud);
}

function regel4(b, rapport) {
  const ontbrekend = b.ontbrekende_tags_na_consent;
  if (!ontbrekend) {
    const consent = rapport.raw_data?.consent;
    const zonderBanner = !!consent && !consent.gegeven;
    return bevinding(4, 'Tags ná consent',
      zonderBanner ? 'Niet van toepassing: er is geen cookiebanner, dus ook geen consent-stap.' : 'Niet gemeten: de scan is gestopt vóór meting 2.',
      'none', [
        el('p', null, zonderBanner
          ? 'Zonder banner kan een bezoeker niets accepteren of weigeren; wat hier vuurt, vuurt altijd. Zie regel 2, 3 en 7.'
          : 'Zonder consent is er geen tweede meting, dus valt niet te zeggen welke tags ná consent vuren.'),
      ]);
  }

  const samenvatting = ontbrekend.length
    ? `${ontbrekend.length} tag(s) doen ná consent geen enkel request: ${ontbrekend.map((tag) => tag.naam).join(', ')}.`
    : 'Alle aangetroffen tags doen ook ná consent requests.';

  const inhoud = [];
  if (ontbrekend.length) {
    inhoud.push(el('p', 'mb-2', 'Ná consent geen nieuw request binnen de meettijd. Dat kan betekenen dat de tag wordt tegengehouden, maar ook dat hij vóór consent al alles verstuurde of pas bij een volgende paginaweergave weer vuurt. Controleer deze handmatig.'));
    inhoud.push(pillen(ontbrekend.map((tag) => `${tag.naam} · ${leesbaar(tag.reden)}`), 'pill-mid'));
  }
  if (b.tag_status?.length) {
    inhoud.push(inklapbaar('Alle herkende tags, vóór en ná consent', [
      tabel(
        ['Tag', 'In HTML', 'In DOM', 'Requests vóór', 'Requests ná'],
        b.tag_status.map((tag) => [
          tag.naam,
          tag.in_html === null ? '?' : tag.in_html ? 'ja' : 'nee',
          tag.in_dom_voor_consent ? 'ja' : 'nee',
          getal(tag.requests_voor_consent),
          tag.requests_na_consent === null ? 'n.v.t.' : getal(tag.requests_na_consent),
        ]),
      ),
    ]));
  }
  return bevinding(4, 'Tags ná consent', samenvatting, ontbrekend.length ? 'mid' : 'good', inhoud);
}

function regel5(cmp) {
  const lp = cmp.laadpositie;
  if (!lp?.detected) {
    return bevinding(5, 'Laadpositie van de CMP',
      cmp.detected.length ? `Het laadscript van ${cmp.detected.join(', ')} is niet in de HTML of de DOM teruggevonden.` : 'Geen CMP op deze pagina aangetroffen.',
      'none', [
        el('p', null, cmp.detected.length
          ? 'De CMP is herkend aan zijn requests of globals, maar het script zelf niet; de laadpositie is daarom niet te bepalen.'
          : 'Zonder CMP is er geen laadpositie te meten.'),
      ]);
  }

  const via = { gtm: 'via Google Tag Manager geïnjecteerd', html: 'rechtstreeks in de HTML', niet_geladen: 'niet geladen' }[lp.geladen_via] || lp.geladen_via;
  const samenvatting = `${lp.naam}: in de ${lp.load_position || 'onbekende positie'}, ${lp.synchroon ? 'synchroon' : lp.attributes.join(' ') || 'zonder attributen'}, ${via}.`;

  const lijst = el('dl', 'kv');
  const rij = (label, waarde) => {
    lijst.append(el('dt', null, label), el('dd', null, waarde));
  };
  rij('CMP', lp.naam);
  rij('Positie', lp.load_position || 'onbekend');
  rij('Attributen', lp.attributes.join(', ') || 'geen');
  rij('Synchroon', lp.synchroon ? 'ja' : 'nee');
  rij('Via GTM geladen', lp.loaded_via_gtm === null ? 'onbekend' : lp.loaded_via_gtm ? 'ja' : 'nee');
  if (lp.initiator) rij('Gestart door', `${lp.initiator.type}${lp.initiator.url ? ` · ${lp.initiator.url}` : ''}`);
  if (lp.request) rij('Script geladen na', seconden(lp.request.tijd_ms));
  if (lp.geladen_event_na_ms !== null) rij('CMP klaar na', seconden(lp.geladen_event_na_ms));
  if (lp.banner_zichtbaar !== null) rij('Banner zichtbaar', lp.banner_zichtbaar ? 'ja' : 'nee');
  if (lp.versie) rij('Versie', lp.versie);
  if (lp.consent_mode_instelling) rij('Consent Mode', lp.consent_mode_instelling.enabledConsentMode ? 'aan' : 'uit');

  const inhoud = [lijst];
  const voor = lp.tracking_requests_tot_cmp_aangevraagd;
  if (voor?.aantal) {
    const box = el('div', 'notice notice-warn mt-3');
    box.append(el('p', 'notice-title', `${voor.aantal} tracking-request(s) waren al onderweg toen het CMP-script werd opgevraagd`));
    box.append(el('p', 'mt-1 text-sm', `Hosts: ${voor.hosts.join(', ')}.`));
    inhoud.push(box);
  }
  return bevinding(5, 'Laadpositie van de CMP', samenvatting, lp.loaded_via_gtm || voor?.aantal ? 'mid' : 'none', inhoud);
}

function regel6(b) {
  const r = b.meerdere_cmps_actief;
  const samenvatting = r.gevonden
    ? `${r.aantal_actief} CMP's draaien tegelijk op deze pagina.`
    : r.aantal_actief === 1
      ? 'Eén actieve CMP gevonden.'
      : 'Geen actieve CMP gevonden.';

  const inhoud = r.cmps.map((cmp) => {
    const blok = el('div', 'border border-pm-line bg-white p-3 mb-2');
    const kop = el('div', 'flex flex-wrap items-center gap-2');
    kop.append(el('span', 'text-sm font-bold', cmp.naam));
    kop.append(el('span', `pill ${cmp.actief ? 'pill-bad' : 'pill'}`, cmp.actief ? 'actief' : 'alleen in de HTML'));
    blok.append(kop);
    blok.append(pillen(cmp.signalen.map((signaal) => `${leesbaar(signaal.bron)}: ${signaal.detail}`)));
    return blok;
  });
  return bevinding(6, "Meerdere CMP's actief", samenvatting, r.gevonden ? 'bad' : 'good', inhoud);
}

function regel7(b) {
  const tags = b.niet_google_tags_gevonden;
  const vuurtVoor = tags.filter((tag) => tag.vuurt_voor_consent);
  const samenvatting = tags.length
    ? `${tags.length} niet-Google tag(s) gevonden${vuurtVoor.length ? `, waarvan er ${vuurtVoor.length} al vóór consent ${vuurtVoor.length === 1 ? 'vuurt' : 'vuren'}` : ''}.`
    : 'Geen niet-Google tags aangetroffen.';

  const inhoud = [];
  if (tags.length) {
    inhoud.push(el('p', 'mb-2', 'Deze tags vallen buiten Google Consent Mode. Heeft een tag geen eigen consent-API, of gebruikt de site die niet, dan moet de CMP hem tegenhouden of moet hij handmatig worden gegate.'));
    inhoud.push(tabel(
      ['Tag', 'Vóór consent', 'Ná consent', 'Gegate door CMP', 'Eigen consent-API'],
      tags.map((tag) => [
        stapel(tag.naam, leesbaar(tag.leverancier)),
        tag.vuurt_voor_consent ? 'vuurt' : 'stil',
        tag.vuurt_na_consent === null ? 'niet gemeten' : tag.vuurt_na_consent ? 'vuurt' : 'stil',
        tag.gated_via_cmp_attribuut ? 'ja' : 'nee',
        tag.consent_api || 'geen bekend',
      ]),
    ));
  }
  return bevinding(7, 'Niet-Google tags', samenvatting, vuurtVoor.length ? 'bad' : tags.length ? 'mid' : 'good', inhoud);
}

function regel8(b) {
  const r = b.js_gegenereerde_iframes;
  if (!r.bepaald) {
    return bevinding(8, 'JS-gegenereerde iframes', `Niet bepaald: ${r.reden}.`, 'none', []);
  }

  const samenvatting = r.gevonden
    ? `${getal(r.aantal)} iframe(s) staan wel in de DOM maar niet in de ruwe HTML (${getal(r.aantal_iframes_dom)} in de DOM, ${getal(r.aantal_iframes_html)} in de HTML).`
    : `Alle ${getal(r.aantal_iframes_dom)} iframes in de DOM staan ook in de ruwe HTML.`;

  const inhoud = [];
  if (r.gevonden) {
    inhoud.push(el('p', 'mb-2', 'Iframes die pas door JavaScript ontstaan, ontwijken vaak de autoblocking van een CMP.'));
    for (const frame of r.iframes) {
      const blok = el('div', 'border border-pm-line bg-white p-3 mb-2');
      const kop = el('div', 'flex flex-wrap items-center gap-1.5');
      kop.append(el('span', 'pill pill-mid', frame.tag_naam || 'onbekend'));
      if (frame.zichtbaar !== null) kop.append(el('span', 'pill', frame.zichtbaar ? `zichtbaar ${frame.breedte}×${frame.hoogte}` : 'onzichtbaar'));
      blok.append(kop);
      blok.append(el('p', 'mt-1.5 text-[13px] break-anywhere', frame.src || '(geen src)'));
      blok.append(el('p', 'mt-0.5 text-xs text-pm-muted', frame.reden));
      inhoud.push(blok);
    }
  }
  return bevinding(8, 'JS-gegenereerde iframes', samenvatting, r.gevonden ? 'mid' : 'good', inhoud);
}

function regel9(b) {
  const r = b.tracking_na_weigeren;
  if (!r) {
    return bevinding(9, 'Na weigeren', 'Niet gemeten: er was geen banner om te weigeren, of het weigeren-scenario stond uit.', 'none', []);
  }
  if (!r.bepaald) {
    return bevinding(9, 'Na weigeren', `Weigeren lukte niet automatisch: ${r.reden}`, 'mid', [
      el('p', null, 'Controleer handmatig of weigeren kan, en wat er daarna nog vuurt.'),
    ]);
  }
  const actief = r.tags.filter((t) => t.actief);
  const samenvatting = actief.length
    ? `${actief.length} tracker(s) blijven actief nadat in een aparte browser alles is geweigerd (ook na herladen): ${actief.map((t) => t.naam).join(', ')}.`
    : 'Na "alles weigeren" (ook na herladen) is geen enkele bekende tracker meer actief.';
  const inhoud = [el('p', 'mb-2', `Geweigerd via ${r.methode}. Pings met de status "geweigerd" en scriptdownloads staan erbij, maar tellen niet als actief.`)];
  if (r.tags.length) {
    inhoud.push(tabel(
      ['Tag', 'Hits', 'Consentstatus', 'Nieuw opgeslagen', 'Actief'],
      r.tags.map((t) => [
        t.naam,
        `${getal(t.hits)}${t.identifiers ? ` (${t.identifiers} met id)` : ''}`,
        Object.entries(t.consent_mode).map(([code, aantal]) => `${code} ×${aantal}`).join(', ') || 'geen',
        [...t.nieuwe_cookies, ...t.nieuwe_opslag].join(', ') || '—',
        t.actief ? 'ja' : 'nee',
      ]),
    ));
  }
  return bevinding(9, 'Na weigeren', samenvatting, actief.length ? 'bad' : 'good', inhoud);
}

function regel10(b) {
  const r = b.cookiebanner;
  if (!r || !r.gevonden) {
    return bevinding(10, 'De cookiebanner zelf', r?.fout ? `Niet bekeken: ${r.fout}` : 'Geen cookiebanner gezien om te bekijken.', 'none', []);
  }
  const delen = [
    r.accepteerknop ? `accepteren: "${r.accepteerknop.tekst}"` : 'geen accepteerknop herkend',
    r.weigerknop_eerste_laag ? `weigeren: "${r.weigerknop.tekst}"` : 'geen weigerknop in de eerste laag',
  ];
  if (r.vooraf_aangevinkt?.length) delen.push(`${r.vooraf_aangevinkt.length} vakje(s) vooraf aangevinkt`);
  if (r.intrekken) delen.push(r.intrekken.gevonden ? `later te wijzigen via ${r.intrekken.hoe}` : 'geen manier gevonden om de keuze later te wijzigen');
  const misleidend = r.accepteerknop?.officieel && r.accepteerknop_tekst_duidelijk === false;
  const toon = misleidend || (!r.weigerknop_eerste_laag && !r.instellingenknop) ? 'bad'
    : (!r.weigerknop_eerste_laag || r.vooraf_aangevinkt?.some((v) => v.zichtbaar) || (r.weiger_t_o_v_accepteer ?? 1) < 0.5 || r.intrekken?.gevonden === false) ? 'mid' : 'good';

  const lijst = el('dl', 'kv');
  const rij = (label, waarde) => lijst.append(el('dt', null, label), el('dd', null, waarde));
  if (r.cmp) rij('CMP', r.cmp);
  rij('Accepteerknop', r.accepteerknop ? `"${r.accepteerknop.tekst}"${r.accepteerknop.officieel ? ' (officiële knop van de CMP)' : ''}` : 'niet herkend');
  if (r.accepteerknop) rij('Zegt dat hij accepteert', r.accepteerknop_tekst_duidelijk ? 'ja' : 'nee');
  rij('Weigerknop in eerste laag', r.weigerknop_eerste_laag ? `ja, "${r.weigerknop.tekst}"` : 'nee');
  if (r.weiger_t_o_v_accepteer !== null) rij('Grootte weigeren t.o.v. accepteren', `${Math.round(r.weiger_t_o_v_accepteer * 100)}%`);
  rij('Knop naar instellingen', r.instellingenknop ? 'ja' : 'nee');
  rij('Vooraf aangevinkt', r.vooraf_aangevinkt?.length ? r.vooraf_aangevinkt.map((v) => `${v.label || '(zonder label)'}${v.zichtbaar ? '' : ' (in instellingen)'}`).join(', ') : 'niets');
  rij('Bedekt van het scherm', `${r.bedekking_procent}%${r.scroll_geblokkeerd ? ', scrollen geblokkeerd' : ''}`);
  if (r.intrekken) rij('Keuze later wijzigen', r.intrekken.gevonden ? r.intrekken.hoe : 'niet gevonden');

  const inhoud = [lijst];
  const zichtbaar = (r.knoppen || []).filter((k) => k.zichtbaar);
  if (zichtbaar.length) {
    inhoud.push(el('p', 'text-xs font-bold uppercase tracking-wide text-pm-muted mt-3 mb-1', 'Zichtbare knoppen'));
    inhoud.push(pillen(zichtbaar.map((k) => `${k.tekst} · ${k.soort}`)));
  }
  return bevinding(10, 'De cookiebanner zelf', `${delen.join('; ')}.`, toon, inhoud);
}

function regel11(b) {
  const r = b.opslag_voor_consent;
  if (!r) return bevinding(11, 'Opslag buiten cookies', 'Niet gemeten.', 'none', []);
  const samenvatting = r.aantal
    ? `${getal(r.aantal)} sleutel(s) in localStorage of sessionStorage vóór consent, waarvan ${getal(r.aantal_tracking)} van een bekende tracker${r.indexeddb?.length ? `; ${r.indexeddb.length} IndexedDB-database(s)` : ''}.`
    : 'Geen localStorage of sessionStorage gebruikt vóór consent.';
  const inhoud = [el('p', 'mb-2', 'De toestemmingsplicht geldt voor alle opslag op het apparaat, niet alleen voor cookies. Alleen sleutels, geen waarden.')];
  if (r.items.length) {
    inhoud.push(tabel(
      ['Sleutel', 'Soort', 'Herkend als', 'Geschreven door'],
      r.items.map((item) => [strak(item.sleutel), item.soort, item.tag_naam || leesbaar(item.classificatie), item.script ? hostVan(item.script) : '—']),
    ));
  }
  if (r.indexeddb?.length) inhoud.push(el('p', 'mt-2 text-xs text-pm-muted', `IndexedDB: ${r.indexeddb.join(', ')}`));
  return bevinding(11, 'Opslag buiten cookies', samenvatting, r.aantal_tracking ? 'bad' : 'good', inhoud);
}

function regel12(b) {
  const r = b.eigen_subdomeinen;
  if (!r) return bevinding(12, 'Eigen subdomeinen (CNAME)', 'Niet bepaald.', 'none', []);
  const herkend = r.items.filter((item) => item.herkend_als);
  const samenvatting = !r.items.length
    ? 'Geen eigen subdomeinen (naast de pagina zelf) die requests kregen.'
    : herkend.length
      ? `${herkend.length} eigen subdomein(en) leiden naar een trackingdienst of server-side tagging: ${herkend.map((item) => item.host).join(', ')}.`
      : `${r.items.length} eigen subdomein(en) gecontroleerd; geen wijst naar een bekende trackingdienst.`;
  const inhoud = r.items.length
    ? [tabel(
      ['Host', 'CNAME', 'Herkend als', 'Requests vóór consent'],
      r.items.map((item) => [strak(item.host), item.cname.join(' → ') || '—', item.herkend_als || 'niets bijzonders', getal(item.requests_voor_consent)]),
    )]
    : [];
  return bevinding(12, 'Eigen subdomeinen (CNAME)', samenvatting, herkend.length ? 'mid' : 'good', inhoud);
}

/** Geen detectieregel, maar wel het antwoord op "wat deed consent nu eigenlijk?". */
function naConsent(b) {
  const cookies = b.nieuwe_cookies_na_consent;
  const hosts = b.nieuwe_hosts_na_consent;
  const samenvatting = `${getal(cookies.length)} nieuwe cookie(s) en ${getal(hosts.length)} nieuwe host(s) na het accepteren.`;

  const inhoud = [];
  if (cookies.length) {
    inhoud.push(el('p', 'text-xs font-bold uppercase tracking-wide text-pm-muted mb-1', 'Nieuwe cookies'));
    inhoud.push(pillen(cookies.map((cookie) => `${cookie.naam} · ${cookie.domein}`)));
  }
  if (hosts.length) {
    inhoud.push(el('p', 'text-xs font-bold uppercase tracking-wide text-pm-muted mt-3 mb-1', 'Nieuwe hosts'));
    inhoud.push(pillen(hosts.map((host) => `${host.host}${host.tag_naam ? ` · ${host.tag_naam}` : ''}`)));
  }
  return bevinding('+', 'Wat consent veranderde', samenvatting, 'none', inhoud);
}

// --- Bouwstenen voor de details ---------------------------------------------------

/** "server_side_tagging" -> "server side tagging": sleutels uit de JSON leesbaar maken. */
function leesbaar(waarde) {
  return String(waarde || '').replace(/_/g, ' ');
}

/** Cel met één ondeelbaar woord (hostnaam, cookienaam): niet middenin afbreken. */
function strak(tekst) {
  return el('span', 'cel-strak', tekst);
}

/** Hoofdwaarde met een toelichting eronder, zodat een tabel een kolom minder nodig heeft. */
function stapel(hoofd, onder) {
  const wrapper = el('div');
  wrapper.append(el('span', null, hoofd));
  if (onder) wrapper.append(el('span', 'block text-xs text-pm-muted', onder));
  return wrapper;
}

function tabel(koppen, rijen) {
  const wrap = el('div', 'table-wrap bg-white border border-pm-line');
  const table = el('table', 'data-table');
  const thead = el('thead');
  const koprij = el('tr');
  for (const kop of koppen) koprij.append(el('th', null, kop));
  thead.append(koprij);
  table.append(thead);

  const tbody = el('tbody');
  rijen.forEach((cellen, index) => {
    const rij = el('tr');
    // Geen break-anywhere hier: cellen breken op spaties, en past een lange
    // hostnaam niet, dan schuift de tabel horizontaal. Dat leest beter dan
    // een woord dat middenin wordt afgekapt.
    for (const cel of cellen) {
      const td = el('td');
      if (cel instanceof Node) td.append(cel);
      else td.textContent = String(cel);
      rij.append(td);
    }
    tbody.append(rij);
  });
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

function pillen(teksten, klasse = '') {
  const lijst = el('div', 'flex flex-wrap gap-1.5');
  for (const tekst of teksten) lijst.append(el('span', `pill ${klasse}`.trim(), tekst));
  return lijst;
}

function inklapbaar(titel, kinderen) {
  const wrapper = el('details', 'mt-3 border-t border-pm-line pt-2');
  wrapper.append(el('summary', 'cursor-pointer text-[13px] font-semibold text-pm-blue hover:underline', titel));
  const body = el('div', 'pt-2');
  for (const kind of kinderen) body.append(kind);
  wrapper.append(body);
  return wrapper;
}

// --- Consent-omschrijving -----------------------------------------------------------

/** "Cookiebot-API", "CookieScript-knop" of de tekst van de knop bij tekstherkenning. */
function methodeLabel(consent) {
  const gelukt = (consent.geprobeerd || []).filter((p) => p.gelukt);
  if (!gelukt.length) return consent.methode || 'onbekend';
  return gelukt
    .map((p) => (p.methode === 'knop_tekstherkenning' ? `knop "${p.knop_tekst}"` : p.methode.endsWith('_api') ? `${p.cmp}-API` : `${p.cmp}-knop`))
    .join(' + ');
}

function consentLabel(rapport) {
  const consent = rapport.raw_data?.consent;
  if (!consent) return 'geen consent-stap (scan gestopt)';
  if (!consent.gegeven) {
    return consent.methode === 'geen_cmp'
      ? 'geen cookiebanner en geen CMP aangetroffen'
      : `CMP aanwezig (${(consent.cmps_aanwezig || []).join(', ') || 'onbekend'}), maar geen banner getoond`;
  }
  return `via ${methodeLabel(consent)}`;
}

// --- Samenvatting als markdown -----------------------------------------------------

function samenvattingMarkdown(rapport) {
  const b = rapport.bevindingen;
  const regels = [
    `# Consent-check: ${hostVan(rapport.eind_url || rapport.url)}`,
    '',
    `**URL:** ${rapport.eind_url || rapport.url}`,
    `**Gescand op:** ${new Date(rapport.gescand_op).toLocaleString('nl-NL')}`,
    `**Status:** ${rapport.status}${rapport.fout ? ` (gestopt bij "${rapport.fout.stap}": ${rapport.fout.melding})` : ''}`,
    '',
  ];

  if (!b) {
    regels.push('Geen bevindingen: de scan strandde vóór de eerste meting.');
    return regels.join('\n');
  }

  const vooraf = rapport.raw_data?.voor_consent?.consent_al_gegeven;
  if (vooraf?.gegeven) {
    regels.push(
      `> **Let op:** vóór meting 1 was er al consent gegeven (${vooraf.cmp}: ${vooraf.detail}).`,
      '> De cijfers onder "vóór consent" horen daardoor deels bij de situatie ná consent.',
      '',
    );
  }

  const cmp = rapport.cmp_info;
  regels.push(
    `**CMP's actief:** ${cmp.detected.length ? cmp.detected.join(', ') : 'geen'}`,
    `**Consent:** ${consentLabel(rapport)}`,
    `**Laadpositie ${cmp.laadpositie?.naam || 'CMP'}:** ${cmp.laadpositie?.detected ? `${cmp.load_position || '?'}, ${cmp.attributes.join(' ') || 'geen attributen'}, geladen via ${cmp.laadpositie.geladen_via}` : 'niet aangetroffen'}`,
    '',
    ...prioriteitenMarkdown(rapport.prioriteiten),
    '## Bevindingen',
    '',
    `1. **Cookies vóór consent:** ${b.cookies_voor_consent.gevonden ? 'ja' : 'nee'} — ${b.cookies_voor_consent.aantal} van ${b.cookies_voor_consent.aantal_totaal}${b.cookies_voor_consent.aantal_tracking !== undefined ? ` (${b.cookies_voor_consent.aantal_tracking} van een bekende tracker, ${b.cookies_voor_consent.aantal_onbekend} onbekend)` : ''}, waarvan ${b.cookies_voor_consent.aantal_third_party} third-party${b.cookies_voor_consent.details.length ? ` (${b.cookies_voor_consent.details.map((c) => c.naam).join(', ')})` : ''}`,
    `2. **Externe requests vóór consent:** ${b.externe_requests_voor_consent.gevonden ? 'ja' : 'nee'} — ${b.externe_requests_voor_consent.aantal_hosts} hosts, ${b.externe_requests_voor_consent.aantal_tracking_hosts} bekende trackers${b.externe_requests_voor_consent.aantal_tracking_hosts_alleen_geweigerd ? ` (waarvan ${b.externe_requests_voor_consent.aantal_tracking_hosts_alleen_geweigerd} alleen cookieloze Consent Mode-pings)` : ''}, ${b.externe_requests_voor_consent.aantal_onbekende_hosts} onbekend`,
    `3. **Identifiers in de payload vóór consent:** ${b.identifiers_in_payload_voor_consent.gevonden ? 'ja' : 'nee'} — ${b.identifiers_in_payload_voor_consent.aantal_requests} requests`,
    `4. **Tags zonder requests ná consent:** ${b.ontbrekende_tags_na_consent ? (b.ontbrekende_tags_na_consent.length ? b.ontbrekende_tags_na_consent.map((t) => t.naam).join(', ') : 'geen') : rapport.raw_data?.consent && !rapport.raw_data.consent.gegeven ? 'n.v.t. (geen cookiebanner)' : 'niet gemeten'}`,
    `5. **Laadpositie CMP:** ${cmp.laadpositie?.detected ? `${cmp.laadpositie.naam}: ${cmp.load_position}, ${cmp.attributes.join(' ')}, via ${cmp.laadpositie.geladen_via}` : 'n.v.t.'}`,
    `6. **Meerdere CMP's actief:** ${b.meerdere_cmps_actief.gevonden ? 'ja' : 'nee'} — ${b.meerdere_cmps_actief.aantal_actief} actief`,
    `7. **Niet-Google tags:** ${b.niet_google_tags_gevonden.length ? b.niet_google_tags_gevonden.map((t) => `${t.naam}${t.vuurt_voor_consent ? ' (vuurt vóór consent)' : ''}`).join(', ') : 'geen'}`,
    `8. **JS-gegenereerde iframes:** ${b.js_gegenereerde_iframes.bepaald ? (b.js_gegenereerde_iframes.gevonden ? `${b.js_gegenereerde_iframes.aantal} gevonden` : 'geen') : 'niet bepaald'}`,
    ...('tracking_na_weigeren' in b ? [
      `9. **Na weigeren:** ${!b.tracking_na_weigeren ? 'niet gemeten' : !b.tracking_na_weigeren.bepaald ? `weigeren niet gelukt (${b.tracking_na_weigeren.reden})` : b.tracking_na_weigeren.tags.filter((t) => t.actief).map((t) => t.naam).join(', ') || 'geen tracker meer actief'}`,
      `10. **De cookiebanner zelf:** ${b.cookiebanner?.gevonden ? `accepteren "${b.cookiebanner.accepteerknop?.tekst || '?'}", ${b.cookiebanner.weigerknop_eerste_laag ? `weigeren "${b.cookiebanner.weigerknop.tekst}"` : 'geen weigerknop in de eerste laag'}${b.cookiebanner.vooraf_aangevinkt?.length ? `, ${b.cookiebanner.vooraf_aangevinkt.length} vakje(s) vooraf aan` : ''}${b.cookiebanner.intrekken ? `, intrekken: ${b.cookiebanner.intrekken.gevonden ? b.cookiebanner.intrekken.hoe : 'niet gevonden'}` : ''}` : 'geen banner gezien'}`,
      `11. **Opslag buiten cookies:** ${b.opslag_voor_consent ? `${b.opslag_voor_consent.aantal} sleutel(s), ${b.opslag_voor_consent.aantal_tracking} van een tracker` : 'niet gemeten'}`,
      `12. **Eigen subdomeinen:** ${b.eigen_subdomeinen?.items?.filter((i) => i.herkend_als).map((i) => `${i.host} (${i.herkend_als})`).join(', ') || 'niets bijzonders'}`,
    ] : []),
  );

  if (b.nieuwe_cookies_na_consent) {
    regels.push(
      '',
      `**Ná consent:** ${b.nieuwe_cookies_na_consent.length} nieuwe cookies, ${b.nieuwe_hosts_na_consent.length} nieuwe hosts`,
    );
  }

  return regels.join('\n');
}

function prioriteitenMarkdown(p) {
  if (!p?.bepaald) return [];
  const regels = ['## Waar actie nodig is', ''];
  if (!p.punten.length) regels.push('Geen punten gevonden die om actie vragen.');
  for (const punt of p.punten) {
    regels.push(`- **[${NIVEAU[punt.niveau].label}] ${punt.titel}.** ${punt.waarom} *Wat te doen:* ${punt.actie}`);
    for (const bewijs of punt.bewijs) regels.push(`  - ${bewijs}`);
  }
  regels.push('', '_Weging volgens vaste regels van de tool; geen juridisch advies._', '');
  return regels;
}

// --- Staten ------------------------------------------------------------------------

function showEmpty() {
  output.className = '';
  output.innerHTML = EMPTY_STATE;
  actions.replaceChildren();
  progressBar.classList.add('hidden');
  setStatus(null);
}

function showSkeleton() {
  output.className = '';
  output.replaceChildren(document.getElementById('loading-state').content.cloneNode(true));
  actions.replaceChildren();
  progressBar.classList.remove('hidden');
  progressBar.setAttribute('data-indeterminate', '');
}

/** Zet boven het skelet welke URL nu aan de beurt is, zodat het wachten niet leeg is. */
function toonBezig({ url, nummer, totaal }) {
  const bestaand = document.getElementById('bezig-melding');
  if (bestaand) {
    bestaand.querySelector('[data-url]').textContent = url;
    bestaand.querySelector('[data-teller]').textContent = totaal > 1 ? `${nummer} van ${totaal}` : '';
    return;
  }

  const blok = el('div', 'notice mb-4');
  blok.id = 'bezig-melding';
  const kop = el('div', 'flex flex-wrap items-center gap-2');
  kop.append(el('span', 'pill pill-info', 'bezig met scannen'));
  const teller = el('span', 'pill', totaal > 1 ? `${nummer} van ${totaal}` : '');
  teller.dataset.teller = '';
  teller.classList.toggle('hidden', totaal <= 1);
  kop.append(teller);
  blok.append(kop);
  const adres = el('p', 'mt-1.5 text-sm font-bold break-anywhere', url);
  adres.dataset.url = '';
  blok.append(adres);
  blok.append(el('p', 'mt-0.5 text-xs text-pm-muted',
    'Meten vóór consent, accepteren, opnieuw meten en herladen; daarna in een tweede browser weigeren en meten. Links zie je regel voor regel wat er gebeurt.'));
  output.prepend(blok);
}

/** Foutmeldingen met een uitleg die past bij wat er misging. */
const FOUT_UITLEG = {
  geen_urls: 'Zet één URL per regel in het veld, bijvoorbeeld www.klant.nl.',
  offline: 'Draait de server nog? Start hem met `npm start` en ververs deze pagina.',
  ongeldige_url: 'Gebruik een volledig webadres, bijvoorbeeld www.klant.nl of https://www.klant.nl/contact.',
  bezet: 'Er draait al een scan. Wacht tot die klaar is.',
  server_fout: 'Kijk in het terminalvenster waar de server draait: daar staat de volledige fout.',
  geen_playwright: 'Draai `npm install` in de map consent-check.',
  geen_browser: 'Draai `npm run browser` in de map consent-check. Dat downloadt Chromium (ongeveer 150 MB).',
  te_veel_urls: 'Scan ze in kleinere groepen.',
};

function renderError(error) {
  output.className = '';
  const box = el('div', 'notice notice-error mx-auto max-w-2xl');
  box.append(el('p', 'notice-title', error.message));
  const uitleg = FOUT_UITLEG[error.code];
  if (uitleg) box.append(el('p', 'mt-1 text-sm leading-6 text-pm-muted', uitleg));
  output.replaceChildren(box);

  actions.replaceChildren();
  progressBar.classList.add('hidden');
  setStatus('error', 'Mislukt');
}

function isDesktop() {
  return window.matchMedia('(min-width: 1024px)').matches;
}

// --- UI-helpers ---------------------------------------------------------------------

function setLoading(loading, aantalUrls = 0) {
  isLoading = loading;
  submitBtn.disabled = loading || !backendKlaar;
  resetBtn.disabled = loading;
  urlsField.disabled = loading;
  headedField.disabled = loading;
  weigerenField.disabled = loading;
  submitSpinner.classList.toggle('hidden', !loading);
  submitArrow.classList.toggle('hidden', loading);

  clearInterval(timer);
  if (!loading) {
    submitLabel.textContent = 'start scan';
    progressBar.classList.add('hidden');
    return;
  }

  // Eerlijke voortgang: we weten niet hoe ver de scanner is, dus tonen we de
  // verstreken tijd naast een onbepaalde balk in plaats van een nepbalkje.
  const gestart = Date.now();
  const tick = () => {
    submitLabel.textContent = `scannen… ${duur(Date.now() - gestart)}`;
  };
  tick();
  timer = setInterval(tick, 1000);
  setStatus('busy', `0 van ${aantalUrls}`);
}

const STATUS_TONES = {
  busy: 'bg-pm-tint text-pm-blue',
  done: 'bg-[#e3f4ee] text-[#00704f]',
  error: 'bg-[#fbe8ee] text-[#9e1744]',
  saved: 'bg-[#eef2f5] text-pm-muted',
};

function setStatus(kind, text) {
  statusBadge.className = `px-2 py-0.5 text-xs font-semibold tabular-nums ${STATUS_TONES[kind] || ''}`;
  statusBadge.classList.toggle('hidden', !kind);
  statusBadge.textContent = text || '';
}

function duur(ms) {
  const totaal = Math.round(ms / 1000);
  return `${Math.floor(totaal / 60)}:${String(totaal % 60).padStart(2, '0')}`;
}

/** Vinkje per ingevuld veld, plus een hint over hoeveel URL's herkend zijn. */
function updateFieldState() {
  const urls = leesUrls();
  urlsField.closest('.field').classList.toggle('is-filled', urls.length > 0);
  headedField.closest('.field').classList.add('is-filled'); // instellingen zijn altijd geldig
  // De waarschuwing alleen tonen als er ook echt een venster opengaat.
  headedWaarschuwing.classList.toggle('hidden', !headedField.checked);

  const ongeldig = urls.filter((url) => !URL_PATTERN.test(url));
  if (urls.length === 0) {
    urlsHint.textContent = "Eén URL per regel. De tool scant ze één voor één.";
    urlsHint.className = 'field-hint';
  } else if (ongeldig.length) {
    urlsHint.textContent = `Dit lijkt geen geldige URL: ${ongeldig[0]}`;
    urlsHint.className = 'field-hint is-error';
  } else {
    urlsHint.textContent = `${urls.length} URL${urls.length === 1 ? '' : "'s"} herkend.`;
    urlsHint.className = 'field-hint is-ok';
  }

  // Zonder scanner staat daar de uitleg uit toonBackendMelding; die niet overschrijven.
  if (!backendKlaar) return;

  // Ruwe schatting op basis van de gemeten scanduur: ruim een halve minuut per
  // URL, plus ongeveer 25 seconden als het weigeren-scenario aan staat.
  const totaalSeconden = Math.max(urls.length, 1) * (weigerenField.checked ? 60 : 35);
  const minuten = Math.round(totaalSeconden / 60);
  duurHint.textContent = totaalSeconden < 60
    ? `Ongeveer ${totaalSeconden} seconden in totaal`
    : `Ongeveer ${minuten} ${minuten === 1 ? 'minuut' : 'minuten'} in totaal`;
}

form.addEventListener('input', () => {
  updateFieldState();
  storageSet(STORAGE.draft, urlsField.value);
  storageSet(STORAGE.headed, headedField.checked ? '1' : '');
  storageSet(STORAGE.weigeren, weigerenField.checked ? '1' : '0');
});

resetBtn.addEventListener('click', () => {
  if (rapporten.length && !confirm('Invoer én resultaten wissen?')) return;
  urlsField.value = '';
  headedField.checked = false;
  weigerenField.checked = true;
  rapporten = [];
  storageRemove(STORAGE.draft);
  storageRemove(STORAGE.rapporten);
  storageRemove(STORAGE.headed);
  storageRemove(STORAGE.weigeren);
  logRegels = [];
  logBox.replaceChildren();
  logTeller.classList.add('hidden');
  logCard.classList.add('hidden');
  showEmpty();
  updateFieldState();
});

// --- Opslag ---------------------------------------------------------------------------
// Invoer en de laatste rapporten overleven een refresh: een scan kost ongeveer een minuut per URL.

function storageGet(sleutel) {
  try { return localStorage.getItem(sleutel); } catch { return null; }
}

function storageSet(sleutel, waarde) {
  try { localStorage.setItem(sleutel, waarde); } catch { /* opslag vol of geblokkeerd */ }
}

function storageRemove(sleutel) {
  try { localStorage.removeItem(sleutel); } catch { /* geblokkeerd */ }
}

(function herstel() {
  urlsField.value = storageGet(STORAGE.draft) || '';
  headedField.checked = storageGet(STORAGE.headed) === '1';
  weigerenField.checked = storageGet(STORAGE.weigeren) !== '0';
  updateFieldState();
  controleerBackend();

  try {
    const bewaard = JSON.parse(storageGet(STORAGE.rapporten) || 'null');
    if (Array.isArray(bewaard) && bewaard.length) {
      rapporten = bewaard;
      renderRapporten();
      setStatus('saved', 'Vorige scan');
    }
  } catch { /* ongeldige opslag negeren */ }
})();
