import type { Catalog } from '../index';

export const vi: Catalog = {
  app_title: 'CumulusVPN — Internet riêng tư, không cần tài khoản, không lưu log',

  header_nav_connect: 'Kết nối',
  header_nav_upgrade: 'Nâng cấp',
  header_theme_label: 'Giao diện: {mode}',
  header_theme_system: 'hệ thống',
  header_theme_light: 'sáng',
  header_theme_dark: 'tối',
  header_language_label: 'Ngôn ngữ',

  footer_tagline: 'CumulusVPN — VPN phi tập trung trên Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Kênh beta · không tài khoản · không log',

  common_copy: 'Sao chép',
  common_copied: 'Đã sao chép',
  common_qr_alt: 'Mã QR',
  common_powered_by_flux_link: 'Powered by Flux — mở runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'seed',
  common_directory: 'danh mục',

  error_gateway_rejected: 'Gateway từ chối đăng ký ({slug}): {message}',

  countries_search_placeholder: '🔎  Tìm trong {n} quốc gia…',
  countries_search_label: 'Tìm quốc gia',
  countries_list_label: 'Quốc gia',
  countries_no_match: 'Không có quốc gia nào khớp với “{query}”.',
  countries_nodes: { other: '{n} node' },

  connect_eyebrow: 'Kênh beta · cấu hình WireGuard',
  connect_title: 'Một khóa, <glow>mọi gateway.</glow>',
  connect_lede:
    'Cặp khóa WireGuard của bạn được tạo ngay tại đây, trong trình duyệt của bạn — khóa riêng tư không bao giờ rời khỏi tab này. Chọn một quốc gia, đăng ký ở gateway Flux gần nhất, rồi xuất một<mono> .conf</mono> sẵn sàng nhập cùng mã QR. Miễn phí mãi mãi ở tốc độ 100 KB/s; <upgrade>nâng cấp bằng FLUX</upgrade> để có tốc độ tối đa.',
  connect_verify_warn:
    'Không thể xác minh chữ ký của danh mục — các endpoint chỉ được hiển thị để tham khảo.',
  connect_notice_no_live_gateway:
    'Không có gateway hoạt động nào mà trình duyệt truy cập được. Đang hiển thị các quốc gia trong danh mục đã ký — cấu hình sẽ đăng ký với một gateway hoạt động khi có gateway khả dụng.',
  connect_choose_location: 'Chọn một vị trí',
  connect_tier_free: 'MIỄN PHÍ · 100 KB/s',
  connect_loading_directory: 'Đang phân giải danh mục đã ký & tìm gateway…',
  connect_your_config: 'Cấu hình của bạn',
  connect_source_directory: 'Danh mục {source}',
  connect_live_nodes: { other: '{n} node đang hoạt động' },
  connect_select_country: 'Chọn một quốc gia để tiếp tục',
  connect_enrolling: 'Đang đăng ký…',
  connect_generate: 'Tạo .conf',
  connect_no_gateway_in_country:
    'Không có gateway hoạt động nào ở {country} mà trình duyệt truy cập được. Việc đăng ký được gửi tới control API của gateway (http :51821), thứ mà các trang https không thể truy cập được — cách này hoạt động từ các ứng dụng desktop và di động dùng chung lõi này.',
  connect_error_enroll_failed: 'Đăng ký thất bại.',
  connect_qr_caption: 'Quét vào ứng dụng WireGuard',
  connect_stat_assigned_ip: 'IP được cấp',
  connect_stat_endpoint: 'Endpoint',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Tải .conf',
  connect_upgrade_cta: 'Nâng cấp lên tốc độ tối đa →',
  connect_identity_title: 'Danh tính của thiết bị này',
  connect_regenerate: 'Tạo lại khóa',
  connect_identity_note:
    'Mỗi thiết bị dùng một cặp khóa để đăng ký ở nhiều gateway; premium đi theo khóa đó trên tất cả các gateway thông qua chain. Mã thanh toán bên dưới chính là thứ gắn khoản thanh toán FLUX với khóa này.',
  connect_field_public_key: 'Khóa công khai WireGuard',
  connect_field_payment_code: 'Mã thanh toán (memo)',

  upgrade_loading: 'Đang tải thông tin thanh toán…',
  upgrade_eyebrow: 'Nâng cấp · thanh toán bằng FLUX',
  upgrade_title: 'Nâng cấp lên tốc độ tối đa',
  upgrade_lede:
    'Gửi FLUX kèm đúng nội dung tin nhắn bên dưới. Mỗi gateway sẽ quét chain và mở khóa của bạn trong vòng ~1 phút — trên tất cả máy chủ cùng lúc, trong 30 ngày. Không cần tài khoản, không cần thẻ, không có công ty nào có thể trao ra thứ mà nó chưa từng nắm giữ.',
  upgrade_usd_line: '≈ {usd} · mỗi 30 ngày',
  upgrade_qr_caption: 'Quét bằng Zelcore / SSP Wallet',
  upgrade_field_address: 'Địa chỉ thanh toán',
  upgrade_field_message: 'Tin nhắn (bắt buộc)',
  upgrade_open_wallet: 'Mở trong ví',
  upgrade_prepay_note:
    '<strong>Trả trước:</strong> trả một bội số của số tiền để cộng thêm từng ấy tháng cùng lúc — ví dụ {amount} FLUX = 3 tháng. Các tháng dư được cộng dồn (tối đa 24), nên bạn có thể nạp thêm bất cứ lúc nào.',
  upgrade_privacy_note:
    'Mở trong Zelcore / SSP Wallet. Khoản thanh toán được xác minh trên blockchain của Flux — chúng tôi không bao giờ biết bạn là ai. Tin nhắn gắn khoản thanh toán với khóa của bạn; gửi mà không kèm tin nhắn nghĩa là tiền vẫn đến nhưng không có gì được mở khóa.',
  upgrade_back: '← Quay lại Kết nối',

  multihop_summary_title: 'Nâng cao: multi-hop (hai cấu hình)',
  multihop_tier_pill: 'CAO CẤP · TÙY CHỌN',
  multihop_lede:
    'Định tuyến qua hai gateway để <strong>không một máy chủ đơn lẻ nào biết được cả bạn là ai lẫn bạn đang đi đâu</strong>. Cách này chậm hơn và tăng độ trễ — hãy dự kiến khoảng <strong>ping gấp 2×</strong> so với single-hop, và thông lượng đỉnh thấp hơn do mã hóa hai lớp. Multi-hop là tính năng premium, nhưng chỉ một khoản thanh toán <mono>$0.99</mono> là đủ cho cả hai hop (cùng một khóa K sẽ tự động trở thành premium ở cả entry lẫn exit). Mặc định tắt — luồng single-hop ở trên vẫn là luồng chính.',
  multihop_entry_label: 'Quốc gia entry (thấy IP của bạn)',
  multihop_entry_aria: 'Quốc gia entry',
  multihop_exit_label: 'Quốc gia exit (thấy đích đến của bạn)',
  multihop_exit_aria: 'Quốc gia exit',
  multihop_style_same: 'Kiểu định tuyến: cân bằng — cùng một quốc gia (một khu vực pháp lý)',
  multihop_style_cross:
    'Kiểu định tuyến: riêng tư tối đa — khác khu vực pháp lý (hai nhà vận hành, hai quốc gia)',
  multihop_enrolling: 'Đang đăng ký cả hai hop…',
  multihop_generate: 'Tạo hai cấu hình',
  multihop_error_no_exit: 'Multi-hop cần một gateway exit riêng biệt; không tìm được gateway nào.',
  multihop_error_no_gateways:
    'Không có gateway hoạt động nào mà trình duyệt truy cập được, nên không thể xác định tuyến đường nào. Việc lồng multi-hop thực chất là một tính năng riêng của ứng dụng chúng tôi — các ứng dụng desktop và di động (cùng lõi) dò gateway trực tiếp và chạy cả hai tunnel giúp bạn.',
  multihop_error_failed: 'Tạo multi-hop thất bại.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'lớp ngoài · MTU 1420',
  multihop_conf_inner_tag: 'lớp trong · MTU {mtu}',
  multihop_download_entry: 'Tải wg-entry.conf',
  multihop_download_exit: 'Tải wg-exit.conf',
  multihop_note:
    '<strong>Cách định tuyến (ghi chú thẳng thắn).</strong> Việc lồng tunnel thật sự với ứng dụng WireGuard gốc khá bất tiện — nó chỉ chạy được một tunnel tại một thời điểm — nên multi-hop thực chất là <strong>tính năng riêng của ứng dụng chúng tôi</strong> (desktop/di động sẽ nối chuỗi hai tunnel giúp bạn). Để thiết lập thủ công, bạn phải bật <mono>wg-entry.conf</mono> trước, sau đó chỉ định tuyến địa chỉ của exit <mono>{exitIp}/32</mono> qua tunnel entry đó và gửi phần còn lại qua <mono>wg-exit.conf</mono> (MTU lớp trong {mtu}, để vừa hai header WireGuard). Endpoint của exit: <mono>{endpoint}</mono>.<br/><strong>Lưu ý v1:</strong> cả hai hop dùng chung một khóa K, điều này vô hiệu hóa bất kỳ nhà vận hành <em>đơn lẻ</em> nào, nhưng cũng có nghĩa là kẻ tấn công kiểm soát <em>cả hai</em> hop của bạn có thể liên kết chúng qua khóa dùng chung đó. Khóa riêng cho từng hop sẽ có mặt ở v1.5.',
};
