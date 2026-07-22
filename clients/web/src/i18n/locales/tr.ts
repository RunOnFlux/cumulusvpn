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
  upgrade_qr_caption: "Zelcore / SSP Wallet ile tara",
  upgrade_field_address: 'Ödeme adresi',
  upgrade_field_message: 'Mesaj (zorunlu)',
  upgrade_open_wallet: "Cüzdanda aç",
  upgrade_prepay_note:
    '<strong>Önceden öde:</strong> aynı anda o kadar ay eklemek için tutarın katını öde — örn. {amount} FLUX = 3 ay. Ekstra aylar üst üste birikir (24’e kadar), yani istediğin zaman yükleme yapabilirsin.',
  upgrade_privacy_note:
    'Zelcore / SSP Wallet içinde açılır. Ödeme, Flux blok zincirinde doğrulanır — kim olduğunu asla görmeyiz. Mesaj, ödemeyi anahtarına bağlar; mesaj olmadan göndermek, paranın ulaşıp hiçbir şeyin açılmaması anlamına gelir.',
  upgrade_back: '← Bağlan’a dön',

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
