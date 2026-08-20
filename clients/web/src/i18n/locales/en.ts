import type { Message } from '../messages';

/**
 * Source-of-truth catalog. Its keys define `Catalog` (src/i18n/index.ts), so
 * every other locale file fails to compile if it drifts from this shape.
 * Rich tags (<glow>, <mono>, <upgrade>, <strong>, <em>, <br/>) and {params}
 * must be preserved exactly in every translation.
 */
export const en = {
  app_title: 'CumulusVPN — Private internet, no account, no logs',

  header_nav_connect: 'Connect',
  header_nav_upgrade: 'Upgrade',
  header_theme_label: 'Theme: {mode}',
  header_theme_system: 'system',
  header_theme_light: 'light',
  header_theme_dark: 'dark',
  header_language_label: 'Language',

  footer_tagline: 'CumulusVPN — Decentralized VPN on Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Beta rail · no account · no logs',

  common_copy: 'Copy',
  common_copied: 'Copied',
  common_qr_alt: 'QR code',
  common_powered_by_flux_link: 'Powered by Flux — opens runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'seed',
  common_directory: 'directory',

  error_gateway_rejected: 'Gateway rejected enrollment ({slug}): {message}',

  countries_search_placeholder: '🔎  Search {n} countries…',
  countries_search_label: 'Search countries',
  countries_list_label: 'Countries',
  countries_no_match: 'No countries match “{query}”.',
  countries_nodes: { one: '{n} node', other: '{n} nodes' },

  connect_eyebrow: 'Beta rail · WireGuard config',
  connect_title: 'One key, <glow>every gateway.</glow>',
  connect_lede:
    'Your WireGuard keypair is generated here, in your browser — the private key never leaves this tab. Pick a country, enroll at the nearest Flux gateway, and export a ready-to-import<mono> .conf</mono> and QR. Free forever at 100 KB/s; <upgrade>upgrade with FLUX</upgrade> for full speed.',
  connect_verify_warn:
    'Directory signature could not be verified — endpoints are shown for information only.',
  connect_notice_no_live_gateway:
    'No live gateway reachable from the browser. Showing the signed directory’s countries — configs enroll against a live gateway when one is reachable.',
  connect_choose_location: 'Choose a location',
  connect_tier_free: 'FREE · 100 KB/s',
  connect_loading_directory: 'Resolving the signed directory & discovering gateways…',
  connect_your_config: 'Your config',
  connect_source_directory: '{source} directory',
  connect_live_nodes: { one: '{n} live node', other: '{n} live nodes' },
  connect_select_country: 'Select a country to continue',
  connect_enrolling: 'Enrolling…',
  connect_generate: 'Generate .conf',
  connect_no_gateway_in_country:
    'No live gateway reachable in {country} from the browser. Enrollment posts to a gateway’s control API (http :51821), which https pages can’t reach — this works from the desktop and mobile clients that share this core.',
  connect_error_enroll_failed: 'Enrollment failed.',
  connect_qr_caption: 'Scan into the WireGuard app',
  connect_stat_assigned_ip: 'Assigned IP',
  connect_stat_endpoint: 'Endpoint',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Download .conf',
  connect_conf_note:
    'Tied to this server. If it restarts or moves, WireGuard will still show the tunnel as connected while nothing gets through — come back here and generate a new .conf.',
  connect_conf_regenerate: 'Generate a new .conf',
  connect_conf_stale:
    'The server that issued your last config for {country} has been replaced — that config can no longer connect. Generate a new one below.',
  connect_conf_unsure:
    'Couldn’t reach the server that issued your last config for {country}. It may be temporarily down, or gone for good — if your tunnel isn’t passing traffic, generate a new config below.',
  connect_conf_checking: 'Checking your last config…',
  connect_upgrade_cta: 'Upgrade to full speed →',
  connect_identity_title: 'This device’s identity',
  connect_regenerate: 'Regenerate key',
  connect_identity_note:
    'One keypair per device enrolls at many gateways; premium follows the key on all of them via the chain. The payment code below is what ties a FLUX payment to this key.',
  connect_field_public_key: 'WireGuard public key',
  connect_field_payment_code: 'Payment code (memo)',

  upgrade_loading: 'Loading payment details…',
  upgrade_eyebrow: 'Upgrade · pay in FLUX',
  upgrade_title: 'Upgrade to full speed',
  upgrade_lede:
    'Send FLUX with the exact message below. Every gateway scans the chain and unlocks your key within ~1 minute — on all servers at once, for 30 days. No account, no card, no company that can hand over what it never had.',
  upgrade_usd_line: '≈ {usd} · per 30 days',
  upgrade_qr_caption: 'Scan with Zelcore / SSP Wallet',
  upgrade_field_address: 'Pay to address',
  upgrade_field_message: 'Message (required)',
  upgrade_open_wallet: 'Open in wallet',
  upgrade_prepay_note:
    '<strong>Prepay ahead:</strong> pay a multiple of the amount to add that many months at once — e.g. {amount} FLUX = 3 months. Extra months stack (up to 24), so you can top up any time.',
  upgrade_privacy_note:
    'Opens in Zelcore / SSP Wallet. Payment is verified on the Flux blockchain — we never see who you are. The message ties the payment to your key; sending without it means funds arrive but nothing unlocks.',
  upgrade_back: '← Back to Connect',

  upgrade_eyebrow_card: 'Or pay with card',
  upgrade_card_lede:
    'Subscribe with a card, Apple Pay or Google Pay. Checkout is handled by Stripe — we never see your card. Your premium is still activated on the Flux blockchain, tied only to your anonymous payment code.',
  upgrade_plan_aria: 'Subscription plan',
  upgrade_plan_monthly: '{usd} / month',
  upgrade_plan_annual: '{usd} / year',
  upgrade_card_cta: 'Pay with card',
  upgrade_card_cta_busy: 'Opening secure checkout…',
  upgrade_card_error: 'Could not open checkout. Please try again in a moment.',
  upgrade_card_note:
    'Renews automatically; cancel or switch plan anytime under “Your subscription” below, or from the Stripe receipt email. Paying in FLUX above is cheaper — card pricing covers processing fees.',
  upgrade_activating_title: 'Activating your premium…',
  upgrade_state_pending: 'Payment received — preparing your activation on the Flux network.',
  upgrade_state_broadcast: 'Activation sent to the Flux network — waiting for confirmation.',
  upgrade_state_confirmed: 'Confirmed! Full speed unlocks on all servers within a minute.',
  upgrade_state_failed:
    'Something went wrong while activating. Your payment is safe — we retry automatically, and your premium will appear shortly.',
  upgrade_activating_hint: 'You can close this page — activation completes on its own.',
  upgrade_activated_cta: 'Back to Connect →',

  manage_eyebrow: 'Your subscription',
  manage_lede:
    'Update your card, switch between monthly and yearly, or cancel. Opens Stripe’s secure billing portal.',
  manage_none:
    'No card subscription was bought in this browser. If you subscribed on another device, use the link in your Stripe receipt email — or the App Store / Google Play if you subscribed in the app.',
  manage_cta: 'Manage subscription',
  manage_cta_busy: 'Opening billing portal…',
  manage_err:
    'Could not open the billing portal from this browser. You can always manage or cancel from the link in your Stripe receipt email.',

  redeem_eyebrow: 'Have a code?',
  redeem_lede:
    'Redeem a voucher or promo code. Free-time codes activate on the Flux network for this device; discount codes apply to the card checkout above.',
  redeem_placeholder: 'CVPN-XXXXX-XXXXX',
  redeem_cta: 'Redeem',
  redeem_cta_busy: 'Checking…',
  redeem_discount_applied:
    '{percent}% off applied — pay by card above and the discount is included at checkout.',
  redeem_err_invalid: 'That code isn’t valid. Check for typos and try again.',
  redeem_err_expired: 'This code has expired.',
  redeem_err_exhausted: 'This code has already been fully used.',
  redeem_err_already: 'This device has already redeemed this code.',
  redeem_err_later: 'Redemption is briefly unavailable — please try again in a few minutes.',

  split_summary_title: 'Advanced: split tunneling',
  split_tier_pill: 'PREMIUM · OPT-IN',
  split_lede:
    'Choose which destinations use the VPN. The generated config expresses rules as WireGuard AllowedIPs, so they work with the stock WireGuard app — IP ranges and local-network bypass only (per-app rules need our native apps).',
  split_mode_aria: 'Split tunneling mode',
  split_mode_off: 'Off',
  split_mode_exclude: 'Exclude listed',
  split_mode_include: 'Only these',
  split_warn_exclude:
    'Excluded traffic leaves your device unprotected and shows your real IP address.',
  split_warn_include:
    'Only the listed destinations are protected — everything else shows your real IP address.',
  split_lan_label: 'Allow local network access (printers, NAS, casting)',
  split_cidr_placeholder: 'e.g. 192.168.0.0/16 or 203.0.113.7',
  split_cidr_aria: 'IP address or CIDR range',
  split_add: 'Add',
  split_input_invalid: 'Not a valid IP address or CIDR range.',
  split_rules_empty: 'No IP rules yet — add a range above, or just use local network access.',
  split_remove_aria: 'Remove rule {value}',
  split_next_note: 'Rules apply to the next config you generate on this page.',
  split_premium_required:
    'Split tunneling is a premium feature. A full-tunnel config was generated instead — upgrade to apply your rules.',
  split_applied: 'Split tunneling applied — this config routes only what your rules allow.',

  multihop_summary_title: 'Advanced: multi-hop (two configs)',
  multihop_tier_pill: 'PREMIUM · OPT-IN',
  multihop_lede:
    'Route through two gateways so <strong>no single server sees both who you are and where you go</strong>. It is slower and adds latency — expect roughly <strong>2× ping</strong> versus single-hop, and lower peak throughput from the double encryption. Multi-hop is premium, but one <mono>$0.99</mono> payment covers both hops (the same key K is premium at entry and exit automatically). Off by default — the single-hop flow above stays primary.',
  multihop_entry_label: 'Entry country (sees your IP)',
  multihop_entry_aria: 'Entry country',
  multihop_exit_label: 'Exit country (sees your destination)',
  multihop_exit_aria: 'Exit country',
  multihop_style_same: 'Route style: balanced — same country (one jurisdiction)',
  multihop_style_cross:
    'Route style: max privacy — cross-jurisdiction (two operators, two countries)',
  multihop_enrolling: 'Enrolling both hops…',
  multihop_generate: 'Generate two configs',
  multihop_error_no_exit: 'Multi-hop needs a distinct exit gateway; none was resolved.',
  multihop_error_no_gateways:
    'No live gateways reachable from the browser, so no route could be resolved. Multi-hop nesting is really an our-apps feature — the desktop and mobile clients (same core) probe gateways directly and run the two tunnels for you.',
  multihop_error_failed: 'Multi-hop generation failed.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'outer · MTU 1420',
  multihop_conf_inner_tag: 'inner · MTU {mtu}',
  multihop_download_entry: 'Download wg-entry.conf',
  multihop_download_exit: 'Download wg-exit.conf',
  multihop_note:
    '<strong>How to route these (honest note).</strong> True nesting with the stock WireGuard app is awkward — it runs one tunnel at a time — so multi-hop is really an <strong>our-apps feature</strong> (desktop/mobile chain the two tunnels for you). For a manual setup you must bring up <mono>wg-entry.conf</mono> first, then route only the exit’s address <mono>{exitIp}/32</mono> via that entry tunnel and send the rest through <mono>wg-exit.conf</mono> (inner MTU {mtu}, so two WireGuard headers fit). Exit endpoint: <mono>{endpoint}</mono>.<br/><strong>v1 caveat:</strong> both hops use the same key K, which defeats any <em>single</em> operator but means an adversary controlling <em>both</em> your hops could correlate via that shared key. Distinct keys per hop land in v1.5.',
} satisfies Record<string, Message>;
