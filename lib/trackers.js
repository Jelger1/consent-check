/**
 * Kennis over bekende tags, trackers, identifiers en cookies.
 *
 * Dit is de enige plek waar "bekend" wordt gedefinieerd. Het meten zelf filtert
 * niets: elk request en elke cookie komt in het rapport. Deze tabellen voegen
 * alleen een label toe, zodat de LLM die het rapport leest niet zelf hoeft te
 * weten dat px.ads.linkedin.com bij LinkedIn Insight hoort.
 *
 * `patronen` worden getest op "host + pad" (zonder query, kleine letters). Een
 * patroon zonder host (zoals /\/g\/collect$/) matcht dus ook op een eigen
 * subdomein of een run.app-adres: precies hoe server-side tagging eruitziet.
 * De volgorde telt: het eerste patroon dat past, wint.
 *
 * `dom_signalen` worden getest op script-src's en inline scriptcode, om te
 * zien of een tag op de pagina stáát, los van of hij ook daadwerkelijk vuurt.
 */

export const TAGS = [
  // --- Google ---------------------------------------------------------------
  {
    id: 'google_tag_manager', naam: 'Google Tag Manager', leverancier: 'google', categorie: 'tagbeheer', tracking: false,
    patronen: [/googletagmanager\.com\/gtm\.js/, /googletagmanager\.com\/ns\.html/, /googletagmanager\.com\/debug/, /\/gtm\.js$/],
    dom_signalen: [/googletagmanager\.com\/gtm\.js/, /\bGTM-[A-Z0-9]{4,}\b/],
    cookies: [],
  },
  {
    id: 'google_tag', naam: 'Google tag (gtag.js)', leverancier: 'google', categorie: 'tagbeheer', tracking: true,
    patronen: [/googletagmanager\.com\/gtag\/js/, /googletagmanager\.com\/gtag\/destination/, /\/gtag\/js$/],
    dom_signalen: [/googletagmanager\.com\/gtag\/js/, /\bgtag\(/],
    cookies: [],
  },
  {
    id: 'google_analytics', naam: 'Google Analytics', leverancier: 'google', categorie: 'analytics', tracking: true,
    patronen: [/google-analytics\.com\//, /analytics\.google\.com\//, /stats\.g\.doubleclick\.net\//, /\/g\/collect$/, /\/j\/collect$/, /\/r\/collect$/],
    dom_signalen: [/google-analytics\.com/, /\bG-[A-Z0-9]{6,}\b/, /\bUA-\d{4,}-\d+\b/, /\bga\('create'/],
    cookies: [/^_ga$/, /^_ga_/, /^_gid$/, /^_gat/, /^__utm/, /^_dc_gtm_/, /^_gaexp/],
  },
  {
    id: 'google_ads', naam: 'Google Ads / DoubleClick', leverancier: 'google', categorie: 'advertising', tracking: true,
    patronen: [/googleadservices\.com\//, /googlesyndication\.com\//, /doubleclick\.net\//, /adservice\.google/, /(^|\.)google\.[a-z.]+\/pagead\//, /(^|\.)google\.[a-z.]+\/ads\//, /(^|\.)google\.[a-z.]+\/ccm\//, /(^|\.)google\.[a-z.]+\/gen_204/],
    dom_signalen: [/\bAW-\d{6,}\b/, /googleadservices\.com/, /googlesyndication\.com/],
    cookies: [/^_gcl_/, /^_gac_/, /^IDE$/, /^test_cookie$/, /^DSID$/, /^NID$/, /^1P_JAR$/, /^AEC$/, /^__Secure-3P/, /^__Secure-1P/, /^CONSENT$/, /^SOCS$/, /^ar_debug$/],
  },
  {
    id: 'youtube', naam: 'YouTube (embed)', leverancier: 'google', categorie: 'embed', tracking: true,
    patronen: [/(^|\.)youtube\.com\//, /(^|\.)youtube-nocookie\.com\//, /(^|\.)ytimg\.com\//, /(^|\.)googlevideo\.com\//, /(^|\.)youtu\.be\//],
    dom_signalen: [/youtube\.com\/embed/, /youtube-nocookie\.com\/embed/, /youtube\.com\/iframe_api/],
    cookies: [/^YSC$/, /^VISITOR_INFO1_LIVE$/, /^VISITOR_PRIVACY_METADATA$/, /^__Secure-ROLLOUT_TOKEN$/, /^PREF$/, /^GPS$/, /^__Secure-YEC$/, /^__Secure-YNID$/],
  },
  {
    id: 'google_maps', naam: 'Google Maps', leverancier: 'google', categorie: 'embed', tracking: false,
    patronen: [/maps\.googleapis\.com\//, /maps\.gstatic\.com\//, /(^|\.)google\.[a-z.]+\/maps/],
    dom_signalen: [/maps\.googleapis\.com/, /google\.com\/maps\/embed/],
    cookies: [],
  },
  {
    id: 'google_recaptcha', naam: 'Google reCAPTCHA', leverancier: 'google', categorie: 'functioneel_extern', tracking: false,
    patronen: [/(^|\.)google\.[a-z.]+\/recaptcha/, /gstatic\.com\/recaptcha/, /(^|\.)recaptcha\.net\//],
    dom_signalen: [/google\.com\/recaptcha/, /grecaptcha/],
    cookies: [/^_GRECAPTCHA$/],
  },
  {
    id: 'google_fonts', naam: 'Google Fonts', leverancier: 'google', categorie: 'extern_overig', tracking: false,
    patronen: [/fonts\.googleapis\.com\//, /fonts\.gstatic\.com\//],
    dom_signalen: [],
    cookies: [],
  },

  // --- Niet-Google tags (vragen handmatige gating: geen Consent Mode) --------
  {
    id: 'meta_pixel', naam: 'Meta Pixel (Facebook/Instagram)', leverancier: 'meta', categorie: 'advertising', tracking: true,
    patronen: [/connect\.facebook\.net\//, /(^|\.)facebook\.com\/tr/, /(^|\.)facebook\.com\//, /(^|\.)fbcdn\.net\//, /(^|\.)instagram\.com\//, /(^|\.)fbsbx\.com\//],
    dom_signalen: [/connect\.facebook\.net/, /\bfbq\(/, /fbevents\.js/, /facebook\.com\/tr\?/],
    cookies: [/^_fbp$/, /^_fbc$/, /^fr$/, /^datr$/, /^sb$/, /^wd$/, /^c_user$/, /^xs$/, /^oo$/, /^ps_l$/, /^ps_n$/, /^dpr$/],
  },
  {
    id: 'linkedin_insight', naam: 'LinkedIn Insight Tag', leverancier: 'linkedin', categorie: 'advertising', tracking: true,
    patronen: [/snap\.licdn\.com\//, /px\d*\.ads\.linkedin\.com\//, /(^|\.)linkedin\.com\/px/, /(^|\.)linkedin\.com\/li\/track/, /(^|\.)linkedin\.com\/collect/, /platform\.linkedin\.com\//, /(^|\.)licdn\.com\//],
    dom_signalen: [/snap\.licdn\.com/, /_linkedin_partner_id/, /_linkedin_data_partner_ids/, /\blintrk\(/],
    cookies: [/^li_sugr$/, /^lidc$/, /^bcookie$/, /^bscookie$/, /^UserMatchHistory$/, /^AnalyticsSyncHistory$/, /^li_gc$/, /^ln_or$/, /^li_fat_id$/, /^li_mc$/],
  },
  {
    id: 'hotjar', naam: 'Hotjar', leverancier: 'hotjar', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)hotjar\.com\//, /(^|\.)hotjar\.io\//],
    dom_signalen: [/hotjar\.com/, /\bhj\(/, /_hjSettings/],
    cookies: [/^_hj/],
  },
  {
    id: 'tiktok_pixel', naam: 'TikTok Pixel', leverancier: 'tiktok', categorie: 'advertising', tracking: true,
    patronen: [/analytics\.tiktok\.com\//, /(^|\.)tiktok\.com\/i18n\/pixel/, /analytics-ipv6\.tiktokw\.us\//],
    dom_signalen: [/analytics\.tiktok\.com/, /\bttq\.(load|page|track)\(/],
    cookies: [/^_ttp$/, /^_tt_enable_cookie$/, /^ttwid$/, /^tt_/],
  },
  {
    id: 'microsoft_clarity', naam: 'Microsoft Clarity', leverancier: 'microsoft', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)clarity\.ms\//],
    dom_signalen: [/clarity\.ms/, /\bclarity\(/],
    cookies: [/^_clck$/, /^_clsk$/, /^CLID$/, /^ANONCHK$/, /^SM$/, /^MR$/],
  },
  {
    id: 'microsoft_ads', naam: 'Microsoft Advertising (UET/Bing)', leverancier: 'microsoft', categorie: 'advertising', tracking: true,
    patronen: [/bat\.bing\.com\//, /(^|\.)bing\.com\/bat/, /(^|\.)bing\.com\/action/, /(^|\.)bing\.com\/p\/action/],
    dom_signalen: [/bat\.bing\.com/, /\buetq\b/],
    cookies: [/^_uetsid$/, /^_uetvid$/, /^MUID$/, /^MUIDB$/],
  },
  {
    id: 'pinterest_tag', naam: 'Pinterest Tag', leverancier: 'pinterest', categorie: 'advertising', tracking: true,
    patronen: [/ct\.pinterest\.com\//, /s\.pinimg\.com\/ct/, /(^|\.)pinterest\.com\//],
    dom_signalen: [/\bpintrk\(/, /pinimg\.com\/ct/],
    cookies: [/^_pin_unauth$/, /^_pinterest_ct/, /^_epik$/, /^_derived_epik$/],
  },
  {
    id: 'snapchat_pixel', naam: 'Snap Pixel', leverancier: 'snapchat', categorie: 'advertising', tracking: true,
    patronen: [/(^|\.)sc-static\.net\//, /tr\.snapchat\.com\//],
    dom_signalen: [/\bsnaptr\(/, /sc-static\.net/],
    cookies: [/^_scid$/, /^_scid_r$/, /^sc_at$/],
  },
  {
    id: 'x_pixel', naam: 'X (Twitter) Pixel', leverancier: 'x', categorie: 'advertising', tracking: true,
    patronen: [/static\.ads-twitter\.com\//, /analytics\.twitter\.com\//, /(^|\.)t\.co\/i\/adsct/, /(^|\.)ads-twitter\.com\//],
    dom_signalen: [/\btwq\(/, /ads-twitter\.com/],
    cookies: [/^muc_ads$/, /^personalization_id$/],
  },
  {
    id: 'hubspot', naam: 'HubSpot', leverancier: 'hubspot', categorie: 'marketing_automation', tracking: true,
    patronen: [/(^|\.)hs-scripts\.com\//, /(^|\.)hs-analytics\.net\//, /(^|\.)hs-banner\.com\//, /(^|\.)hsforms\.(net|com)\//, /(^|\.)hubspot\.com\//, /(^|\.)hscollectedforms\.net\//, /(^|\.)hsadspixel\.net\//, /(^|\.)usemessages\.com\//, /(^|\.)hubspotusercontent[a-z0-9-]*\.net\//],
    dom_signalen: [/hs-scripts\.com/, /hs-analytics\.net/],
    cookies: [/^hubspotutk$/, /^__hs/],
  },
  {
    id: 'activecampaign', naam: 'ActiveCampaign site tracking', leverancier: 'activecampaign', categorie: 'marketing_automation', tracking: true,
    patronen: [/(^|\.)trackcmp\.net\//],
    dom_signalen: [/trackcmp\.net/, /\bvgo\(/],
    cookies: [/^prism_/],
  },
  {
    id: 'leadinfo', naam: 'Leadinfo', leverancier: 'leadinfo', categorie: 'b2b_tracking', tracking: true,
    patronen: [/(^|\.)leadinfo\.(com|net)\//],
    dom_signalen: [/leadinfo\.(com|net)/],
    cookies: [/^_li_id$/, /^_li_ses$/],
  },
  {
    id: 'leadfeeder', naam: 'Leadfeeder / Dealfront', leverancier: 'leadfeeder', categorie: 'b2b_tracking', tracking: true,
    patronen: [/(^|\.)lfeeder\.com\//, /(^|\.)leadfeeder\.com\//],
    dom_signalen: [/lfeeder\.com/],
    cookies: [/^_lfa$/],
  },
  {
    id: 'matomo', naam: 'Matomo / Piwik', leverancier: 'matomo', categorie: 'analytics', tracking: true,
    patronen: [/\/matomo\.(js|php)$/, /\/piwik\.(js|php)$/, /(^|\.)matomo\.cloud\//],
    dom_signalen: [/matomo\.(js|php)/, /piwik\.(js|php)/, /_paq\.push/],
    cookies: [/^_pk_/, /^MATOMO_SESSID$/, /^mtm_/],
  },
  {
    id: 'plausible', naam: 'Plausible Analytics', leverancier: 'plausible', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)plausible\.io\//],
    dom_signalen: [/plausible\.io/],
    cookies: [],
  },
  {
    id: 'cloudflare_insights', naam: 'Cloudflare Web Analytics', leverancier: 'cloudflare', categorie: 'analytics', tracking: true,
    patronen: [/cloudflareinsights\.com\//, /\/cdn-cgi\/rum$/],
    dom_signalen: [/cloudflareinsights\.com/],
    cookies: [],
  },
  {
    id: 'jetpack_stats', naam: 'Jetpack Stats (WordPress.com)', leverancier: 'automattic', categorie: 'analytics', tracking: true,
    patronen: [/stats\.wp\.com\//, /pixel\.wp\.com\//],
    dom_signalen: [/stats\.wp\.com/],
    cookies: [],
  },
  {
    id: 'crazyegg', naam: 'Crazy Egg', leverancier: 'crazyegg', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)crazyegg\.com\//], dom_signalen: [/crazyegg\.com/], cookies: [/^_ce/],
  },
  {
    id: 'mouseflow', naam: 'Mouseflow', leverancier: 'mouseflow', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)mouseflow\.com\//], dom_signalen: [/mouseflow\.com/], cookies: [/^mf_/],
  },
  {
    id: 'fullstory', naam: 'FullStory', leverancier: 'fullstory', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)fullstory\.com\//], dom_signalen: [/fullstory\.com/], cookies: [/^fs_/],
  },
  {
    id: 'mixpanel', naam: 'Mixpanel', leverancier: 'mixpanel', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)mixpanel\.com\//, /(^|\.)mxpnl\.com\//], dom_signalen: [/mixpanel/], cookies: [/^mp_/],
  },
  {
    id: 'segment', naam: 'Segment', leverancier: 'twilio', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)segment\.(com|io)\//], dom_signalen: [/segment\.(com|io)/, /analytics\.load\(/], cookies: [/^ajs_/],
  },
  {
    id: 'intercom', naam: 'Intercom', leverancier: 'intercom', categorie: 'chat', tracking: true,
    patronen: [/(^|\.)intercom\.io\//, /(^|\.)intercomcdn\.com\//], dom_signalen: [/intercom/], cookies: [/^intercom-/],
  },
  {
    id: 'tawk_to', naam: 'tawk.to', leverancier: 'tawk', categorie: 'chat', tracking: true,
    patronen: [/(^|\.)tawk\.to\//], dom_signalen: [/tawk\.to/], cookies: [/^twk_/, /^TawkConnectionTime$/],
  },
  {
    id: 'crisp', naam: 'Crisp chat', leverancier: 'crisp', categorie: 'chat', tracking: true,
    patronen: [/(^|\.)crisp\.chat\//], dom_signalen: [/crisp\.chat/], cookies: [/^crisp-client/],
  },
  {
    id: 'trustpilot', naam: 'Trustpilot widget', leverancier: 'trustpilot', categorie: 'embed', tracking: false,
    patronen: [/(^|\.)trustpilot\.com\//], dom_signalen: [/trustpilot\.com/], cookies: [],
  },
  {
    id: 'vimeo', naam: 'Vimeo (embed)', leverancier: 'vimeo', categorie: 'embed', tracking: true,
    patronen: [/(^|\.)vimeo\.com\//, /(^|\.)vimeocdn\.com\//], dom_signalen: [/player\.vimeo\.com/], cookies: [/^vuid$/],
  },
  {
    id: 'wistia', naam: 'Wistia (embed)', leverancier: 'wistia', categorie: 'embed', tracking: true,
    patronen: [/(^|\.)wistia\.(com|net)\//], dom_signalen: [/wistia\.(com|net)/], cookies: [],
  },
  {
    id: 'addthis_sharethis', naam: 'AddThis / ShareThis', leverancier: 'sharethis', categorie: 'advertising', tracking: true,
    patronen: [/(^|\.)addthis\.com\//, /(^|\.)sharethis\.com\//], dom_signalen: [/addthis\.com/, /sharethis\.com/], cookies: [/^__atuvc$/, /^__atuvs$/, /^__stid$/],
  },
  {
    id: 'adroll', naam: 'AdRoll', leverancier: 'adroll', categorie: 'advertising', tracking: true,
    patronen: [/(^|\.)adroll\.com\//], dom_signalen: [/adroll\.com/], cookies: [/^__adroll/],
  },
  {
    id: 'criteo', naam: 'Criteo', leverancier: 'criteo', categorie: 'advertising', tracking: true,
    patronen: [/(^|\.)criteo\.(com|net)\//], dom_signalen: [/criteo\.(com|net)/], cookies: [/^cto_/],
  },
  {
    id: 'server_side_tagging_run_app', naam: 'Server-side tagging endpoint (Google Cloud Run *.run.app)', leverancier: 'onbekend', categorie: 'server_side_tagging', tracking: true,
    patronen: [/\.run\.app\//],
    dom_signalen: [/\.run\.app\//],
    cookies: [],
  },

  // --- CMP's (worden apart herkend in lib/cmp/detect.js; hier alleen voor het request-label) ---
  { id: 'cookiescript', naam: 'CookieScript', leverancier: 'cookiescript', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookie-script\.com\//], dom_signalen: [], cookies: [] },
  { id: 'cookiebot', naam: 'Cookiebot', leverancier: 'usercentrics', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookiebot\.com\//], dom_signalen: [], cookies: [] },
  { id: 'onetrust', naam: 'OneTrust', leverancier: 'onetrust', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookielaw\.org\//, /(^|\.)onetrust\.com\//], dom_signalen: [], cookies: [] },
  { id: 'cookieyes', naam: 'CookieYes', leverancier: 'cookieyes', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookieyes\.com\//], dom_signalen: [], cookies: [] },
  { id: 'iubenda', naam: 'iubenda', leverancier: 'iubenda', categorie: 'cmp', tracking: false, patronen: [/(^|\.)iubenda\.com\//], dom_signalen: [], cookies: [] },
  { id: 'usercentrics', naam: 'Usercentrics', leverancier: 'usercentrics', categorie: 'cmp', tracking: false, patronen: [/(^|\.)usercentrics\.eu\//], dom_signalen: [], cookies: [] },
  { id: 'didomi', naam: 'Didomi', leverancier: 'didomi', categorie: 'cmp', tracking: false, patronen: [/(^|\.)privacy-center\.org\//, /(^|\.)didomi\.io\//], dom_signalen: [], cookies: [] },
  { id: 'cookiefirst', naam: 'CookieFirst', leverancier: 'cookiefirst', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookiefirst\.com\//], dom_signalen: [], cookies: [] },
  { id: 'cookieinformation', naam: 'Cookie Information', leverancier: 'cookieinformation', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookieinformation\.com\//], dom_signalen: [], cookies: [] },
  { id: 'termly', naam: 'Termly', leverancier: 'termly', categorie: 'cmp', tracking: false, patronen: [/(^|\.)termly\.io\//], dom_signalen: [], cookies: [] },
  { id: 'osano', naam: 'Osano', leverancier: 'osano', categorie: 'cmp', tracking: false, patronen: [/(^|\.)osano\.com\//], dom_signalen: [], cookies: [] },
  { id: 'axeptio', naam: 'Axeptio', leverancier: 'axeptio', categorie: 'cmp', tracking: false, patronen: [/(^|\.)axept\.io\//], dom_signalen: [], cookies: [] },
  { id: 'quantcast_choice', naam: 'Quantcast Choice / InMobi', leverancier: 'inmobi', categorie: 'cmp', tracking: false, patronen: [/quantcast\.mgr\.consensu\.org\//, /(^|\.)quantcast\.com\//], dom_signalen: [], cookies: [] },
  { id: 'trustarc', naam: 'TrustArc', leverancier: 'trustarc', categorie: 'cmp', tracking: false, patronen: [/(^|\.)trustarc\.com\//, /(^|\.)truste\.com\//], dom_signalen: [], cookies: [] },

  // --- CDN's en fonts: extern, maar geen tag ---------------------------------
  {
    id: 'cdn_algemeen', naam: 'Publieke CDN (scripts/stijlen)', leverancier: 'divers', categorie: 'cdn', tracking: false,
    patronen: [/cdnjs\.cloudflare\.com\//, /cdn\.jsdelivr\.net\//, /(^|\.)unpkg\.com\//, /ajax\.googleapis\.com\//, /code\.jquery\.com\//, /(^|\.)bootstrapcdn\.com\//, /(^|\.)fontawesome\.com\//, /(^|\.)typekit\.net\//, /fonts\.bunny\.net\//, /(^|\.)cloudfront\.net\//, /(^|\.)akamaized\.net\//, /(^|\.)wp\.com\//, /(^|\.)gravatar\.com\//],
    dom_signalen: [],
    cookies: [],
  },
];

/** Tags die als "bekende tracking-host" gelden (regel 2) en meetellen in de tag-matrix (regel 4). */
export const TRACKING_TAGS = TAGS.filter((tag) => tag.tracking);

/**
 * Niet-Google tags moeten door de CMP zelf worden tegengehouden (autoblocking
 * of handmatige gating): ze kennen geen Consent Mode zoals de Google-tags.
 */
export function vereistHandmatigeGating(tag) {
  return tag.tracking && tag.leverancier !== 'google';
}

const TAG_PER_ID = new Map(TAGS.map((tag) => [tag.id, tag]));

export function tagPerId(id) {
  return TAG_PER_ID.get(id) || null;
}

/** Herkent de tag achter een request. `hostPad` is "host/pad" in kleine letters. */
export function herkenTag(hostPad) {
  if (!hostPad) return null;
  for (const tag of TAGS) {
    if (tag.patronen.some((patroon) => patroon.test(hostPad))) return tag;
  }
  return null;
}

/** Welke tags in een stuk scriptcode of script-src worden genoemd. */
export function herkenTagsInCode(code) {
  if (!code) return [];
  const gevonden = [];
  for (const tag of TAGS) {
    if (tag.dom_signalen.some((patroon) => patroon.test(code))) gevonden.push(tag.id);
  }
  return gevonden;
}

// --- Identifiers in request-payloads --------------------------------------

/**
 * Parameternamen die een bezoeker of sessie identificeren. Een pixel kan die
 * meesturen zonder dat er een cookie wordt gezet; vandaar dat de tool de
 * payload apart bekijkt en niet alleen de cookies.
 */
export const IDENTIFIER_PARAMETERS = {
  fbp: 'Meta browser-id (_fbp)',
  fbc: 'Meta click-id (_fbc)',
  fbclid: 'Meta click-id uit de URL',
  cid: 'client-id (bij Google Analytics-hits de GA client-id)',
  _gid: 'Google Analytics sessie-cookie',
  _ga: 'Google Analytics client-id (cross-domain linker)',
  _gl: 'Google cross-domain linker',
  sid: 'sessie-id (bij GA4-hits de session id)',
  gclid: 'Google Ads click-id',
  gbraid: 'Google Ads click-id (iOS)',
  wbraid: 'Google Ads click-id (iOS web)',
  dclid: 'DoubleClick click-id',
  _gcl_au: 'Google Ads conversion linker',
  gcl_au: 'Google Ads conversion linker',
  msclkid: 'Microsoft Ads click-id',
  ttclid: 'TikTok click-id',
  ttp: 'TikTok browser-id (_ttp)',
  li_fat_id: 'LinkedIn click-id',
  epik: 'Pinterest click-id',
  sccid: 'Snapchat click-id',
  twclid: 'X click-id',
  hjid: 'Hotjar user-id',
  _hjid: 'Hotjar user-id',
  uid: 'user-id',
  user_id: 'user-id',
  userid: 'user-id',
  uuid: 'unieke id',
  visitor_id: 'bezoeker-id',
  visitorid: 'bezoeker-id',
  client_id: 'client-id',
  clientid: 'client-id',
  session_id: 'sessie-id',
  sessionid: 'sessie-id',
  anonymous_id: 'anonieme id',
  anonymousid: 'anonieme id',
  device_id: 'apparaat-id',
  deviceid: 'apparaat-id',
  external_id: 'externe id (Meta advanced matching)',
  em: 'gehashte e-mail (Meta advanced matching)',
  ph: 'gehashte telefoon (Meta advanced matching)',
  fn: 'gehashte voornaam (Meta advanced matching)',
  ln: 'gehashte achternaam (Meta advanced matching)',
  muid: 'Microsoft user-id',
  vid: 'bezoeker-id',
};

/** Parameters met een voorvoegsel, zoals ud[em]=... bij Meta advanced matching. */
export const IDENTIFIER_VOORVOEGSELS = [
  { patroon: /^ud\[/, betekenis: 'Meta advanced matching (gehashte klantdata)' },
  { patroon: /^cd\[/, betekenis: 'Meta custom data' },
];

/** Waardepatronen die ook zonder herkenbare parameternaam een identifier verraden. */
export const IDENTIFIER_WAARDEN = [
  { patroon: /\bfb\.[12]\.\d{13}\.\d{6,}\b/, betekenis: 'Meta _fbp-waarde' },
  { patroon: /\bGA1\.\d\.\d{6,}\.\d{9,}\b/, betekenis: 'Google Analytics _ga-waarde' },
  { patroon: /\b\d{8,10}\.\d{10}\b/, betekenis: 'id in <getal>.<unix-tijd>-formaat (zoals een GA client-id, _gcl_au of auid)' },
];

// --- Cookies ---------------------------------------------------------------

/** Cookies van de CMP zelf: die zijn per definitie vóór consent aanwezig en tellen niet mee. */
const CMP_COOKIES = [
  /^CookieScriptConsent$/, /^CookieConsent$/, /^CookieConsentBulkSetting/, /^cmplz_/, /^cookieyes-consent$/, /^cky-/,
  /^OptanonConsent$/, /^OptanonAlertBoxClosed$/, /^euconsent-v2$/, /^_iub_cs-/, /^uc_/, /^usercentrics/,
  /^didomi_token$/, /^cookie_notice_accepted$/, /^cookielawinfo-checkbox-/, /^viewed_cookie_policy$/,
  /^moove_gdpr_popup$/, /^borlabs-cookie/, /^klaro$/, /^cc_cookie$/, /^cookieconsent_status$/, /^cookiefirst-consent$/,
  /^CookieInformationConsent$/, /^TERMLY_API_CACHE$/, /^osano_consentmanager/, /^axeptio_/, /^rcb-consent$/, /^tarteaucitron$/,
];

/**
 * Functionele sessie- en beveiligingscookies die een site nodig heeft om te
 * werken en waar geen consent voor nodig is. Alleen bekende namen; een
 * onbekende cookie blijft "onbekend" en telt dus wél mee als cookie vóór consent.
 */
const FUNCTIONELE_COOKIES = [
  /^PHPSESSID$/, /^wordpress_test_cookie$/, /^wp-settings-/, /^wordpress_logged_in_/, /^wordpress_sec_/, /^wp_lang$/,
  /^XSRF-TOKEN$/, /^laravel_session$/, /^csrftoken$/, /^_csrf/, /^CSRF-TOKEN$/, /^ASP\.NET_SessionId$/, /^ARRAffinity/,
  /^JSESSIONID$/, /^ci_session$/, /^__cf_bm$/, /^cf_clearance$/, /^__cfruid$/, /^_cfuvid$/, /^AWSALB/, /^__Host-/,
  /^woocommerce_/, /^wp_woocommerce_session_/, /^wc_cart_hash_/, /^wc_fragments_/, /^pll_language$/, /^wpml_/, /^_icl_/,
  /^__stripe_mid$/, /^__stripe_sid$/, /^wpEmojiSettingsSupports$/, /^frontend$/, /^frontend_cid$/, /^form_key$/,
  /^cookietest$/, /^humans_/, /^wfwaf-authcookie-/, /^wordpress_/,
];

/**
 * Classificeert een cookie op naam: cmp, functioneel, tracking (met de tag
 * waar hij bij hoort) of onbekend. Bewust alleen op naam: de waarde zegt
 * zelden iets, en de LLM krijgt de volledige lijst er sowieso bij.
 */
export function classificeerCookie(naam) {
  if (CMP_COOKIES.some((patroon) => patroon.test(naam))) return { classificatie: 'cmp', tag: null };
  for (const tag of TAGS) {
    if (tag.cookies.some((patroon) => patroon.test(naam))) return { classificatie: 'tracking', tag: tag.id };
  }
  if (FUNCTIONELE_COOKIES.some((patroon) => patroon.test(naam))) return { classificatie: 'functioneel', tag: null };
  return { classificatie: 'onbekend', tag: null };
}
