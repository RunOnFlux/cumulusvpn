import type { Catalog } from '../index';

export const de: Catalog = {
  app_title: 'CumulusVPN — Privates Internet, ohne Konto, ohne Logs',

  header_nav_connect: 'Verbinden',
  header_nav_upgrade: 'Upgrade',
  header_theme_label: 'Design: {mode}',
  header_theme_system: 'System',
  header_theme_light: 'Hell',
  header_theme_dark: 'Dunkel',
  header_language_label: 'Sprache',

  footer_tagline: 'CumulusVPN — Dezentrales VPN auf Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Beta-Schiene · kein Konto · keine Logs',

  common_copy: 'Kopieren',
  common_copied: 'Kopiert',
  common_qr_alt: 'QR-Code',
  common_powered_by_flux_link: 'Powered by Flux — öffnet runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'Seed',
  common_directory: 'Verzeichnis',

  error_gateway_rejected: 'Gateway hat die Anmeldung abgelehnt ({slug}): {message}',

  countries_search_placeholder: '🔎  {n} Länder durchsuchen…',
  countries_search_label: 'Länder durchsuchen',
  countries_list_label: 'Länder',
  countries_no_match: 'Kein Land passt zu „{query}“.',
  countries_nodes: { one: '{n} Knoten', other: '{n} Knoten' },

  connect_eyebrow: 'Beta-Schiene · WireGuard-Konfiguration',
  connect_title: 'Ein Schlüssel, <glow>jedes Gateway.</glow>',
  connect_lede:
    'Dein WireGuard-Schlüsselpaar wird hier, in deinem Browser, erzeugt — der private Schlüssel verlässt diesen Tab nie. Wähle ein Land, melde dich beim nächstgelegenen Flux-Gateway an und exportiere eine importfertige<mono> .conf</mono>-Datei samt QR-Code. Für immer kostenlos mit 100 KB/s; <upgrade>mit FLUX upgraden</upgrade> für volle Geschwindigkeit.',
  connect_verify_warn:
    'Verzeichnissignatur konnte nicht verifiziert werden — Endpunkte werden nur zur Information angezeigt.',
  connect_notice_no_live_gateway:
    'Kein aktives Gateway vom Browser aus erreichbar. Es werden die Länder des signierten Verzeichnisses angezeigt — Konfigurationen melden sich bei einem aktiven Gateway an, sobald eines erreichbar ist.',
  connect_choose_location: 'Standort wählen',
  connect_tier_free: 'KOSTENLOS · 100 KB/s',
  connect_loading_directory: 'Signiertes Verzeichnis wird aufgelöst und Gateways werden ermittelt…',
  connect_your_config: 'Deine Konfiguration',
  connect_source_directory: '{source}-Verzeichnis',
  connect_live_nodes: { one: '{n} aktiver Knoten', other: '{n} aktive Knoten' },
  connect_select_country: 'Wähle ein Land, um fortzufahren',
  connect_enrolling: 'Anmeldung läuft…',
  connect_generate: '.conf erzeugen',
  connect_no_gateway_in_country:
    'Kein aktives Gateway in {country} vom Browser aus erreichbar. Die Anmeldung erfolgt an der Steuer-API eines Gateways (http :51821), die https-Seiten nicht erreichen können — das funktioniert bei den Desktop- und Mobile-Clients, die diesen Kern gemeinsam nutzen.',
  connect_error_enroll_failed: 'Anmeldung fehlgeschlagen.',
  connect_qr_caption: 'Mit der WireGuard-App scannen',
  connect_stat_assigned_ip: 'Zugewiesene IP',
  connect_stat_endpoint: 'Endpunkt',
  connect_stat_dns: 'DNS',
  connect_download_conf: '.conf herunterladen',
  connect_upgrade_cta: 'Auf volle Geschwindigkeit upgraden →',
  connect_identity_title: 'Identität dieses Geräts',
  connect_regenerate: 'Schlüssel neu erzeugen',
  connect_identity_note:
    'Ein Schlüsselpaar pro Gerät meldet sich bei vielen Gateways an; Premium folgt dem Schlüssel über die Chain auf allen davon. Der Zahlungscode unten verknüpft eine FLUX-Zahlung mit diesem Schlüssel.',
  connect_field_public_key: 'WireGuard-Public-Key',
  connect_field_payment_code: 'Zahlungscode (Memo)',

  upgrade_loading: 'Zahlungsdetails werden geladen…',
  upgrade_eyebrow: 'Upgrade · Zahlung in FLUX',
  upgrade_title: 'Auf volle Geschwindigkeit upgraden',
  upgrade_lede:
    'Sende FLUX mit exakt der Nachricht unten. Jedes Gateway scannt die Chain und schaltet deinen Schlüssel innerhalb von ~1 Minute frei — auf allen Servern gleichzeitig, für 30 Tage. Kein Konto, keine Karte, keine Firma, die herausgeben könnte, was sie nie besessen hat.',
  upgrade_usd_line: '≈ {usd} · pro 30 Tage',
  upgrade_qr_caption: 'Mit Zelcore / SSP Wallet scannen',
  upgrade_field_address: 'Zahlungsadresse',
  upgrade_field_message: 'Nachricht (erforderlich)',
  upgrade_open_wallet: 'In der Wallet öffnen',
  upgrade_prepay_note:
    '<strong>Im Voraus zahlen:</strong> zahle ein Vielfaches des Betrags, um entsprechend viele Monate auf einmal hinzuzufügen — z. B. {amount} FLUX = 3 Monate. Zusätzliche Monate stapeln sich (bis zu 24), du kannst also jederzeit aufstocken.',
  upgrade_privacy_note:
    'Öffnet sich in Zelcore / SSP Wallet. Die Zahlung wird auf der Flux-Blockchain verifiziert — wir sehen nie, wer du bist. Die Nachricht verknüpft die Zahlung mit deinem Schlüssel; sendest du sie ohne diese, kommt das Geld an, aber nichts wird freigeschaltet.',
  upgrade_back: '← Zurück zu Verbinden',

  multihop_summary_title: 'Erweitert: Multi-Hop (zwei Konfigurationen)',
  multihop_tier_pill: 'PREMIUM · OPT-IN',
  multihop_lede:
    'Route über zwei Gateways, sodass <strong>kein einzelner Server sowohl weiß, wer du bist, als auch, wohin du gehst</strong>. Das ist langsamer und erhöht die Latenz — rechne mit etwa <strong>2× Ping</strong> gegenüber Single-Hop und geringerem Spitzendurchsatz durch die doppelte Verschlüsselung. Multi-Hop ist Premium, aber eine einzige Zahlung von <mono>$0.99</mono> deckt beide Hops ab (derselbe Schlüssel K wird an Eingang und Ausgang automatisch Premium). Standardmäßig aus — der Single-Hop-Ablauf oben bleibt primär.',
  multihop_entry_label: 'Eingangsland (sieht deine IP)',
  multihop_entry_aria: 'Eingangsland',
  multihop_exit_label: 'Ausgangsland (sieht dein Ziel)',
  multihop_exit_aria: 'Ausgangsland',
  multihop_style_same: 'Routenstil: ausgewogen — gleiches Land (eine Rechtsordnung)',
  multihop_style_cross:
    'Routenstil: maximale Privatsphäre — länderübergreifend (zwei Betreiber, zwei Länder)',
  multihop_enrolling: 'Beide Hops werden angemeldet…',
  multihop_generate: 'Zwei Konfigurationen erzeugen',
  multihop_error_no_exit: 'Multi-Hop braucht ein eigenständiges Ausgangs-Gateway; keines wurde ermittelt.',
  multihop_error_no_gateways:
    'Kein aktives Gateway vom Browser aus erreichbar, daher konnte keine Route ermittelt werden. Multi-Hop-Verschachtelung ist eigentlich ein Feature unserer Apps — die Desktop- und Mobile-Clients (gleicher Kern) prüfen Gateways direkt und betreiben die beiden Tunnel für dich.',
  multihop_error_failed: 'Multi-Hop-Erzeugung fehlgeschlagen.',
  multihop_internet: 'Internet',
  multihop_conf_outer_tag: 'äußerer Tunnel · MTU 1420',
  multihop_conf_inner_tag: 'innerer Tunnel · MTU {mtu}',
  multihop_download_entry: 'wg-entry.conf herunterladen',
  multihop_download_exit: 'wg-exit.conf herunterladen',
  multihop_note:
    '<strong>So routest du das (ehrlicher Hinweis).</strong> Echte Verschachtelung mit der Standard-WireGuard-App ist umständlich — sie fährt nur einen Tunnel gleichzeitig — daher ist Multi-Hop eigentlich ein <strong>Feature unserer Apps</strong> (Desktop/Mobile verketten die beiden Tunnel für dich). Für ein manuelles Setup musst du zuerst <mono>wg-entry.conf</mono> hochfahren, dann nur die Ausgangsadresse <mono>{exitIp}/32</mono> über diesen Eingangstunnel routen und den Rest über <mono>wg-exit.conf</mono> senden (innere MTU {mtu}, damit zwei WireGuard-Header hineinpassen). Ausgangs-Endpunkt: <mono>{endpoint}</mono>.<br/><strong>v1-Einschränkung:</strong> beide Hops verwenden denselben Schlüssel K, was jeden <em>einzelnen</em> Betreiber aushebelt, aber bedeutet, dass ein Angreifer, der <em>beide</em> deiner Hops kontrolliert, sie über diesen gemeinsamen Schlüssel korrelieren könnte. Unterschiedliche Schlüssel pro Hop kommen in v1.5.',
};
