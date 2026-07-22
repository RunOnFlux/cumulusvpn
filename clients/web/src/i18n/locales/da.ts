import type { Catalog } from '../index';

export const da: Catalog = {
  app_title: 'CumulusVPN — Privat internet, ingen konto, ingen logning',

  header_nav_connect: 'Forbind',
  header_nav_upgrade: 'Opgrader',
  header_theme_label: 'Tema: {mode}',
  header_theme_system: 'system',
  header_theme_light: 'lyst',
  header_theme_dark: 'mørkt',
  header_language_label: 'Sprog',

  footer_tagline: 'CumulusVPN — Decentraliseret VPN på Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Betaspor · ingen konto · ingen logning',

  common_copy: 'Kopiér',
  common_copied: 'Kopieret',
  common_qr_alt: 'QR-kode',
  common_powered_by_flux_link: 'Powered by Flux — åbner runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'frø',
  common_directory: 'katalog',

  error_gateway_rejected: 'Gatewayen afviste tilmeldingen ({slug}): {message}',

  countries_search_placeholder: '🔎  Søg blandt {n} lande…',
  countries_search_label: 'Søg lande',
  countries_list_label: 'Lande',
  countries_no_match: 'Ingen lande matcher »{query}«.',
  countries_nodes: { one: '{n} node', other: '{n} noder' },

  connect_eyebrow: 'Betaspor · WireGuard-konfiguration',
  connect_title: 'Én nøgle, <glow>hver gateway.</glow>',
  connect_lede:
    'Dit WireGuard-nøglepar genereres her, i din browser — den private nøgle forlader aldrig denne fane. Vælg et land, tilmeld dig den nærmeste Flux-gateway, og eksportér en importklar<mono> .conf</mono> og QR-kode. Gratis for altid ved 100 KB/s; <upgrade>opgradér med FLUX</upgrade> for fuld hastighed.',
  connect_verify_warn:
    'Katalogets signatur kunne ikke verificeres — endpoints vises kun til orientering.',
  connect_notice_no_live_gateway:
    'Ingen aktiv gateway tilgængelig fra browseren. De signerede katalogs lande vises — konfigurationer tilmeldes en aktiv gateway, når én er tilgængelig.',
  connect_choose_location: 'Vælg en placering',
  connect_tier_free: 'GRATIS · 100 KB/s',
  connect_loading_directory: 'Løser det signerede katalog og finder gateways…',
  connect_your_config: 'Din konfiguration',
  connect_source_directory: '{source}-katalog',
  connect_live_nodes: { one: '{n} aktiv node', other: '{n} aktive noder' },
  connect_select_country: 'Vælg et land for at fortsætte',
  connect_enrolling: 'Tilmelder…',
  connect_generate: 'Generér .conf',
  connect_no_gateway_in_country:
    'Ingen aktiv gateway tilgængelig i {country} fra browseren. Tilmeldingen sendes til en gateways styrings-API (http :51821), som https-sider ikke kan nå — det fungerer fra desktop- og mobilklienterne, der deler denne kerne.',
  connect_error_enroll_failed: 'Tilmeldingen mislykkedes.',
  connect_qr_caption: 'Scan ind i WireGuard-appen',
  connect_stat_assigned_ip: 'Tildelt IP',
  connect_stat_endpoint: 'Endpoint',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Download .conf',
  connect_upgrade_cta: 'Opgradér til fuld hastighed →',
  connect_identity_title: 'Denne enheds identitet',
  connect_regenerate: 'Generér ny nøgle',
  connect_identity_note:
    'Ét nøglepar pr. enhed tilmelder sig mange gateways; premium følger nøglen på dem alle via kæden. Betalingskoden nedenfor er det, der knytter en FLUX-betaling til denne nøgle.',
  connect_field_public_key: 'WireGuard offentlig nøgle',
  connect_field_payment_code: 'Betalingskode (besked)',

  upgrade_loading: 'Indlæser betalingsoplysninger…',
  upgrade_eyebrow: 'Opgradér · betal i FLUX',
  upgrade_title: 'Opgradér til fuld hastighed',
  upgrade_lede:
    'Send FLUX med den nøjagtige besked nedenfor. Hver gateway skanner kæden og låser din nøgle op inden for ~1 minut — på alle servere på én gang, i 30 dage. Ingen konto, intet kort, ingen virksomhed der kan udlevere det, den aldrig havde.',
  upgrade_usd_line: '≈ {usd} · pr. 30 dage',
  upgrade_qr_caption: 'Scan med Zelcore / SSP Wallet',
  upgrade_field_address: 'Betal til adresse',
  upgrade_field_message: 'Besked (påkrævet)',
  upgrade_open_wallet: 'Åbn i tegnebog',
  upgrade_prepay_note:
    '<strong>Forudbetal:</strong> betal et multiplum af beløbet for at lægge lige så mange måneder til på én gang — f.eks. {amount} FLUX = 3 måneder. Ekstra måneder lægges oveni (op til 24), så du kan fylde op når som helst.',
  upgrade_privacy_note:
    'Åbner i Zelcore / SSP Wallet. Betalingen verificeres på Flux-blockchainen — vi ser aldrig, hvem du er. Beskeden knytter betalingen til din nøgle; sender du uden den, ankommer pengene, men intet låses op.',
  upgrade_back: '← Tilbage til Forbind',

  multihop_summary_title: 'Avanceret: multi-hop (to konfigurationer)',
  multihop_tier_pill: 'PREMIUM · TILVALG',
  multihop_lede:
    'Dirigér gennem to gateways, så <strong>ingen enkelt server ser både hvem du er, og hvor du går hen</strong>. Det er langsommere og øger latensen — regn med cirka <strong>2× ping</strong> sammenlignet med single-hop, og lavere maks. gennemløb pga. den dobbelte kryptering. Multi-hop er premium, men én enkelt betaling på <mono>$0.99</mono> dækker begge hop (samme nøgle K bliver automatisk premium ved både indgang og udgang). Slået fra som standard — single-hop-flowet ovenfor forbliver primært.',
  multihop_entry_label: 'Indgangsland (ser din IP)',
  multihop_entry_aria: 'Indgangsland',
  multihop_exit_label: 'Udgangsland (ser din destination)',
  multihop_exit_aria: 'Udgangsland',
  multihop_style_same: 'Rutestil: afbalanceret — samme land (én jurisdiktion)',
  multihop_style_cross:
    'Rutestil: maks. privatliv — på tværs af jurisdiktioner (to operatører, to lande)',
  multihop_enrolling: 'Tilmelder begge hop…',
  multihop_generate: 'Generér to konfigurationer',
  multihop_error_no_exit: 'Multi-hop kræver en separat udgangsgateway; ingen blev fundet.',
  multihop_error_no_gateways:
    'Ingen aktive gateways tilgængelige fra browseren, så ingen rute kunne findes. Multi-hop-nesting er reelt en funktion i vores apps — desktop- og mobilklienterne (samme kerne) undersøger gateways direkte og kører de to tunneler for dig.',
  multihop_error_failed: 'Multi-hop-generering mislykkedes.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'ydre · MTU 1420',
  multihop_conf_inner_tag: 'indre · MTU {mtu}',
  multihop_download_entry: 'Download wg-entry.conf',
  multihop_download_exit: 'Download wg-exit.conf',
  multihop_note:
    '<strong>Sådan dirigerer du dette (ærlig bemærkning).</strong> Ægte nesting med standard-WireGuard-appen er besværligt — den kører kun én tunnel ad gangen — så multi-hop er reelt en <strong>funktion i vores apps</strong> (desktop/mobil kæder de to tunneler sammen for dig). For en manuel opsætning skal du først bringe <mono>wg-entry.conf</mono> op, derefter kun dirigere udgangens adresse <mono>{exitIp}/32</mono> via den indgangstunnel og sende resten gennem <mono>wg-exit.conf</mono> (indre MTU {mtu}, så to WireGuard-headers kan være der). Udgangsendpoint: <mono>{endpoint}</mono>.<br/><strong>v1-forbehold:</strong> begge hop bruger samme nøgle K, hvilket omgår enhver <em>enkelt</em> operatør, men betyder, at en modstander, der kontrollerer <em>begge</em> dine hop, kunne korrelere via den delte nøgle. Separate nøgler pr. hop lander i v1.5.',
};
