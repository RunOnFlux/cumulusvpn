import type { Catalog } from '../index';

export const zh: Catalog = {
  app_title: 'CumulusVPN — 私密上网，无账号，无日志',

  header_nav_connect: '连接',
  header_nav_upgrade: '升级',
  header_theme_label: '主题：{mode}',
  header_theme_system: '系统',
  header_theme_light: '浅色',
  header_theme_dark: '深色',
  header_language_label: '语言',

  footer_tagline: 'CumulusVPN — Flux Cloud 上的去中心化 VPN · vpn.cumulusvpn.com',
  footer_credit: 'Beta 通道 · 无账号 · 无日志',

  common_copy: '复制',
  common_copied: '已复制',
  common_qr_alt: 'QR 码',
  common_powered_by_flux_link: 'Powered by Flux — 打开 runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: '种子',
  common_directory: '目录',

  error_gateway_rejected: '网关拒绝了注册（{slug}）：{message}',

  countries_search_placeholder: '🔎  搜索 {n} 个国家…',
  countries_search_label: '搜索国家',
  countries_list_label: '国家',
  countries_no_match: '没有国家匹配“{query}”。',
  countries_nodes: { other: '{n} 个节点' },

  connect_eyebrow: 'Beta 通道 · WireGuard 配置',
  connect_title: '一把密钥，<glow>覆盖每个网关。</glow>',
  connect_lede:
    '你的 WireGuard 密钥对在此生成，就在你的浏览器里——私钥永远不会离开此标签页。选择一个国家，在最近的 Flux 网关注册，然后导出可直接导入的<mono> .conf</mono> 和 QR 码。永久免费，速度 100 KB/s；<upgrade>使用 FLUX 升级</upgrade>即可获得全速。',
  connect_verify_warn: '无法验证目录签名——所显示的端点仅供参考。',
  connect_notice_no_live_gateway:
    '浏览器无法访问到任何在线网关。目前显示的是已签名目录中的国家——一旦有可用网关，配置将向其注册。',
  connect_choose_location: '选择一个位置',
  connect_tier_free: '免费 · 100 KB/s',
  connect_loading_directory: '正在解析已签名目录并发现网关…',
  connect_your_config: '你的配置',
  connect_source_directory: '{source} 目录',
  connect_live_nodes: { other: '{n} 个在线节点' },
  connect_select_country: '选择一个国家以继续',
  connect_enrolling: '正在注册…',
  connect_generate: '生成 .conf',
  connect_no_gateway_in_country:
    '浏览器无法访问到 {country} 的任何在线网关。注册请求会发送到网关的控制 API（http :51821），而 https 页面无法访问该端口——这在共用同一核心的桌面端和移动端客户端上可以正常工作。',
  connect_error_enroll_failed: '注册失败。',
  connect_qr_caption: '在 WireGuard 应用中扫描',
  connect_stat_assigned_ip: '分配的 IP',
  connect_stat_endpoint: '端点',
  connect_stat_dns: 'DNS',
  connect_download_conf: '下载 .conf',
  connect_upgrade_cta: '升级至全速 →',
  connect_identity_title: '此设备的身份',
  connect_regenerate: '重新生成密钥',
  connect_identity_note:
    '每台设备一个密钥对可在多个网关注册；高级权限通过 chain 跟随该密钥在所有网关生效。下方的付款代码就是把 FLUX 付款与此密钥绑定的凭证。',
  connect_field_public_key: 'WireGuard 公钥',
  connect_field_payment_code: '付款代码（备注）',

  upgrade_loading: '正在加载付款信息…',
  upgrade_eyebrow: '升级 · 使用 FLUX 付款',
  upgrade_title: '升级至全速',
  upgrade_lede:
    '按照下方的确切信息发送 FLUX。每个网关都会扫描 chain，并在 ~1 分钟内解锁你的密钥——同时在所有服务器生效，为期 30 天。无需账号，无需银行卡，没有任何公司能交出它从未拥有过的东西。',
  upgrade_usd_line: '≈ {usd} · 每 30 天',
  upgrade_qr_caption: '使用 Zelcore / SSP Wallet 扫描',
  upgrade_field_address: '付款地址',
  upgrade_field_message: '留言（必填）',
  upgrade_open_wallet: '在钱包中打开',
  upgrade_prepay_note:
    '<strong>提前预付：</strong>支付该金额的倍数即可一次性增加相应月数——例如 {amount} FLUX = 3 个月。多余的月数可以累积（最多 24 个月），因此你可以随时充值。',
  upgrade_privacy_note:
    '在 Zelcore / SSP Wallet 中打开。付款会在 Flux 区块链上验证——我们永远不知道你是谁。留言把付款与你的密钥绑定；不带留言发送意味着资金会到账，但不会解锁任何东西。',
  upgrade_back: '← 返回连接',

  multihop_summary_title: '进阶：multi-hop（两份配置）',
  multihop_tier_pill: '高级 · 可选启用',
  multihop_lede:
    '通过两个网关路由，让<strong>没有任何单一服务器能同时看到你是谁、以及你要去哪里</strong>。这样更慢，也会增加延迟——与单跳相比，预计约 <strong>2× ping</strong>，且双重加密还会降低峰值吞吐量。multi-hop 是高级功能，但一笔 <mono>$0.99</mono> 付款即可覆盖两跳（同一把密钥 K 会在入口和出口自动获得高级权限）。默认关闭——上方的单跳流程仍是主流程。',
  multihop_entry_label: '入口国家（可看到你的 IP）',
  multihop_entry_aria: '入口国家',
  multihop_exit_label: '出口国家（可看到你的目的地）',
  multihop_exit_aria: '出口国家',
  multihop_style_same: '路由方式：均衡——同一国家（单一司法辖区）',
  multihop_style_cross: '路由方式：最大隐私——跨司法辖区（两个运营方，两个国家）',
  multihop_enrolling: '正在注册两跳…',
  multihop_generate: '生成两份配置',
  multihop_error_no_exit: 'multi-hop 需要一个独立的出口网关；未能解析出任何出口网关。',
  multihop_error_no_gateways:
    '浏览器无法访问到任何在线网关，因此无法解析出路由。multi-hop 的嵌套其实是我们自家应用的功能——桌面端和移动端客户端（同一核心）会直接探测网关，并为你运行这两条隧道。',
  multihop_error_failed: 'multi-hop 生成失败。',
  multihop_internet: '互联网',
  multihop_conf_outer_tag: '外层 · MTU 1420',
  multihop_conf_inner_tag: '内层 · MTU {mtu}',
  multihop_download_entry: '下载 wg-entry.conf',
  multihop_download_exit: '下载 wg-exit.conf',
  multihop_note:
    '<strong>如何路由这两份配置（坦率说明）。</strong>用标准 WireGuard 应用实现真正的嵌套并不方便——它一次只能运行一条隧道——所以 multi-hop 实际上是<strong>我们自家应用的功能</strong>（桌面端/移动端会替你串联这两条隧道）。若要手动配置，你必须先启用 <mono>wg-entry.conf</mono>，然后只把出口地址 <mono>{exitIp}/32</mono> 通过该入口隧道路由，其余流量则通过 <mono>wg-exit.conf</mono> 发送（内层 MTU 为 {mtu}，以便容纳两层 WireGuard 报头）。出口端点：<mono>{endpoint}</mono>。<br/><strong>v1 局限：</strong>两跳使用同一把密钥 K，这能挫败任何<em>单一</em>运营方，但也意味着若对手同时控制了<em>两</em>跳，就能借助这把共享密钥进行关联。每跳使用独立密钥的功能将在 v1.5 中推出。',
};
