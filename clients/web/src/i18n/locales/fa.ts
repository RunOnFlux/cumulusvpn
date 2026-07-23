import type { Catalog } from '../index';

export const fa: Catalog = {
  app_title: 'CumulusVPN — اینترنت خصوصی، بدون حساب کاربری، بدون ثبت لاگ',

  header_nav_connect: 'اتصال',
  header_nav_upgrade: 'ارتقا',
  header_theme_label: 'پوسته: {mode}',
  header_theme_system: 'سیستم',
  header_theme_light: 'روشن',
  header_theme_dark: 'تیره',
  header_language_label: 'زبان',

  footer_tagline: 'CumulusVPN — VPN غیرمتمرکز روی Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'نسخه بتا · بدون حساب کاربری · بدون ثبت لاگ',

  common_copy: 'کپی',
  common_copied: 'کپی شد',
  common_qr_alt: 'کد QR',
  common_powered_by_flux_link: 'Powered by Flux — runonflux.com را باز می‌کند',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'فهرست اولیه',
  common_directory: 'فهرست راهنما',

  error_gateway_rejected: 'دروازه ثبت‌نام را رد کرد ({slug}): {message}',

  countries_search_placeholder: '🔎  در میان {n} کشور جستجو کنید…',
  countries_search_label: 'جستجوی کشورها',
  countries_list_label: 'کشورها',
  countries_no_match: 'هیچ کشوری با «{query}» مطابقت ندارد.',
  countries_nodes: { one: '{n} گره', other: '{n} گره' },

  connect_eyebrow: 'نسخه بتا · پیکربندی WireGuard',
  connect_title: 'یک کلید، <glow>هر دروازه.</glow>',
  connect_lede:
    'جفت‌کلید WireGuard شما همین‌جا، در مرورگرتان ساخته می‌شود — کلید خصوصی هرگز این تب را ترک نمی‌کند. کشوری را انتخاب کنید، در نزدیک‌ترین دروازه Flux ثبت‌نام کنید و فایل<mono> .conf</mono> آماده وارد کردن را همراه با کد QR دریافت کنید. برای همیشه رایگان با سرعت 100 KB/s؛ برای سرعت کامل <upgrade>با FLUX ارتقا دهید</upgrade>.',
  connect_verify_warn:
    'امضای فهرست راهنما قابل تأیید نبود — نقاط پایانی فقط جهت اطلاع نمایش داده می‌شوند.',
  connect_notice_no_live_gateway:
    'هیچ دروازه فعالی از مرورگر در دسترس نیست. کشورهای فهرست راهنمای امضاشده نمایش داده می‌شوند — پیکربندی‌ها هرگاه دروازه فعالی در دسترس باشد، در آن ثبت‌نام می‌کنند.',
  connect_choose_location: 'موقعیتی را انتخاب کنید',
  connect_tier_free: 'رایگان · 100 KB/s',
  connect_loading_directory: 'در حال یافتن فهرست راهنمای امضاشده و کشف دروازه‌ها…',
  connect_your_config: 'پیکربندی شما',
  connect_source_directory: 'فهرست راهنمای {source}',
  connect_live_nodes: { one: '{n} گره فعال', other: '{n} گره فعال' },
  connect_select_country: 'برای ادامه کشوری را انتخاب کنید',
  connect_enrolling: 'در حال ثبت‌نام…',
  connect_generate: 'ساخت .conf',
  connect_no_gateway_in_country:
    'هیچ دروازه فعالی در {country} از مرورگر در دسترس نیست. ثبت‌نام به API کنترلِ دروازه (http :51821) ارسال می‌شود که صفحات https نمی‌توانند به آن دسترسی داشته باشند — این کار از برنامه‌های دسکتاپ و موبایل که این هسته را به اشتراک می‌گذارند انجام‌پذیر است.',
  connect_error_enroll_failed: 'ثبت‌نام ناموفق بود.',
  connect_qr_caption: 'در برنامه WireGuard اسکن کنید',
  connect_stat_assigned_ip: 'IP اختصاص‌یافته',
  connect_stat_endpoint: 'نقطه پایانی',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'دانلود .conf',
  connect_upgrade_cta: 'ارتقا به سرعت کامل ←',
  connect_identity_title: 'هویت این دستگاه',
  connect_regenerate: 'ساخت مجدد کلید',
  connect_identity_note:
    'یک جفت‌کلید برای هر دستگاه در دروازه‌های زیادی ثبت‌نام می‌کند؛ نسخه ویژه از طریق زنجیره، کلید را در همه آن‌ها دنبال می‌کند. کد پرداخت زیر همان چیزی است که پرداخت FLUX را به این کلید متصل می‌کند.',
  connect_field_public_key: 'کلید عمومی WireGuard',
  connect_field_payment_code: 'کد پرداخت (یادداشت)',

  upgrade_loading: 'در حال بارگذاری جزئیات پرداخت…',
  upgrade_eyebrow: 'ارتقا · پرداخت با FLUX',
  upgrade_title: 'ارتقا به سرعت کامل',
  upgrade_lede:
    'FLUX را دقیقاً با پیام زیر ارسال کنید. هر دروازه زنجیره را اسکن می‌کند و کلید شما را ظرف ~1 دقیقه باز می‌کند — روی همه سرورها هم‌زمان، برای 30 روز. بدون حساب کاربری، بدون کارت، بدون هیچ شرکتی که بتواند چیزی را که هرگز نداشته تحویل دهد.',
  upgrade_usd_line: '≈ {usd} · هر 30 روز',
  upgrade_qr_caption: 'با Zelcore / SSP Wallet اسکن کنید',
  upgrade_field_address: 'آدرس پرداخت',
  upgrade_field_message: 'پیام (الزامی)',
  upgrade_open_wallet: 'باز کردن در کیف پول',
  upgrade_prepay_note:
    '<strong>پیش‌پرداخت:</strong> مضربی از مبلغ را بپردازید تا همان تعداد ماه را یک‌جا اضافه کنید — مثلاً {amount} FLUX برابر با 3 ماه است. ماه‌های اضافه روی هم انباشته می‌شوند (تا 24 ماه)، بنابراین هر زمان می‌توانید شارژ کنید.',
  upgrade_privacy_note:
    'در Zelcore / SSP Wallet باز می‌شود. پرداخت روی بلاک‌چین Flux تأیید می‌شود — ما هرگز نمی‌بینیم شما چه کسی هستید. پیام، پرداخت را به کلید شما متصل می‌کند؛ ارسال بدون آن یعنی وجه می‌رسد اما چیزی باز نمی‌شود.',
  upgrade_back: '→ بازگشت به اتصال',

  multihop_summary_title: 'پیشرفته: چندجهشی (دو پیکربندی)',
  multihop_tier_pill: 'ویژه · اختیاری',
  multihop_lede:
    'از طریق دو دروازه مسیردهی کنید تا <strong>هیچ سروری به‌تنهایی هم هویت شما و هم مقصدتان را نبیند</strong>. این کندتر است و تأخیر را افزایش می‌دهد — نسبت به تک‌جهشی، تقریباً <strong>2× پینگ</strong> و توان عملیاتی اوج پایین‌تر به‌دلیل رمزگذاری دوگانه انتظار داشته باشید. چندجهشی ویژه است، اما یک پرداخت <mono>$0.99</mono> هر دو جهش را پوشش می‌دهد (همان کلید K به‌طور خودکار در ورودی و خروجی ویژه می‌شود). به‌طور پیش‌فرض خاموش است — روند تک‌جهشی بالا همچنان اصلی باقی می‌ماند.',
  multihop_entry_label: 'کشور ورودی (IP شما را می‌بیند)',
  multihop_entry_aria: 'کشور ورودی',
  multihop_exit_label: 'کشور خروجی (مقصد شما را می‌بیند)',
  multihop_exit_aria: 'کشور خروجی',
  multihop_style_same: 'سبک مسیر: متعادل — کشور یکسان (یک حوزه قضایی)',
  multihop_style_cross: 'سبک مسیر: حداکثر حریم خصوصی — بین حوزه‌های قضایی (دو اپراتور، دو کشور)',
  multihop_enrolling: 'در حال ثبت‌نام هر دو جهش…',
  multihop_generate: 'ساخت دو پیکربندی',
  multihop_error_no_exit: 'چندجهشی به یک دروازه خروجی مجزا نیاز دارد؛ هیچ‌کدام یافت نشد.',
  multihop_error_no_gateways:
    'هیچ دروازه فعالی از مرورگر در دسترس نیست، بنابراین هیچ مسیری قابل تعیین نبود. تودرتویی چندجهشی درواقع ویژگی برنامه‌های ماست — برنامه‌های دسکتاپ و موبایل (همان هسته) دروازه‌ها را مستقیماً بررسی می‌کنند و دو تونل را برای شما اجرا می‌کنند.',
  multihop_error_failed: 'ساخت چندجهشی ناموفق بود.',
  multihop_internet: 'اینترنت',
  multihop_conf_outer_tag: 'بیرونی · MTU 1420',
  multihop_conf_inner_tag: 'درونی · MTU {mtu}',
  multihop_download_entry: 'دانلود wg-entry.conf',
  multihop_download_exit: 'دانلود wg-exit.conf',
  multihop_note:
    '<strong>چگونگی مسیردهی این‌ها (یادداشت صادقانه).</strong> تودرتویی واقعی با برنامه استاندارد WireGuard دست‌وپاگیر است — چون فقط یک تونل را در هر لحظه اجرا می‌کند — پس چندجهشی درواقع <strong>ویژگی برنامه‌های ماست</strong> (دسکتاپ/موبایل دو تونل را برای شما زنجیر می‌کنند). برای راه‌اندازی دستی، ابتدا باید <mono>wg-entry.conf</mono> را بالا بیاورید، سپس فقط آدرس خروجی <mono>{exitIp}/32</mono> را از طریق آن تونل ورودی مسیردهی کنید و بقیه را از طریق <mono>wg-exit.conf</mono> ارسال کنید (MTU درونی {mtu}، تا دو هدر WireGuard جا شود). نقطه پایانی خروجی: <mono>{endpoint}</mono>.<br/><strong>هشدار نسخه v1:</strong> هر دو جهش از کلید یکسان K استفاده می‌کنند که هر اپراتور <em>منفرد</em> را بی‌اثر می‌کند، اما به این معناست که مهاجمی که <em>هر دو</em> جهش شما را کنترل کند می‌تواند از طریق آن کلید مشترک همبستگی برقرار کند. کلیدهای جداگانه برای هر جهش در v1.5 خواهد آمد.',
};
