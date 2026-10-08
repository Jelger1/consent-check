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
 *
 * `consent_api` is de eigen manier waarop een tag toestemming kan ontvangen,
 * naast het tegenhouden door de CMP. Leeg betekent: in deze tool geen bekende
 * API, niet: "bestaat niet". Alleen invullen na controle in de documentatie
 * van de leverancier.
 *
 * `laadscript: true` markeert een tag die alleen een bibliotheek ophaalt
 * (gtag.js). Die wordt één keer geladen; dat hij ná consent geen nieuw request
 * doet, zegt dus niets.
 *
 * `sessie_opname: true` markeert tools die klikken, scrollen en muisbewegingen
 * opnemen (heatmaps, sessie-opnames). Die vallen in de regel niet onder de
 * uitzondering voor analytische cookies; lib/prioriteit.js weegt ze daarom
 * zwaarder dan gewone bezoekersstatistieken.
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
    consent_api: 'Google Consent Mode', laadscript: true,
    // /a?id=G-… is de diagnoseping van de Google-tag zelf.
    patronen: [/googletagmanager\.com\/gtag\/js/, /googletagmanager\.com\/gtag\/destination/, /googletagmanager\.com\/a$/, /\/gtag\/js$/],
    dom_signalen: [/googletagmanager\.com\/gtag\/js/, /\bgtag\(/],
    cookies: [],
  },
  {
    id: 'google_analytics', naam: 'Google Analytics', leverancier: 'google', categorie: 'analytics', tracking: true,
    consent_api: 'Google Consent Mode',
    patronen: [/google-analytics\.com\//, /analytics\.google\.com\//, /stats\.g\.doubleclick\.net\//, /\/g\/collect$/, /\/j\/collect$/, /\/r\/collect$/],
    dom_signalen: [/google-analytics\.com/, /\bG-[A-Z0-9]{6,}\b/, /\bUA-\d{4,}-\d+\b/, /\bga\('create'/],
    cookies: [/^_ga$/, /^_ga_/, /^_gid$/, /^_gat/, /^__utm/, /^_dc_gtm_/, /^_gaexp/],
  },
  {
    id: 'google_ads', naam: 'Google Ads / DoubleClick', leverancier: 'google', categorie: 'advertising', tracking: true,
    consent_api: 'Google Consent Mode',
    patronen: [/googleadservices\.com\//, /googlesyndication\.com\//, /doubleclick\.net\//, /adservice\.google/, /(^|\.)google\.[a-z.]+\/pagead\//, /(^|\.)google\.[a-z.]+\/ads\//, /(^|\.)google\.[a-z.]+\/ccm\//, /(^|\.)google\.[a-z.]+\/gen_204/, /(^|\.)google\.[a-z.]+\/rmkt\//],
    dom_signalen: [/\bAW-\d{6,}\b/, /googleadservices\.com/, /googlesyndication\.com/],
    cookies: [/^_gcl_/, /^_gac_/, /^IDE$/, /^test_cookie$/, /^DSID$/, /^NID$/, /^1P_JAR$/, /^AEC$/, /^__Secure-3P/, /^__Secure-1P/, /^CONSENT$/, /^SOCS$/, /^ar_debug$/],
  },
  {
    // Vóór 'youtube': de privacymodus zet bij het laden geen cookies, dus dat
    // is een andere situatie dan een gewone embed. Beelden en video komen van
    // ytimg.com en googlevideo.com; die vallen onder 'youtube', want beide
    // varianten gebruiken ze.
    id: 'youtube_nocookie', naam: 'YouTube (privacymodus, youtube-nocookie.com)', leverancier: 'google', categorie: 'embed', tracking: false,
    patronen: [/(^|\.)youtube-nocookie\.com\//],
    dom_signalen: [/youtube-nocookie\.com\/embed/],
    cookies: [],
  },
  {
    id: 'youtube', naam: 'YouTube (embed)', leverancier: 'google', categorie: 'embed', tracking: true,
    patronen: [/(^|\.)youtube\.com\//, /(^|\.)ytimg\.com\//, /(^|\.)googlevideo\.com\//, /(^|\.)youtu\.be\//],
    dom_signalen: [/youtube\.com\/embed/, /youtube\.com\/iframe_api/],
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
    consent_api: "fbq('consent', 'revoke' / 'grant')",
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
    id: 'hotjar', naam: 'Hotjar', leverancier: 'hotjar', categorie: 'analytics', tracking: true, sessie_opname: true,
    patronen: [/(^|\.)hotjar\.com\//, /(^|\.)hotjar\.io\//],
    dom_signalen: [/hotjar\.com/, /\bhj\(/, /_hjSettings/],
    cookies: [/^_hj/],
  },
  {
    id: 'tiktok_pixel', naam: 'TikTok Pixel', leverancier: 'tiktok', categorie: 'advertising', tracking: true,
    patronen: [/analytics\.tiktok\.com\//, /(^|\.)tiktok\.com\/i18n\/pixel/, /analytics-ipv6\.tiktokw\.us\//],
    dom_signalen: [/analytics\.tiktok\.com/, /\bttq\.(load|page|track)\(/],
    cookies: [/^_ttp$/, /^_tt_enable_cookie$/, /^ttwid$/, /^tt_chain_token$/, /^tt_csrf_token$/, /^tt_webid/],
  },
  {
    id: 'microsoft_clarity', naam: 'Microsoft Clarity', leverancier: 'microsoft', categorie: 'analytics', tracking: true, sessie_opname: true,
    consent_api: "Clarity Consent API (clarity('consentv2', ...))",
    patronen: [/(^|\.)clarity\.ms\//],
    dom_signalen: [/clarity\.ms/, /\bclarity\(/],
    // SM en MR zijn te algemene namen; die worden via het domein (clarity.ms) herkend.
    cookies: [/^_clck$/, /^_clsk$/, /^CLID$/, /^ANONCHK$/],
  },
  {
    id: 'microsoft_ads', naam: 'Microsoft Advertising (UET/Bing)', leverancier: 'microsoft', categorie: 'advertising', tracking: true,
    consent_api: "UET Consent Mode (uetq.push('consent', ...))",
    // c.bing.com is de cookiesynchronisatie van UET; bat.bing.net ontvangt de hits.
    patronen: [/bat\.bing\.(com|net)\//, /(^|\.)bing\.com\/bat/, /(^|\.)bing\.com\/action/, /(^|\.)bing\.com\/p\/action/, /(^|\.)c\.bing\.com\//],
    dom_signalen: [/bat\.bing\.(com|net)/, /\buetq\b/],
    cookies: [/^_uetsid$/, /^_uetvid$/, /^_uetmsclkid$/, /^MUID$/, /^MUIDB$/],
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
    id: 'crazyegg', naam: 'Crazy Egg', leverancier: 'crazyegg', categorie: 'analytics', tracking: true, sessie_opname: true,
    patronen: [/(^|\.)crazyegg\.com\//], dom_signalen: [/crazyegg\.com/], cookies: [/^_ce\.s$/, /^_ce\.clock_/, /^cebs$/, /^cebsp_$/, /^_CEFT$/],
  },
  {
    id: 'mouseflow', naam: 'Mouseflow', leverancier: 'mouseflow', categorie: 'analytics', tracking: true, sessie_opname: true,
    patronen: [/(^|\.)mouseflow\.com\//], dom_signalen: [/mouseflow\.com/], cookies: [/^mf_/],
  },
  {
    id: 'fullstory', naam: 'FullStory', leverancier: 'fullstory', categorie: 'analytics', tracking: true, sessie_opname: true,
    patronen: [/(^|\.)fullstory\.com\//], dom_signalen: [/fullstory\.com/], cookies: [/^fs_uid$/, /^fs_lua$/, /^fs_cid$/],
  },
  {
    id: 'mixpanel', naam: 'Mixpanel', leverancier: 'mixpanel', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)mixpanel\.com\//, /(^|\.)mxpnl\.com\//], dom_signalen: [/mixpanel/], cookies: [/^mp_[0-9a-f]{32}_mixpanel$/],
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
    // Self-hosted: de collector staat meestal op een eigen domein, dus vooral de cookies verraden hem.
    id: 'snowplow', naam: 'Snowplow', leverancier: 'snowplow', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)snowplowanalytics\.com\//, /\/com\.snowplowanalytics\.snowplow\/tp2$/],
    dom_signalen: [/snowplow/i],
    cookies: [/^_sp_id\./, /^_sp_ses\./],
  },
  {
    // WooCommerce "Order Attribution": onthoudt via welk kanaal een bezoeker binnenkwam.
    id: 'sourcebuster', naam: 'Sourcebuster (WooCommerce bronherkenning)', leverancier: 'woocommerce', categorie: 'analytics', tracking: true,
    patronen: [],
    dom_signalen: [/sourcebuster/i, /order-attribution/],
    cookies: [/^sbjs_/],
  },
  {
    id: 'shopify_analytics', naam: 'Shopify-analytics', leverancier: 'shopify', categorie: 'analytics', tracking: true,
    patronen: [/monorail-edge\.shopifysvc\.com\//],
    dom_signalen: [/trekkie/, /monorail-edge\.shopifysvc\.com/],
    cookies: [/^_shopify_y$/, /^_shopify_s$/, /^_shopify_sa_[pt]$/, /^_shopify_analytics$/, /^_shopify_marketing$/, /^_orig_referrer$/, /^_landing_page$/],
  },
  {
    id: 'yotpo', naam: 'Yotpo (reviews, loyalty en pixel)', leverancier: 'yotpo', categorie: 'marketing_automation', tracking: true,
    patronen: [/(^|\.)yotpo\.com\//, /(^|\.)yotpoapi\.com\//],
    dom_signalen: [/yotpo\.com/],
    cookies: [/^yotpo_pixel$/],
  },
  {
    // Nederlandse call tracking en attributie; koppelt telefoontjes aan het websitebezoek.
    id: 'qooqie', naam: 'Qooqie (call tracking)', leverancier: 'qooqie', categorie: 'analytics', tracking: true,
    patronen: [/(^|\.)qooqie\.com\//],
    dom_signalen: [/qooqie\.com/],
    cookies: [],
  },
  {
    // Mailchimp-sitekoppeling (pop-ups, e-commerce-tracking); Mailchimp is van Intuit.
    id: 'mailchimp', naam: 'Mailchimp', leverancier: 'intuit', categorie: 'marketing_automation', tracking: true,
    // Niet list-manage.com: daar staan ook gewone aanmeldformulieren.
    patronen: [/(^|\.)chimpstatic\.com\//, /mcjs\.prd\.a\.intuit\.com\//],
    dom_signalen: [/chimpstatic\.com/],
    cookies: [],
  },
  {
    id: 'brevo', naam: 'Brevo (voorheen Sendinblue)', leverancier: 'brevo', categorie: 'marketing_automation', tracking: true,
    patronen: [/(^|\.)sibautomation\.com\//, /(^|\.)brevo\.com\//, /(^|\.)sendinblue\.com\//],
    dom_signalen: [/sibautomation\.com/, /brevo\.com/, /sendinblue\.com/],
    cookies: [/^sib_cuid$/],
  },
  {
    // Advertentie-exchange (Index Exchange); verschijnt meestal als cookie-synchronisatie.
    id: 'casale_media', naam: 'Index Exchange (Casale Media)', leverancier: 'index_exchange', categorie: 'advertising', tracking: true,
    patronen: [/(^|\.)casalemedia\.com\//],
    dom_signalen: [],
    cookies: [/^CMID$/, /^CMPS$/, /^CMPRO$/],
  },
  {
    id: 'ad4mat', naam: 'ad4mat (affiliate en advertenties)', leverancier: 'ad4mat', categorie: 'advertising', tracking: true,
    patronen: [/(^|\.)ad4m\.at\//],
    dom_signalen: [/ad4m\.at/],
    cookies: [],
  },
  {
    // Zegt zelf cookieloos te meten; dat is een eigenschap, de lezer weegt hem.
    id: 'ahrefs_analytics', naam: 'Ahrefs Web Analytics', leverancier: 'ahrefs', categorie: 'analytics', tracking: true,
    patronen: [/analytics\.ahrefs\.com\//],
    dom_signalen: [/analytics\.ahrefs\.com/],
    cookies: [],
  },
  {
    id: 'userlike', naam: 'Userlike (chat)', leverancier: 'userlike', categorie: 'chat', tracking: true,
    patronen: [/(^|\.)userlike\.com\//, /userlike-cdn-widgets\./],
    dom_signalen: [/userlike/],
    cookies: [/^uslk_/],
  },
  {
    id: 'futy', naam: 'Futy (chat- en WhatsApp-widget)', leverancier: 'futy', categorie: 'chat', tracking: true,
    patronen: [/(^|\.)futy\.io\//],
    dom_signalen: [/futy\.io/],
    cookies: [],
  },
  {
    id: 'trusted_shops', naam: 'Trusted Shops (keurmerk en reviews)', leverancier: 'trusted_shops', categorie: 'embed', tracking: false,
    patronen: [/(^|\.)trustedshops\.com\//, /(^|\.)etrusted\.com\//, /(^|\.)trstd-login\.trustedshops\.com\//],
    dom_signalen: [/trustedshops\.com/, /etrusted\.com/],
    cookies: [],
  },
  {
    // Telemetrie van het platform zelf, geen tag van de site-eigenaar.
    id: 'wix_telemetrie', naam: 'Wix-platform (telemetrie)', leverancier: 'wix', categorie: 'platform', tracking: false,
    patronen: [/frog\.wix\.com\//, /panorama\.wixapps\.net\//],
    dom_signalen: [],
    cookies: [],
  },
  {
    id: 'shopify_telemetrie', naam: 'Shopify-platform (telemetrie)', leverancier: 'shopify', categorie: 'platform', tracking: false,
    patronen: [/otlp-http-production\.shopifysvc\.com\//],
    dom_signalen: [],
    cookies: [],
  },
  {
    id: 'cloudflare_turnstile', naam: 'Cloudflare Turnstile (botcontrole)', leverancier: 'cloudflare', categorie: 'functioneel_extern', tracking: false,
    patronen: [/challenges\.cloudflare\.com\//],
    dom_signalen: [/challenges\.cloudflare\.com\/turnstile/],
    cookies: [],
  },
  {
    id: 'sentry', naam: 'Sentry (foutmeldingen)', leverancier: 'sentry', categorie: 'monitoring', tracking: false,
    patronen: [/(^|\.)sentry-cdn\.com\//, /(^|\.)ingest\.sentry\.io\//, /(^|\.)ingest\.[a-z]+\.sentry\.io\//],
    dom_signalen: [/sentry-cdn\.com/],
    cookies: [],
  },
  {
    id: 'server_side_tagging_run_app', naam: 'Server-side tagging endpoint (Google Cloud Run *.run.app)', leverancier: 'onbekend', categorie: 'server_side_tagging', tracking: true,
    patronen: [/\.run\.app\//],
    dom_signalen: [/\.run\.app\//],
    cookies: [],
  },

  // --- CMP's (worden apart herkend in lib/cmp/detect.js; hier alleen voor het request-label) ---
  { id: 'cookiescript', naam: 'CookieScript', leverancier: 'cookiescript', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookie-script\.com\//], dom_signalen: [], cookies: [] },
  { id: 'cookiebot', naam: 'Cookiebot', leverancier: 'usercentrics', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookiebot\.(com|eu)\//], dom_signalen: [], cookies: [] },
  // CookieCode: Nederlandse CMP. Hier alleen het request-label; de consent-stap kent hem nog niet.
  { id: 'cookiecode', naam: 'CookieCode', leverancier: 'cookiecode', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookiecode\.nl\//], dom_signalen: [], cookies: [] },
  { id: 'onetrust', naam: 'OneTrust', leverancier: 'onetrust', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookielaw\.org\//, /(^|\.)onetrust\.com\//], dom_signalen: [], cookies: [] },
  { id: 'cookieyes', naam: 'CookieYes', leverancier: 'cookieyes', categorie: 'cmp', tracking: false, patronen: [/(^|\.)cookieyes\.com\//, /(^|\.)cdn-cookieyes\.com\//], dom_signalen: [], cookies: [] },
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
    patronen: [/cdnjs\.cloudflare\.com\//, /cdn\.jsdelivr\.net\//, /(^|\.)unpkg\.com\//, /ajax\.googleapis\.com\//, /code\.jquery\.com\//, /(^|\.)bootstrapcdn\.com\//, /(^|\.)fontawesome\.com\//, /(^|\.)typekit\.net\//, /fonts\.bunny\.net\//, /(^|\.)cloudfront\.net\//, /(^|\.)akamaized\.net\//, /(^|\.)wp\.com\//, /(^|\.)gravatar\.com\//,
      // Bestanden van het platform waarop de site draait (Wix, Shopify).
      /(^|\.)parastorage\.com\//, /(^|\.)wixstatic\.com\//, /cdn\.shopify\.com\//, /fonts\.shopifycdn\.com\//],
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

/**
 * Namen die óók gewoon in de eigen API van een site voorkomen (`sid`, `uid`,
 * `session_id`) of te kort zijn om op te vertrouwen (`em`, `fn`). Die tellen
 * alleen mee in een request naar een bekende tracker of in een hit die het
 * protocol van een tracker volgt; elders staan ze apart als "niet meegeteld".
 */
export const GENERIEKE_PARAMETERS = new Set([
  'cid', 'sid', 'uid', 'user_id', 'userid', 'uuid', 'vid', 'visitor_id', 'visitorid', 'client_id', 'clientid',
  'session_id', 'sessionid', 'anonymous_id', 'anonymousid', 'device_id', 'deviceid', 'external_id',
  'em', 'ph', 'fn', 'ln', 'muid',
]);

/** Parameters met een voorvoegsel, zoals ud[em]=... bij Meta advanced matching. */
export const IDENTIFIER_VOORVOEGSELS = [
  { patroon: /^ud\[/, betekenis: 'Meta advanced matching (gehashte klantdata)' },
  { patroon: /^cd\[/, betekenis: 'Meta custom data' },
];

/**
 * Waardepatronen die ook zonder herkenbare parameternaam een identifier verraden.
 * Het derde patroon is algemeen (een versienummer of tijdstempel kan er ook op
 * lijken) en telt daarom alleen mee in een trackercontext, net als de
 * GENERIEKE_PARAMETERS.
 */
export const IDENTIFIER_WAARDEN = [
  { patroon: /\bfb\.[12]\.\d{13}\.\d{6,}\b/, betekenis: 'Meta _fbp-waarde' },
  { patroon: /\bGA1\.\d\.\d{6,}\.\d{9,}\b/, betekenis: 'Google Analytics _ga-waarde' },
  { patroon: /\b\d{8,10}\.\d{10}\b/, betekenis: 'id in <getal>.<unix-tijd>-formaat (zoals een GA client-id, _gcl_au of auid)', generiek: true },
];

/**
 * Herkent een hit aan zijn protocol in plaats van aan de host. Een GA4-hit
 * blijft een GA4-hit als hij naar data.klant.nl gaat (server-side tagging) of
 * via een proxy loopt.
 */
export function volgtTrackerProtocol(query) {
  if (!query) return null;
  if (query.v === '2' && /^G-[A-Z0-9]{4,}$/i.test(query.tid || '')) return 'ga4';
  if (query.v === '1' && /^UA-\d+-\d+$/i.test(query.tid || '')) return 'universal_analytics';
  if (query.id && query.ev && /^\d{10,}$/.test(query.id)) return 'meta_pixel';
  return null;
}

// --- CNAME cloaking ------------------------------------------------------------

/**
 * Waar een eigen subdomein (data.klant.nl) naartoe kan wijzen als er tracking
 * achter zit. Een request naar zo'n subdomein ziet eruit als first-party, maar
 * komt bij een trackingdienst of een server-side tagging-server uit. Alleen
 * diensten waarvan bekend is dat klanten ze via een CNAME koppelen.
 */
export const CNAME_DOELEN = [
  { patroon: /(^|\.)stape\.(io|net)\.?$/, naam: 'Stape (server-side Google Tag Manager)', soort: 'server_side_tagging' },
  { patroon: /(^|\.)taggrs\.io\.?$/, naam: 'Taggrs (server-side Google Tag Manager)', soort: 'server_side_tagging' },
  { patroon: /(^|\.)addingwell\.(com|io)\.?$/, naam: 'Addingwell (server-side Google Tag Manager)', soort: 'server_side_tagging' },
  { patroon: /\.run\.app\.?$/, naam: 'Google Cloud Run (meestal server-side GTM)', soort: 'server_side_tagging' },
  { patroon: /\.appspot\.com\.?$/, naam: 'Google App Engine (vaak server-side GTM)', soort: 'server_side_tagging' },
  { patroon: /(^|\.)omtrdc\.net\.?$/, naam: 'Adobe Analytics', soort: 'analytics' },
  { patroon: /(^|\.)adobedc\.net\.?$/, naam: 'Adobe Experience Platform', soort: 'analytics' },
  { patroon: /(^|\.)eulerian\.net\.?$/, naam: 'Eulerian', soort: 'analytics' },
  { patroon: /(^|\.)at-o\.net\.?$/, naam: 'AT Internet / Piano Analytics', soort: 'analytics' },
  { patroon: /(^|\.)wt-eu02\.net\.?$/, naam: 'Mapp (Webtrekk)', soort: 'analytics' },
  { patroon: /(^|\.)tagcommander\.com\.?$/, naam: 'Commanders Act', soort: 'tagbeheer' },
  { patroon: /(^|\.)dnsdelegation\.io\.?$/, naam: 'Criteo (first-party-koppeling)', soort: 'advertising' },
];

export function herkenCnameDoel(doel) {
  const host = String(doel || '').toLowerCase();
  return CNAME_DOELEN.find((d) => d.patroon.test(host)) || null;
}

// --- Google Consent Mode per hit ---------------------------------------------

/**
 * `gcs=G1xy` in een Google-hit: x = ad_storage, y = analytics_storage, 1 =
 * toegestaan, 0 = geweigerd. G100 is dus een hit zonder cookies (een
 * "cookieloze ping" bij Consent Mode advanced). `gcd` is de uitgebreide v2-
 * code met ook ad_user_data en ad_personalization; die bewaren we letterlijk.
 * Geen gcs betekent: Consent Mode is niet actief voor die hit.
 */
const GCS_BETEKENIS = {
  G100: 'advertentie- en analyse-opslag geweigerd',
  G101: 'advertentie-opslag geweigerd, analyse-opslag toegestaan',
  G110: 'advertentie-opslag toegestaan, analyse-opslag geweigerd',
  G111: 'advertentie- en analyse-opslag toegestaan',
};

/**
 * De consentstatus die een hit zelf meestuurt. Google zet `gcs` in elke hit;
 * Microsoft UET zet `asc` (D = ad storage denied, G = granted) in hits naar
 * bat.bing.com/.net. `geweigerd: true` betekent: alle opslag geweigerd, dus
 * een cookieloze ping. `code` is wat het rapport toont ("G100", "asc=D").
 */
export function consentModeVanHit(query, host = '') {
  const gcs = query?.gcs;
  if (gcs && Object.hasOwn(GCS_BETEKENIS, gcs)) {
    return {
      systeem: 'google',
      code: gcs,
      geweigerd: gcs === 'G100',
      advertentie_toegestaan: gcs[2] === '1',
      gcd: query.gcd || null,
      betekenis: GCS_BETEKENIS[gcs],
    };
  }
  const asc = query?.asc;
  if ((asc === 'D' || asc === 'G') && /(^|\.)bing\.(com|net)$/.test(host)) {
    return {
      systeem: 'microsoft',
      code: `asc=${asc}`,
      geweigerd: asc === 'D',
      advertentie_toegestaan: asc === 'G',
      gcd: null,
      betekenis: asc === 'D' ? 'advertentie-opslag geweigerd (UET Consent Mode)' : 'advertentie-opslag toegestaan (UET Consent Mode)',
    };
  }
  return null;
}

// --- Cookies ---------------------------------------------------------------

/** Cookies van de CMP zelf: die zijn per definitie vóór consent aanwezig en tellen niet mee. */
const CMP_COOKIES = [
  /^CookieScriptConsent$/, /^CookieConsent$/, /^CookieConsentBulkSetting/, /^cmplz_/, /^cookieyes-consent$/, /^cky-/,
  /^OptanonConsent$/, /^OptanonAlertBoxClosed$/, /^euconsent-v2$/, /^_iub_cs-/, /^uc_/, /^usercentrics/,
  /^didomi_token$/, /^cookie_notice_accepted$/, /^cookielawinfo-checkbox-/, /^viewed_cookie_policy$/,
  /^moove_gdpr_popup$/, /^borlabs-cookie/, /^klaro$/, /^cc_cookie$/, /^cookieconsent_status$/, /^cookiefirst-consent$/,
  /^CookieInformationConsent$/, /^TERMLY_API_CACHE$/, /^osano_consentmanager/, /^axeptio_/, /^rcb-consent$/, /^tarteaucitron$/,
  // Consentcookies van platforms met een ingebouwde banner (Wix, Shopify).
  /^consent-policy$/, /^_tracking_consent$/, /^_cmp_a$/,
];

/**
 * Functionele cookies die een site of zijn infrastructuur nodig heeft, per
 * soort. De soort komt in het rapport bij "niet meegeteld", zodat de lezer
 * ziet wáárom. Alleen bekende namen; een onbekende cookie blijft "onbekend".
 *
 * Bron per groep: de cookiedocumentatie van het platform of de leverancier.
 * Twijfelgevallen (een cookie die óók voor analyse wordt gebruikt, zoals
 * Shopify's _shopify_y) horen hier niet.
 */
const FUNCTIONELE_COOKIES = [
  {
    soort: 'sessie of beveiliging van het CMS',
    patronen: [
      /^PHPSESSID$/, /^wordpress_test_cookie$/, /^wp-settings-/, /^wordpress_logged_in_/, /^wordpress_sec_/, /^wp_lang$/,
      /^XSRF-TOKEN$/, /^laravel_session$/, /^csrftoken$/, /^_csrf/, /^CSRF-TOKEN$/, /^ASP\.NET_SessionId$/,
      /^JSESSIONID$/, /^ci_session$/, /^__Host-/, /^pll_language$/, /^wpml_/, /^_icl_/, /^wpEmojiSettingsSupports$/,
      /^frontend$/, /^frontend_cid$/, /^form_key$/, /^cookietest$/, /^humans_/, /^wfwaf-authcookie-/, /^wordpress_/,
    ],
  },
  {
    soort: 'webshop (winkelwagen, sessie)',
    patronen: [
      /^woocommerce_/, /^wp_woocommerce_session_/, /^wc_cart_hash_/, /^wc_fragments_/,
      // Shopify
      /^cart$/, /^cart_sig$/, /^cart_ts$/, /^cart_ver$/, /^cart_currency$/, /^secure_customer_sig$/, /^localization$/,
      /^keep_alive$/, /^_secure_session_id$/, /^shopify_pay_redirect$/, /^_shopify_essential$/, /^_shop_app_essential$/,
      // Magento
      /^mage-cache-storage/, /^mage-cache-sessid$/, /^mage-messages$/, /^private_content_version$/, /^section_data_ids$/,
      /^X-Magento-Vary$/, /^store$/, /^mage-translation-/, /^product_data_storage$/,
    ],
  },
  {
    // Wix markeert deze als essentieel: sessie, beveiliging en hoe de pagina gerenderd is.
    soort: 'Wix-platform (sessie, beveiliging, weergave)',
    patronen: [/^svSession$/, /^hs$/, /^ssr-caching$/, /^server-session-bind$/, /^client-session-bind$/, /^bSession$/, /^fedops\.logger\./],
  },
  {
    soort: 'loadbalancer',
    patronen: [/^AWSALB/, /^AWSELB/, /^BIGipServer/, /^SERVERID$/, /^ROUTEID$/, /^ARRAffinity/, /^__cflb$/],
  },
  {
    soort: 'bot- en DDoS-beveiliging',
    patronen: [
      /^__cf_bm$/, /^cf_clearance$/, /^__cfruid$/, /^_cfuvid$/, /^cf_chl_/,
      /^incap_ses_/, /^nlbi_/, /^visid_incap_/, /^ak_bmsc$/, /^bm_sz$/, /^_abck$/, /^bm_sv$/, /^bm_mi$/, /^bm_so$/,
      /^datadome$/, /^TS[0-9a-f]{8,}(_\d+)?$/i, /^__ddg/, /^sucuri_cloudproxy_/,
    ],
  },
  {
    soort: 'betaling (fraudepreventie)',
    patronen: [/^__stripe_mid$/, /^__stripe_sid$/],
  },
];

/** De bekende tag achter een cookiedomein (".clarity.ms" -> Clarity), of null. */
export function tagVanDomein(domein) {
  const host = String(domein || '').replace(/^\.+/, '').toLowerCase();
  return host ? herkenTag(`${host}/`) : null;
}

/**
 * Classificeert een cookie: cmp, functioneel, tracking (met de tag waar hij
 * bij hoort) of onbekend.
 *
 * Eerst op naam. Lukt dat niet en staat de cookie op het domein van een
 * andere partij, dan op dat domein: een onbekende cookie op `.clarity.ms` is
 * van Clarity, een op `.cookiebot.com` van de CMP. Het domein van de site zelf
 * zegt niets over de eigenaar, dus daar blijft een onbekende naam onbekend.
 */
export function classificeerCookie(naam, domein = '', extern = false) {
  if (CMP_COOKIES.some((patroon) => patroon.test(naam))) return { classificatie: 'cmp', tag: null, functie: null };
  for (const tag of TAGS) {
    if (tag.cookies.some((patroon) => patroon.test(naam))) return { classificatie: 'tracking', tag: tag.id, functie: null };
  }
  const functioneel = FUNCTIONELE_COOKIES.find((groep) => groep.patronen.some((patroon) => patroon.test(naam)));
  if (functioneel) return { classificatie: 'functioneel', tag: null, functie: functioneel.soort };

  if (extern && domein) {
    const tag = tagVanDomein(domein);
    if (tag?.categorie === 'cmp') return { classificatie: 'cmp', tag: tag.id, functie: null };
    if (tag?.tracking) return { classificatie: 'tracking', tag: tag.id, functie: null };
  }
  return { classificatie: 'onbekend', tag: null, functie: null };
}
