import type { Catalog } from '../index';

export const ru: Catalog = {
  app_title: 'CumulusVPN — Приватный интернет, без аккаунта, без логов',

  header_nav_connect: 'Подключение',
  header_nav_upgrade: 'Апгрейд',
  header_theme_label: 'Тема: {mode}',
  header_theme_system: 'системная',
  header_theme_light: 'светлая',
  header_theme_dark: 'тёмная',
  header_language_label: 'Язык',

  footer_tagline: 'CumulusVPN — Децентрализованный VPN на Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Бета-канал · без аккаунта · без логов',

  common_copy: 'Копировать',
  common_copied: 'Скопировано',
  common_qr_alt: 'QR-код',
  common_powered_by_flux_link: 'Powered by Flux — открывает runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'seed',
  common_directory: 'каталог',

  error_gateway_rejected: 'Шлюз отклонил регистрацию ({slug}): {message}',

  countries_search_placeholder: '🔎  Поиск среди {n} стран…',
  countries_search_label: 'Поиск стран',
  countries_list_label: 'Страны',
  countries_no_match: 'Ни одна страна не соответствует запросу «{query}».',
  countries_nodes: { one: '{n} узел', few: '{n} узла', many: '{n} узлов', other: '{n} узла' },

  connect_eyebrow: 'Бета-канал · конфигурация WireGuard',
  connect_title: 'Один ключ, <glow>каждый шлюз.</glow>',
  connect_lede:
    'Твоя пара ключей WireGuard генерируется здесь, в браузере — приватный ключ никогда не покидает эту вкладку. Выбери страну, зарегистрируйся на ближайшем шлюзе Flux и экспортируй готовый к импорту<mono> .conf</mono> вместе с QR-кодом. Бесплатно навсегда на скорости 100 KB/s; <upgrade>апгрейд за FLUX</upgrade> для полной скорости.',
  connect_verify_warn:
    'Не удалось проверить подпись каталога — конечные точки показаны исключительно в информационных целях.',
  connect_notice_no_live_gateway:
    'Ни один активный шлюз не доступен из браузера. Показаны страны из подписанного каталога — конфигурации регистрируются на активном шлюзе, как только он станет доступен.',
  connect_choose_location: 'Выбери локацию',
  connect_tier_free: 'БЕСПЛАТНО · 100 KB/s',
  connect_loading_directory: 'Загрузка подписанного каталога и поиск шлюзов…',
  connect_your_config: 'Твоя конфигурация',
  connect_source_directory: 'Каталог {source}',
  connect_live_nodes: {
    one: '{n} активный узел',
    few: '{n} активных узла',
    many: '{n} активных узлов',
    other: '{n} активного узла',
  },
  connect_select_country: 'Выбери страну, чтобы продолжить',
  connect_enrolling: 'Регистрация…',
  connect_generate: 'Сгенерировать .conf',
  connect_no_gateway_in_country:
    'Ни один активный шлюз в {country} не доступен из браузера. Регистрация отправляется в управляющий API шлюза (http :51821), недоступный со страниц https — это работает из десктопных и мобильных клиентов, использующих то же ядро.',
  connect_error_enroll_failed: 'Регистрация не удалась.',
  connect_qr_caption: 'Отсканируй в приложении WireGuard',
  connect_stat_assigned_ip: 'Назначенный IP',
  connect_stat_endpoint: 'Конечная точка',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Скачать .conf',
  connect_upgrade_cta: 'Апгрейд до полной скорости →',
  connect_identity_title: 'Идентичность этого устройства',
  connect_regenerate: 'Перегенерировать ключ',
  connect_identity_note:
    'Одна пара ключей на устройство регистрируется на многих шлюзах; премиум следует за ключом на всех них через chain. Код платежа ниже связывает платёж в FLUX с этим ключом.',
  connect_field_public_key: 'Публичный ключ WireGuard',
  connect_field_payment_code: 'Код платежа (memo)',

  upgrade_loading: 'Загрузка данных платежа…',
  upgrade_eyebrow: 'Апгрейд · оплата в FLUX',
  upgrade_title: 'Апгрейд до полной скорости',
  upgrade_lede:
    'Отправь FLUX с точно таким сообщением, как ниже. Каждый шлюз сканирует chain и разблокирует твой ключ в течение ~1 минуты — сразу на всех серверах, на 30 дней. Без аккаунта, без карты, без какой-либо компании, способной выдать то, чего у неё никогда не было.',
  upgrade_usd_line: '≈ {usd} · за 30 дней',
  upgrade_qr_caption: 'Отсканируй через Zelcore / SSP Wallet',
  upgrade_field_address: 'Адрес для оплаты',
  upgrade_field_message: 'Сообщение (обязательно)',
  upgrade_open_wallet: 'Открыть в кошельке',
  upgrade_prepay_note:
    '<strong>Оплати заранее:</strong> заплати сумму, кратную указанной, чтобы сразу добавить соответствующее число месяцев — напр., {amount} FLUX = 3 месяца. Дополнительные месяцы накапливаются (до 24), так что пополнять можно в любой момент.',
  upgrade_privacy_note:
    'Открывается в Zelcore / SSP Wallet. Платёж проверяется в блокчейне Flux — мы никогда не видим, кто ты. Сообщение связывает платёж с твоим ключом; отправка без него означает, что средства придут, но ничего не разблокируется.',
  upgrade_back: '← Назад к подключению',

  multihop_summary_title: 'Расширенно: multi-hop (две конфигурации)',
  multihop_tier_pill: 'ПРЕМИУМ · ПО ЖЕЛАНИЮ',
  multihop_lede:
    'Маршрутизируй через два шлюза, чтобы <strong>ни один отдельный сервер не видел одновременно, кто ты и куда направляешься</strong>. Это медленнее и добавляет задержку — ожидай примерно <strong>2× пинга</strong> по сравнению с одним хопом и более низкую пиковую пропускную способность из-за двойного шифрования. Multi-hop — премиум-функция, но один платёж <mono>$0.99</mono> покрывает оба хопа (один и тот же ключ K автоматически становится премиум на входе и выходе). Отключено по умолчанию — приведённый выше поток с одним хопом остаётся основным.',
  multihop_entry_label: 'Страна входа (видит твой IP)',
  multihop_entry_aria: 'Страна входа',
  multihop_exit_label: 'Страна выхода (видит твоё назначение)',
  multihop_exit_aria: 'Страна выхода',
  multihop_style_same: 'Стиль маршрута: сбалансированный — одна страна (одна юрисдикция)',
  multihop_style_cross:
    'Стиль маршрута: максимальная приватность — между юрисдикциями (два оператора, две страны)',
  multihop_enrolling: 'Регистрация обоих хопов…',
  multihop_generate: 'Сгенерировать две конфигурации',
  multihop_error_no_exit: 'Multi-hop требует отдельный выходной шлюз; ни один не найден.',
  multihop_error_no_gateways:
    'Ни один активный шлюз не доступен из браузера, поэтому маршрут определить не удалось. Вложенность multi-hop на деле является функцией наших приложений — десктопные и мобильные клиенты (то же ядро) напрямую опрашивают шлюзы и запускают оба туннеля за тебя.',
  multihop_error_failed: 'Не удалось сгенерировать multi-hop.',
  multihop_internet: 'интернет',
  multihop_conf_outer_tag: 'внешний · MTU 1420',
  multihop_conf_inner_tag: 'внутренний · MTU {mtu}',
  multihop_download_entry: 'Скачать wg-entry.conf',
  multihop_download_exit: 'Скачать wg-exit.conf',
  multihop_note:
    '<strong>Как это маршрутизировать (честное замечание).</strong> Настоящая вложенность со стандартным приложением WireGuard неудобна — оно запускает лишь один туннель за раз — поэтому multi-hop на деле является <strong>функцией наших приложений</strong> (десктоп/мобильные соединяют оба туннеля за тебя). Для ручной настройки сначала подними <mono>wg-entry.conf</mono>, затем маршрутизируй через этот входной туннель только выходной адрес <mono>{exitIp}/32</mono>, а остальное отправляй через <mono>wg-exit.conf</mono> (внутренний MTU {mtu}, чтобы поместились два заголовка WireGuard). Выходная конечная точка: <mono>{endpoint}</mono>.<br/><strong>Оговорка v1:</strong> оба хопа используют один и тот же ключ K, что срывает планы любого <em>отдельного</em> оператора, но означает, что противник, контролирующий <em>оба</em> твоих хопа, мог бы сопоставить их по этому общему ключу. Разные ключи для каждого хопа появятся в v1.5.',
};
