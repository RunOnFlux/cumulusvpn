import type { Catalog } from '../index';

export const tr: Catalog = {
  app_title: 'CumulusVPN — Özel internet, hesap yok, kayıt yok',

  header_nav_connect: 'Bağlan',
  header_nav_upgrade: 'Yükselt',
  header_theme_label: 'Tema: {mode}',
  header_theme_system: 'sistem',
  header_theme_light: 'açık',
  header_theme_dark: 'koyu',
  header_language_label: 'Dil',

  footer_tagline: 'CumulusVPN — Flux Cloud üzerinde merkeziyetsiz VPN · vpn.cumulusvpn.com',
  footer_credit: 'Beta hattı · hesap yok · kayıt yok',

  common_copy: 'Kopyala',
  common_copied: 'Kopyalandı',
  common_qr_alt: 'QR kodu',
  common_powered_by_flux_link: 'Powered by Flux — runonflux.com açar',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'seed',
  common_directory: 'dizin',

  error_gateway_rejected: 'Gateway kaydı reddetti ({slug}): {message}',

  countries_search_placeholder: '🔎  {n} ülke arasında ara…',
  countries_search_label: 'Ülke ara',
  countries_list_label: 'Ülkeler',
  countries_no_match: '“{query}” ile eşleşen ülke yok.',
  countries_nodes: { one: '{n} düğüm', other: '{n} düğüm' },

  connect_eyebrow: 'Beta hattı · WireGuard yapılandırması',
  connect_title: 'Tek anahtar, <glow>her gateway.</glow>',
  connect_lede:
    'WireGuard anahtar çiftin burada, tarayıcında oluşturulur — özel anahtar bu sekmeden asla çıkmaz. Bir ülke seç, en yakın Flux gateway’ine kaydol ve içe aktarmaya hazır bir<mono> .conf</mono> ile QR dışa aktar. 100 KB/s hızında sonsuza dek ücretsiz; tam hız için <upgrade>FLUX ile yükselt</upgrade>.',
  connect_verify_warn:
    'Dizin imzası doğrulanamadı — uç noktalar yalnızca bilgi amaçlı gösteriliyor.',
  connect_notice_no_live_gateway:
    'Tarayıcıdan erişilebilen canlı gateway yok. İmzalı dizindeki ülkeler gösteriliyor — bir canlı gateway’e erişilebildiğinde yapılandırmalar ona kaydolur.',
  connect_choose_location: 'Bir konum seç',
  connect_tier_free: 'ÜCRETSİZ · 100 KB/s',
  connect_loading_directory: 'İmzalı dizin çözümleniyor ve gateway’ler keşfediliyor…',
  connect_your_config: 'Yapılandırman',
  connect_source_directory: '{source} dizini',
  connect_live_nodes: { one: '{n} canlı düğüm', other: '{n} canlı düğüm' },
  connect_select_country: 'Devam etmek için bir ülke seç',
  connect_enrolling: 'Kaydolunuyor…',
  connect_generate: '.conf oluştur',
  connect_no_gateway_in_country:
    '{country} içinde tarayıcıdan erişilebilen canlı gateway yok. Kayıt, https sayfalarının erişemediği bir gateway’in kontrol API’sine (http :51821) gönderilir — bu, aynı çekirdeği paylaşan masaüstü ve mobil istemcilerden çalışır.',
  connect_error_enroll_failed: 'Kayıt başarısız oldu.',
  connect_qr_caption: 'WireGuard uygulamasıyla tara',
  connect_stat_assigned_ip: 'Atanan IP',
  connect_stat_endpoint: 'Uç nokta',
  connect_stat_dns: 'DNS',
  connect_download_conf: '.conf indir',
  connect_conf_note:
    'Bu sunucuya bağlı. Sunucu yeniden başlar veya değişirse WireGuard tüneli hâlâ bağlı gösterir ama hiçbir şey geçmez — buraya dönüp yeni bir .conf oluşturun.',
  connect_conf_regenerate: 'Yeni bir .conf oluştur',
  connect_conf_stale:
    '{country} için son yapılandırmanı veren sunucu değiştirildi — o yapılandırma artık bağlanamaz. Aşağıdan yenisini oluştur.',
  connect_conf_unsure:
    '{country} için son yapılandırmanı veren sunucuya ulaşılamadı. Geçici olarak kapalı ya da tamamen gitmiş olabilir — tünelin trafik geçirmiyorsa aşağıdan yeni bir yapılandırma oluştur.',
  connect_conf_checking: 'Son yapılandırman kontrol ediliyor…',
  connect_upgrade_cta: 'Tam hız için yükselt →',
  connect_identity_title: 'Bu cihazın kimliği',
  connect_regenerate: 'Anahtarı yeniden oluştur',
  connect_identity_note:
    'Cihaz başına bir anahtar çifti birçok gateway’e kaydolur; premium, chain üzerinden anahtarı hepsinde takip eder. Aşağıdaki ödeme kodu, bir FLUX ödemesini bu anahtara bağlar.',
  connect_field_public_key: 'WireGuard açık anahtarı',
  connect_field_payment_code: 'Ödeme kodu (not)',

  upgrade_loading: 'Ödeme bilgileri yükleniyor…',
  upgrade_eyebrow: 'Yükseltme · FLUX ile öde',
  upgrade_title: 'Tam hıza yükselt',
  upgrade_lede:
    'Aşağıdaki mesajın tam olarak aynısıyla FLUX gönder. Her gateway chain’i tarar ve anahtarını ~1 dakika içinde açar — tüm sunucularda aynı anda, 30 gün boyunca. Hesap yok, kart yok, hiçbir zaman sahip olmadığını teslim edebilecek bir şirket yok.',
  upgrade_usd_line: '≈ {usd} · 30 günde bir',
  upgrade_qr_caption: 'Zelcore / SSP Wallet ile tara',
  upgrade_field_address: 'Ödeme adresi',
  upgrade_field_message: 'Mesaj (zorunlu)',
  upgrade_open_wallet: 'Cüzdanda aç',
  upgrade_prepay_note:
    '<strong>Önceden öde:</strong> aynı anda o kadar ay eklemek için tutarın katını öde — örn. {amount} FLUX = 3 ay. Ekstra aylar üst üste birikir (24’e kadar), yani istediğin zaman yükleme yapabilirsin.',
  upgrade_privacy_note:
    'Zelcore / SSP Wallet içinde açılır. Ödeme, Flux blok zincirinde doğrulanır — kim olduğunu asla görmeyiz. Mesaj, ödemeyi anahtarına bağlar; mesaj olmadan göndermek, paranın ulaşıp hiçbir şeyin açılmaması anlamına gelir.',
  upgrade_back: '← Bağlan’a dön',

  upgrade_eyebrow_card: 'Ya da kartla öde',
  upgrade_card_lede:
    'Kart, Apple Pay veya Google Pay ile abone ol. Ödeme sayfası Stripe tarafından yürütülür — kartını asla görmeyiz. Premium’un yine Flux blok zincirinde etkinleştirilir ve yalnızca anonim ödeme koduna bağlıdır.',
  upgrade_plan_aria: 'Abonelik planı',
  upgrade_plan_monthly: '{usd} / ay',
  upgrade_plan_annual: '{usd} / yıl',
  upgrade_card_cta: 'Kartla öde',
  upgrade_card_cta_busy: 'Güvenli ödeme sayfası açılıyor…',
  upgrade_card_error: 'Ödeme sayfası açılamadı. Lütfen birazdan tekrar dene.',
  upgrade_card_note:
    'Otomatik yenilenir; aşağıdaki “Aboneliğin” bölümünden ya da Stripe makbuz e-postandan istediğin zaman iptal edebilir veya plan değiştirebilirsin. Yukarıdan FLUX ile ödemek daha ucuz — kart fiyatı işlem ücretlerini karşılıyor.',
  upgrade_activating_title: 'Premium’un etkinleştiriliyor…',
  upgrade_state_pending: 'Ödeme alındı — Flux ağındaki etkinleştirmen hazırlanıyor.',
  upgrade_state_broadcast: 'Etkinleştirme Flux ağına gönderildi — onay bekleniyor.',
  upgrade_state_confirmed: 'Onaylandı! Tam hız bir dakika içinde tüm sunucularda açılır.',
  upgrade_state_failed:
    'Etkinleştirme sırasında bir şeyler ters gitti. Ödemen güvende — otomatik olarak yeniden deniyoruz, premium’un kısa süre içinde görünecek.',
  upgrade_activating_hint: 'Bu sayfayı kapatabilirsin — etkinleştirme kendi kendine tamamlanır.',
  upgrade_activated_cta: 'Bağlan’a dön →',

  otherdev_eyebrow: 'Başka bir cihaz için mi ödüyorsun?',
  otherdev_lede:
    'Premium tek bir cihazın anahtarına bağlıdır. Telefonun için buradan ödeme yapmak istersen uygulamayı aç → Ayarlar → Hakkında ve cihaz kodunu kopyala.',
  otherdev_placeholder: 'Cihaz kodu',
  otherdev_apply: 'Bu kodu kullan',
  otherdev_active:
    'O cihazda görünen kodla eşleştiğini doğrula — yanlış yazılmış bir kod yine de geçerli olabilir ve yanlış cihaza ödeme yapar.',
  otherdev_clear: 'Bu tarayıcıya dön ({code}…)',
  otherdev_err:
    'Bu geçerli bir cihaz kodu değil. Yükseltmek istediğin cihazda Ayarlar → Hakkında bölümünden kopyala.',

  manage_eyebrow: 'Aboneliğin',
  manage_lede:
    'Kartını güncelle, aylık ve yıllık arasında geçiş yap ya da iptal et. Stripe’ın güvenli faturalandırma portalını açar.',
  manage_none:
    'Bu tarayıcıda kartla alınmış bir abonelik yok. Başka bir cihazda abone olduysan Stripe makbuz e-postandaki bağlantıyı kullan — uygulama içinden abone olduysan App Store / Google Play üzerinden yönet.',
  manage_cta: 'Aboneliği yönet',
  manage_cta_busy: 'Faturalandırma portalı açılıyor…',
  manage_err:
    'Faturalandırma portalı bu tarayıcıdan açılamadı. Aboneliğini her zaman Stripe makbuz e-postandaki bağlantıdan yönetebilir veya iptal edebilirsin.',

  redeem_eyebrow: 'Kodun mu var?',
  redeem_lede:
    'Bir hediye kodu ya da promosyon kodu kullan. Ücretsiz süre kodları bu cihaz için Flux ağında etkinleştirilir; indirim kodları yukarıdaki kartla ödemeye uygulanır.',
  redeem_placeholder: 'CVPN-XXXXX-XXXXX',
  redeem_cta: 'Kodu kullan',
  redeem_cta_busy: 'Kontrol ediliyor…',
  redeem_discount_applied:
    '%{percent} indirim uygulandı — yukarıda kartla öde, indirim ödeme sayfasında dahil edilmiş olur.',
  redeem_err_invalid:
    'Bu kod geçerli değil. Yazım hatası olup olmadığını kontrol edip tekrar dene.',
  redeem_err_expired: 'Bu kodun süresi dolmuş.',
  redeem_err_exhausted: 'Bu kod zaten tamamen kullanılmış.',
  redeem_err_already: 'Bu cihaz bu kodu zaten kullandı.',
  redeem_err_later:
    'Kod kullanımı kısa süreliğine kullanılamıyor — lütfen birkaç dakika sonra tekrar dene.',

  split_summary_title: 'Gelişmiş: split tunneling',
  split_tier_pill: 'PREMIUM · İSTEĞE BAĞLI',
  split_lede:
    'Hangi hedeflerin VPN’i kullanacağını seç. Üretilen yapılandırma kuralları WireGuard AllowedIPs olarak ifade eder, bu yüzden standart WireGuard uygulamasıyla çalışır — yalnızca IP aralıkları ve yerel ağ atlaması (uygulama başına kurallar native uygulamalarımızı gerektirir).',
  split_mode_aria: 'Split tunneling modu',
  split_mode_off: 'Kapalı',
  split_mode_exclude: 'Listeyi hariç tut',
  split_mode_include: 'Yalnızca bunlar',
  split_warn_exclude:
    'Hariç tutulan trafik cihazından korumasız çıkar ve gerçek IP adresini gösterir.',
  split_warn_include:
    'Yalnızca listelenen hedefler korunur — geri kalan her şey gerçek IP adresini gösterir.',
  split_lan_label: 'Yerel ağ erişimine izin ver (yazıcılar, NAS, yayın)',
  split_cidr_placeholder: 'örn. 192.168.0.0/16 veya 203.0.113.7',
  split_cidr_aria: 'IP adresi veya CIDR aralığı',
  split_add: 'Ekle',
  split_input_invalid: 'Geçerli bir IP adresi veya CIDR aralığı değil.',
  split_rules_empty:
    'Henüz IP kuralı yok — yukarıya bir aralık ekle ya da sadece yerel ağ erişimini kullan.',
  split_remove_aria: '{value} kuralını kaldır',
  split_next_note: 'Kurallar bu sayfada üreteceğin bir sonraki yapılandırmaya uygulanır.',
  split_premium_required:
    'Split tunneling bir premium özelliktir. Bunun yerine tam tünel yapılandırması üretildi — kurallarını uygulamak için premium’a geç.',
  split_applied:
    'Split tunneling uygulandı — bu yapılandırma yalnızca kurallarının izin verdiğini yönlendirir.',

  multihop_summary_title: 'Gelişmiş: multi-hop (iki yapılandırma)',
  multihop_tier_pill: 'PREMIUM · İSTEĞE BAĞLI',
  multihop_lede:
    'Tek bir sunucunun <strong>hem kim olduğunu hem nereye gittiğini görmemesi</strong> için iki gateway üzerinden yönlendir. Daha yavaştır ve gecikme ekler — tek hop’a kıyasla yaklaşık <strong>2× ping</strong> ve çift şifrelemeden dolayı daha düşük tepe verim bekle. Multi-hop premium bir özelliktir, ama tek bir <mono>$0.99</mono> ödemesi her iki hop’u da kapsar (aynı K anahtarı hem girişte hem çıkışta otomatik olarak premium olur). Varsayılan olarak kapalıdır — yukarıdaki tek hop akışı birincil olmaya devam eder.',
  multihop_entry_label: 'Giriş ülkesi (IP’ni görür)',
  multihop_entry_aria: 'Giriş ülkesi',
  multihop_exit_label: 'Çıkış ülkesi (hedefini görür)',
  multihop_exit_aria: 'Çıkış ülkesi',
  multihop_style_same: 'Rota stili: dengeli — aynı ülke (tek yargı alanı)',
  multihop_style_cross:
    'Rota stili: maksimum gizlilik — yargı alanları arası (iki operatör, iki ülke)',
  multihop_enrolling: 'Her iki hop kaydediliyor…',
  multihop_generate: 'İki yapılandırma oluştur',
  multihop_error_no_exit: 'Multi-hop ayrı bir çıkış gateway’i gerektirir; hiçbiri çözümlenemedi.',
  multihop_error_no_gateways:
    'Tarayıcıdan erişilebilen canlı gateway olmadığı için hiçbir rota çözümlenemedi. Multi-hop iç içe geçirme aslında uygulamalarımıza özgü bir özelliktir — masaüstü ve mobil istemciler (aynı çekirdek) gateway’leri doğrudan yoklar ve iki tüneli senin için çalıştırır.',
  multihop_error_failed: 'Multi-hop oluşturma başarısız oldu.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'dış · MTU 1420',
  multihop_conf_inner_tag: 'iç · MTU {mtu}',
  multihop_download_entry: 'wg-entry.conf indir',
  multihop_download_exit: 'wg-exit.conf indir',
  multihop_note:
    '<strong>Bunu nasıl yönlendireceğin (dürüst not).</strong> Standart WireGuard uygulamasıyla gerçek iç içe geçirme zahmetlidir — aynı anda yalnızca bir tünel çalıştırır — bu yüzden multi-hop aslında <strong>uygulamalarımıza özgü bir özelliktir</strong> (masaüstü/mobil iki tüneli senin için zincirler). Manuel kurulum için önce <mono>wg-entry.conf</mono>’u ayağa kaldırmalı, ardından yalnızca çıkışın adresini <mono>{exitIp}/32</mono> bu giriş tüneli üzerinden yönlendirmeli ve geri kalanını <mono>wg-exit.conf</mono> üzerinden göndermelisin (iki WireGuard başlığının sığması için iç MTU {mtu}). Çıkış uç noktası: <mono>{endpoint}</mono>.<br/><strong>v1 uyarısı:</strong> her iki hop da aynı K anahtarını kullanır; bu, herhangi bir <em>tek</em> operatörü etkisiz kılar ama <em>her iki</em> hop’unu da kontrol eden bir saldırganın onları bu paylaşılan anahtar üzerinden ilişkilendirebileceği anlamına gelir. Hop başına ayrı anahtarlar v1.5’te geliyor.',
};
