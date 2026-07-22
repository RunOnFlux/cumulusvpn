import type { Catalog } from '../index';

export const ja: Catalog = {
  app_title: 'CumulusVPN — プライベートなインターネット、アカウント不要、ログなし',

  header_nav_connect: '接続',
  header_nav_upgrade: 'アップグレード',
  header_theme_label: 'テーマ: {mode}',
  header_theme_system: 'システム',
  header_theme_light: 'ライト',
  header_theme_dark: 'ダーク',
  header_language_label: '言語',

  footer_tagline: 'CumulusVPN — Flux Cloud 上の分散型 VPN · vpn.cumulusvpn.com',
  footer_credit: 'ベータ版 · アカウント不要 · ログなし',

  common_copy: 'コピー',
  common_copied: 'コピーしました',
  common_qr_alt: 'QR コード',
  common_powered_by_flux_link: 'Powered by Flux — runonflux.com を開きます',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'シード',
  common_directory: 'ディレクトリ',

  error_gateway_rejected: 'ゲートウェイが登録を拒否しました（{slug}）：{message}',

  countries_search_placeholder: '🔎  {n} か国を検索…',
  countries_search_label: '国を検索',
  countries_list_label: '国一覧',
  countries_no_match: '「{query}」に一致する国はありません。',
  countries_nodes: { other: '{n} 件のノード' },

  connect_eyebrow: 'ベータ版 · WireGuard 設定',
  connect_title: '鍵ひとつで<glow>すべてのゲートウェイへ。</glow>',
  connect_lede:
    'WireGuard の鍵ペアはここ、あなたのブラウザ内で生成されます — 秘密鍵がこのタブから出ることはありません。国を選び、最寄りの Flux ゲートウェイに登録すると、すぐにインポートできる<mono> .conf</mono>と QR コードを書き出せます。100 KB/s でずっと無料。フルスピードにするには <upgrade>FLUX でアップグレード</upgrade>してください。',
  connect_verify_warn:
    'ディレクトリの署名を検証できませんでした — エンドポイントは参考情報として表示しています。',
  connect_notice_no_live_gateway:
    'ブラウザから到達できるゲートウェイが見つかりません。署名済みディレクトリの国を表示しています — 到達可能なゲートウェイがあれば、そこに設定が登録されます。',
  connect_choose_location: '場所を選択',
  connect_tier_free: '無料 · 100 KB/s',
  connect_loading_directory: '署名済みディレクトリを解決し、ゲートウェイを探索しています…',
  connect_your_config: 'あなたの設定',
  connect_source_directory: '{source} ディレクトリ',
  connect_live_nodes: { other: '{n} 件の稼働中ノード' },
  connect_select_country: '続けるには国を選択してください',
  connect_enrolling: '登録中…',
  connect_generate: '.conf を生成',
  connect_no_gateway_in_country:
    'ブラウザから {country} 内のゲートウェイに到達できません。登録はゲートウェイの制御 API（http :51821）宛てに送信されますが、https のページはそこへ到達できません — これはこのコアを共有するデスクトップ版やモバイル版のクライアントでは機能します。',
  connect_error_enroll_failed: '登録に失敗しました。',
  connect_qr_caption: 'WireGuard アプリで読み取り',
  connect_stat_assigned_ip: '割り当てられた IP',
  connect_stat_endpoint: 'エンドポイント',
  connect_stat_dns: 'DNS',
  connect_download_conf: '.conf をダウンロード',
  connect_upgrade_cta: 'フルスピードにアップグレード →',
  connect_identity_title: 'このデバイスの識別情報',
  connect_regenerate: '鍵を再生成',
  connect_identity_note:
    'デバイスごとの鍵ペアは複数のゲートウェイに登録できます。プレミアムは chain を通じて、その鍵が使われるすべてのゲートウェイに適用されます。下記の支払いコードが、FLUX の支払いをこの鍵に結びつけます。',
  connect_field_public_key: 'WireGuard 公開鍵',
  connect_field_payment_code: '支払いコード（メモ）',

  upgrade_loading: '支払い情報を読み込んでいます…',
  upgrade_eyebrow: 'アップグレード · FLUX で支払う',
  upgrade_title: 'フルスピードにアップグレード',
  upgrade_lede:
    '下記のメッセージをそのまま添えて FLUX を送金してください。各ゲートウェイが chain をスキャンし、~1 分ほどで鍵のロックを解除します — すべてのサーバーで同時に、30 日間有効です。アカウントもカードも不要で、持ってもいないものを引き渡せる会社もありません。',
  upgrade_usd_line: '≈ {usd} · 30 日ごと',
  upgrade_qr_caption: 'Zelcore / SSP Wallet で読み取り',
  upgrade_field_address: '送金先アドレス',
  upgrade_field_message: 'メッセージ（必須）',
  upgrade_open_wallet: 'ウォレットで開く',
  upgrade_prepay_note:
    '<strong>先払いで積み増し：</strong>金額の倍数を支払うと、その分の月数をまとめて追加できます — 例：{amount} FLUX = 3 か月。余分な月数は積み重なり（最大 24 か月まで）、好きなタイミングでチャージできます。',
  upgrade_privacy_note:
    'Zelcore / SSP Wallet で開きます。支払いは Flux のブロックチェーン上で検証され — あなたが誰かを私たちが知ることはありません。メッセージが支払いをあなたの鍵に結びつけます。メッセージなしで送ると、資金は届いてもロックは解除されません。',
  upgrade_back: '← 接続に戻る',

  multihop_summary_title: '上級者向け：マルチホップ（設定 2 件）',
  multihop_tier_pill: 'プレミアム · 任意',
  multihop_lede:
    '2 つのゲートウェイを経由させることで、<strong>あなたが誰で、どこへ向かっているかを単独のサーバーが両方知ることはありません</strong>。その分速度は落ち、遅延も増えます — シングルホップに比べて <strong>2× ping</strong> 前後を見込んでください。二重暗号化によりピーク時のスループットも下がります。マルチホップはプレミアム機能ですが、<mono>$0.99</mono> の支払い 1 回で両方のホップをカバーします（同じ鍵 K が入口と出口の両方で自動的にプレミアムになります）。デフォルトでは無効 — 上記のシングルホップが引き続きメインの経路です。',
  multihop_entry_label: '入口の国（あなたの IP が見えます）',
  multihop_entry_aria: '入口の国',
  multihop_exit_label: '出口の国（あなたの行き先が見えます）',
  multihop_exit_aria: '出口の国',
  multihop_style_same: 'ルート方式：バランス型 — 同じ国（単一の法域）',
  multihop_style_cross: 'ルート方式：最大限のプライバシー — 法域をまたぐ（2 つの運営者、2 つの国）',
  multihop_enrolling: '両方のホップを登録しています…',
  multihop_generate: '設定を 2 件生成',
  multihop_error_no_exit:
    'マルチホップには独立した出口ゲートウェイが必要ですが、見つかりませんでした。',
  multihop_error_no_gateways:
    'ブラウザから到達できるゲートウェイがないため、経路を解決できませんでした。マルチホップの入れ子構成は実質的に自社アプリ向けの機能です — デスクトップ版とモバイル版のクライアント（同じコア）がゲートウェイを直接探索し、2 本のトンネルをあなたに代わって実行します。',
  multihop_error_failed: 'マルチホップの生成に失敗しました。',
  multihop_internet: 'インターネット',
  multihop_conf_outer_tag: '外側 · MTU 1420',
  multihop_conf_inner_tag: '内側 · MTU {mtu}',
  multihop_download_entry: 'wg-entry.conf をダウンロード',
  multihop_download_exit: 'wg-exit.conf をダウンロード',
  multihop_note:
    '<strong>これらの経路の通し方（率直な補足）。</strong>標準の WireGuard アプリで本当の入れ子構成を行うのは扱いにくく — 一度に 1 本のトンネルしか動かせません — そのためマルチホップは実質的に<strong>自社アプリ向けの機能</strong>です（デスクトップ版/モバイル版が 2 本のトンネルを代わりに連結します）。手動で設定する場合は、まず <mono>wg-entry.conf</mono> を起動し、その入口トンネル経由で出口のアドレス <mono>{exitIp}/32</mono> だけをルーティングし、残りは <mono>wg-exit.conf</mono> 経由で送信してください（内側の MTU は {mtu} — WireGuard のヘッダー 2 つ分が収まるサイズです）。出口のエンドポイント：<mono>{endpoint}</mono>。<br/><strong>v1 の注意点：</strong>両方のホップが同じ鍵 K を使うため、<em>単独</em>の運営者による解析は防げますが、<em>両方</em>のホップを支配する攻撃者であれば、その共有鍵を手がかりに相関させられる可能性があります。ホップごとに異なる鍵を使う仕組みは v1.5 で導入予定です。',
};
