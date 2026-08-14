import type { Catalog } from '../index';

export const id: Catalog = {
  app_title: 'CumulusVPN — Internet pribadi, tanpa akun, tanpa log',

  header_nav_connect: 'Hubungkan',
  header_nav_upgrade: 'Upgrade',
  header_theme_label: 'Tema: {mode}',
  header_theme_system: 'sistem',
  header_theme_light: 'terang',
  header_theme_dark: 'gelap',
  header_language_label: 'Bahasa',

  footer_tagline: 'CumulusVPN — VPN terdesentralisasi di Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Jalur beta · tanpa akun · tanpa log',

  common_copy: 'Salin',
  common_copied: 'Tersalin',
  common_qr_alt: 'Kode QR',
  common_powered_by_flux_link: 'Powered by Flux — membuka runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'seed',
  common_directory: 'direktori',

  error_gateway_rejected: 'Gateway menolak pendaftaran ({slug}): {message}',

  countries_search_placeholder: '🔎  Cari {n} negara…',
  countries_search_label: 'Cari negara',
  countries_list_label: 'Negara',
  countries_no_match: 'Tidak ada negara yang cocok dengan “{query}”.',
  countries_nodes: { other: '{n} node' },

  connect_eyebrow: 'Jalur beta · config WireGuard',
  connect_title: 'Satu kunci, <glow>semua gateway.</glow>',
  connect_lede:
    'Pasangan kunci WireGuard Anda dibuat di sini, di browser Anda — kunci privat tidak pernah keluar dari tab ini. Pilih negara, daftar di gateway Flux terdekat, lalu ekspor<mono> .conf</mono> siap-impor beserta QR-nya. Gratis selamanya di 100 KB/s; <upgrade>upgrade dengan FLUX</upgrade> untuk kecepatan penuh.',
  connect_verify_warn:
    'Tanda tangan direktori tidak dapat diverifikasi — endpoint hanya ditampilkan sebagai informasi.',
  connect_notice_no_live_gateway:
    'Tidak ada gateway aktif yang terjangkau dari browser. Menampilkan negara dari direktori bertanda tangan — config akan mendaftar ke gateway aktif begitu tersedia.',
  connect_choose_location: 'Pilih lokasi',
  connect_tier_free: 'GRATIS · 100 KB/s',
  connect_loading_directory: 'Me-resolve direktori bertanda tangan & menemukan gateway…',
  connect_your_config: 'Config Anda',
  connect_source_directory: 'Direktori {source}',
  connect_live_nodes: { other: '{n} node aktif' },
  connect_select_country: 'Pilih negara untuk melanjutkan',
  connect_enrolling: 'Mendaftar…',
  connect_generate: 'Buat .conf',
  connect_no_gateway_in_country:
    'Tidak ada gateway aktif yang terjangkau di {country} dari browser. Pendaftaran dikirim ke API kontrol gateway (http :51821), yang tidak bisa dijangkau halaman https — ini berjalan dari klien desktop dan mobile yang berbagi core yang sama.',
  connect_error_enroll_failed: 'Pendaftaran gagal.',
  connect_qr_caption: 'Pindai ke aplikasi WireGuard',
  connect_stat_assigned_ip: 'IP yang ditetapkan',
  connect_stat_endpoint: 'Endpoint',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Unduh .conf',
  connect_conf_note:
    'Terikat pada server ini. Jika server dimulai ulang atau berpindah, WireGuard tetap menampilkan terowongan sebagai tersambung padahal tidak ada yang lewat — kembali ke sini dan buat .conf baru.',
  connect_conf_regenerate: 'Buat .conf baru',
  connect_conf_stale:
    'Server yang menerbitkan konfigurasi terakhir kamu untuk {country} telah diganti — konfigurasi itu tidak dapat tersambung lagi. Buat yang baru di bawah.',
  connect_conf_unsure:
    'Tidak dapat menghubungi server yang menerbitkan konfigurasi terakhir kamu untuk {country}. Mungkin sedang mati sementara, atau hilang selamanya — jika terowonganmu tidak meneruskan lalu lintas, buat konfigurasi baru di bawah.',
  connect_conf_checking: 'Memeriksa konfigurasi terakhir kamu…',
  connect_upgrade_cta: 'Upgrade ke kecepatan penuh →',
  connect_identity_title: 'Identitas perangkat ini',
  connect_regenerate: 'Buat ulang kunci',
  connect_identity_note:
    'Satu pasangan kunci per perangkat mendaftar di banyak gateway; premium mengikuti kunci itu di semuanya lewat chain. Kode pembayaran di bawah inilah yang mengaitkan pembayaran FLUX dengan kunci ini.',
  connect_field_public_key: 'Kunci publik WireGuard',
  connect_field_payment_code: 'Kode pembayaran (memo)',

  upgrade_loading: 'Memuat detail pembayaran…',
  upgrade_eyebrow: 'Upgrade · bayar dengan FLUX',
  upgrade_title: 'Upgrade ke kecepatan penuh',
  upgrade_lede:
    'Kirim FLUX dengan pesan persis seperti di bawah. Setiap gateway memindai chain dan membuka kunci Anda dalam ~1 menit — di semua server sekaligus, selama 30 hari. Tanpa akun, tanpa kartu, tanpa perusahaan yang bisa menyerahkan apa yang tidak pernah ia miliki.',
  upgrade_usd_line: '≈ {usd} · per 30 hari',
  upgrade_qr_caption: 'Pindai dengan Zelcore / SSP Wallet',
  upgrade_field_address: 'Alamat pembayaran',
  upgrade_field_message: 'Pesan (wajib)',
  upgrade_open_wallet: 'Buka di wallet',
  upgrade_prepay_note:
    '<strong>Bayar di muka:</strong> bayar kelipatan jumlahnya untuk menambah bulan sebanyak itu sekaligus — misalnya {amount} FLUX = 3 bulan. Bulan tambahan bisa menumpuk (hingga 24), jadi Anda bisa top up kapan saja.',
  upgrade_privacy_note:
    'Terbuka di Zelcore / SSP Wallet. Pembayaran diverifikasi di blockchain Flux — kami tidak pernah tahu siapa Anda. Pesan mengaitkan pembayaran dengan kunci Anda; mengirim tanpa pesan berarti dana sampai tapi tidak ada yang terbuka.',
  upgrade_back: '← Kembali ke Hubungkan',

  upgrade_eyebrow_card: 'Atau bayar dengan kartu',
  upgrade_card_lede:
    'Berlangganan dengan kartu, Apple Pay, atau Google Pay. Checkout ditangani oleh Stripe — kami tidak pernah melihat kartu Anda. Premium Anda tetap diaktifkan di blockchain Flux, hanya terkait dengan kode pembayaran anonim Anda.',
  upgrade_plan_aria: 'Paket langganan',
  upgrade_plan_monthly: '{usd} / bulan',
  upgrade_plan_annual: '{usd} / tahun',
  upgrade_card_cta: 'Bayar dengan kartu',
  upgrade_card_cta_busy: 'Membuka checkout aman…',
  upgrade_card_error: 'Tidak dapat membuka checkout. Silakan coba lagi sebentar lagi.',
  upgrade_card_note:
    'Diperpanjang otomatis; batalkan atau ganti paket kapan saja di “Langgananmu” di bawah, atau lewat email tanda terima Stripe. Membayar dengan FLUX di atas lebih murah — harga kartu menutup biaya pemrosesan.',
  upgrade_activating_title: 'Mengaktifkan premium Anda…',
  upgrade_state_pending: 'Pembayaran diterima — menyiapkan aktivasi Anda di jaringan Flux.',
  upgrade_state_broadcast: 'Aktivasi dikirim ke jaringan Flux — menunggu konfirmasi.',
  upgrade_state_confirmed:
    'Terkonfirmasi! Kecepatan penuh terbuka di semua server dalam waktu satu menit.',
  upgrade_state_failed:
    'Terjadi kesalahan saat mengaktifkan. Pembayaran Anda aman — kami mencoba lagi secara otomatis, dan premium Anda akan segera muncul.',
  upgrade_activating_hint: 'Anda bisa menutup halaman ini — aktivasi selesai dengan sendirinya.',
  upgrade_activated_cta: 'Kembali ke Hubungkan →',

  manage_eyebrow: 'Langgananmu',
  manage_lede:
    'Perbarui kartumu, ganti antara bulanan dan tahunan, atau batalkan. Membuka portal penagihan aman dari Stripe.',
  manage_none:
    'Tidak ada langganan kartu yang dibeli di peramban ini. Jika kamu berlangganan di perangkat lain, gunakan tautan di email tanda terima Stripe — atau App Store / Google Play jika kamu berlangganan di aplikasi.',
  manage_cta: 'Kelola langganan',
  manage_cta_busy: 'Membuka portal penagihan…',
  manage_err:
    'Portal penagihan tidak dapat dibuka dari peramban ini. Kamu selalu bisa mengelola atau membatalkan lewat tautan di email tanda terima Stripe.',

  redeem_eyebrow: 'Punya kode?',
  redeem_lede:
    'Tukarkan voucher atau kode promo. Kode waktu gratis diaktifkan di jaringan Flux untuk perangkat ini; kode diskon berlaku untuk checkout kartu di atas.',
  redeem_placeholder: 'CVPN-XXXXX-XXXXX',
  redeem_cta: 'Tukarkan',
  redeem_cta_busy: 'Memeriksa…',
  redeem_discount_applied:
    'Diskon {percent}% diterapkan — bayar dengan kartu di atas dan diskon sudah termasuk saat checkout.',
  redeem_err_invalid: 'Kode itu tidak valid. Periksa salah ketik dan coba lagi.',
  redeem_err_expired: 'Kode ini sudah kedaluwarsa.',
  redeem_err_exhausted: 'Kode ini sudah terpakai sepenuhnya.',
  redeem_err_already: 'Perangkat ini sudah menukarkan kode ini.',
  redeem_err_later: 'Penukaran sementara tidak tersedia — silakan coba lagi dalam beberapa menit.',

  split_summary_title: 'Lanjutan: split tunneling',
  split_tier_pill: 'PREMIUM · OPSIONAL',
  split_lede:
    'Pilih tujuan mana yang menggunakan VPN. Konfigurasi yang dihasilkan menyatakan aturan sebagai AllowedIPs WireGuard, sehingga berfungsi dengan aplikasi WireGuard standar — hanya rentang IP dan pengecualian jaringan lokal (aturan per aplikasi memerlukan aplikasi native kami).',
  split_mode_aria: 'Mode split tunneling',
  split_mode_off: 'Mati',
  split_mode_exclude: 'Kecualikan daftar',
  split_mode_include: 'Hanya ini',
  split_warn_exclude:
    'Lalu lintas yang dikecualikan keluar dari perangkat Anda tanpa perlindungan dan menampilkan alamat IP asli Anda.',
  split_warn_include:
    'Hanya tujuan yang terdaftar yang terlindungi — sisanya menampilkan alamat IP asli Anda.',
  split_lan_label: 'Izinkan akses jaringan lokal (printer, NAS, casting)',
  split_cidr_placeholder: 'mis. 192.168.0.0/16 atau 203.0.113.7',
  split_cidr_aria: 'Alamat IP atau rentang CIDR',
  split_add: 'Tambah',
  split_input_invalid: 'Bukan alamat IP atau rentang CIDR yang valid.',
  split_rules_empty:
    'Belum ada aturan IP — tambahkan rentang di atas, atau cukup gunakan akses jaringan lokal.',
  split_remove_aria: 'Hapus aturan {value}',
  split_next_note: 'Aturan berlaku untuk konfigurasi berikutnya yang Anda hasilkan di halaman ini.',
  split_premium_required:
    'Split tunneling adalah fitur premium. Sebagai gantinya, konfigurasi full-tunnel dihasilkan — tingkatkan untuk menerapkan aturan Anda.',
  split_applied:
    'Split tunneling diterapkan — konfigurasi ini hanya merutekan yang diizinkan aturan Anda.',

  multihop_summary_title: 'Lanjutan: multi-hop (dua config)',
  multihop_tier_pill: 'PREMIUM · OPT-IN',
  multihop_lede:
    'Rutekan lewat dua gateway agar <strong>tidak ada satu server pun yang tahu siapa Anda sekaligus ke mana Anda pergi</strong>. Ini lebih lambat dan menambah latensi — perkirakan sekitar <strong>2× ping</strong> dibanding single-hop, dan throughput puncak lebih rendah akibat enkripsi ganda. Multi-hop bersifat premium, tapi satu pembayaran <mono>$0.99</mono> mencakup kedua hop (kunci K yang sama otomatis menjadi premium di entry maupun exit). Nonaktif secara default — alur single-hop di atas tetap yang utama.',
  multihop_entry_label: 'Negara entry (melihat IP Anda)',
  multihop_entry_aria: 'Negara entry',
  multihop_exit_label: 'Negara exit (melihat tujuan Anda)',
  multihop_exit_aria: 'Negara exit',
  multihop_style_same: 'Gaya rute: seimbang — negara yang sama (satu yurisdiksi)',
  multihop_style_cross:
    'Gaya rute: privasi maksimal — lintas yurisdiksi (dua operator, dua negara)',
  multihop_enrolling: 'Mendaftarkan kedua hop…',
  multihop_generate: 'Buat dua config',
  multihop_error_no_exit:
    'Multi-hop butuh gateway exit yang berbeda; tidak ada yang berhasil ditemukan.',
  multihop_error_no_gateways:
    'Tidak ada gateway aktif yang terjangkau dari browser, jadi tidak ada rute yang bisa ditentukan. Nesting multi-hop sebenarnya fitur aplikasi kami sendiri — klien desktop dan mobile (core yang sama) memeriksa gateway secara langsung dan menjalankan kedua tunnel untuk Anda.',
  multihop_error_failed: 'Pembuatan multi-hop gagal.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'luar · MTU 1420',
  multihop_conf_inner_tag: 'dalam · MTU {mtu}',
  multihop_download_entry: 'Unduh wg-entry.conf',
  multihop_download_exit: 'Unduh wg-exit.conf',
  multihop_note:
    '<strong>Cara merutekan ini (catatan jujur).</strong> Nesting sungguhan dengan aplikasi WireGuard standar itu merepotkan — ia hanya menjalankan satu tunnel dalam satu waktu — jadi multi-hop sebenarnya adalah <strong>fitur aplikasi kami</strong> (desktop/mobile merangkai kedua tunnel untuk Anda). Untuk setup manual, Anda harus menyalakan <mono>wg-entry.conf</mono> lebih dulu, lalu merutekan hanya alamat exit <mono>{exitIp}/32</mono> lewat tunnel entry itu dan mengirim sisanya lewat <mono>wg-exit.conf</mono> (MTU dalam {mtu}, agar dua header WireGuard muat). Endpoint exit: <mono>{endpoint}</mono>.<br/><strong>Catatan v1:</strong> kedua hop memakai kunci K yang sama, yang mengalahkan operator <em>tunggal</em> mana pun, tapi berarti musuh yang menguasai <em>kedua</em> hop Anda bisa mengorelasikannya lewat kunci bersama itu. Kunci berbeda per hop akan hadir di v1.5.',
};
