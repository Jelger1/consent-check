# CLAUDE.md — Consent-check

Vaste instructieset voor dit project. Lees dit bestand voordat je code wijzigt.

---

## Wat de tool doet

Een Node.js-script met Playwright (Chromium) dat per URL het handmatige
cookie- en consentonderzoek automatiseert:

1. ruwe HTML ophalen met een gewone fetch (voor de iframe-vergelijking);
2. in een schone browsercontext navigeren en minimaal tien seconden wachten tot
   het netwerk rustig is;
3. **meting 1**: cookies, álle requests, iframes en scripts in de DOM,
   dataLayer, CMP-status;
4. **consent** geven via `CookieScript.instance.acceptAllAction()`;
5. opnieuw wachten, **meting 2**;
6. één JSON per URL met `raw_data`, `cmp_info` en `bevindingen` (de acht regels).

De output is voor een LLM die het rapport interpreteert. De tool levert feiten,
geen oordeel, geen opgemaakte rapportage.

---

## Architectuur

Geen framework, geen build-stap, geen dependencies buiten Playwright.
ES-modules (`"type": "module"`), Node 20+.

| Pad | Rol |
|---|---|
| `scan.js` | CLI en de lus over de URL's. Exitcode 1 als één scan mislukt. |
| `lib/scanner.js` | De kernflow per URL. Vangt fouten per stap en bewaart wat al gemeten is. |
| `lib/browser.js` | Chromium, schone context, netwerk-tracker met fase, CDP-initiators, rustig-netwerk-wachter. |
| `lib/html.js` | Ruwe HTML: fetch met time-out, regex-ontleding van scripts/iframes, `<noscript>`, head/body. |
| `lib/snapshot.js` | `context.cookies()` en de DOM-snapshot die in de pagina draait. |
| `lib/cmp/cookiescript.js` | Regel 5 (laadpositie) en de consent-stap. |
| `lib/cmp/detect.js` | Regel 6: signaturen van alle CMP's. |
| `lib/trackers.js` | Alle kennis: tags/hosts, identifier-parameters, cookie-classificatie. |
| `lib/analyse.js` | De acht regels; puur functies over de metingen. |
| `lib/report.js` | Rapportstructuur, bestandsnaam, console-samenvatting. |
| `lib/domain.js`, `lib/util.js` | Eigen domein versus extern, `fail(stap, melding)`, `kort()`. |

Regels:

- **Meten filtert niets.** Elk request en elke cookie komt in `raw_data`. Labels
  (bekende tag, classificatie) worden toegevoegd, nooit gebruikt om weg te laten.
  Onbekende externe hosts zijn juist interessant.
- **"Bekend" staat op één plek:** `lib/trackers.js`. Nieuwe leverancier, nieuw
  cookie of nieuwe identifier-parameter? Daar toevoegen, nergens anders.
- **Consent faalt hard.** Geen CookieScript-API, of consent niet bevestigd
  (state én cookie), dan stopt de scan met `fout.stap: "consent"`. Nooit
  stilzwijgend doorgaan; nooit CSS-selectors op willekeurige knoppen. De enige
  toegestane terugvaloptie is de officiële knop `#cookiescript_accept`.
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

---

## Stijl en conventies

- **Taal: Nederlands**, in de code-commentaren, de console en de JSON-sleutels.
  De sleutels uit de projectopdracht (`raw_data`, `cmp_info`, `bevindingen`,
  `detected`, `load_position`, `attributes`, `loaded_via_gtm`) blijven zoals ze
  zijn; nieuwe sleutels in het Nederlands, snake_case.
- **Commentaar legt uit waarom**, niet wat. Bestandsheaders beschrijven de rol
  van de module en de keuzes erin.
- **Constanten bovenaan**, met toelichting bij elke waarde die het meetresultaat
  beïnvloedt (wachttijden, afkaplengtes).
- **Fouten via `fail(stap, melding)`** uit `lib/util.js`, met een Nederlandse
  melding die zegt wat er misging én wat er wel is gevonden.
- Moderne vanilla JS, 2 spaties, enkele aanhalingstekens, puntkomma's.

---

## Grenzen

- **Alleen CookieScript** in versie 1. Andere CMP's worden wel herkend (regel 6)
  maar niet bediend.
- **Geen scroll of interactie**: de meting is de landingssituatie.
- **Geen conclusies in de code.** Een bevinding is `gevonden: true/false` plus
  details; wat dat betekent, bepaalt de lezer. Voeg geen scores of oordelen toe.
- **Geen gevoelige data bewaren.** Cookiewaarden en POST-bodies worden afgekapt;
  de ruwe HTML wordt niet opgeslagen, alleen wat eruit is ontleed.
- De initiators uit het DevTools Protocol dekken alleen het hoofdframe en
  same-process iframes; voor out-of-process iframes zijn ze leeg.
