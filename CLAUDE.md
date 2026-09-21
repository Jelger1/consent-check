# CLAUDE.md — Consent-check

Vaste instructieset voor dit project. Lees dit bestand voordat je code wijzigt.

> Dit project hergebruikt het designsysteem van de eerdere interne tools
> (SEO Content Gap Analyzer en Landingpage & Ads Optimizer): dezelfde
> `styles.css`-bouwstenen, dezelfde Tailwind-tokens, dezelfde toon.

---

## Wat de tool doet

Een lokale tool met Playwright (Chromium) die per URL het handmatige cookie- en
consentonderzoek automatiseert:

1. ruwe HTML ophalen met een gewone fetch (voor de iframe-vergelijking);
2. in een schone browsercontext navigeren en minimaal tien seconden wachten tot
   het netwerk rustig is;
3. **meting 1**: cookies, álle requests, iframes en scripts in de DOM,
   dataLayer, CMP-status;
4. **consent** geven via de API van de CMP, anders zijn officiële knop, anders
   tekstherkenning; geen banner betekent: klaar na meting 1;
5. opnieuw wachten, **meting 2**;
6. één JSON per URL met `raw_data`, `cmp_info` en `bevindingen` (de acht regels).

De JSON is voor een LLM die het rapport interpreteert. De interface toont
dezelfde feiten leesbaar. De tool velt geen oordeel.

---

## Architectuur

Geen framework, geen build-stap, geen dependencies buiten Playwright.
ES-modules (`"type": "module"`), Node 20+. De frontend is vanilla JS met
Tailwind via de Play CDN, net als de andere interne tools.

| Pad | Rol |
|---|---|
| `index.html` | De UI: formulier, logvenster, resultaatkaart, lege staat, skeleton-template. |
| `styles.css` | Designsysteem van pureminds.nl plus de toolspecifieke bevindingenregels. |
| `app.js` | Frontend: formulier, NDJSON-stroom lezen, de acht regels renderen, kopiëren en downloaden. |
| `start.cmd`, `start.sh`, `scripts/start.js` | Dubbelklik-start: controleren, installeren waar nodig, server starten. Gebruikt alleen ingebouwde Node-modules, want het draait ook vóór `npm install`. |
| `scripts/snelkoppeling.js` | Bureaubladicoon op Windows; maakt zelf een .ico uit `assets/favicon.png`. |
| `server/server.js` | Lokale server: statische UI-bestanden, `GET /api/health` en `POST /api/scan` (NDJSON). |
| `Dockerfile`, `render.yaml` | Draaien op een hostingplatform, met de officiële Playwright-image. |
| `scan.js` | CLI en de lus over de URL's. Exitcode 1 als één scan mislukt. |
| `lib/scanner.js` | De kernflow per URL. Vangt fouten per stap en bewaart wat al gemeten is. |
| `lib/browser.js` | Chromium, schone context, netwerk-tracker met fase, CDP-initiators, rustig-netwerk-wachter. |
| `lib/html.js` | Ruwe HTML: fetch met time-out, regex-ontleding van scripts/iframes, `<noscript>`, head/body. |
| `lib/snapshot.js` | `context.cookies()` en de DOM-snapshot die in de pagina draait. |
| `lib/cmp/consent.js` | De consent-stap: `paginaApi` met alle CMP-API's, de officiële knoppen, de tekstherkenning en de bevestiging. |
| `lib/stealth.js` | Browser starten zonder automation-signalen; `herkenBlokkade()` voor blokkade- en challenge-pagina's. |
| `lib/branding.js` | Kleur en logo van de gescande site, met WCAG-contrasttoets en logohelderheid. |
| `lib/pdf.js` | HTML-sjabloon + `page.pdf()`. Geen PDF-bibliotheek: Chromium staat er al. |
| `lib/cmp/laadpositie.js` | Regel 5: laadpositie van de belangrijkste CMP. |
| `lib/cmp/detect.js` | Regel 6: signaturen van alle CMP's; `consentAlGegeven()`; `kiesPrimaireCmp()`. |
| `lib/trackers.js` | Alle kennis: tags/hosts, identifier-parameters, cookie-classificatie. |
| `lib/analyse.js` | De acht regels; puur functies over de metingen. |
| `lib/report.js` | Rapportstructuur, bestandsnaam, console-samenvatting. |
| `lib/config.js` | Standaardwachttijden, `config.json`, URL-normalisatie. Gedeeld door CLI en server. |
| `lib/domain.js`, `lib/util.js` | Eigen domein versus extern, `fail(stap, melding)`, `kort()`. |

Regels voor de meetkant:

- **Meten filtert niets.** Elk request en elke cookie komt in `raw_data`. Labels
  (bekende tag, classificatie) worden toegevoegd, nooit gebruikt om weg te laten.
  Onbekende externe hosts zijn juist interessant.
- **"Bekend" staat op één plek:** `lib/trackers.js`. Nieuwe leverancier, nieuw
  cookie of nieuwe identifier-parameter? Daar toevoegen, nergens anders.
- **Consent in drie trappen, altijd bevestigd.** Eerst de officiële API van de
  CMP (in `paginaApi` in `lib/cmp/consent.js`), bevestigd bij diezelfde API.
  Dan de officiële accept-knop van die CMP, bevestigd doordat de banner
  verdwijnt of het consentcookie verschijnt. Als laatste de tekstherkenning
  (`ACCEPT_TEKSTEN`), alleen voor een knop in een element dat over cookies gaat,
  en in het rapport als zodanig gemarkeerd. Nieuwe CMP? Voeg hem toe aan
  `STRATEGIEEN` én aan `CMPS` in detect.js; bevestig de API-namen eerst in het
  echte script van die CMP.
- **Alleen een getoonde banner wordt bediend.** `getoond()` per CMP, of een
  zichtbare banner-selector. Een geladen CMP zonder banner staat als
  "overgeslagen" in `consent.geprobeerd`.
- **Geen banner is geen fout.** `geefConsent` geeft dan `gegeven: false` met
  `methode: 'geen_cmp'` of `'geen_banner'` terug; de scanner slaat meting 2 over
  en de status blijft "geslaagd". Alleen een banner die er wél is maar niet te
  accepteren valt, geeft `fout.stap: "consent"`, met wat er geprobeerd is.
- **`voorAccept` zet de fase om.** De scanner geeft een callback mee die
  `tracker.fase` op `na_consent` zet vlak vóór de eerste echte acceptatie; de
  inventarisatie ervoor telt dus nog als "vóór consent".
- **Alles wat tot een fout gemeten is, blijft bewaard.** Een rapport met
  `status: "mislukt"` bevat meting 1 en de CMP-analyse als die er waren.
- **Elke wachttijd heeft een bovengrens.** Fetch, navigatie, netwerk-rust,
  consent: allemaal met time-out uit `config.json`. Een site mag de tool nooit
  laten hangen.
- **Code die in de browser draait** (`domSnapshot`, `initScript`) mag niets van
  buiten de eigen functie refereren en moet JSON-serialiseerbaar teruggeven.
  Vang alles af: een rare site mag een meting niet laten crashen.
- **Fasering via `tracker.fase`.** Requests krijgen de fase op het moment van
  starten; de scanner zet de fase op `na_consent` vlak vóór de consent-aanroep.
- **Stealth dient de meting, niet de toegang.** Het doel van `lib/stealth.js` is
  dat tagmanagers en pixels zich normaal gedragen; anders meet de tool te weinig.
  Blokkades omzeilen is expliciet géén doel: `herkenBlokkade()` meldt ze.
  Raak alleen signalen aan die aantoonbaar afwijken. `navigator.webdriver` hoort
  `false` te zijn, niet `undefined`: de property bestaat in elke echte browser.
- **Zet nooit browser-eigen headers via `extraHTTPHeaders`.** `Sec-Fetch-*` en
  `Upgrade-Insecure-Requests` staan op de forbidden header list; Chrome weigert
  die requests dan met ERR_INVALID_ARGUMENT. Gemeten: 75 van de 119 requests
  mislukten en de CMP laadde niet.
- **Elke `page.evaluate` kan stuklopen op een navigatie.** Gebruik het patroon
  uit `api()` en `snapshotDom()`: één keer opnieuw proberen na
  `waitForLoadState`, daarna pas opgeven.
- **Eén browser-aanroep waar het kan.** De CMP-inventarisatie gebeurt in één
  `evaluate` (`actie: 'inventaris'`); losse aanroepen kostten tientallen
  heen-en-weertjes, precies terwijl de site nog laadt.
- **Meting 1 moet een nulmeting zijn.** Na meting 1 controleert de scanner met
  `consentAlGegeven()` of er al een keuze vastligt (iemand die in een zichtbaar
  venster klikt). Zo ja, dan komt er een waarschuwing in het rapport: de scan
  gaat door, maar de cijfers onder "vóór consent" horen dan deels bij de
  situatie erna. Lees die status uit de CMP-API, niet uit de cookies:
  CookieScript zet zijn cookie al bij het tonen van de banner, met
  `action: null` zolang er niets gekozen is.

Regels voor de interface en de server:

- **De interface toont, hij rekent niet.** Alle cijfers komen uit `bevindingen`;
  `app.js` telt niets zelf uit. Verandert een regel, dan verandert `lib/analyse.js`.
- **Alles via `textContent`, nooit `innerHTML`** voor inhoud uit een rapport:
  die komt van een vreemde website. `innerHTML` alleen voor vaste iconen.
- **De server serveert een allowlist** (`index.html`, `styles.css`, `app.js`,
  `assets/`). Voeg je een UI-bestand toe, zet het in die lijst; zo lekt er nooit
  een configuratie-, rapport- of broncodebestand.
- **De server luistert op 127.0.0.1.** De tool start een browser en bezoekt
  websites; dat hoort niemand anders op het netwerk te kunnen aanzwengelen.
- **Eén scan tegelijk** (`bezet`), anders vertekenen parallelle Chromiums de meting.
- **NDJSON, geen buffering.** De interface moet kunnen meelezen terwijl de scan
  loopt; elke gebeurtenis is één regel JSON.
- **Kleur is een leeswijzer, geen oordeel.** Het regelnummer kleurt naar
  "aangetroffen / niets gevonden". De tekst eromheen blijft feitelijk.
- **De pagina legt zelf uit wat er ontbreekt.** `index.html` is een gewoon
  bestand en kan overal geopend worden: op GitHub Pages, vanaf schijf, of via de
  server. Bij het laden vraagt `app.js` aan `GET /api/health` of de scanner
  klaarstaat; is die er niet, dan verschijnt een melding met de commando's die
  passen bij wáár de pagina geopend is, en gaat de knop uit. Nooit een klik
  laten mislukken met een HTTP-code als uitleg.
- **Playwright wordt pas geladen bij de eerste scan.** Daardoor start de server
  ook als `npm install` nog niet gedraaid heeft, en kan de interface dát juist
  melden. Importeer `lib/scanner.js` dus niet bovenaan `server/server.js`.
- **API-adressen zijn relatief** (`api('api/scan')`), zodat de tool ook werkt
  als hij onder een submap wordt geserveerd.

---

## Stijl en conventies

- **Taal: Nederlands**, in de interface, de code-commentaren, de console en de
  JSON-sleutels. De sleutels uit de projectopdracht (`raw_data`, `cmp_info`,
  `bevindingen`, `detected`, `load_position`, `attributes`, `loaded_via_gtm`)
  blijven zoals ze zijn; nieuwe sleutels in het Nederlands, snake_case.
- **Knoppen en labels in kleine letters** ("start scan", "kopieer json"), zoals
  op pureminds.nl. Koppen wél met hoofdletter.
- **Kleuren:** cyaan `#1ab9e2` voor accenten, magenta `#b61b50` voor de
  hoofdactie, groen `#009670` voor "niets gevonden", oranje `#e0951f` voor "loop
  na", inkt `#303030` voor tekst. De tokens staan in `styles.css` én in de
  `tailwind.config` bovenin `index.html`: wijzig je een kleur, wijzig hem op
  beide plekken.
- **Gebruik de bestaande klassen** uit `styles.css` voordat je nieuwe CSS
  schrijft. Toolspecifieke opmaak staat onderaan dat bestand.
- **Commentaar legt uit waarom**, niet wat. Bestandsheaders beschrijven de rol
  van de module en de keuzes erin.
- **Constanten bovenaan**, met toelichting bij elke waarde die het meetresultaat
  beïnvloedt (wachttijden, afkaplengtes).
- **Fouten via `fail(stap, melding)`** uit `lib/util.js`, met een Nederlandse
  melding die zegt wat er misging én wat er wel is gevonden. In de frontend
  hoort bij elke foutcode een uitleg in `FOUT_UITLEG`.
- Moderne vanilla JS, 2 spaties, enkele aanhalingstekens, puntkomma's.

---

## Grenzen

- **De API's zijn geverifieerd voor** CookieScript, Cookiebot, Usercentrics,
  Complianz, OneTrust, Didomi en CookieFirst (op de sites van de leveranciers
  zelf). Klaro en tarteaucitron staan erin op basis van hun documentatie en zijn
  nog niet tegen een echte site getest.
- **Een IP-blokkade is een grens, geen bug.** Bol.com blokkeert deze scanner op
  IP-adres via Akamai. Dat is geen fingerprint-probleem: alle browservarianten
  krijgen dezelfde 403 vóórdat er JavaScript draait. Bouw daar geen
  proxy-omweg omheen; de site zegt expliciet nee en biedt een Developer Guide.
- **De PDF is een Pure Minds-document.** De klantkleur is een accent, geen
  merkovername: het omslag draagt hun logo en kleur, de voettekst ons logo.
  Een merkkleur die op wit onder 4,5 contrast scoort, wordt donkerder gemaakt.
- **Geen scroll of interactie**: de meting is de landingssituatie.
- **Geen conclusies in de code.** Een bevinding is `gevonden: true/false` plus
  details; wat dat betekent, bepaalt de lezer. Voeg geen scores of oordelen toe.
- **Geen gevoelige data bewaren.** Cookiewaarden en POST-bodies worden afgekapt;
  de ruwe HTML wordt niet opgeslagen, alleen wat eruit is ontleed.
- De initiators uit het DevTools Protocol dekken alleen het hoofdframe en
  same-process iframes; voor out-of-process iframes zijn ze leeg.
