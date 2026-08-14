import type { Catalog } from '../index';

export const ar: Catalog = {
  app_title: 'CumulusVPN — إنترنت خاص، بلا حساب، بلا سجلات',

  header_nav_connect: 'اتصال',
  header_nav_upgrade: 'ترقية',
  header_theme_label: 'المظهر: {mode}',
  header_theme_system: 'نظام',
  header_theme_light: 'فاتح',
  header_theme_dark: 'داكن',
  header_language_label: 'اللغة',

  footer_tagline: 'CumulusVPN — VPN لامركزية على Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'مسار تجريبي · بلا حساب · بلا سجلات',

  common_copy: 'نسخ',
  common_copied: 'تم النسخ',
  common_qr_alt: 'رمز QR',
  common_powered_by_flux_link: 'Powered by Flux — يفتح runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'قائمة أولية',
  common_directory: 'دليل',

  error_gateway_rejected: 'رفضت البوابة التسجيل ({slug}): {message}',

  countries_search_placeholder: '🔎  ابحث بين {n} دولة…',
  countries_search_label: 'البحث عن الدول',
  countries_list_label: 'الدول',
  countries_no_match: 'لا توجد دولة تطابق «{query}».',
  countries_nodes: {
    zero: '{n} عقدة',
    one: '{n} عقدة',
    two: '{n} عقدتان',
    few: '{n} عُقد',
    many: '{n} عقدةً',
    other: '{n} عقدة',
  },

  connect_eyebrow: 'مسار تجريبي · إعداد WireGuard',
  connect_title: 'مفتاح واحد، <glow>كل بوابة.</glow>',
  connect_lede:
    'يُنشأ زوج مفاتيح WireGuard الخاص بك هنا، في متصفحك — المفتاح الخاص لا يغادر هذا التبويب أبدًا. اختر دولة، سجّل في أقرب بوابة Flux، ثم صدّر ملف<mono> .conf</mono> جاهزًا للاستيراد مع رمز QR. مجاني للأبد بسرعة 100 KB/s؛ <upgrade>رقِّ مع FLUX</upgrade> للحصول على السرعة الكاملة.',
  connect_verify_warn: 'تعذّر التحقق من توقيع الدليل — تُعرض نقاط النهاية للعِلم فقط.',
  connect_notice_no_live_gateway:
    'لا توجد بوابة نشطة يمكن الوصول إليها من المتصفح. تُعرض دول الدليل الموقَّع — تُسجَّل الإعدادات لدى بوابة نشطة عند توفر واحدة.',
  connect_choose_location: 'اختر موقعًا',
  connect_tier_free: 'مجاني · 100 KB/s',
  connect_loading_directory: 'جارٍ تحليل الدليل الموقَّع واكتشاف البوابات…',
  connect_your_config: 'إعدادك',
  connect_source_directory: 'دليل {source}',
  connect_live_nodes: {
    zero: '{n} عقدة نشطة',
    one: '{n} عقدة نشطة',
    two: '{n} عقدتان نشطتان',
    few: '{n} عُقد نشطة',
    many: '{n} عقدةً نشطة',
    other: '{n} عقدة نشطة',
  },
  connect_select_country: 'اختر دولة للمتابعة',
  connect_enrolling: 'جارٍ التسجيل…',
  connect_generate: 'إنشاء .conf',
  connect_no_gateway_in_country:
    'لا توجد بوابة نشطة يمكن الوصول إليها في {country} من المتصفح. يُرسَل التسجيل إلى واجهة التحكم البرمجية لبوابة (http :51821)، التي لا تستطيع صفحات https الوصول إليها — يعمل هذا من تطبيقات سطح المكتب والجوال التي تشارك هذه النواة.',
  connect_error_enroll_failed: 'فشل التسجيل.',
  connect_qr_caption: 'امسح ضوئيًا في تطبيق WireGuard',
  connect_stat_assigned_ip: 'IP المخصص',
  connect_stat_endpoint: 'نقطة النهاية',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'تنزيل .conf',
  connect_conf_note:
    'مرتبط بهذا الخادم. إذا أُعيد تشغيله أو تغيّر، سيظل WireGuard يعرض النفق متصلاً دون أن يمر أي شيء — عد إلى هنا وأنشئ ملف ‎.conf‎ جديدًا.',
  connect_conf_regenerate: 'إنشاء ملف ‎.conf‎ جديد',
  connect_conf_stale:
    'تم استبدال الخادم الذي أصدر إعدادك الأخير لـ {country} — لم يعد بإمكان ذلك الإعداد الاتصال. أنشئ إعدادًا جديدًا أدناه.',
  connect_conf_unsure:
    'تعذّر الوصول إلى الخادم الذي أصدر إعدادك الأخير لـ {country}. قد يكون متوقفًا مؤقتًا أو زال نهائيًا — إذا كان النفق لا يمرر أي بيانات، فأنشئ إعدادًا جديدًا أدناه.',
  connect_conf_checking: 'جارٍ فحص إعدادك الأخير…',
  connect_upgrade_cta: 'الترقية إلى السرعة الكاملة ←',
  connect_identity_title: 'هوية هذا الجهاز',
  connect_regenerate: 'إعادة إنشاء المفتاح',
  connect_identity_note:
    'يُسجَّل زوج مفاتيح واحد لكل جهاز في بوابات عديدة؛ الوضع المميز يتبع المفتاح في جميعها عبر السلسلة. رمز الدفع أدناه هو ما يربط دفعة FLUX بهذا المفتاح.',
  connect_field_public_key: 'المفتاح العام لـ WireGuard',
  connect_field_payment_code: 'رمز الدفع (مذكرة)',

  upgrade_loading: 'جارٍ تحميل تفاصيل الدفع…',
  upgrade_eyebrow: 'الترقية · ادفع بـ FLUX',
  upgrade_title: 'الترقية إلى السرعة الكاملة',
  upgrade_lede:
    'أرسل FLUX مع الرسالة الدقيقة أدناه. تفحص كل بوابة السلسلة وتُطلق مفتاحك خلال ~1 دقيقة تقريبًا — على جميع الخوادم في آنٍ واحد، لمدة 30 يومًا. بلا حساب، بلا بطاقة، بلا شركة يمكنها تسليم ما لم تمتلكه قط.',
  upgrade_usd_line: '≈ {usd} · لكل 30 يومًا',
  upgrade_qr_caption: 'امسح ضوئيًا باستخدام Zelcore / SSP Wallet',
  upgrade_field_address: 'عنوان الدفع',
  upgrade_field_message: 'الرسالة (مطلوبة)',
  upgrade_open_wallet: 'فتح في المحفظة',
  upgrade_prepay_note:
    '<strong>ادفع مسبقًا:</strong> ادفع مضاعفًا للمبلغ لإضافة العدد نفسه من الأشهر دفعة واحدة — على سبيل المثال، {amount} FLUX = 3 أشهر. تتراكم الأشهر الإضافية (حتى 24)، لذا يمكنك التعبئة في أي وقت.',
  upgrade_privacy_note:
    'يفتح في Zelcore / SSP Wallet. يُتحقَّق من الدفعة على سلسلة كتل Flux — لا نرى أبدًا من أنت. تربط الرسالة الدفعة بمفتاحك؛ الإرسال بدونها يعني وصول الأموال دون أن يُطلَق شيء.',
  upgrade_back: '→ العودة إلى الاتصال',

  upgrade_eyebrow_card: 'أو ادفع بالبطاقة',
  upgrade_card_lede:
    'اشترك ببطاقة أو Apple Pay أو Google Pay. تتولى Stripe عملية الدفع — لا نرى بطاقتك أبدًا. يُفعَّل وضعك المميز مع ذلك على سلسلة كتل Flux، مرتبطًا فقط برمز الدفع المجهول الخاص بك.',
  upgrade_plan_aria: 'خطة الاشتراك',
  upgrade_plan_monthly: '{usd} / شهريًا',
  upgrade_plan_annual: '{usd} / سنويًا',
  upgrade_card_cta: 'ادفع بالبطاقة',
  upgrade_card_cta_busy: 'جارٍ فتح صفحة الدفع الآمنة…',
  upgrade_card_error: 'تعذّر فتح صفحة الدفع. يُرجى المحاولة مرة أخرى بعد قليل.',
  upgrade_card_note:
    'يتجدّد تلقائيًا؛ يمكنك الإلغاء أو تغيير الخطة في أي وقت من قسم «اشتراكك» أدناه، أو من رسالة إيصال Stripe. الدفع بـ FLUX في الأعلى أرخص — سعر البطاقة يغطي رسوم المعالجة.',
  upgrade_activating_title: 'جارٍ تفعيل وضعك المميز…',
  upgrade_state_pending: 'تم استلام الدفعة — جارٍ تجهيز التفعيل على شبكة Flux.',
  upgrade_state_broadcast: 'أُرسل التفعيل إلى شبكة Flux — بانتظار التأكيد.',
  upgrade_state_confirmed: 'تم التأكيد! تُفتح السرعة الكاملة على جميع الخوادم خلال دقيقة.',
  upgrade_state_failed:
    'حدث خطأ ما أثناء التفعيل. دفعتك آمنة — نعيد المحاولة تلقائيًا، وسيظهر وضعك المميز قريبًا.',
  upgrade_activating_hint: 'يمكنك إغلاق هذه الصفحة — يكتمل التفعيل من تلقاء نفسه.',
  upgrade_activated_cta: 'العودة إلى الاتصال ←',

  manage_eyebrow: 'اشتراكك',
  manage_lede:
    'حدّث بطاقتك، أو بدّل بين الاشتراك الشهري والسنوي، أو ألغِ الاشتراك. يفتح بوابة الفوترة الآمنة من Stripe.',
  manage_none:
    'لم يتم شراء أي اشتراك بالبطاقة في هذا المتصفح. إذا اشتركت من جهاز آخر، استخدم الرابط الموجود في رسالة إيصال Stripe — أو App Store / Google Play إذا اشتركت داخل التطبيق.',
  manage_cta: 'إدارة الاشتراك',
  manage_cta_busy: 'جارٍ فتح بوابة الفوترة…',
  manage_err:
    'تعذّر فتح بوابة الفوترة من هذا المتصفح. يمكنك دائمًا الإدارة أو الإلغاء عبر الرابط الموجود في رسالة إيصال Stripe.',

  redeem_eyebrow: 'هل لديك رمز؟',
  redeem_lede:
    'استرد قسيمة أو رمزًا ترويجيًا. رموز الوقت المجاني تُفعَّل على شبكة Flux لهذا الجهاز؛ ورموز الخصم تُطبَّق على الدفع بالبطاقة أعلاه.',
  redeem_placeholder: 'CVPN-XXXXX-XXXXX',
  redeem_cta: 'استرداد',
  redeem_cta_busy: 'جارٍ التحقق…',
  redeem_discount_applied:
    'تم تطبيق خصم {percent}% — ادفع بالبطاقة أعلاه وسيُدرج الخصم في صفحة الدفع.',
  redeem_err_invalid: 'هذا الرمز غير صالح. تحقق من الأخطاء الإملائية وحاول مرة أخرى.',
  redeem_err_expired: 'انتهت صلاحية هذا الرمز.',
  redeem_err_exhausted: 'استُخدم هذا الرمز بالكامل بالفعل.',
  redeem_err_already: 'استرد هذا الجهاز هذا الرمز بالفعل.',
  redeem_err_later: 'الاسترداد غير متاح مؤقتًا — يُرجى المحاولة مرة أخرى بعد بضع دقائق.',

  split_summary_title: 'متقدم: تقسيم النفق',
  split_tier_pill: 'بريميوم · اختياري',
  split_lede:
    'اختر الوجهات التي تمر عبر VPN. تعبّر التهيئة المولَّدة عن القواعد كـ AllowedIPs في WireGuard، لذا تعمل مع تطبيق WireGuard القياسي — نطاقات IP وتجاوز الشبكة المحلية فقط (قواعد التطبيقات تتطلب تطبيقاتنا الأصلية).',
  split_mode_aria: 'وضع تقسيم النفق',
  split_mode_off: 'إيقاف',
  split_mode_exclude: 'استبعاد المُدرجة',
  split_mode_include: 'هذه فقط',
  split_warn_exclude:
    'حركة المرور المستبعدة تغادر جهازك دون حماية وتُظهر عنوان IP الحقيقي الخاص بك.',
  split_warn_include: 'الوجهات المُدرجة فقط محمية — كل ما عداها يُظهر عنوان IP الحقيقي الخاص بك.',
  split_lan_label: 'السماح بالوصول إلى الشبكة المحلية (طابعات، NAS، بث)',
  split_cidr_placeholder: 'مثل 192.168.0.0/16 أو 203.0.113.7',
  split_cidr_aria: 'عنوان IP أو نطاق CIDR',
  split_add: 'إضافة',
  split_input_invalid: 'عنوان IP أو نطاق CIDR غير صالح.',
  split_rules_empty:
    'لا توجد قواعد IP بعد — أضف نطاقًا أعلاه، أو استخدم الوصول إلى الشبكة المحلية فقط.',
  split_remove_aria: 'إزالة القاعدة {value}',
  split_next_note: 'تنطبق القواعد على التهيئة التالية التي تولّدها في هذه الصفحة.',
  split_premium_required:
    'تقسيم النفق ميزة بريميوم. تم توليد تهيئة نفق كامل بدلًا من ذلك — قم بالترقية لتطبيق قواعدك.',
  split_applied: 'تم تطبيق تقسيم النفق — هذه التهيئة توجّه فقط ما تسمح به قواعدك.',

  multihop_summary_title: 'متقدم: تعدد القفزات (إعدادان)',
  multihop_tier_pill: 'مميز · اختياري',
  multihop_lede:
    'وجّه عبر بوابتين حتى <strong>لا يرى أي خادم بمفرده هويتك ووجهتك معًا</strong>. هذا أبطأ ويزيد زمن الوصول — توقع تقريبًا <strong>2× بينغ</strong> مقارنة بالقفزة الواحدة، وذروة إنتاجية أقل بسبب التشفير المزدوج. تعدد القفزات ميزة مميزة، لكن دفعة واحدة قدرها <mono>$0.99</mono> تغطي القفزتين معًا (يصبح المفتاح K نفسه مميزًا عند الدخول والخروج تلقائيًا). معطّل افتراضيًا — يبقى تدفق القفزة الواحدة أعلاه هو الأساسي.',
  multihop_entry_label: 'دولة الدخول (ترى عنوان IP الخاص بك)',
  multihop_entry_aria: 'دولة الدخول',
  multihop_exit_label: 'دولة الخروج (ترى وجهتك)',
  multihop_exit_aria: 'دولة الخروج',
  multihop_style_same: 'نمط المسار: متوازن — الدولة نفسها (ولاية قضائية واحدة)',
  multihop_style_cross: 'نمط المسار: أقصى خصوصية — عبر الولايات القضائية (مشغّلان، دولتان)',
  multihop_enrolling: 'جارٍ تسجيل كلتا القفزتين…',
  multihop_generate: 'إنشاء إعدادين',
  multihop_error_no_exit: 'يحتاج تعدد القفزات إلى بوابة خروج مستقلة؛ لم يتم تحديد أي منها.',
  multihop_error_no_gateways:
    'لا توجد بوابات نشطة يمكن الوصول إليها من المتصفح، لذا تعذّر تحديد أي مسار. تداخل تعدد القفزات هو في الواقع ميزة خاصة بتطبيقاتنا — تفحص تطبيقات سطح المكتب والجوال (النواة نفسها) البوابات مباشرة وتشغّل النفقين نيابة عنك.',
  multihop_error_failed: 'فشل إنشاء تعدد القفزات.',
  multihop_internet: 'الإنترنت',
  multihop_conf_outer_tag: 'خارجي · MTU 1420',
  multihop_conf_inner_tag: 'داخلي · MTU {mtu}',
  multihop_download_entry: 'تنزيل wg-entry.conf',
  multihop_download_exit: 'تنزيل wg-exit.conf',
  multihop_note:
    '<strong>كيفية توجيه هذا (ملاحظة صريحة).</strong> التداخل الحقيقي باستخدام تطبيق WireGuard القياسي أمر مرهق — فهو يشغّل نفقًا واحدًا في كل مرة — لذا فإن تعدد القفزات هو في الواقع <strong>ميزة خاصة بتطبيقاتنا</strong> (تطبيقا سطح المكتب والجوال يسلسلان النفقين نيابة عنك). للإعداد اليدوي يجب عليك أولًا تشغيل <mono>wg-entry.conf</mono>، ثم توجيه عنوان الخروج فقط <mono>{exitIp}/32</mono> عبر نفق الدخول ذاك، وإرسال الباقي عبر <mono>wg-exit.conf</mono> (MTU الداخلي {mtu}، ليتسع لترويستي WireGuard). نقطة نهاية الخروج: <mono>{endpoint}</mono>.<br/><strong>تنبيه الإصدار v1:</strong> تستخدم كلتا القفزتين المفتاح K نفسه، ما يُبطل أي مشغّل <em>واحد</em> بمفرده لكن يعني أن خصمًا يتحكم في <em>كلتا</em> قفزتيك يمكنه الربط بينهما عبر ذلك المفتاح المشترك. مفاتيح مستقلة لكل قفزة ستصل في الإصدار v1.5.',
};
