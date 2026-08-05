import type { Catalog } from '../index';

export const sv: Catalog = {
  app_title: 'CumulusVPN — Privat internet, inget konto, inga loggar',

  header_nav_connect: 'Anslut',
  header_nav_upgrade: 'Uppgradera',
  header_theme_label: 'Tema: {mode}',
  header_theme_system: 'system',
  header_theme_light: 'ljust',
  header_theme_dark: 'mörkt',
  header_language_label: 'Språk',

  footer_tagline: 'CumulusVPN — Decentraliserat VPN på Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Betaspår · inget konto · inga loggar',

  common_copy: 'Kopiera',
  common_copied: 'Kopierat',
  common_qr_alt: 'QR-kod',
  common_powered_by_flux_link: 'Powered by Flux — öppnar runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'frö',
  common_directory: 'katalog',

  error_gateway_rejected: 'Gatewayen avvisade registreringen ({slug}): {message}',

  countries_search_placeholder: '🔎  Sök bland {n} länder…',
  countries_search_label: 'Sök länder',
  countries_list_label: 'Länder',
  countries_no_match: 'Inga länder matchar ”{query}”.',
  countries_nodes: { one: '{n} nod', other: '{n} noder' },

  connect_eyebrow: 'Betaspår · WireGuard-konfiguration',
  connect_title: 'En nyckel, <glow>varje gateway.</glow>',
  connect_lede:
    'Ditt WireGuard-nyckelpar genereras här, i din webbläsare — den privata nyckeln lämnar aldrig fliken. Välj ett land, registrera dig hos närmaste Flux-gateway och exportera en importfärdig<mono> .conf</mono> och QR-kod. Gratis för alltid vid 100 KB/s; <upgrade>uppgradera med FLUX</upgrade> för full hastighet.',
  connect_verify_warn:
    'Katalogens signatur kunde inte verifieras — endpoints visas endast i informationssyfte.',
  connect_notice_no_live_gateway:
    'Ingen aktiv gateway nåbar från webbläsaren. Den signerade katalogens länder visas — konfigurationer registreras hos en aktiv gateway när en sådan är nåbar.',
  connect_choose_location: 'Välj en plats',
  connect_tier_free: 'GRATIS · 100 KB/s',
  connect_loading_directory: 'Löser upp den signerade katalogen och upptäcker gateways…',
  connect_your_config: 'Din konfiguration',
  connect_source_directory: '{source}-katalog',
  connect_live_nodes: { one: '{n} aktiv nod', other: '{n} aktiva noder' },
  connect_select_country: 'Välj ett land för att fortsätta',
  connect_enrolling: 'Registrerar…',
  connect_generate: 'Generera .conf',
  connect_no_gateway_in_country:
    'Ingen aktiv gateway nåbar i {country} från webbläsaren. Registreringen skickas till en gateways styr-API (http :51821), som https-sidor inte kan nå — det fungerar från desktop- och mobilklienterna som delar denna kärna.',
  connect_error_enroll_failed: 'Registreringen misslyckades.',
  connect_qr_caption: 'Skanna in i WireGuard-appen',
  connect_stat_assigned_ip: 'Tilldelad IP',
  connect_stat_endpoint: 'Endpoint',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Ladda ner .conf',
  connect_conf_note:
    'Knuten till den här servern. Om den startas om eller flyttas visar WireGuard fortfarande tunneln som ansluten trots att inget kommer fram — kom tillbaka hit och skapa en ny .conf.',
  connect_conf_regenerate: 'Skapa en ny .conf',
  connect_conf_stale:
    'Servern som utfärdade din senaste konfiguration för {country} har ersatts — den konfigurationen kan inte längre ansluta. Skapa en ny nedan.',
  connect_conf_unsure:
    'Kunde inte nå servern som utfärdade din senaste konfiguration för {country}. Den kan vara tillfälligt nere eller borta för gott — om din tunnel inte släpper igenom trafik, skapa en ny konfiguration nedan.',
  connect_conf_checking: 'Kontrollerar din senaste konfiguration…',
  connect_upgrade_cta: 'Uppgradera till full hastighet →',
  connect_identity_title: 'Den här enhetens identitet',
  connect_regenerate: 'Generera ny nyckel',
  connect_identity_note:
    'Ett nyckelpar per enhet registrerar sig hos många gateways; premium följer nyckeln på alla via kedjan. Betalningskoden nedan är det som knyter en FLUX-betalning till den här nyckeln.',
  connect_field_public_key: 'WireGuard publik nyckel',
  connect_field_payment_code: 'Betalningskod (meddelande)',

  upgrade_loading: 'Laddar betalningsuppgifter…',
  upgrade_eyebrow: 'Uppgradera · betala i FLUX',
  upgrade_title: 'Uppgradera till full hastighet',
  upgrade_lede:
    'Skicka FLUX med det exakta meddelandet nedan. Varje gateway skannar kedjan och låser upp din nyckel inom ~1 minut — på alla servrar samtidigt, i 30 dagar. Inget konto, inget kort, inget företag som kan lämna ut det det aldrig hade.',
  upgrade_usd_line: '≈ {usd} · per 30 dagar',
  upgrade_qr_caption: 'Skanna med Zelcore / SSP Wallet',
  upgrade_field_address: 'Betala till adress',
  upgrade_field_message: 'Meddelande (krävs)',
  upgrade_open_wallet: 'Öppna i plånbok',
  upgrade_prepay_note:
    '<strong>Förbetala:</strong> betala en multipel av beloppet för att lägga till lika många månader på en gång — t.ex. {amount} FLUX = 3 månader. Extra månader staplas (upp till 24), så du kan fylla på när som helst.',
  upgrade_privacy_note:
    'Öppnas i Zelcore / SSP Wallet. Betalningen verifieras på Flux blockkedja — vi ser aldrig vem du är. Meddelandet knyter betalningen till din nyckel; skickar du utan det anländer pengarna men inget låses upp.',
  upgrade_back: '← Tillbaka till Anslut',

  split_summary_title: 'Avancerat: split tunneling',
  split_tier_pill: 'PREMIUM · TILLVAL',
  split_lede:
    'Välj vilka destinationer som använder VPN:et. Den genererade konfigurationen uttrycker regler som WireGuard AllowedIPs och fungerar därför med standardappen för WireGuard — endast IP-intervall och förbigång av lokalt nätverk (regler per app kräver våra nativa appar).',
  split_mode_aria: 'Läge för split tunneling',
  split_mode_off: 'Av',
  split_mode_exclude: 'Uteslut listan',
  split_mode_include: 'Endast dessa',
  split_warn_exclude: 'Utesluten trafik lämnar din enhet oskyddad och visar din riktiga IP-adress.',
  split_warn_include:
    'Endast de listade destinationerna är skyddade — allt annat visar din riktiga IP-adress.',
  split_lan_label: 'Tillåt åtkomst till lokalt nätverk (skrivare, NAS, casting)',
  split_cidr_placeholder: 't.ex. 192.168.0.0/16 eller 203.0.113.7',
  split_cidr_aria: 'IP-adress eller CIDR-intervall',
  split_add: 'Lägg till',
  split_input_invalid: 'Ogiltig IP-adress eller ogiltigt CIDR-intervall.',
  split_rules_empty:
    'Inga IP-regler ännu — lägg till ett intervall ovan, eller använd bara lokal nätverksåtkomst.',
  split_remove_aria: 'Ta bort regeln {value}',
  split_next_note: 'Reglerna gäller nästa konfiguration du genererar på den här sidan.',
  split_premium_required:
    'Split tunneling är en premiumfunktion. En full-tunnelkonfiguration genererades i stället — uppgradera för att tillämpa dina regler.',
  split_applied:
    'Split tunneling tillämpad — den här konfigurationen dirigerar bara det dina regler tillåter.',

  multihop_summary_title: 'Avancerat: multi-hop (två konfigurationer)',
  multihop_tier_pill: 'PREMIUM · VALFRITT',
  multihop_lede:
    'Dirigera genom två gateways så att <strong>ingen enskild server ser både vem du är och vart du är på väg</strong>. Det är långsammare och ger högre latens — räkna med ungefär <strong>2× ping</strong> jämfört med single-hop, och lägre maxgenomströmning på grund av den dubbla krypteringen. Multi-hop är premium, men en enda betalning på <mono>$0.99</mono> täcker båda hoppen (samma nyckel K blir automatiskt premium vid både ingång och utgång). Avstängt som standard — flödet med enkelt hopp ovan förblir det primära.',
  multihop_entry_label: 'Ingångsland (ser din IP)',
  multihop_entry_aria: 'Ingångsland',
  multihop_exit_label: 'Utgångsland (ser din destination)',
  multihop_exit_aria: 'Utgångsland',
  multihop_style_same: 'Ruttstil: balanserad — samma land (en jurisdiktion)',
  multihop_style_cross:
    'Ruttstil: max integritet — mellan jurisdiktioner (två operatörer, två länder)',
  multihop_enrolling: 'Registrerar båda hoppen…',
  multihop_generate: 'Generera två konfigurationer',
  multihop_error_no_exit: 'Multi-hop kräver en separat utgångsgateway; ingen kunde fastställas.',
  multihop_error_no_gateways:
    'Inga aktiva gateways nåbara från webbläsaren, så ingen rutt kunde fastställas. Multi-hop-nästling är egentligen en funktion i våra appar — desktop- och mobilklienterna (samma kärna) sonderar gateways direkt och kör de två tunnlarna åt dig.',
  multihop_error_failed: 'Det gick inte att generera multi-hop.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'yttre · MTU 1420',
  multihop_conf_inner_tag: 'inre · MTU {mtu}',
  multihop_download_entry: 'Ladda ner wg-entry.conf',
  multihop_download_exit: 'Ladda ner wg-exit.conf',
  multihop_note:
    '<strong>Så dirigerar du detta (ärlig anmärkning).</strong> Verklig nästling med standard-WireGuard-appen är krångligt — den kör bara en tunnel åt gången — så multi-hop är egentligen en <strong>funktion i våra appar</strong> (desktop/mobil kedjar ihop de två tunnlarna åt dig). För manuell installation måste du först starta <mono>wg-entry.conf</mono>, sedan dirigera bara utgångens adress <mono>{exitIp}/32</mono> via den ingångstunneln och skicka resten genom <mono>wg-exit.conf</mono> (inre MTU {mtu}, så att två WireGuard-headers får plats). Utgångsendpoint: <mono>{endpoint}</mono>.<br/><strong>v1-förbehåll:</strong> båda hoppen använder samma nyckel K, vilket omintetgör varje <em>enskild</em> operatör men innebär att en motståndare som kontrollerar <em>båda</em> dina hopp skulle kunna korrelera via den delade nyckeln. Separata nycklar per hopp kommer i v1.5.',
};
