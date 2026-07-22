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
