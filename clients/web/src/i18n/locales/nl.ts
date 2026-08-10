import type { Catalog } from '../index';

export const nl: Catalog = {
  app_title: 'CumulusVPN — Privé internet, geen account, geen logs',

  header_nav_connect: 'Verbinden',
  header_nav_upgrade: 'Upgraden',
  header_theme_label: 'Thema: {mode}',
  header_theme_system: 'systeem',
  header_theme_light: 'licht',
  header_theme_dark: 'donker',
  header_language_label: 'Taal',

  footer_tagline: 'CumulusVPN — Gedecentraliseerde VPN op Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Bèta-traject · geen account · geen logs',

  common_copy: 'Kopiëren',
  common_copied: 'Gekopieerd',
  common_qr_alt: 'QR-code',
  common_powered_by_flux_link: 'Powered by Flux — opent runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'seed',
  common_directory: 'directory',

  error_gateway_rejected: 'Gateway heeft inschrijving geweigerd ({slug}): {message}',

  countries_search_placeholder: '🔎  Zoek in {n} landen…',
  countries_search_label: 'Landen zoeken',
  countries_list_label: 'Landen',
  countries_no_match: 'Geen land komt overeen met “{query}”.',
  countries_nodes: { one: '{n} node', other: '{n} nodes' },

  connect_eyebrow: 'Bèta-traject · WireGuard-configuratie',
  connect_title: 'Eén sleutel, <glow>elke gateway.</glow>',
  connect_lede:
    'Je WireGuard-sleutelpaar wordt hier gegenereerd, in je browser — de privésleutel verlaat dit tabblad nooit. Kies een land, schrijf je in bij de dichtstbijzijnde Flux-gateway en exporteer een importklare<mono> .conf</mono> met QR-code. Voor altijd gratis op 100 KB/s; <upgrade>upgrade met FLUX</upgrade> voor volle snelheid.',
  connect_verify_warn:
    'Directoryhandtekening kon niet worden geverifieerd — endpoints worden alleen ter informatie getoond.',
  connect_notice_no_live_gateway:
    'Geen actieve gateway bereikbaar vanuit de browser. De landen uit de ondertekende directory worden getoond — configuraties schrijven zich in bij een actieve gateway zodra er één bereikbaar is.',
  connect_choose_location: 'Kies een locatie',
  connect_tier_free: 'GRATIS · 100 KB/s',
  connect_loading_directory: 'Ondertekende directory wordt opgehaald en gateways worden gezocht…',
  connect_your_config: 'Jouw configuratie',
  connect_source_directory: '{source}-directory',
  connect_live_nodes: { one: '{n} actieve node', other: '{n} actieve nodes' },
  connect_select_country: 'Selecteer een land om door te gaan',
  connect_enrolling: 'Inschrijven…',
  connect_generate: '.conf genereren',
  connect_no_gateway_in_country:
    "Geen actieve gateway bereikbaar in {country} vanuit de browser. Inschrijving gaat naar de control-API van een gateway (http :51821), die https-pagina's niet kunnen bereiken — dit werkt wel vanuit de desktop- en mobiele clients, die deze kern delen.",
  connect_error_enroll_failed: 'Inschrijving mislukt.',
  connect_qr_caption: 'Scan met de WireGuard-app',
  connect_stat_assigned_ip: 'Toegewezen IP',
  connect_stat_endpoint: 'Endpoint',
  connect_stat_dns: 'DNS',
  connect_download_conf: '.conf downloaden',
  connect_conf_note:
    'Gekoppeld aan deze server. Bij een herstart of verplaatsing blijft WireGuard de tunnel als verbonden tonen terwijl er niets doorkomt — kom terug en genereer een nieuwe .conf.',
  connect_conf_regenerate: 'Nieuwe .conf genereren',
  connect_conf_stale:
    'De server die je laatste configuratie voor {country} uitgaf, is vervangen — die configuratie kan geen verbinding meer maken. Genereer hieronder een nieuwe.',
  connect_conf_unsure:
    'De server die je laatste configuratie voor {country} uitgaf, was niet bereikbaar. Mogelijk tijdelijk offline, of definitief weg — als je tunnel geen verkeer doorlaat, genereer hieronder een nieuwe configuratie.',
  connect_conf_checking: 'Je laatste configuratie wordt gecontroleerd…',
  connect_upgrade_cta: 'Upgraden naar volle snelheid →',
  connect_identity_title: 'Identiteit van dit apparaat',
  connect_regenerate: 'Sleutel opnieuw genereren',
  connect_identity_note:
    'Eén sleutelpaar per apparaat schrijft zich in bij veel gateways; premium volgt de sleutel overal via de chain. De betaalcode hieronder koppelt een FLUX-betaling aan deze sleutel.',
  connect_field_public_key: 'WireGuard publieke sleutel',
  connect_field_payment_code: 'Betaalcode (memo)',

  upgrade_loading: 'Betaalgegevens worden geladen…',
  upgrade_eyebrow: 'Upgrade · betaal in FLUX',
  upgrade_title: 'Upgraden naar volle snelheid',
  upgrade_lede:
    'Stuur FLUX met precies het bericht hieronder. Elke gateway scant de chain en ontgrendelt je sleutel binnen ~1 minuut — op alle servers tegelijk, voor 30 dagen. Geen account, geen kaart, geen bedrijf dat kan afgeven wat het nooit had.',
  upgrade_usd_line: '≈ {usd} · per 30 dagen',
  upgrade_qr_caption: 'Scan met Zelcore / SSP Wallet',
  upgrade_field_address: 'Betaaladres',
  upgrade_field_message: 'Bericht (verplicht)',
  upgrade_open_wallet: 'Openen in wallet',
  upgrade_prepay_note:
    '<strong>Vooruitbetalen:</strong> betaal een veelvoud van het bedrag om net zoveel maanden ineens toe te voegen — bijv. {amount} FLUX = 3 maanden. Extra maanden stapelen (tot 24), dus je kunt op elk moment bijvullen.',
  upgrade_privacy_note:
    'Opent in Zelcore / SSP Wallet. Betaling wordt geverifieerd op de Flux-blockchain — wij zien nooit wie je bent. Het bericht koppelt de betaling aan je sleutel; versturen zonder bericht betekent dat het geld aankomt maar niets wordt ontgrendeld.',
  upgrade_back: '← Terug naar Verbinden',

  upgrade_eyebrow_card: 'Of betaal met kaart',
  upgrade_card_lede:
    'Abonneer je met een kaart, Apple Pay of Google Pay. De checkout wordt afgehandeld door Stripe — wij zien nooit je kaart. Je premium wordt nog steeds geactiveerd op de Flux-blockchain, alleen gekoppeld aan je anonieme betaalcode.',
  upgrade_plan_aria: 'Abonnement',
  upgrade_plan_monthly: '{usd} / maand',
  upgrade_plan_annual: '{usd} / jaar',
  upgrade_card_cta: 'Betalen met kaart',
  upgrade_card_cta_busy: 'Beveiligde checkout wordt geopend…',
  upgrade_card_error: 'Kon de checkout niet openen. Probeer het zo opnieuw.',
  upgrade_card_note:
    'Verlengt automatisch; opzeggen kan altijd via de Stripe-bevestigingsmail. Hierboven betalen in FLUX is goedkoper — de kaartprijs dekt de verwerkingskosten.',
  upgrade_activating_title: 'Je premium wordt geactiveerd…',
  upgrade_state_pending: 'Betaling ontvangen — je activering op het Flux-netwerk wordt voorbereid.',
  upgrade_state_broadcast: 'Activering verzonden naar het Flux-netwerk — wachten op bevestiging.',
  upgrade_state_confirmed:
    'Bevestigd! Volle snelheid wordt binnen een minuut op alle servers ontgrendeld.',
  upgrade_state_failed:
    'Er ging iets mis bij het activeren. Je betaling is veilig — we proberen het automatisch opnieuw en je premium verschijnt binnenkort.',
  upgrade_activating_hint: 'Je kunt deze pagina sluiten — de activering wordt vanzelf afgerond.',
  upgrade_activated_cta: 'Terug naar Verbinden →',

  redeem_eyebrow: 'Heb je een code?',
  redeem_lede:
    'Wissel een voucher of promocode in. Codes voor gratis tijd worden op het Flux-netwerk geactiveerd voor dit apparaat; kortingscodes gelden voor de kaartcheckout hierboven.',
  redeem_placeholder: 'CVPN-XXXXX-XXXXX',
  redeem_cta: 'Inwisselen',
  redeem_cta_busy: 'Controleren…',
  redeem_discount_applied:
    '{percent}% korting toegepast — betaal hierboven met kaart en de korting zit bij de checkout inbegrepen.',
  redeem_err_invalid: 'Die code is niet geldig. Controleer op typefouten en probeer het opnieuw.',
  redeem_err_expired: 'Deze code is verlopen.',
  redeem_err_exhausted: 'Deze code is al volledig gebruikt.',
  redeem_err_already: 'Dit apparaat heeft deze code al ingewisseld.',
  redeem_err_later:
    'Inwisselen is even niet beschikbaar — probeer het over een paar minuten opnieuw.',

  split_summary_title: 'Geavanceerd: split tunneling',
  split_tier_pill: 'PREMIUM · OPT-IN',
  split_lede:
    'Kies welke bestemmingen de VPN gebruiken. De gegenereerde configuratie drukt regels uit als WireGuard-AllowedIPs en werkt dus met de standaard WireGuard-app — alleen IP-reeksen en het omzeilen van het lokale netwerk (regels per app vereisen onze native apps).',
  split_mode_aria: 'Split-tunnelingmodus',
  split_mode_off: 'Uit',
  split_mode_exclude: 'Lijst uitsluiten',
  split_mode_include: 'Alleen deze',
  split_warn_exclude:
    'Uitgesloten verkeer verlaat je apparaat onbeschermd en toont je echte IP-adres.',
  split_warn_include:
    'Alleen de vermelde bestemmingen zijn beschermd — al het andere toont je echte IP-adres.',
  split_lan_label: 'Toegang tot lokaal netwerk toestaan (printers, NAS, casten)',
  split_cidr_placeholder: 'bijv. 192.168.0.0/16 of 203.0.113.7',
  split_cidr_aria: 'IP-adres of CIDR-reeks',
  split_add: 'Toevoegen',
  split_input_invalid: 'Geen geldig IP-adres of CIDR-reeks.',
  split_rules_empty:
    'Nog geen IP-regels — voeg hierboven een reeks toe, of gebruik gewoon lokale netwerktoegang.',
  split_remove_aria: 'Regel {value} verwijderen',
  split_next_note: 'Regels gelden voor de volgende configuratie die je op deze pagina genereert.',
  split_premium_required:
    'Split tunneling is een premiumfunctie. In plaats daarvan is een full-tunnelconfiguratie gegenereerd — upgrade om je regels toe te passen.',
  split_applied:
    'Split tunneling toegepast — deze configuratie routeert alleen wat je regels toestaan.',

  multihop_summary_title: 'Geavanceerd: multi-hop (twee configuraties)',
  multihop_tier_pill: 'PREMIUM · OPT-IN',
  multihop_lede:
    'Route via twee gateways zodat <strong>geen enkele server alleen zowel weet wie je bent als waar je heen gaat</strong>. Dit is trager en voegt latency toe — reken op ongeveer <strong>2× ping</strong> vergeleken met single-hop, en lagere piekdoorvoer door de dubbele versleuteling. Multi-hop is premium, maar één betaling van <mono>$0.99</mono> dekt beide hops (dezelfde sleutel K wordt automatisch premium bij entry en exit). Standaard uit — de single-hop-flow hierboven blijft primair.',
  multihop_entry_label: 'Entry-land (ziet jouw IP)',
  multihop_entry_aria: 'Entry-land',
  multihop_exit_label: 'Exit-land (ziet jouw bestemming)',
  multihop_exit_aria: 'Exit-land',
  multihop_style_same: 'Routestijl: gebalanceerd — zelfde land (één jurisdictie)',
  multihop_style_cross:
    'Routestijl: maximale privacy — over jurisdicties heen (twee operators, twee landen)',
  multihop_enrolling: 'Beide hops worden ingeschreven…',
  multihop_generate: 'Twee configuraties genereren',
  multihop_error_no_exit: 'Multi-hop heeft een aparte exit-gateway nodig; er is er geen gevonden.',
  multihop_error_no_gateways:
    'Geen actieve gateways bereikbaar vanuit de browser, dus er kon geen route worden gevonden. Multi-hop-nesting is eigenlijk een functie van onze apps — de desktop- en mobiele clients (zelfde kern) peilen gateways rechtstreeks en draaien de twee tunnels voor je.',
  multihop_error_failed: 'Genereren van multi-hop mislukt.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'buiten · MTU 1420',
  multihop_conf_inner_tag: 'binnen · MTU {mtu}',
  multihop_download_entry: 'wg-entry.conf downloaden',
  multihop_download_exit: 'wg-exit.conf downloaden',
  multihop_note:
    '<strong>Zo route je dit (eerlijke opmerking).</strong> Echte nesting met de standaard WireGuard-app is onhandig — die draait maar één tunnel tegelijk — dus multi-hop is eigenlijk een <strong>functie van onze apps</strong> (desktop/mobiel schakelen de twee tunnels voor je). Voor een handmatige opzet moet je eerst <mono>wg-entry.conf</mono> opzetten, dan alleen het exit-adres <mono>{exitIp}/32</mono> via die entry-tunnel routeren en de rest via <mono>wg-exit.conf</mono> sturen (binnen-MTU {mtu}, zodat er twee WireGuard-headers bij passen). Exit-endpoint: <mono>{endpoint}</mono>.<br/><strong>v1-kanttekening:</strong> beide hops gebruiken dezelfde sleutel K, wat elke <em>afzonderlijke</em> operator dwarsboomt, maar betekent dat een tegenstander die <em>beide</em> hops beheerst, ze via die gedeelde sleutel kan correleren. Aparte sleutels per hop komen in v1.5.',
};
