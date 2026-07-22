import type { Catalog } from '../index';

export const nb: Catalog = {
  app_title: 'CumulusVPN — Privat internett, ingen konto, ingen logger',

  header_nav_connect: 'Koble til',
  header_nav_upgrade: 'Oppgrader',
  header_theme_label: 'Tema: {mode}',
  header_theme_system: 'system',
  header_theme_light: 'lyst',
  header_theme_dark: 'mørkt',
  header_language_label: 'Språk',

  footer_tagline: 'CumulusVPN — Desentralisert VPN på Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Betaspor · ingen konto · ingen logger',

  common_copy: 'Kopier',
  common_copied: 'Kopiert',
  common_qr_alt: 'QR-kode',
  common_powered_by_flux_link: 'Powered by Flux — åpner runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'frø',
  common_directory: 'katalog',

  error_gateway_rejected: 'Gatewayen avviste påmeldingen ({slug}): {message}',

  countries_search_placeholder: '🔎  Søk blant {n} land…',
  countries_search_label: 'Søk land',
  countries_list_label: 'Land',
  countries_no_match: 'Ingen land samsvarer med «{query}».',
  countries_nodes: { one: '{n} node', other: '{n} noder' },

  connect_eyebrow: 'Betaspor · WireGuard-konfigurasjon',
  connect_title: 'Én nøkkel, <glow>hver gateway.</glow>',
  connect_lede:
    'WireGuard-nøkkelparet ditt genereres her, i nettleseren din — den private nøkkelen forlater aldri denne fanen. Velg et land, meld deg på den nærmeste Flux-gatewayen, og eksporter en importklar<mono> .conf</mono> og QR-kode. Gratis for alltid ved 100 KB/s; <upgrade>oppgrader med FLUX</upgrade> for full hastighet.',
  connect_verify_warn:
    'Katalogens signatur kunne ikke verifiseres — endepunkter vises kun til orientering.',
  connect_notice_no_live_gateway:
    'Ingen aktiv gateway tilgjengelig fra nettleseren. Landene fra den signerte katalogen vises — konfigurasjoner meldes på en aktiv gateway når én er tilgjengelig.',
  connect_choose_location: 'Velg et sted',
  connect_tier_free: 'GRATIS · 100 KB/s',
  connect_loading_directory: 'Løser opp den signerte katalogen og oppdager gatewayer…',
  connect_your_config: 'Konfigurasjonen din',
  connect_source_directory: '{source}-katalog',
  connect_live_nodes: { one: '{n} aktiv node', other: '{n} aktive noder' },
  connect_select_country: 'Velg et land for å fortsette',
  connect_enrolling: 'Melder på…',
  connect_generate: 'Generer .conf',
  connect_no_gateway_in_country:
    'Ingen aktiv gateway tilgjengelig i {country} fra nettleseren. Påmeldingen sendes til en gateways styrings-API (http :51821), som https-sider ikke kan nå — dette fungerer fra desktop- og mobilklientene som deler denne kjernen.',
  connect_error_enroll_failed: 'Påmeldingen mislyktes.',
  connect_qr_caption: 'Skann inn i WireGuard-appen',
  connect_stat_assigned_ip: 'Tildelt IP',
  connect_stat_endpoint: 'Endepunkt',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Last ned .conf',
  connect_upgrade_cta: 'Oppgrader til full hastighet →',
  connect_identity_title: 'Identiteten til denne enheten',
  connect_regenerate: 'Generer ny nøkkel',
  connect_identity_note:
    'Ett nøkkelpar per enhet melder seg på mange gatewayer; premium følger nøkkelen på alle via kjeden. Betalingskoden nedenfor er det som knytter en FLUX-betaling til denne nøkkelen.',
  connect_field_public_key: 'Offentlig WireGuard-nøkkel',
  connect_field_payment_code: 'Betalingskode (notat)',

  upgrade_loading: 'Laster betalingsdetaljer…',
  upgrade_eyebrow: 'Oppgrader · betal i FLUX',
  upgrade_title: 'Oppgrader til full hastighet',
  upgrade_lede:
    'Send FLUX med den nøyaktige meldingen nedenfor. Hver gateway skanner kjeden og låser opp nøkkelen din innen ~1 minutt — på alle servere samtidig, i 30 dager. Ingen konto, ingen kort, ingen bedrift som kan utlevere det den aldri hadde.',
  upgrade_usd_line: '≈ {usd} · per 30 dager',
  upgrade_qr_caption: 'Skann med Zelcore / SSP Wallet',
  upgrade_field_address: 'Betal til adresse',
  upgrade_field_message: 'Melding (påkrevd)',
  upgrade_open_wallet: 'Åpne i lommebok',
  upgrade_prepay_note:
    '<strong>Forhåndsbetal:</strong> betal et multiplum av beløpet for å legge til like mange måneder på én gang — f.eks. {amount} FLUX = 3 måneder. Ekstra måneder stables (opptil 24), så du kan fylle på når som helst.',
  upgrade_privacy_note:
    'Åpnes i Zelcore / SSP Wallet. Betalingen verifiseres på Flux-blokkjeden — vi ser aldri hvem du er. Meldingen knytter betalingen til nøkkelen din; sender du uten den, kommer pengene frem, men ingenting låses opp.',
  upgrade_back: '← Tilbake til Koble til',

  multihop_summary_title: 'Avansert: multi-hop (to konfigurasjoner)',
  multihop_tier_pill: 'PREMIUM · VALGFRITT',
  multihop_lede:
    'Rut gjennom to gatewayer, slik at <strong>ingen enkelt server ser både hvem du er og hvor du skal</strong>. Det er tregere og øker ventetiden — regn med omtrent <strong>2× ping</strong> sammenlignet med single-hop, og lavere maks gjennomstrømning på grunn av den doble krypteringen. Multi-hop er premium, men én betaling på <mono>$0.99</mono> dekker begge hoppene (samme nøkkel K blir automatisk premium ved både inngang og utgang). Av som standard — enkelthopp-flyten over forblir hovedvalget.',
  multihop_entry_label: 'Inngangsland (ser IP-en din)',
  multihop_entry_aria: 'Inngangsland',
  multihop_exit_label: 'Utgangsland (ser målet ditt)',
  multihop_exit_aria: 'Utgangsland',
  multihop_style_same: 'Rutestil: balansert — samme land (én jurisdiksjon)',
  multihop_style_cross:
    'Rutestil: maks personvern — på tvers av jurisdiksjoner (to operatører, to land)',
  multihop_enrolling: 'Melder på begge hoppene…',
  multihop_generate: 'Generer to konfigurasjoner',
  multihop_error_no_exit: 'Multi-hop trenger en egen utgangsgateway; ingen ble funnet.',
  multihop_error_no_gateways:
    'Ingen aktive gatewayer tilgjengelige fra nettleseren, så ingen rute kunne fastsettes. Multi-hop-nøsting er egentlig en funksjon i appene våre — desktop- og mobilklientene (samme kjerne) sonderer gatewayer direkte og kjører de to tunnelene for deg.',
  multihop_error_failed: 'Multi-hop-generering mislyktes.',
  multihop_internet: 'internett',
  multihop_conf_outer_tag: 'ytre · MTU 1420',
  multihop_conf_inner_tag: 'indre · MTU {mtu}',
  multihop_download_entry: 'Last ned wg-entry.conf',
  multihop_download_exit: 'Last ned wg-exit.conf',
  multihop_note:
    '<strong>Slik ruter du dette (ærlig merknad).</strong> Ekte nøsting med standard WireGuard-appen er tungvint — den kjører bare én tunnel om gangen — så multi-hop er egentlig en <strong>funksjon i appene våre</strong> (desktop/mobil kjeder de to tunnelene sammen for deg). For manuelt oppsett må du først starte <mono>wg-entry.conf</mono>, deretter rute bare utgangens adresse <mono>{exitIp}/32</mono> via den inngangstunnelen og sende resten gjennom <mono>wg-exit.conf</mono> (indre MTU {mtu}, slik at to WireGuard-headere får plass). Utgangsendepunkt: <mono>{endpoint}</mono>.<br/><strong>v1-forbehold:</strong> begge hoppene bruker samme nøkkel K, som nøytraliserer enhver <em>enkelt</em> operatør, men betyr at en motstander som kontrollerer <em>begge</em> hoppene dine kan korrelere via den delte nøkkelen. Egne nøkler per hopp kommer i v1.5.',
};
