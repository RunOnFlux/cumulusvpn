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

  upgrade_eyebrow_card: 'Eller betala med kort',
  upgrade_card_lede:
    'Prenumerera med kort, Apple Pay eller Google Pay. Betalningen hanteras av Stripe — vi ser aldrig ditt kort. Premium aktiveras fortfarande på Flux blockkedja, knuten enbart till din anonyma betalningskod.',
  upgrade_plan_aria: 'Prenumerationsplan',
  upgrade_plan_monthly: '{usd} / månad',
  upgrade_plan_annual: '{usd} / år',
  upgrade_card_cta: 'Betala med kort',
  upgrade_card_cta_busy: 'Öppnar säker betalning…',
  upgrade_card_error: 'Kunde inte öppna betalningen. Försök igen om en stund.',
  upgrade_card_note:
    'Förnyas automatiskt; säg upp eller byt plan när du vill under ”Din prenumeration” nedan, eller via Stripe-kvittot du fick via e-post. Att betala i FLUX ovan är billigare — kortpriset täcker transaktionsavgifterna.',
  upgrade_activating_title: 'Aktiverar ditt premium…',
  upgrade_state_pending: 'Betalning mottagen — förbereder din aktivering på Flux-nätverket.',
  upgrade_state_broadcast: 'Aktivering skickad till Flux-nätverket — väntar på bekräftelse.',
  upgrade_state_confirmed: 'Bekräftat! Full hastighet låses upp på alla servrar inom en minut.',
  upgrade_state_failed:
    'Något gick fel vid aktiveringen. Din betalning är säker — vi försöker igen automatiskt och ditt premium dyker upp inom kort.',
  upgrade_activating_hint: 'Du kan stänga den här sidan — aktiveringen slutförs av sig själv.',
  upgrade_activated_cta: 'Tillbaka till Anslut →',

  otherdev_eyebrow: 'Betalar du för en annan enhet?',
  otherdev_lede:
    'Premium är knutet till en enhets nyckel. Vill du betala för din telefon härifrån, öppna appen → Inställningar → Om och kopiera dess enhetskod.',
  otherdev_placeholder: 'Enhetskod',
  otherdev_apply: 'Använd den här koden',
  otherdev_active:
    'Kontrollera att den stämmer med koden på den enheten — en felskriven kod kan ändå vara giltig och skulle betala för fel enhet.',
  otherdev_clear: 'Tillbaka till den här webbläsaren ({code}…)',
  otherdev_err:
    'Det är ingen giltig enhetskod. Kopiera den från Inställningar → Om på enheten du vill uppgradera.',

  manage_eyebrow: 'Din prenumeration',
  manage_lede:
    'Uppdatera ditt kort, växla mellan månads- och årsplan eller säg upp. Öppnar Stripes säkra faktureringsportal.',
  manage_none:
    'Ingen kortprenumeration köptes i den här webbläsaren. Om du prenumererade på en annan enhet, använd länken i Stripe-kvittot du fick via e-post — eller App Store / Google Play om du prenumererade i appen.',
  manage_cta: 'Hantera prenumeration',
  manage_cta_busy: 'Öppnar faktureringsportalen…',
  manage_err:
    'Det gick inte att öppna faktureringsportalen från den här webbläsaren. Du kan alltid hantera eller säga upp via länken i Stripe-kvittot du fick via e-post.',

  redeem_eyebrow: 'Har du en kod?',
  redeem_lede:
    'Lös in en värdekod eller kampanjkod. Koder för gratistid aktiveras på Flux-nätverket för den här enheten; rabattkoder gäller kortbetalningen ovan.',
  redeem_placeholder: 'CVPN-XXXXX-XXXXX',
  redeem_cta: 'Lös in',
  redeem_cta_busy: 'Kontrollerar…',
  redeem_discount_applied:
    '{percent} % rabatt tillagd — betala med kort ovan så ingår rabatten i betalningen.',
  redeem_err_invalid: 'Den koden är inte giltig. Kontrollera stavningen och försök igen.',
  redeem_err_expired: 'Den här koden har gått ut.',
  redeem_err_exhausted: 'Den här koden är redan helt förbrukad.',
  redeem_err_already: 'Den här enheten har redan löst in den här koden.',
  redeem_err_later: 'Inlösen är tillfälligt otillgänglig — försök igen om några minuter.',

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
