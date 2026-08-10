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
  connect_conf_note:
    'Sidottu tähän palvelimeen. Jos se käynnistyy uudelleen tai vaihtuu, WireGuard näyttää tunnelin yhä yhdistettynä, vaikka mikään ei kulje — palaa tänne ja luo uusi .conf.',
  connect_conf_regenerate: 'Luo uusi .conf',
  connect_conf_stale:
    'Palvelin, joka myönsi viimeisimmän asetuksesi kohteeseen {country}, on korvattu — se asetus ei voi enää yhdistää. Luo uusi alta.',
  connect_conf_unsure:
    'Palvelinta, joka myönsi viimeisimmän asetuksesi kohteeseen {country}, ei tavoitettu. Se voi olla väliaikaisesti alhaalla tai poistunut lopullisesti — jos tunneli ei välitä liikennettä, luo uusi asetus alta.',
  connect_conf_checking: 'Tarkistetaan viimeisintä asetustasi…',
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

  upgrade_eyebrow_card: 'Tai maksa kortilla',
  upgrade_card_lede:
    'Tilaa kortilla, Apple Payllä tai Google Payllä. Maksun hoitaa Stripe — emme koskaan näe korttiasi. Premiumisi aktivoidaan silti Fluxin lohkoketjussa, sidottuna vain anonyymiin maksukoodiisi.',
  upgrade_plan_aria: 'Tilaussuunnitelma',
  upgrade_plan_monthly: '{usd} / kuukausi',
  upgrade_plan_annual: '{usd} / vuosi',
  upgrade_card_cta: 'Maksa kortilla',
  upgrade_card_cta_busy: 'Avataan turvallista maksua…',
  upgrade_card_error: 'Maksua ei voitu avata. Yritä hetken kuluttua uudelleen.',
  upgrade_card_note:
    'Uusiutuu automaattisesti; peruuta milloin tahansa Stripen kuittisähköpostista. FLUXilla maksaminen yllä on halvempaa — kortin hinta kattaa käsittelykulut.',
  upgrade_activating_title: 'Aktivoidaan premiumiasi…',
  upgrade_state_pending: 'Maksu vastaanotettu — valmistellaan aktivointiasi Flux-verkossa.',
  upgrade_state_broadcast: 'Aktivointi lähetetty Flux-verkkoon — odotetaan vahvistusta.',
  upgrade_state_confirmed:
    'Vahvistettu! Täysi nopeus avautuu kaikilla palvelimilla minuutin sisällä.',
  upgrade_state_failed:
    'Aktivoinnissa meni jotain pieleen. Maksusi on turvassa — yritämme automaattisesti uudelleen, ja premiumisi ilmestyy pian.',
  upgrade_activating_hint: 'Voit sulkea tämän sivun — aktivointi valmistuu itsestään.',
  upgrade_activated_cta: 'Takaisin Yhdistä-sivulle →',

  redeem_eyebrow: 'Onko sinulla koodi?',
  redeem_lede:
    'Lunasta kuponki tai kampanjakoodi. Ilmaisajan koodit aktivoidaan Flux-verkossa tälle laitteelle; alennuskoodit koskevat yllä olevaa korttimaksua.',
  redeem_placeholder: 'CVPN-XXXXX-XXXXX',
  redeem_cta: 'Lunasta',
  redeem_cta_busy: 'Tarkistetaan…',
  redeem_discount_applied:
    '{percent}% alennus käytössä — maksa kortilla yllä, niin alennus sisältyy maksuun.',
  redeem_err_invalid: 'Koodi ei kelpaa. Tarkista kirjoitusvirheet ja yritä uudelleen.',
  redeem_err_expired: 'Tämä koodi on vanhentunut.',
  redeem_err_exhausted: 'Tämä koodi on jo käytetty kokonaan.',
  redeem_err_already: 'Tämä laite on jo lunastanut tämän koodin.',
  redeem_err_later:
    'Lunastus on hetkellisesti poissa käytöstä — yritä uudelleen muutaman minuutin kuluttua.',

  split_summary_title: 'Lisäasetukset: jaettu tunnelointi',
  split_tier_pill: 'PREMIUM · VALINNAINEN',
  split_lede:
    'Valitse, mitkä kohteet käyttävät VPN:ää. Luotu konfiguraatio ilmaisee säännöt WireGuardin AllowedIPs-muodossa, joten se toimii tavallisen WireGuard-sovelluksen kanssa — vain IP-alueet ja lähiverkon ohitus (sovelluskohtaiset säännöt vaativat natiivisovelluksemme).',
  split_mode_aria: 'Jaetun tunneloinnin tila',
  split_mode_off: 'Pois',
  split_mode_exclude: 'Sulje listatut pois',
  split_mode_include: 'Vain nämä',
  split_warn_exclude:
    'Poissuljettu liikenne lähtee laitteeltasi suojaamattomana ja paljastaa oikean IP-osoitteesi.',
  split_warn_include:
    'Vain listatut kohteet on suojattu — kaikki muu paljastaa oikean IP-osoitteesi.',
  split_lan_label: 'Salli pääsy lähiverkkoon (tulostimet, NAS, suoratoisto)',
  split_cidr_placeholder: 'esim. 192.168.0.0/16 tai 203.0.113.7',
  split_cidr_aria: 'IP-osoite tai CIDR-alue',
  split_add: 'Lisää',
  split_input_invalid: 'Ei kelvollinen IP-osoite tai CIDR-alue.',
  split_rules_empty: 'Ei vielä IP-sääntöjä — lisää alue yllä tai käytä pelkkää lähiverkkoyhteyttä.',
  split_remove_aria: 'Poista sääntö {value}',
  split_next_note: 'Säännöt koskevat seuraavaa tällä sivulla luotavaa konfiguraatiota.',
  split_premium_required:
    'Jaettu tunnelointi on premium-ominaisuus. Sen sijaan luotiin täyden tunnelin konfiguraatio — päivitä ottaaksesi sääntösi käyttöön.',
  split_applied:
    'Jaettu tunnelointi käytössä — tämä konfiguraatio reitittää vain sen, minkä sääntösi sallivat.',

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
  multihop_error_no_exit:
    'Multi-hop tarvitsee erillisen uloskäynti-yhdyskäytävän; yhtään ei löytynyt.',
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
