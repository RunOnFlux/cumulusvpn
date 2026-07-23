import type { Catalog } from '../index';

export const uk: Catalog = {
  app_title: 'CumulusVPN — Приватний інтернет, без акаунта, без логів',

  header_nav_connect: 'Підключення',
  header_nav_upgrade: 'Оновлення',
  header_theme_label: 'Тема: {mode}',
  header_theme_system: 'системна',
  header_theme_light: 'світла',
  header_theme_dark: 'темна',
  header_language_label: 'Мова',

  footer_tagline: 'CumulusVPN — Децентралізований VPN на Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Бета-канал · без акаунта · без логів',

  common_copy: 'Копіювати',
  common_copied: 'Скопійовано',
  common_qr_alt: 'QR-код',
  common_powered_by_flux_link: 'Powered by Flux — відкриває runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'seed',
  common_directory: 'каталог',

  error_gateway_rejected: 'Шлюз відхилив реєстрацію ({slug}): {message}',

  countries_search_placeholder: '🔎  Пошук серед {n} країн…',
  countries_search_label: 'Пошук країн',
  countries_list_label: 'Країни',
  countries_no_match: 'Жодна країна не відповідає запиту «{query}».',
  countries_nodes: { one: '{n} вузол', few: '{n} вузли', many: '{n} вузлів', other: '{n} вузла' },

  connect_eyebrow: 'Бета-канал · конфігурація WireGuard',
  connect_title: 'Один ключ, <glow>кожен шлюз.</glow>',
  connect_lede:
    'Твоя пара ключів WireGuard генерується тут, у браузері — приватний ключ ніколи не залишає цю вкладку. Обери країну, зареєструйся на найближчому шлюзі Flux і експортуй готовий до імпорту<mono> .conf</mono> разом із QR-кодом. Назавжди безкоштовно на 100 KB/s; <upgrade>онови з FLUX</upgrade> для повної швидкості.',
  connect_verify_warn:
    'Не вдалося перевірити підпис каталогу — кінцеві точки показані лише для інформації.',
  connect_notice_no_live_gateway:
    'Жоден активний шлюз не доступний із браузера. Показано країни з підписаного каталогу — конфігурації реєструються на активному шлюзі, щойно він стане доступним.',
  connect_choose_location: 'Обери локацію',
  connect_tier_free: 'БЕЗКОШТОВНО · 100 KB/s',
  connect_loading_directory: 'Завантаження підписаного каталогу та пошук шлюзів…',
  connect_your_config: 'Твоя конфігурація',
  connect_source_directory: 'Каталог {source}',
  connect_live_nodes: {
    one: '{n} активний вузол',
    few: '{n} активні вузли',
    many: '{n} активних вузлів',
    other: '{n} активного вузла',
  },
  connect_select_country: 'Обери країну, щоб продовжити',
  connect_enrolling: 'Реєстрація…',
  connect_generate: 'Згенерувати .conf',
  connect_no_gateway_in_country:
    'Жоден активний шлюз у {country} не доступний із браузера. Реєстрація надсилається до керуючого API шлюзу (http :51821), недоступного зі сторінок https — це працює з десктопних і мобільних клієнтів, що використовують те саме ядро.',
  connect_error_enroll_failed: 'Реєстрація не вдалася.',
  connect_qr_caption: 'Скануй у застосунку WireGuard',
  connect_stat_assigned_ip: 'Призначена IP',
  connect_stat_endpoint: 'Кінцева точка',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Завантажити .conf',
  connect_upgrade_cta: 'Оновити до повної швидкості →',
  connect_identity_title: 'Ідентичність цього пристрою',
  connect_regenerate: 'Перегенерувати ключ',
  connect_identity_note:
    'Одна пара ключів на пристрій реєструється на багатьох шлюзах; преміум супроводжує ключ на всіх них через chain. Наведений нижче код платежу пов’язує платіж у FLUX із цим ключем.',
  connect_field_public_key: 'Публічний ключ WireGuard',
  connect_field_payment_code: 'Код платежу (memo)',

  upgrade_loading: 'Завантаження деталей платежу…',
  upgrade_eyebrow: 'Оновлення · оплата у FLUX',
  upgrade_title: 'Оновлення до повної швидкості',
  upgrade_lede:
    'Надішли FLUX із точно таким повідомленням, як нижче. Кожен шлюз сканує chain і розблоковує твій ключ протягом ~1 хвилини — одразу на всіх серверах, на 30 днів. Без акаунта, без картки, без жодної компанії, яка могла б видати те, чого в неї ніколи не було.',
  upgrade_usd_line: '≈ {usd} · за кожні 30 днів',
  upgrade_qr_caption: 'Скануй через Zelcore / SSP Wallet',
  upgrade_field_address: 'Адреса для оплати',
  upgrade_field_message: "Повідомлення (обов'язкове)",
  upgrade_open_wallet: 'Відкрити в гаманці',
  upgrade_prepay_note:
    '<strong>Заплати наперед:</strong> заплати кратну суму, щоб одразу додати відповідну кількість місяців — напр., {amount} FLUX = 3 місяці. Додаткові місяці накопичуються (до 24), тож можна поповнювати будь-коли.',
  upgrade_privacy_note:
    'Відкривається в Zelcore / SSP Wallet. Платіж перевіряється в блокчейні Flux — ми ніколи не бачимо, хто ти. Повідомлення пов’язує платіж із твоїм ключем; надсилання без нього означає, що кошти надійдуть, але нічого не розблокується.',
  upgrade_back: '← Назад до підключення',

  multihop_summary_title: 'Розширено: multi-hop (дві конфігурації)',
  multihop_tier_pill: 'ПРЕМІУМ · ЗА БАЖАННЯМ',
  multihop_lede:
    'Маршрутизуй через два шлюзи, щоб <strong>жоден окремий сервер не бачив одночасно, хто ти і куди прямуєш</strong>. Це повільніше й додає затримку — очікуй приблизно <strong>2× пінгу</strong> порівняно з одним хопом та нижчу пікову пропускну здатність через подвійне шифрування. Multi-hop — преміум-функція, але один платіж <mono>$0.99</mono> покриває обидва хопи (той самий ключ K автоматично стає преміум на вході та виході). Вимкнено за замовчуванням — наведений вище потік з одним хопом лишається основним.',
  multihop_entry_label: 'Країна входу (бачить твою IP)',
  multihop_entry_aria: 'Країна входу',
  multihop_exit_label: 'Країна виходу (бачить твій напрямок)',
  multihop_exit_aria: 'Країна виходу',
  multihop_style_same: 'Стиль маршруту: збалансований — та сама країна (одна юрисдикція)',
  multihop_style_cross:
    'Стиль маршруту: максимальна приватність — між юрисдикціями (два оператори, дві країни)',
  multihop_enrolling: 'Реєстрація обох хопів…',
  multihop_generate: 'Згенерувати дві конфігурації',
  multihop_error_no_exit: 'Multi-hop потребує окремого вихідного шлюзу; жодного не знайдено.',
  multihop_error_no_gateways:
    'Жоден активний шлюз не доступний із браузера, тож маршрут визначити не вдалося. Вкладеність multi-hop насправді є функцією наших застосунків — десктопні та мобільні клієнти (те саме ядро) перевіряють шлюзи напряму й запускають обидва тунелі за тебе.',
  multihop_error_failed: 'Не вдалося згенерувати multi-hop.',
  multihop_internet: 'інтернет',
  multihop_conf_outer_tag: 'зовнішній · MTU 1420',
  multihop_conf_inner_tag: 'внутрішній · MTU {mtu}',
  multihop_download_entry: 'Завантажити wg-entry.conf',
  multihop_download_exit: 'Завантажити wg-exit.conf',
  multihop_note:
    '<strong>Як це маршрутизувати (чесна примітка).</strong> Справжня вкладеність зі стандартним застосунком WireGuard незручна — він запускає лише один тунель одночасно — тож multi-hop насправді є <strong>функцією наших застосунків</strong> (десктоп/мобільний з’єднують обидва тунелі за тебе). Для ручного налаштування спершу підніми <mono>wg-entry.conf</mono>, потім маршрутизуй лише вихідну адресу <mono>{exitIp}/32</mono> через цей вхідний тунель, а решту надсилай через <mono>wg-exit.conf</mono> (внутрішній MTU {mtu}, щоб вмістилися два заголовки WireGuard). Вихідна кінцева точка: <mono>{endpoint}</mono>.<br/><strong>Застереження v1:</strong> обидва хопи використовують той самий ключ K, що унеможливлює кореляцію будь-яким <em>окремим</em> оператором, але означає, що супротивник, який контролює <em>обидва</em> твої хопи, міг би скорелювати їх через цей спільний ключ. Окремі ключі для кожного хопа з’являться у v1.5.',
};
