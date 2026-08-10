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
  connect_conf_note:
    '与该服务器绑定。若服务器重启或迁移，WireGuard 仍会显示隧道已连接，但没有任何流量通过——请回到此页重新生成 .conf。',
  connect_conf_regenerate: '重新生成 .conf',
  connect_conf_stale:
    '为 {country} 签发你上一份配置的服务器已被替换——该配置无法再连接。请在下方重新生成。',
  connect_conf_unsure:
    '无法连接到为 {country} 签发你上一份配置的服务器。它可能暂时下线，也可能已永久消失——如果隧道没有流量通过，请在下方重新生成配置。',
  connect_conf_checking: '正在检查你的上一份配置…',
  connect_upgrade_cta: '升级至全速 →',
  connect_identity_title: '此设备的身份',
  connect_regenerate: '重新生成密钥',
  connect_identity_note:
    '每台设备一个密钥对可在多个网关注册；高级权限通过区块链跟随该密钥在所有网关生效。下方的付款代码就是把 FLUX 付款与此密钥绑定的凭证。',
  connect_field_public_key: 'WireGuard 公钥',
  connect_field_payment_code: '付款代码（备注）',

  upgrade_loading: '正在加载付款信息…',
  upgrade_eyebrow: '升级 · 使用 FLUX 付款',
  upgrade_title: '升级至全速',
  upgrade_lede:
    '按照下方的确切信息发送 FLUX。每个网关都会扫描区块链，并在 ~1 分钟内解锁你的密钥——同时在所有服务器生效，为期 30 天。无需账号，无需银行卡，没有任何公司能交出它从未拥有过的东西。',
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

  upgrade_eyebrow_card: '或使用银行卡付款',
  upgrade_card_lede:
    '使用银行卡、Apple Pay 或 Google Pay 订阅。结账由 Stripe 处理——我们永远看不到你的卡。你的高级权限仍在 Flux 区块链上激活，只与你的匿名付款代码绑定。',
  upgrade_plan_aria: '订阅方案',
  upgrade_plan_monthly: '{usd} / 月',
  upgrade_plan_annual: '{usd} / 年',
  upgrade_card_cta: '使用银行卡付款',
  upgrade_card_cta_busy: '正在打开安全结账页面…',
  upgrade_card_error: '无法打开结账页面。请稍后再试。',
  upgrade_card_note:
    '自动续订；随时可通过 Stripe 收据邮件取消。上方用 FLUX 付款更便宜——银行卡价格包含了手续费。',
  upgrade_activating_title: '正在激活你的高级权限…',
  upgrade_state_pending: '已收到付款——正在为你准备 Flux 网络上的激活。',
  upgrade_state_broadcast: '激活已发送至 Flux 网络——等待确认中。',
  upgrade_state_confirmed: '已确认！全速将在一分钟内在所有服务器解锁。',
  upgrade_state_failed:
    '激活时出了点问题。你的付款是安全的——我们会自动重试，你的高级权限很快就会出现。',
  upgrade_activating_hint: '你可以关闭此页面——激活会自行完成。',
  upgrade_activated_cta: '返回连接 →',

  redeem_eyebrow: '有兑换码？',
  redeem_lede:
    '兑换代金券或优惠码。免费时长码会在 Flux 网络上为此设备激活；折扣码适用于上方的银行卡结账。',
  redeem_placeholder: 'CVPN-XXXXX-XXXXX',
  redeem_cta: '兑换',
  redeem_cta_busy: '正在检查…',
  redeem_discount_applied: '已应用 {percent}% 折扣——用上方银行卡付款，折扣会在结账时自动计入。',
  redeem_err_invalid: '该兑换码无效。请检查是否有输入错误后重试。',
  redeem_err_expired: '此兑换码已过期。',
  redeem_err_exhausted: '此兑换码已被用完。',
  redeem_err_already: '此设备已兑换过此码。',
  redeem_err_later: '兑换功能暂时不可用——请几分钟后重试。',

  split_summary_title: '高级：分流隧道',
  split_tier_pill: '高级版 · 可选',
  split_lede:
    '选择哪些目标走 VPN。生成的配置将规则表达为 WireGuard 的 AllowedIPs，因此可用于标准 WireGuard 应用 — 仅支持 IP 范围和本地网络绕行（按应用的规则需要我们的原生应用）。',
  split_mode_aria: '分流隧道模式',
  split_mode_off: '关闭',
  split_mode_exclude: '排除所列',
  split_mode_include: '仅这些',
  split_warn_exclude: '被排除的流量将不受保护地离开你的设备，并暴露你的真实 IP 地址。',
  split_warn_include: '仅列出的目标受保护 — 其他一切都会暴露你的真实 IP 地址。',
  split_lan_label: '允许访问本地网络（打印机、NAS、投屏）',
  split_cidr_placeholder: '例如 192.168.0.0/16 或 203.0.113.7',
  split_cidr_aria: 'IP 地址或 CIDR 范围',
  split_add: '添加',
  split_input_invalid: '不是有效的 IP 地址或 CIDR 范围。',
  split_rules_empty: '还没有 IP 规则 — 在上方添加一个范围，或只使用本地网络访问。',
  split_remove_aria: '移除规则 {value}',
  split_next_note: '规则将应用于你在此页面生成的下一个配置。',
  split_premium_required: '分流隧道是高级版功能。已改为生成全隧道配置 — 升级以应用你的规则。',
  split_applied: '已应用分流隧道 — 此配置仅路由你的规则所允许的流量。',

  multihop_summary_title: '进阶：多跳（两份配置）',
  multihop_tier_pill: '高级 · 可选启用',
  multihop_lede:
    '通过两个网关路由，让<strong>没有任何单一服务器能同时看到你是谁、以及你要去哪里</strong>。这样更慢，也会增加延迟——与单跳相比，预计约 <strong>2× ping</strong>，且双重加密还会降低峰值吞吐量。多跳是高级功能，但一笔 <mono>$0.99</mono> 付款即可覆盖两跳（同一把密钥 K 会在入口和出口自动获得高级权限）。默认关闭——上方的单跳流程仍是主流程。',
  multihop_entry_label: '入口国家（可看到你的 IP）',
  multihop_entry_aria: '入口国家',
  multihop_exit_label: '出口国家（可看到你的目的地）',
  multihop_exit_aria: '出口国家',
  multihop_style_same: '路由方式：均衡——同一国家（单一司法辖区）',
  multihop_style_cross: '路由方式：最大隐私——跨司法辖区（两个运营方，两个国家）',
  multihop_enrolling: '正在注册两跳…',
  multihop_generate: '生成两份配置',
  multihop_error_no_exit: '多跳需要一个独立的出口网关；未能解析出任何出口网关。',
  multihop_error_no_gateways:
    '浏览器无法访问到任何在线网关，因此无法解析出路由。多跳的嵌套其实是我们自家应用的功能——桌面端和移动端客户端（同一核心）会直接探测网关，并为你运行这两条隧道。',
  multihop_error_failed: '多跳生成失败。',
  multihop_internet: '互联网',
  multihop_conf_outer_tag: '外层 · MTU 1420',
  multihop_conf_inner_tag: '内层 · MTU {mtu}',
  multihop_download_entry: '下载 wg-entry.conf',
  multihop_download_exit: '下载 wg-exit.conf',
  multihop_note:
    '<strong>如何路由这两份配置（坦率说明）。</strong>用标准 WireGuard 应用实现真正的嵌套并不方便——它一次只能运行一条隧道——所以多跳实际上是<strong>我们自家应用的功能</strong>（桌面端/移动端会替你串联这两条隧道）。若要手动配置，你必须先启用 <mono>wg-entry.conf</mono>，然后只把出口地址 <mono>{exitIp}/32</mono> 通过该入口隧道路由，其余流量则通过 <mono>wg-exit.conf</mono> 发送（内层 MTU 为 {mtu}，以便容纳两层 WireGuard 报头）。出口端点：<mono>{endpoint}</mono>。<br/><strong>v1 局限：</strong>两跳使用同一把密钥 K，这能挫败任何<em>单一</em>运营方，但也意味着若对手同时控制了<em>两</em>跳，就能借助这把共享密钥进行关联。每跳使用独立密钥的功能将在 v1.5 中推出。',
};
