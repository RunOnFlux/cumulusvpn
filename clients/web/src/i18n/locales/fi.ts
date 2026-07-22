import type { Catalog } from '../index';

export const fi: Catalog = {
  app_title: 'CumulusVPN — Yksityinen internet, ei tiliä, ei lokeja',

  header_nav_connect: 'Yhdistä',
  header_nav_upgrade: 'Päivitä',
  header_theme_label: 'Teema: {mode}',
  header_theme_system: 'järjestelmä',
  header_theme_light: 'vaalea',
  header_theme_dark: 'tumma',
  header_language_label: 'Kieli',

  footer_tagline: 'CumulusVPN — Hajautettu VPN Flux Cloudissa · vpn.cumulusvpn.com',
  footer_credit: 'Beta-kaista · ei tiliä · ei lokeja',

  common_copy: 'Kopioi',
  common_copied: 'Kopioitu',
  common_qr_alt: 'QR-koodi',
  common_powered_by_flux_link: 'Powered by Flux — avaa runonflux.com-sivuston',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'siemenluettelo',
  common_directory: 'hakemisto',

  error_gateway_rejected: 'Yhdyskäytävä hylkäsi rekisteröinnin ({slug}): {message}',

  countries_search_placeholder: '🔎  Hae {n} maan joukosta…',
  countries_search_label: 'Hae maita',
  countries_list_label: 'Maat',
  countries_no_match: 'Yksikään maa ei vastaa hakua ”{query}”.',
  countries_nodes: { one: '{n} solmu', other: '{n} solmua' },

  connect_eyebrow: 'Beta-kaista · WireGuard-asetukset',
  connect_title: 'Yksi avain, <glow>jokainen yhdyskäytävä.</glow>',
  connect_lede:
    'WireGuard-avainparisi luodaan täällä, selaimessasi — yksityinen avain ei koskaan poistu tältä välilehdeltä. Valitse maa, rekisteröidy lähimpään Flux-yhdyskäytävään ja vie tuontivalmis<mono> .conf</mono> ja QR-koodi. Ilmainen ikuisesti nopeudella 100 KB/s; <upgrade>päivitä FLUXilla</upgrade> täyteen nopeuteen.',
  connect_verify_warn:
    'Hakemiston allekirjoitusta ei voitu vahvistaa — päätepisteet näytetään vain tiedoksi.',
  connect_notice_no_live_gateway:
    'Selaimesta ei tavoiteta yhtään aktiivista yhdyskäytävää. Näytetään allekirjoitetun hakemiston maat — asetukset rekisteröityvät aktiiviseen yhdyskäytävään, kun sellainen on tavoitettavissa.',
  connect_choose_location: 'Valitse sijainti',
  connect_tier_free: 'ILMAINEN · 100 KB/s',
  connect_loading_directory: 'Ratkaistaan allekirjoitettua hakemistoa ja etsitään yhdyskäytäviä…',
  connect_your_config: 'Asetuksesi',
  connect_source_directory: '{source}-hakemisto',
  connect_live_nodes: { one: '{n} aktiivinen solmu', other: '{n} aktiivista solmua' },
  connect_select_country: 'Valitse maa jatkaaksesi',
  connect_enrolling: 'Rekisteröidään…',
  connect_generate: 'Luo .conf',
  connect_no_gateway_in_country:
    'Selaimesta ei tavoiteta yhtään aktiivista yhdyskäytävää maassa {country}. Rekisteröinti lähetetään yhdyskäytävän ohjaus-API:in (http :51821), johon https-sivut eivät pääse — tämä toimii työpöytä- ja mobiilisovelluksista, jotka jakavat saman ytimen.',
  connect_error_enroll_failed: 'Rekisteröinti epäonnistui.',
  connect_qr_caption: 'Skannaa WireGuard-sovellukseen',
  connect_stat_assigned_ip: 'Osoitettu IP',
  connect_stat_endpoint: 'Päätepiste',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Lataa .conf',
  connect_upgrade_cta: 'Päivitä täyteen nopeuteen →',
  connect_identity_title: 'Tämän laitteen identiteetti',
  connect_regenerate: 'Luo avain uudelleen',
  connect_identity_note:
    'Yksi avainpari per laite rekisteröityy moneen yhdyskäytävään; premium seuraa avainta niissä kaikissa ketjun kautta. Alla oleva maksukoodi on se, mikä sitoo FLUX-maksun tähän avaimeen.',
  connect_field_public_key: 'WireGuardin julkinen avain',
  connect_field_payment_code: 'Maksukoodi (viesti)',

  upgrade_loading: 'Ladataan maksutietoja…',
  upgrade_eyebrow: 'Päivitys · maksa FLUXilla',
  upgrade_title: 'Päivitä täyteen nopeuteen',
  upgrade_lede:
    'Lähetä FLUXia alla olevalla täsmällisellä viestillä. Jokainen yhdyskäytävä skannaa ketjun ja avaa avaimesi noin ~1 minuutissa — kaikilla palvelimilla samanaikaisesti, 30 päiväksi. Ei tiliä, ei korttia, ei yritystä, joka voisi luovuttaa jotain, mitä sillä ei koskaan ollut.',
  upgrade_usd_line: '≈ {usd} · 30 päivää kohti',
  upgrade_qr_caption: 'Skannaa Zelcorella / SSP Walletilla',
  upgrade_field_address: 'Maksuosoite',
  upgrade_field_message: 'Viesti (pakollinen)',
  upgrade_open_wallet: 'Avaa lompakossa',
  upgrade_prepay_note:
    '<strong>Maksa etukäteen:</strong> maksa summan monikerta lisätäksesi vastaavan määrän kuukausia kerralla — esim. {amount} FLUX = 3 kuukautta. Ylimääräiset kuukaudet kasautuvat (enintään 24), joten voit täydentää milloin tahansa.',
  upgrade_privacy_note:
    'Avautuu Zelcoressa / SSP Walletissa. Maksu vahvistetaan Fluxin lohkoketjussa — emme koskaan näe, kuka olet. Viesti sitoo maksun avaimeesi; jos lähetät ilman sitä, varat saapuvat mutta mitään ei avaudu.',
  upgrade_back: '← Takaisin Yhdistä-sivulle',

  multihop_summary_title: 'Lisäasetukset: multi-hop (kaksi asetustiedostoa)',
  multihop_tier_pill: 'PREMIUM · VALINNAINEN',
  multihop_lede:
    'Reititä kahden yhdyskäytävän kautta, jotta <strong>yksikään palvelin ei näe sekä sitä, kuka olet, että sitä, minne olet menossa</strong>. Se on hitaampaa ja lisää viivettä — odota karkeasti <strong>2× pingiä</strong> yhden hypyn reittiin verrattuna, sekä matalampaa huippunopeutta kaksinkertaisen salauksen vuoksi. Multi-hop on premium-ominaisuus, mutta yksi <mono>$0.99</mono>-maksu kattaa molemmat hypyt (sama avain K on automaattisesti premium sekä sisään- että uloskäynnissä). Pois päältä oletuksena — yllä oleva yhden hypyn kulku pysyy ensisijaisena.',
  multihop_entry_label: 'Sisääntulomaa (näkee IP-osoitteesi)',
  multihop_entry_aria: 'Sisääntulomaa',
  multihop_exit_label: 'Uloskäyntimaa (näkee kohteesi)',
  multihop_exit_aria: 'Uloskäyntimaa',
  multihop_style_same: 'Reititystyyli: tasapainoinen — sama maa (yksi lainkäyttöalue)',
  multihop_style_cross:
    'Reititystyyli: paras yksityisyys — lainkäyttöalueiden välillä (kaksi operaattoria, kaksi maata)',
  multihop_enrolling: 'Rekisteröidään molempia hyppyjä…',
  multihop_generate: 'Luo kaksi asetustiedostoa',
  multihop_error_no_exit: 'Multi-hop tarvitsee erillisen uloskäynti-yhdyskäytävän; yhtään ei löytynyt.',
  multihop_error_no_gateways:
    'Selaimesta ei tavoiteta yhtään aktiivista yhdyskäytävää, joten reittiä ei voitu ratkaista. Multi-hop-sisäkkäisyys on itse asiassa omien sovellustemme ominaisuus — työpöytä- ja mobiilisovellukset (sama ydin) etsivät yhdyskäytäviä suoraan ja ajavat kaksi tunnelia puolestasi.',
  multihop_error_failed: 'Multi-hopin luonti epäonnistui.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'ulompi · MTU 1420',
  multihop_conf_inner_tag: 'sisempi · MTU {mtu}',
  multihop_download_entry: 'Lataa wg-entry.conf',
  multihop_download_exit: 'Lataa wg-exit.conf',
  multihop_note:
    '<strong>Näin reitität tämän (rehellinen huomautus).</strong> Aito sisäkkäisyys vakio-WireGuard-sovelluksella on hankalaa — se ajaa vain yhtä tunnelia kerrallaan — joten multi-hop on itse asiassa <strong>omien sovellustemme ominaisuus</strong> (työpöytä/mobiili ketjuttavat kaksi tunnelia puolestasi). Manuaalista asennusta varten sinun on ensin nostettava <mono>wg-entry.conf</mono>, sitten reititettävä vain uloskäynnin osoite <mono>{exitIp}/32</mono> tuon sisääntulotunnelin kautta ja lähetettävä loput <mono>wg-exit.conf</mono>:n kautta (sisempi MTU {mtu}, jotta kaksi WireGuard-otsikkoa mahtuu). Uloskäynnin päätepiste: <mono>{endpoint}</mono>.<br/><strong>v1-varauma:</strong> molemmat hypyt käyttävät samaa avainta K, mikä tekee tyhjäksi minkä tahansa <em>yksittäisen</em> operaattorin, mutta tarkoittaa, että vastustaja, joka hallitsee <em>molempia</em> hyppyjäsi, voisi yhdistää ne tuon jaetun avaimen kautta. Eri avaimet per hyppy tulevat versiossa v1.5.',
};
