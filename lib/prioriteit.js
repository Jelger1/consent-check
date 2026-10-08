/**
 * Prioriteiten: waar moet de klant als eerste iets aan doen?
 *
 * De bevindingen (lib/analyse.js) zijn feiten en blijven dat. Deze module legt
 * er een tweede laag overheen: een vaste, uitlegbare weging in drie niveaus.
 *
 *   hoog    eerst oplossen: tracking waarvoor vrijwel altijd toestemming nodig
 *           is, gebeurt al vóórdat de bezoeker iets koos;
 *   middel  nalopen: kan in orde zijn, afhankelijk van de instellingen, of is
 *           juridisch omstreden;
 *   laag    ter info: geen privacyrisico van betekenis, wel handig om te weten.
 *
 * WAAROM HIER EN NIET IN DE BEVINDINGEN
 * Een LLM die de JSON leest, moet de ruwe feiten zien zonder dat een oordeel
 * ze kleurt. Een mens die de PDF leest, wil weten waar hij moet beginnen. Beide
 * krijgen wat ze nodig hebben; de weging staat op één plek en is na te lezen.
 *
 * GEEN JURIDISCH OORDEEL
 * "Hoog" betekent: hiervoor is in de regel toestemming nodig en die ontbrak op
 * het moment van meten. Of het in deze situatie een overtreding is, hangt af
 * van de context. Teksten zeggen daarom "in de regel" en noemen hun bron.
 */

import { tagPerId } from './trackers.js';

/** Categorieën uit lib/trackers.js waarvoor vrijwel altijd toestemming nodig is. */
const MARKETING = new Set(['advertising', 'marketing_automation', 'b2b_tracking']);

/** Categorieën die afhankelijk van de instellingen wel of niet toestemming vragen. */
const INGESLOTEN = new Set(['embed', 'chat']);

const BRONNEN = {
  telecomwet: 'Telecommunicatiewet art. 11.7a: toestemming voor het plaatsen of uitlezen van gegevens op het apparaat, behalve voor functionele cookies en analytische cookies met geen of geringe gevolgen voor de privacy.',
  edpb: 'EDPB-richtsnoeren 2/2023 over art. 5 lid 3 ePrivacy: ook pixels, URL-tracking en verzoeken zonder cookie vallen onder de toestemmingsplicht.',
  ap_analytics: 'Autoriteit Persoonsgegevens: analytische cookies zijn alleen vrijgesteld als ze privacyvriendelijk zijn ingesteld (o.a. IP-adres afgeschermd, geen gegevens delen met de leverancier).',
  banner: 'EDPB Cookie Banner Taskforce (rapport januari 2023) en de Autoriteit Persoonsgegevens: weigeren moet even makkelijk zijn als accepteren, in de eerste laag, zonder vooraf aangevinkte vakjes en zonder misleidende knoppen.',
  intrekken: 'AVG art. 7 lid 3: toestemming intrekken moet even eenvoudig zijn als toestemming geven.',
  consent_mode: 'Consent Mode van Google en Microsoft: elke hit meldt zelf de status. Bij Google betekent gcs=G100 alles geweigerd en G111 alles toegestaan; bij Microsoft UET betekent asc=D geweigerd en asc=G toegestaan.',
};

const NIVEAUS = ['hoog', 'middel', 'laag'];

/** Consentcodes uit lib/trackers.js (consentModeVanHit): alles geweigerd, of advertentie-opslag toegestaan. */
const GEWEIGERD = new Set(['G100', 'asc=D']);
const ADVERTENTIE_TOEGESTAAN = new Set(['G110', 'G111', 'asc=G']);

/**
 * Bepaalt de prioriteiten. Geeft altijd een object terug; `bepaald: false` als
 * er niets zinnigs over te zeggen valt (blokkade, geen meting).
 */
export function bepaalPrioriteiten({ bevindingen: b, cmpInfo, consent, fout, blokkade, consentAlGegeven }) {
  if (blokkade?.geblokkeerd) {
    return leeg('De site serveerde een blokkadepagina; de meting gaat niet over de echte site.');
  }
  if (!b) return leeg('Er is geen meting vóór consent.');

  const voorbehoud = [];
  if (consentAlGegeven?.gegeven) {
    voorbehoud.push('Vóór de eerste meting was er al een keuze gemaakt; de cijfers "vóór consent" zijn daardoor niet zuiver en de prioriteiten kunnen te hoog uitvallen.');
  }

  const punten = [];
  const tags = activiteitPerTag(b);
  const marketing = tags.filter((t) => MARKETING.has(t.categorie) && t.actief);
  const opnames = tags.filter((t) => t.sessie_opname && t.actief);
  const analytics = tags.filter((t) => t.categorie === 'analytics' && !t.sessie_opname && t.actief);
  const ingesloten = tags.filter((t) => INGESLOTEN.has(t.categorie) && t.actief);
  const alleenPings = tags.filter((t) => t.alleen_g100);
  const sst = tags.filter((t) => t.categorie === 'server_side_tagging' && t.actief);
  const alleenGeladen = tags.filter((t) => t.alleen_scripts);
  const geenBanner = consent && !consent.gegeven && consent.methode === 'geen_cmp';

  // --- Hoog ---------------------------------------------------------------------------

  if (geenBanner && (marketing.length || opnames.length)) {
    punten.push({
      niveau: 'hoog',
      code: 'geen_banner_wel_tracking',
      titel: 'Geen cookiebanner, wel trackers',
      waarom: 'De site vraagt nergens om toestemming, maar er draaien wel advertentie- of opnametools. Een bezoeker kan dus nooit weigeren.',
      actie: 'Plaats een cookiebanner (CMP) die deze tags tegenhoudt tot er toestemming is, of verwijder de tags.',
      bron: BRONNEN.telecomwet,
      bewijs: [...marketing, ...opnames].map(beschrijf),
      regels: [2, 6],
    });
  }

  if (marketing.length) {
    punten.push({
      niveau: 'hoog',
      code: 'marketing_voor_consent',
      titel: 'Advertentie- en marketingtrackers actief vóór consent',
      waarom: 'Deze tags meten bezoekers voor advertentieplatforms of marketingsystemen. Daarvoor is in de regel altijd toestemming nodig, en die was er op dit moment nog niet.',
      actie: 'Laat deze tags pas vuren na toestemming: blokkeer ze in de CMP (autoblocking of de juiste categorie) of geef ze in Google Tag Manager een consent-trigger.',
      bron: `${BRONNEN.telecomwet} ${BRONNEN.edpb}`,
      bewijs: marketing.map(beschrijf),
      regels: [1, 2, 3, 7],
    });
  }

  if (opnames.length) {
    punten.push({
      niveau: 'hoog',
      code: 'sessie_opname_voor_consent',
      titel: 'Sessie-opnames of heatmaps vóór consent',
      waarom: 'Deze tools leggen klikken, scrollen en muisbewegingen vast. Dat gaat verder dan bezoekers tellen en valt in de regel niet onder de uitzondering voor analytische cookies.',
      actie: 'Laad deze tools pas na toestemming, of gebruik hun eigen consent-instelling als die er is.',
      bron: `${BRONNEN.telecomwet} ${BRONNEN.ap_analytics}`,
      bewijs: opnames.map(beschrijf),
      regels: [1, 2, 7],
    });
  }

  // Over alle tags samen, ook hits via een eigen subdomein (server-side tagging).
  const status = {};
  for (const s of b.tag_status || []) {
    for (const [code, aantal] of Object.entries(s.consent_mode_voor_consent || {})) status[code] = (status[code] || 0) + aantal;
  }
  const toegestaan = Object.entries(status).filter(([code]) => !GEWEIGERD.has(code));
  if (toegestaan.length) {
    const adToegestaan = toegestaan.some(([code]) => ADVERTENTIE_TOEGESTAAN.has(code));
    punten.push({
      niveau: adToegestaan ? 'hoog' : 'middel',
      code: 'consent_mode_vooraf_toegestaan',
      titel: 'Consent Mode staat vóór consent al op "toegestaan"',
      waarom: 'De hits van Google of Microsoft melden zelf dat opslag is toegestaan, terwijl de bezoeker nog niets koos. Het platform gaat dan uit van toestemming en zet cookies.',
      actie: "Zet de Consent Mode-standaard op 'denied' voordat de tags laden (in de CMP-integratie of via de consent-initialisatie in Google Tag Manager; voor Microsoft via uetq.push('consent', 'default', ...)), en laat de CMP pas na toestemming een update sturen.",
      bron: BRONNEN.consent_mode,
      bewijs: toegestaan.map(([code, aantal]) => `${aantal} hit(s) met ${code.startsWith('asc') ? `${code} (Microsoft)` : `gcs=${code} (Google)`}`),
      regels: [2],
    });
  }

  // --- Na weigeren ------------------------------------------------------------------

  const weigeren = b.tracking_na_weigeren;
  if (weigeren?.bepaald) {
    const actief = weigeren.tags.filter((t) => t.actief);
    const zwaar = actief.filter((t) => MARKETING.has(t.categorie) || t.sessie_opname);
    const licht = actief.filter((t) => !zwaar.includes(t));
    const beschrijfWeiger = (t) => [
      t.hits ? `${t.hits} hit(s)` : '',
      t.nieuwe_cookies.length ? `nieuwe cookies ${t.nieuwe_cookies.join(', ')}` : '',
      t.nieuwe_opslag.length ? `nieuwe opslag ${t.nieuwe_opslag.join(', ')}` : '',
      t.identifiers ? `${t.identifiers} met identifier` : '',
    ].filter(Boolean).join(', ');
    if (zwaar.length) {
      punten.push({
        niveau: 'hoog',
        code: 'tracking_na_weigeren',
        titel: 'Trackers draaien door nadat de bezoeker alles weigerde',
        waarom: 'In een aparte browser is "alles weigeren" gekozen. Daarna (ook na herladen) bleven deze advertentie- of opnametools meten. De keuze van de bezoeker wordt dus niet gerespecteerd.',
        actie: 'Koppel deze tags aan de toestemmingscategorie in de CMP of in Google Tag Manager, zodat ze na weigeren niet meer vuren.',
        bron: `${BRONNEN.telecomwet} ${BRONNEN.edpb}`,
        bewijs: zwaar.map((t) => `${t.naam}: ${beschrijfWeiger(t)}`),
        regels: [9],
      });
    }
    if (licht.length) {
      punten.push({
        niveau: 'middel',
        code: 'statistieken_na_weigeren',
        titel: 'Statistieken of ingesloten diensten actief na weigeren',
        waarom: 'Na "alles weigeren" bleven deze tools iets versturen of opslaan. Voor privacyvriendelijk ingestelde statistieken kan dat mogen; voor de rest niet.',
        actie: 'Controleer per tool of hij zonder toestemming mag draaien, en blokkeer hem anders na weigeren.',
        bron: BRONNEN.ap_analytics,
        bewijs: licht.map((t) => `${t.naam}: ${beschrijfWeiger(t)}`),
        regels: [9],
      });
    }
  } else if (weigeren && weigeren.bepaald === false) {
    punten.push({
      niveau: 'middel',
      code: 'weigeren_niet_gelukt',
      titel: 'Weigeren lukte niet automatisch',
      waarom: 'De tool vond in de banner geen manier om alles te weigeren die hij kon bedienen. Dat kan aan de tool liggen, maar ook aan een banner waarin weigeren lastig is.',
      actie: 'Controleer handmatig of weigeren even makkelijk is als accepteren.',
      bron: BRONNEN.banner,
      bewijs: [weigeren.reden].filter(Boolean),
      regels: [9, 10],
    });
  }

  // --- De banner zelf -------------------------------------------------------------------

  const banner = b.cookiebanner;
  if (banner?.gevonden) {
    if (banner.accepteerknop?.officieel && banner.accepteerknop_tekst_duidelijk === false) {
      punten.push({
        niveau: 'hoog',
        code: 'accepteerknop_misleidend',
        titel: `De knop "${banner.accepteerknop.tekst}" geeft toestemming voor alles`,
        waarom: 'Dit is de officiële "alles accepteren"-knop van de CMP, maar de tekst zegt dat niet. Een bezoeker die de banner wil wegklikken, geeft zo ongemerkt toestemming. Toestemming moet ondubbelzinnig zijn.',
        actie: 'Geef de knop een tekst die zegt wat hij doet ("Alles accepteren") en zet er een even duidelijke weigerknop naast.',
        bron: BRONNEN.banner,
        bewijs: [`Accepteerknop van ${banner.cmp}: "${banner.accepteerknop.tekst}"`],
        regels: [10],
      });
    }
    if (!banner.weigerknop_eerste_laag) {
      const blokkeert = banner.scroll_geblokkeerd || (banner.bedekking_procent ?? 0) >= 70;
      punten.push({
        niveau: banner.instellingenknop ? 'middel' : 'hoog',
        code: banner.instellingenknop ? 'geen_weigerknop_eerste_laag' : 'geen_weigeroptie',
        titel: banner.instellingenknop ? 'Geen weigerknop in de eerste laag van de banner' : 'Geen enkele manier om te weigeren gevonden',
        waarom: banner.instellingenknop
          ? 'Accepteren kan met één klik, weigeren alleen via de instellingen. Dat maakt weigeren moeilijker dan accepteren.'
          : `De banner biedt geen weigerknop en geen instellingen${blokkeert ? ', en blokkeert de site tot er een keuze is' : ''}. Een bezoeker kan in feite alleen accepteren.`,
        actie: 'Zet een knop "Alles weigeren" naast "Alles accepteren", even groot en even opvallend.',
        bron: BRONNEN.banner,
        bewijs: [
          banner.accepteerknop ? `Accepteren: "${banner.accepteerknop.tekst}"` : '',
          `Zichtbare knoppen: ${banner.knoppen.filter((k) => k.zichtbaar).map((k) => `"${k.tekst}"`).join(', ') || 'geen'}`,
          blokkeert ? `De banner bedekt ${banner.bedekking_procent}% van het scherm${banner.scroll_geblokkeerd ? ' en scrollen is geblokkeerd' : ''}` : '',
        ].filter(Boolean),
        regels: [10],
      });
    } else if (banner.weiger_t_o_v_accepteer !== null && banner.weiger_t_o_v_accepteer < 0.5) {
      punten.push({
        niveau: 'middel',
        code: 'weigerknop_minder_prominent',
        titel: 'De weigerknop is veel kleiner dan de accepteerknop',
        waarom: 'Weigeren staat er wel, maar valt minder op dan accepteren. Een knop die bewust onopvallend is, stuurt de keuze.',
        actie: 'Maak beide knoppen even groot en even opvallend.',
        bron: BRONNEN.banner,
        bewijs: [`Weigerknop "${banner.weigerknop.tekst}" is ${Math.round(banner.weiger_t_o_v_accepteer * 100)}% van de accepteerknop "${banner.accepteerknop?.tekst}"`],
        regels: [10],
      });
    }
    const zichtbaarAan = (banner.vooraf_aangevinkt || []).filter((v) => v.zichtbaar);
    const verborgenAan = (banner.vooraf_aangevinkt || []).filter((v) => !v.zichtbaar);
    if (zichtbaarAan.length) {
      punten.push({
        niveau: 'middel',
        code: 'vooraf_aangevinkt',
        titel: 'Vakjes staan vooraf aangevinkt',
        waarom: 'Toestemming moet een actieve keuze zijn. Een vakje dat al aan staat, is dat niet.',
        actie: 'Zet alle niet-noodzakelijke categorieën standaard uit.',
        bron: BRONNEN.banner,
        bewijs: zichtbaarAan.map((v) => v.label || '(zonder label)'),
        regels: [10],
      });
    }
    if (verborgenAan.length) {
      punten.push({
        niveau: 'laag',
        code: 'vooraf_aangevinkt_instellingen',
        titel: 'In de instellingen staan vakjes vooraf aan',
        waarom: 'In het (nog verborgen) instellingenscherm staan niet-noodzakelijke categorieën al aan. Wie daar "opslaan" kiest, geeft er toestemming voor.',
        actie: 'Zet ook in de instellingen alle niet-noodzakelijke categorieën standaard uit.',
        bron: BRONNEN.banner,
        bewijs: verborgenAan.map((v) => v.label || '(zonder label)'),
        regels: [10],
      });
    }
    if (consent?.gegeven && banner.intrekken && banner.intrekken.gevonden === false) {
      punten.push({
        niveau: 'middel',
        code: 'geen_intrekmogelijkheid',
        titel: 'Geen manier gevonden om toestemming later in te trekken',
        waarom: 'Na het accepteren vond de tool geen zwevende knop van de CMP en geen link als "Cookie-instellingen". Intrekken moet even makkelijk zijn als toestemming geven.',
        actie: 'Zet een vaste link "Cookie-instellingen" in de footer of zet de zwevende knop van de CMP aan.',
        bron: BRONNEN.intrekken,
        bewijs: [],
        regels: [10],
      });
    }
  }

  // --- Middel -------------------------------------------------------------------------

  const googleZonderStatus = (b.tag_status || []).filter((s) => (s.tag === 'google_analytics' || s.tag === 'google_ads')
    && s.requests_voor_consent > 0 && !Object.keys(s.consent_mode_voor_consent || {}).length);
  if (googleZonderStatus.length && tags.some((t) => googleZonderStatus.some((s) => s.tag === t.tag) && t.actief)) {
    punten.push({
      niveau: 'middel',
      code: 'google_zonder_consent_mode',
      titel: 'Google-tags vuren zonder Consent Mode',
      waarom: 'Er gaan vóór consent Google-hits de deur uit zonder Consent Mode-status. Google weet dan niet dat er geen toestemming is en meet volledig.',
      actie: 'Activeer Google Consent Mode v2 via de CMP, met standaard "denied", of houd de Google-tags tegen tot er toestemming is.',
      bron: BRONNEN.consent_mode,
      bewijs: tags.filter((t) => googleZonderStatus.some((s) => s.tag === t.tag) && t.actief).map(beschrijf),
      regels: [2],
    });
  }

  if (analytics.length) {
    punten.push({
      niveau: 'middel',
      code: 'analytics_voor_consent',
      titel: 'Bezoekersstatistieken vóór consent',
      waarom: 'Analytische cookies mogen zonder toestemming, maar alleen als ze privacyvriendelijk zijn ingesteld. Of dat zo is, is van buitenaf niet te zien.',
      actie: 'Controleer de instellingen (IP-adres afgeschermd, geen gegevens delen, verwerkersovereenkomst) of laad de tool pas na toestemming.',
      bron: BRONNEN.ap_analytics,
      bewijs: analytics.map(beschrijf),
      regels: [1, 2],
    });
  }

  if (alleenGeladen.length) {
    punten.push({
      niveau: 'middel',
      code: 'trackerscripts_geladen',
      titel: 'Trackerscripts geladen vóór consent, zonder meting',
      waarom: 'Het script van de tracker werd al opgehaald, maar er ging geen meting de deur uit en er kwam geen cookie. De leverancier ziet wel het IP-adres van de bezoeker.',
      actie: 'Laad het script pas na toestemming; dan weet de leverancier ook niet dat de bezoeker er was.',
      bron: BRONNEN.edpb,
      bewijs: alleenGeladen.map((t) => `${t.naam}: ${t.requests} script(s), geen hits`),
      regels: [2],
    });
  }

  if (sst.length) {
    punten.push({
      niveau: 'middel',
      code: 'server_side_tagging',
      titel: 'Server-side tagging actief vóór consent',
      waarom: 'Er gaan hits naar een server-side tagging-endpoint. Wat die server doorstuurt, is van buitenaf niet te zien.',
      actie: 'Controleer in de server-container welke tags vuren zonder toestemming.',
      bron: BRONNEN.edpb,
      bewijs: sst.map(beschrijf),
      regels: [2],
    });
  }

  if (alleenPings.length) {
    punten.push({
      niveau: 'middel',
      code: 'alleen_cookieloze_pings',
      titel: 'Alleen cookieloze pings (Consent Mode: geweigerd)',
      waarom: 'Google of Microsoft krijgt vóór consent een melding zonder cookies, met de status "geweigerd". Dat is de bedoelde werking van Consent Mode "advanced", maar toezichthouders zijn het niet eens of ook dat toestemming vraagt.',
      actie: 'Bewuste keuze maken: in de "basic"-variant gaat er vóór consent niets naar het platform.',
      bron: `${BRONNEN.consent_mode} ${BRONNEN.edpb}`,
      bewijs: alleenPings.map((t) => `${t.naam}: alleen pings met ${Object.keys(t.status).join(', ')}`),
      regels: [2],
    });
  }

  if (ingesloten.length) {
    punten.push({
      niveau: 'middel',
      code: 'ingesloten_diensten_voor_consent',
      titel: 'Video, chat of widgets van derden vóór consent',
      waarom: 'Ingesloten diensten zoals YouTube, Vimeo of een chatvenster zetten vaak eigen cookies of herkennen de bezoeker. Sommige hebben een privacymodus.',
      actie: 'Laad ze pas na toestemming (klik-om-te-laden), of gebruik de privacymodus (zoals youtube-nocookie.com).',
      bron: BRONNEN.telecomwet,
      bewijs: ingesloten.map(beschrijf),
      regels: [2, 8],
    });
  }

  const onbekendeOntvangers = (b.identifiers_in_payload_voor_consent?.details || []).filter((d) => d.is_extern && !d.bekende_tag);
  if (onbekendeOntvangers.length) {
    punten.push({
      niveau: 'middel',
      code: 'identifier_naar_onbekende_partij',
      titel: 'Onbekende partijen ontvangen een identifier',
      waarom: 'Een externe dienst die deze tool niet kent, krijgt een bezoeker- of click-id. Wat die partij ermee doet, is onbekend.',
      actie: 'Zoek uit welke dienst dit is en of die toestemming vraagt.',
      bron: BRONNEN.edpb,
      bewijs: [...new Set(onbekendeOntvangers.map((d) => `${d.host}: ${d.identifiers.map((i) => i.parameter).join(', ')}`))],
      regels: [3],
    });
  }

  const ck = b.cookies_voor_consent;
  const onbekendDerde = (ck?.details || []).filter((c) => c.classificatie === 'onbekend' && c.is_third_party);
  if (onbekendDerde.length) {
    punten.push({
      niveau: 'middel',
      code: 'onbekende_cookies_derden',
      titel: 'Onbekende cookies van andere partijen',
      waarom: 'Een cookie op het domein van een andere partij, die deze tool niet kan thuisbrengen. Cookies van derden zijn zelden functioneel.',
      actie: 'Zoek uit van welke dienst deze cookies zijn.',
      bron: BRONNEN.telecomwet,
      bewijs: onbekendDerde.map((c) => `${c.naam} op ${c.domein}`),
      regels: [1],
    });
  }

  const lp = cmpInfo?.laadpositie;
  if (lp?.detected && lp.tracking_requests_tot_cmp_aangevraagd?.aantal) {
    punten.push({
      niveau: 'middel',
      code: 'cmp_te_laat_geladen',
      titel: 'De cookiebanner laadt pas ná de eerste trackers',
      waarom: 'Toen het script van de CMP werd opgevraagd, waren er al tracking-requests onderweg. Wat vóór de CMP laadt, kan die niet meer tegenhouden.',
      actie: lp.loaded_via_gtm
        ? 'De CMP wordt via Google Tag Manager geladen. Zet hem rechtstreeks bovenaan de <head>, vóór GTM.'
        : 'Zet het CMP-script bovenaan de <head>, vóór alle andere tags.',
      bron: BRONNEN.telecomwet,
      bewijs: [`${lp.tracking_requests_tot_cmp_aangevraagd.aantal} tracking-request(s) vóór het CMP-script: ${lp.tracking_requests_tot_cmp_aangevraagd.hosts.join(', ')}`],
      regels: [5],
    });
  }

  if (b.meerdere_cmps_actief?.gevonden) {
    punten.push({
      niveau: 'middel',
      code: 'meerdere_cmps',
      titel: "Meerdere cookiebanners tegelijk actief",
      waarom: 'Twee CMP\'s op één pagina kunnen elkaars keuze negeren: wat de bezoeker in de ene weigert, kan de andere doorlaten.',
      actie: 'Kies één CMP en verwijder de andere.',
      bron: BRONNEN.telecomwet,
      bewijs: b.meerdere_cmps_actief.cmps.filter((c) => c.actief).map((c) => c.naam),
      regels: [6],
    });
  }

  const trackerIframes = (b.js_gegenereerde_iframes?.iframes || []).filter((f) => f.bekende_tag && tagPerId(f.bekende_tag)?.tracking);
  if (trackerIframes.length) {
    punten.push({
      niveau: 'middel',
      code: 'tracker_iframes',
      titel: 'Iframes van trackers die pas via JavaScript ontstaan',
      waarom: 'Deze iframes staan niet in de HTML en ontsnappen daardoor vaak aan de autoblocking van een CMP.',
      actie: 'Controleer of de CMP deze iframes tegenhoudt tot er toestemming is.',
      bron: BRONNEN.telecomwet,
      bewijs: trackerIframes.map((f) => `${f.tag_naam}: ${f.src || '(geen src)'}`),
      regels: [8],
    });
  }

  const subdomeinen = (b.eigen_subdomeinen?.items || []).filter((item) => item.herkend_als && item.requests_voor_consent > 0);
  if (subdomeinen.length) {
    punten.push({
      niveau: 'middel',
      code: 'tracking_via_eigen_subdomein',
      titel: 'Tracking via een eigen subdomein',
      waarom: 'Deze subdomeinen lijken van de site zelf, maar wijzen via DNS naar een trackingdienst, of ontvangen hits zoals een server-side tagging-server. Wat daar binnenkomt, kan naar andere partijen worden doorgestuurd, en browsers en adblockers zien dat niet.',
      actie: 'Controleer welke tags via dit subdomein lopen en of die zonder toestemming vuren.',
      bron: BRONNEN.edpb,
      bewijs: subdomeinen.map((item) => `${item.host}${item.cname.length ? ` -> ${item.cname.join(' -> ')}` : ''} (${item.herkend_als}): ${item.requests_voor_consent} request(s) vóór consent`),
      regels: [12],
    });
  }

  // --- Laag ---------------------------------------------------------------------------

  const onbekendEigen = (ck?.details || []).filter((c) => c.classificatie === 'onbekend' && !c.is_third_party);
  if (onbekendEigen.length) {
    punten.push({
      niveau: 'laag',
      code: 'onbekende_cookies_eigen_domein',
      titel: 'Onbekende cookies op het eigen domein',
      waarom: 'Cookies van de site zelf die deze tool niet kan thuisbrengen. Vaak functioneel (taal, winkelwagen), soms niet.',
      actie: 'Even nagaan waarvoor ze dienen; bij twijfel in de cookieverklaring opnemen.',
      bron: BRONNEN.telecomwet,
      bewijs: onbekendEigen.map((c) => c.naam),
      regels: [1],
    });
  }

  const ontbrekend = (b.ontbrekende_tags_na_consent || []).filter((t) => t.reden === 'aanwezig_in_html_of_dom_maar_geen_requests_na_consent');
  if (ontbrekend.length) {
    punten.push({
      niveau: 'laag',
      code: 'tags_stil_na_consent',
      titel: 'Tags die ook ná consent niets doen',
      waarom: 'Geen privacyrisico, wel mogelijk meetverlies: deze tags staan op de pagina maar vuurden niet na het accepteren.',
      actie: 'Controleer of deze tags na toestemming wel vuren, bijvoorbeeld op een volgende pagina.',
      bron: null,
      bewijs: ontbrekend.map((t) => t.naam),
      regels: [4],
    });
  }

  if (fout?.stap === 'consent') {
    punten.push({
      niveau: 'laag',
      code: 'consent_niet_automatisch',
      titel: 'De banner kon niet automatisch worden geaccepteerd',
      waarom: 'Er is daardoor geen meting ná consent. Dat zegt niets over de site, alleen over wat deze scan kon meten.',
      actie: 'Controleer het gedrag ná accepteren handmatig.',
      bron: null,
      bewijs: [fout.melding],
      regels: [4],
    });
  }

  return {
    bepaald: true,
    reden: null,
    voorbehoud,
    aantal: Object.fromEntries(NIVEAUS.map((niveau) => [niveau, punten.filter((p) => p.niveau === niveau).length])),
    punten: punten.sort((a, c) => NIVEAUS.indexOf(a.niveau) - NIVEAUS.indexOf(c.niveau)),
  };
}

function leeg(reden) {
  return { bepaald: false, reden, voorbehoud: [], aantal: { hoog: 0, middel: 0, laag: 0 }, punten: [] };
}

/**
 * Per bekende tracker wat hij vóór consent deed: requests, cookies en
 * identifiers. `actief` is waar als er méér gebeurde dan alleen cookieloze
 * pings met de status "geweigerd" (G100, asc=D); die staan apart in `alleen_g100`. Laadscripts (gtag.js) tellen
 * niet: het script ophalen is nog geen meting.
 */
function activiteitPerTag(b) {
  const ids = b.identifiers_in_payload_voor_consent?.details || [];
  return (b.tag_status || [])
    .filter((s) => !s.laadscript)
    .map((s) => {
      const tag = tagPerId(s.tag);
      // Een id in een geweigerde ping is tijdelijk: zonder cookies kan het platform hem niet
      // bewaren, hij geldt alleen voor die paginaweergave. Die maakt een tag dus niet "actief".
      const identifiers = ids.filter((d) => d.bekende_tag === s.tag && d.consent_mode_geweigerd !== true).length;
      const cookies = [...(s.cookies_voor_consent || []), ...(s.opslag_voor_consent || []).map((sleutel) => `${sleutel} (opslag)`)];
      const alleenG100 = !!s.alleen_geweigerde_pings_voor_consent && !cookies.length && !identifiers;
      // Alleen het script opgehaald, zonder hit, cookie of id: de leverancier
      // ziet de bezoeker wel (IP-adres), maar er is niets gemeten.
      const hits = s.hits_voor_consent ?? s.requests_voor_consent;
      const alleenScripts = s.requests_voor_consent > 0 && hits === 0 && !cookies.length && !identifiers;
      const iets = s.requests_voor_consent > 0 || cookies.length > 0 || identifiers > 0;
      return {
        tag: s.tag,
        naam: s.naam,
        categorie: s.categorie,
        sessie_opname: !!tag?.sessie_opname,
        status: s.consent_mode_voor_consent || {},
        zonder_status: s.hits_zonder_consentstatus_voor_consent || 0,
        requests: s.requests_voor_consent,
        cookies,
        identifiers,
        alleen_g100: iets && alleenG100,
        alleen_scripts: alleenScripts,
        actief: iets && !alleenG100 && !alleenScripts,
      };
    });
}

/** "Meta Pixel: 4 requests, cookies _fbp, 2 met identifier". */
function beschrijf(t) {
  const delen = [];
  if (t.requests) delen.push(`${t.requests} request(s)`);
  // Alleen zinvol als de tag wél Consent Mode gebruikt: dan zijn dit de hits die eraan ontsnappen.
  if (Object.keys(t.status).length && t.zonder_status) delen.push(`waarvan ${t.zonder_status} hit(s) zonder consentstatus`);
  if (t.cookies.length) delen.push(`cookie${t.cookies.length === 1 ? '' : 's'} ${t.cookies.join(', ')}`);
  if (t.identifiers) delen.push(`${t.identifiers} met identifier`);
  return `${t.naam}: ${delen.join(', ') || 'aanwezig'}`;
}
