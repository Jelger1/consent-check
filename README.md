# Consent-check

Interne tool van Pure Minds. Je geeft één of meer URL's op; de tool bezoekt elke
site met een schone browser, meet wat er **vóór** consent gebeurt, accepteert de
cookies via de CookieScript-API en meet opnieuw wat er **ná** consent gebeurt.
Het resultaat is per URL één JSON-bestand met de ruwe metingen en de feiten uit
acht detectieregels. De tool oordeelt niet: een LLM (of een collega) leest de
JSON en trekt de conclusies.

## Wat de tool meet

```
ruwe HTML (fetch)  ──▶  iframes en scripts zoals de server ze stuurt
                                    │
Playwright/Chromium ──▶  navigeren, ≥ 10 s wachten tot het netwerk rustig is
                                    │
meting 1 (vóór consent)  cookies · alle requests · iframes en scripts in de DOM · dataLayer · CMP-status
                                    │
consent               CookieScript.instance.acceptAllAction()  ──  lukt dit niet, dan faalt de scan hier
                                    │
meting 2 (ná consent)    cookies · nieuwe requests · iframes en scripts in de DOM · dataLayer
                                    │
JSON                  raw_data (beide metingen) + cmp_info + bevindingen (de 8 regels)
```

Tijdens het meten wordt **niets weggefilterd**: elk request en elke cookie staat
in het rapport, ook van onbekende hosts. Bekende trackers (Google, Meta,
LinkedIn, Hotjar, TikTok, YouTube, Microsoft, ...) krijgen alleen een label.

## Starten

Vereist Node.js 20 of hoger.

```bash
npm install                      # Playwright
npm run browser                  # eenmalig: Chromium downloaden (~150 MB)
npm run scan                     # scant de URL's uit config.json
```

Andere manieren om te starten:

```bash
node scan.js https://www.klant.nl              # één of meer URL's, instellingen uit config.json
node scan.js --config klanten.json             # andere configuratie
node scan.js --output rapporten                # andere uitvoermap
node scan.js --headed https://www.klant.nl     # browser zichtbaar, handig bij debuggen
```

De exitcode is `1` zodra één scan mislukt. Een mislukte scan levert wél een
rapport op, met `status: "mislukt"`, de stap waarin het misging en alles wat tot
dan toe gemeten was.

## Configuratie

`config.json`:

| Sleutel | Standaard | Waarvoor |
|---|---|---|
| `urls` | `[]` | De te scannen URL's. `www.klant.nl` zonder `https://` mag ook. |
| `output_map` | `output` | Map voor de JSON-rapporten. |
| `headless` | `true` | `false` laat de browser zien. |
| `wachttijden.minimaal_voor_consent_ms` | `10000` | Minimale wachttijd na het laden, ook als het netwerk eerder rustig is. Vertraagde pixels krijgen zo hun kans. |
| `wachttijden.minimaal_na_consent_ms` | `8000` | Zelfde, na consent. |
| `wachttijden.maximaal_ms` | `30000` | Harde bovengrens per meting; een site met een eeuwige poll houdt de scan niet op. |
| `wachttijden.netwerk_rust_ms` | `2000` | Hoe lang het stil moet zijn om "rustig" te heten. |
| `wachttijden.navigatie_timeout_ms` | `45000` | Time-out voor het laden van de pagina. |
| `wachttijden.consent_timeout_ms` | `15000` | Hoe lang we op de CookieScript-API en de bevestiging wachten. |
| `wachttijden.html_timeout_ms` | `20000` | Time-out voor de ruwe HTML-fetch. |

## De acht detectieregels

| # | Sleutel in `bevindingen` | Wat er in staat |
|---|---|---|
| 1 | `cookies_voor_consent` | Cookies vóór consent, zonder de CMP-eigen cookies en bekende functionele sessiecookies. Onbekende cookies tellen wél mee. |
| 2 | `externe_requests_voor_consent` | Alle hosts buiten het eigen domein, met per host het aantal requests, de herkende tag en de initiator. Onbekende hosts (zoals `*.run.app`) staan er gewoon bij. |
| 3 | `identifiers_in_payload_voor_consent` | Requests waarvan de URL of POST-body een identifier bevat (`fbp`, `cid`, `gclid`, `sid`, gehashte e-mail, ...), ook als er geen cookie is gezet. |
| 4 | `ontbrekende_tags_na_consent` + `tag_status` | Per bekende tag: staat hij in HTML/DOM, vuurde hij vóór consent, vuurde hij ná consent, welke cookies horen erbij. Tags die ná consent geen enkel request doen, staan apart. |
| 5 | `cmp_info` | Hoe CookieScript is ingeladen: `load_position` (head/body), `attributes` (async, defer, type), `synchroon`, `loaded_via_gtm` (gemeten via de request-initiator), welke trackers al onderweg waren toen het CMP-script werd aangevraagd, gated scripts, Consent Mode-instellingen. |
| 6 | `meerdere_cmps_actief` | Alle herkende CMP's (CookieScript, Cookiebot, Complianz, OneTrust, CookieYes, ...) met de signalen waarop de herkenning rust en of ze echt actief zijn. |
| 7 | `niet_google_tags_gevonden` | Meta, LinkedIn, Hotjar, TikTok en andere niet-Google tags: waar gevonden, of ze vóór consent vuren en of ze via een CMP-attribuut gegate zijn. Deze tags kennen geen Consent Mode en vragen handmatige gating. |
| 8 | `js_gegenereerde_iframes` | Iframes in de gerenderde DOM die niet in de ruwe HTML staan (of alleen binnen `<noscript>`). Die ontwijken vaak de autoblocking van een CMP. |

Daarnaast: `nieuwe_cookies_na_consent`, `nieuwe_hosts_na_consent` en
`identifiers_in_payload_na_consent`, zodat de lezer ziet wat consent veranderde.

## Het rapport

```
{
  "url", "eind_url", "gescand_op", "duur_ms",
  "status": "geslaagd" | "mislukt",
  "fout": null | { "stap": "navigatie" | "consent" | ..., "melding": "..." },
  "waarschuwingen": [],
  "tool", "browser", "instellingen", "html",
  "raw_data": {
    "voor_consent": { "cookies", "requests", "iframes_html", "iframes_dom", "scripts_html", "scripts_dom",
                      "data_layer", "google_consent_signalen", "cmp_state", "events", "wachttijd" },
    "consent":      { "methode", "state_voor", "state_na", "cookie", "duur_ms" },
    "na_consent":   { "cookies", "requests", "iframes_dom", "scripts_dom", "data_layer", ... }
  },
  "cmp_info": { "detected", "load_position", "attributes", "loaded_via_gtm", "synchroon",
                "cookiescript": { ... }, "cmps": [ ... ], "google_consent_mode": { ... } },
  "bevindingen": { ... de acht regels ... }
}
```

Elke bevinding heeft een `gevonden`-vlag én de details waarop die rust. Alles in
`raw_data` is meting, alles in `bevindingen` is afgeleid. Per request staan de
fase, het tijdstip, host, pad, query-parameters, (afgekapte) POST-body, status,
de herkende tag en de initiator (parser of welk script het request startte).

Rapporten komen in `output/` en heten `<host>-<tijdstip>.json`.

## Bestanden

| Pad | Rol |
|---|---|
| `scan.js` | CLI: configuratie, de lus over de URL's, console-samenvatting, exitcode. |
| `lib/scanner.js` | De kernflow per URL: HTML, navigeren, meting 1, consent, meting 2. |
| `lib/browser.js` | Chromium starten, schone context, netwerk volgen, CDP-initiators, wachten op een rustig netwerk. |
| `lib/html.js` | Ruwe HTML ophalen en ontleden (scripts, iframes, `<noscript>`, head/body, resource hints). |
| `lib/snapshot.js` | Cookies uit de context en de DOM-snapshot (iframes, scripts, dataLayer, CMP-status, events). |
| `lib/cmp/cookiescript.js` | Laadpositie van CookieScript (regel 5) en consent geven via de CookieScript-API. |
| `lib/cmp/detect.js` | Herkenning van alle CMP's (regel 6). |
| `lib/trackers.js` | De kennis: bekende tags en hun hosts, identifier-parameters, cookie-classificatie. |
| `lib/analyse.js` | De acht regels, op basis van de metingen. |
| `lib/report.js` | Rapport samenstellen, wegschrijven, console-samenvatting. |
| `lib/domain.js`, `lib/util.js` | Domeinvergelijking (eigen domein versus extern), kleine helpers. |
| `config.json` | URL's en wachttijden. |
| `CLAUDE.md` | Vaste instructieset voor wie aan de code werkt. |

## Keuzes en grenzen

- **Alleen CookieScript** in deze versie. Op een site met een ander CMP stopt de
  scan bij de consent-stap met een duidelijke melding en de CMP's die wél zijn
  herkend; meting 1 en de CMP-analyse staan dan gewoon in het rapport.
- **Consent via de API**, niet via knoppen: `CookieScript.instance.acceptAllAction()`.
  Alleen als die aanroep een fout geeft, probeert de tool de officiële knop
  `#cookiescript_accept`. Daarna wordt de consent bevestigd op twee plekken
  (`currentState().action === "accept"` én het cookie `CookieScriptConsent`);
  anders faalt de scan. Er is geen stille doorgang zonder consent.
- **Third-party cookies staan aan** en de browser meldt zich als een gewone
  Chrome-bezoeker (zonder "Headless" in de user-agent), zodat de meting is wat
  een bezoeker krijgt. `browser.third_party_cookies_waargenomen` laat zien of er
  daadwerkelijk third-party cookies zijn aangekomen.
- **Geen scroll, geen klikken**: de meting is de landingssituatie. Tags die pas
  bij scrollen of interactie vuren, zie je niet.
- **Initiators** komen uit het DevTools Protocol van het hoofdframe. Voor requests
  uit iframes die in een eigen proces draaien (YouTube, Cookiebot) is de initiator
  leeg; de `iframe_url` per request laat wel zien uit welk frame ze komen.
- **Eigen domein** = hetzelfde registreerbare domein als de start- of eind-URL.
  `cdn.klant.nl` is dus niet extern; een server-side-tagging-subdomein ook niet,
  maar dat wordt apart gemarkeerd (`lijkt_server_side_tagging`).
- De **tag- en cookielijsten** in `lib/trackers.js` zijn de enige plek waar
  "bekend" is gedefinieerd. Mis je een leverancier, voeg hem daar toe.

## Validatie

Getest op de sites van Beweegkliniek Sittard en Rugcentrum Parkstad:

- **beweegklinieksittard.nl** scant volledig. CookieScript wordt daar via GTM
  geïnjecteerd (initiator `gtm.js`), naast een Cookiebot-script in de HTML: twee
  actieve CMP's. Meta Pixel en GA4 vuren vóór consent, met `fbp` en `cid` in
  de payload.
- **rugcentrumparkstad.nl** draait op het moment van schrijven alleen Cookiebot.
  De scan levert meting 1 en de CMP-analyse op en stopt dan met
  `fout.stap: "consent"`, precies zoals bedoeld. Zodra die site op CookieScript
  staat, scant hij volledig.
