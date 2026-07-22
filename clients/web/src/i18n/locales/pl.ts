import type { Catalog } from '../index';

export const pl: Catalog = {
  app_title: 'CumulusVPN — Prywatny internet, bez konta, bez logów',

  header_nav_connect: 'Połącz',
  header_nav_upgrade: 'Ulepsz',
  header_theme_label: 'Motyw: {mode}',
  header_theme_system: 'systemowy',
  header_theme_light: 'jasny',
  header_theme_dark: 'ciemny',
  header_language_label: 'Język',

  footer_tagline: 'CumulusVPN — Zdecentralizowany VPN na Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Wersja beta · bez konta · bez logów',

  common_copy: 'Kopiuj',
  common_copied: 'Skopiowano',
  common_qr_alt: 'Kod QR',
  common_powered_by_flux_link: 'Powered by Flux — otwiera runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'seed',
  common_directory: 'katalog',

  error_gateway_rejected: 'Bramka odrzuciła rejestrację ({slug}): {message}',

  countries_search_placeholder: '🔎  Przeszukaj {n} krajów…',
  countries_search_label: 'Szukaj krajów',
  countries_list_label: 'Kraje',
  countries_no_match: 'Żaden kraj nie pasuje do „{query}”.',
  countries_nodes: { one: '{n} węzeł', few: '{n} węzły', many: '{n} węzłów', other: '{n} węzła' },

  connect_eyebrow: 'Wersja beta · konfiguracja WireGuard',
  connect_title: 'Jeden klucz, <glow>każda bramka.</glow>',
  connect_lede:
    'Twoja para kluczy WireGuard jest generowana tutaj, w przeglądarce — klucz prywatny nigdy nie opuszcza tej karty. Wybierz kraj, zarejestruj się na najbliższej bramce Flux i wyeksportuj gotowy do zaimportowania plik<mono> .conf</mono> wraz z kodem QR. Zawsze za darmo przy 100 KB/s; <upgrade>ulepsz za FLUX</upgrade>, aby uzyskać pełną prędkość.',
  connect_verify_warn:
    'Nie udało się zweryfikować podpisu katalogu — punkty końcowe są pokazane wyłącznie informacyjnie.',
  connect_notice_no_live_gateway:
    'Żadna aktywna bramka nie jest dostępna z przeglądarki. Pokazujemy kraje z podpisanego katalogu — konfiguracje rejestrują się na aktywnej bramce, gdy tylko jakaś stanie się dostępna.',
  connect_choose_location: 'Wybierz lokalizację',
  connect_tier_free: 'DARMOWY · 100 KB/s',
  connect_loading_directory: 'Wczytywanie podpisanego katalogu i wykrywanie bramek…',
  connect_your_config: 'Twoja konfiguracja',
  connect_source_directory: 'Katalog {source}',
  connect_live_nodes: { one: '{n} aktywny węzeł', few: '{n} aktywne węzły', many: '{n} aktywnych węzłów', other: '{n} aktywnego węzła' },
  connect_select_country: 'Wybierz kraj, aby kontynuować',
  connect_enrolling: 'Rejestracja…',
  connect_generate: 'Wygeneruj .conf',
  connect_no_gateway_in_country:
    'Żadna aktywna bramka w {country} nie jest dostępna z przeglądarki. Rejestracja trafia do API kontrolnego bramki (http :51821), do którego strony https nie mają dostępu — działa to z klientów desktopowych i mobilnych, które współdzielą ten sam rdzeń.',
  connect_error_enroll_failed: 'Rejestracja nie powiodła się.',
  connect_qr_caption: 'Zeskanuj aplikacją WireGuard',
  connect_stat_assigned_ip: 'Przypisany adres IP',
  connect_stat_endpoint: 'Punkt końcowy',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Pobierz .conf',
  connect_upgrade_cta: 'Ulepsz do pełnej prędkości →',
  connect_identity_title: 'Tożsamość tego urządzenia',
  connect_regenerate: 'Wygeneruj klucz ponownie',
  connect_identity_note:
    'Jedna para kluczy na urządzenie rejestruje się na wielu bramkach; wersja premium podąża za kluczem na wszystkich z nich poprzez chain. Poniższy kod płatności wiąże płatność w FLUX z tym kluczem.',
  connect_field_public_key: 'Klucz publiczny WireGuard',
  connect_field_payment_code: 'Kod płatności (notatka)',

  upgrade_loading: 'Wczytywanie danych płatności…',
  upgrade_eyebrow: 'Ulepszenie · płatność w FLUX',
  upgrade_title: 'Ulepsz do pełnej prędkości',
  upgrade_lede:
    'Wyślij FLUX z dokładnie taką wiadomością jak poniżej. Każda bramka skanuje chain i odblokowuje twój klucz w ciągu ~1 minuty — na wszystkich serwerach naraz, na 30 dni. Bez konta, bez karty, bez żadnej firmy, która mogłaby wydać coś, czego nigdy nie miała.',
  upgrade_usd_line: '≈ {usd} · za 30 dni',
  upgrade_qr_caption: 'Zeskanuj Zelcore / SSP Wallet',
  upgrade_field_address: 'Adres płatności',
  upgrade_field_message: 'Wiadomość (wymagana)',
  upgrade_open_wallet: 'Otwórz w portfelu',
  upgrade_prepay_note:
    '<strong>Zapłać z góry:</strong> zapłać wielokrotność kwoty, aby dodać odpowiednio więcej miesięcy naraz — np. {amount} FLUX = 3 miesiące. Dodatkowe miesiące się kumulują (do 24), więc możesz doładować w dowolnym momencie.',
  upgrade_privacy_note:
    'Otwiera się w Zelcore / SSP Wallet. Płatność jest weryfikowana na blockchainie Flux — nigdy nie widzimy, kim jesteś. Wiadomość wiąże płatność z twoim kluczem; wysłanie bez niej oznacza, że środki dotrą, ale nic się nie odblokuje.',
  upgrade_back: '← Wróć do Połącz',

  multihop_summary_title: 'Zaawansowane: multi-hop (dwie konfiguracje)',
  multihop_tier_pill: 'PREMIUM · OPCJONALNIE',
  multihop_lede:
    'Trasuj przez dwie bramki, tak aby <strong>żaden pojedynczy serwer nie widział jednocześnie tego, kim jesteś, i tego, dokąd zmierzasz</strong>. Jest wolniej i rośnie opóźnienie — spodziewaj się mniej więcej <strong>2× pingu</strong> w porównaniu z pojedynczym skokiem oraz niższej szczytowej przepustowości z powodu podwójnego szyfrowania. Multi-hop jest funkcją premium, ale jedna płatność <mono>$0.99</mono> pokrywa oba skoki (ten sam klucz K automatycznie staje się premium zarówno na wejściu, jak i na wyjściu). Domyślnie wyłączone — powyższy tryb pojedynczego skoku pozostaje główny.',
  multihop_entry_label: 'Kraj wejściowy (widzi twój adres IP)',
  multihop_entry_aria: 'Kraj wejściowy',
  multihop_exit_label: 'Kraj wyjściowy (widzi twój cel)',
  multihop_exit_aria: 'Kraj wyjściowy',
  multihop_style_same: 'Styl trasy: zrównoważony — ten sam kraj (jedna jurysdykcja)',
  multihop_style_cross:
    'Styl trasy: maksymalna prywatność — między jurysdykcjami (dwóch operatorów, dwa kraje)',
  multihop_enrolling: 'Rejestracja obu skoków…',
  multihop_generate: 'Wygeneruj dwie konfiguracje',
  multihop_error_no_exit: 'Multi-hop wymaga oddzielnej bramki wyjściowej; żadnej nie znaleziono.',
  multihop_error_no_gateways:
    'Żadna aktywna bramka nie jest dostępna z przeglądarki, więc nie udało się wyznaczyć trasy. Zagnieżdżanie multi-hop to tak naprawdę funkcja naszych aplikacji — klienci desktopowi i mobilni (ten sam rdzeń) sprawdzają bramki bezpośrednio i uruchamiają oba tunele za ciebie.',
  multihop_error_failed: 'Generowanie multi-hop nie powiodło się.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'zewnętrzny · MTU 1420',
  multihop_conf_inner_tag: 'wewnętrzny · MTU {mtu}',
  multihop_download_entry: 'Pobierz wg-entry.conf',
  multihop_download_exit: 'Pobierz wg-exit.conf',
  multihop_note:
    '<strong>Jak to trasować (szczera uwaga).</strong> Prawdziwe zagnieżdżanie w standardowej aplikacji WireGuard jest niewygodne — obsługuje ona tylko jeden tunel naraz — więc multi-hop to tak naprawdę <strong>funkcja naszych aplikacji</strong> (desktop/mobile łączą oba tunele za ciebie). Do ręcznej konfiguracji musisz najpierw uruchomić <mono>wg-entry.conf</mono>, potem trasować przez ten tunel wejściowy tylko adres wyjściowy <mono>{exitIp}/32</mono>, a resztę wysyłać przez <mono>wg-exit.conf</mono> (wewnętrzne MTU {mtu}, aby zmieściły się dwa nagłówki WireGuard). Punkt końcowy wyjścia: <mono>{endpoint}</mono>.<br/><strong>Zastrzeżenie v1:</strong> oba skoki używają tego samego klucza K, co udaremnia każdego <em>pojedynczego</em> operatora, ale oznacza, że przeciwnik kontrolujący <em>oba</em> twoje skoki mógłby je skorelować przez ten wspólny klucz. Odrębne klucze dla każdego skoku pojawią się w v1.5.',
};
