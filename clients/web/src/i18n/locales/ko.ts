import type { Catalog } from '../index';

export const ko: Catalog = {
  app_title: 'CumulusVPN — 계정도 로그도 없는 프라이빗 인터넷',

  header_nav_connect: '연결',
  header_nav_upgrade: '업그레이드',
  header_theme_label: '테마: {mode}',
  header_theme_system: '시스템',
  header_theme_light: '라이트',
  header_theme_dark: '다크',
  header_language_label: '언어',

  footer_tagline: 'CumulusVPN — Flux Cloud 기반 분산형 VPN · vpn.cumulusvpn.com',
  footer_credit: '베타 채널 · 계정 없음 · 로그 없음',

  common_copy: '복사',
  common_copied: '복사됨',
  common_qr_alt: 'QR 코드',
  common_powered_by_flux_link: 'Powered by Flux — runonflux.com 열기',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: '시드',
  common_directory: '디렉터리',

  error_gateway_rejected: '게이트웨이가 등록을 거부했습니다 ({slug}): {message}',

  countries_search_placeholder: '🔎  {n}개국 검색…',
  countries_search_label: '국가 검색',
  countries_list_label: '국가',
  countries_no_match: '“{query}”와 일치하는 국가가 없습니다.',
  countries_nodes: { other: '노드 {n}개' },

  connect_eyebrow: '베타 채널 · WireGuard 설정',
  connect_title: '키 하나로 <glow>모든 게이트웨이에.</glow>',
  connect_lede:
    'WireGuard 키 쌍은 여기, 브라우저 안에서 생성되며 — 개인 키는 이 탭을 벗어나지 않습니다. 국가를 선택하고 가장 가까운 Flux 게이트웨이에 등록한 뒤, 바로 가져올 수 있는<mono> .conf</mono> 파일과 QR 코드를 내보내세요. 100 KB/s로 영구 무료이며, 전체 속도를 원한다면 <upgrade>FLUX로 업그레이드</upgrade>하세요.',
  connect_verify_warn: '디렉터리 서명을 확인할 수 없습니다 — 엔드포인트는 참고용으로만 표시됩니다.',
  connect_notice_no_live_gateway:
    '브라우저에서 접속 가능한 활성 게이트웨이가 없습니다. 서명된 디렉터리의 국가 목록을 표시하고 있으며 — 활성 게이트웨이에 접속할 수 있게 되면 그곳에 설정이 등록됩니다.',
  connect_choose_location: '위치 선택',
  connect_tier_free: '무료 · 100 KB/s',
  connect_loading_directory: '서명된 디렉터리를 확인하고 게이트웨이를 찾는 중…',
  connect_your_config: '내 설정',
  connect_source_directory: '{source} 디렉터리',
  connect_live_nodes: { other: '활성 노드 {n}개' },
  connect_select_country: '계속하려면 국가를 선택하세요',
  connect_enrolling: '등록 중…',
  connect_generate: '.conf 생성',
  connect_no_gateway_in_country:
    '브라우저에서 {country}의 활성 게이트웨이에 접속할 수 없습니다. 등록 요청은 게이트웨이의 제어 API(http :51821)로 전송되는데, https 페이지에서는 여기에 접속할 수 없습니다 — 이는 동일한 코어를 공유하는 데스크톱 및 모바일 클라이언트에서는 정상적으로 동작합니다.',
  connect_error_enroll_failed: '등록에 실패했습니다.',
  connect_qr_caption: 'WireGuard 앱으로 스캔',
  connect_stat_assigned_ip: '할당된 IP',
  connect_stat_endpoint: '엔드포인트',
  connect_stat_dns: 'DNS',
  connect_download_conf: '.conf 다운로드',
  connect_conf_note:
    '이 서버에 묶여 있습니다. 서버가 재시작되거나 옮겨지면 WireGuard는 계속 터널이 연결된 것으로 표시하지만 아무것도 통과하지 못합니다 — 여기로 돌아와 새 .conf를 생성하세요.',
  connect_conf_regenerate: '새 .conf 생성',
  connect_conf_stale:
    '{country}용 마지막 설정을 발급한 서버가 교체되었습니다 — 그 설정으로는 더 이상 연결할 수 없습니다. 아래에서 새로 생성하세요.',
  connect_conf_unsure:
    '{country}용 마지막 설정을 발급한 서버에 연결하지 못했습니다. 일시적으로 중단되었거나 완전히 사라졌을 수 있습니다 — 터널로 트래픽이 흐르지 않는다면 아래에서 새 설정을 생성하세요.',
  connect_conf_checking: '마지막 설정을 확인하는 중…',
  connect_upgrade_cta: '전체 속도로 업그레이드 →',
  connect_identity_title: '이 기기의 신원',
  connect_regenerate: '키 재생성',
  connect_identity_note:
    '기기당 하나의 키 쌍으로 여러 게이트웨이에 등록할 수 있으며, 프리미엄은 체인을 통해 그 키가 쓰이는 모든 게이트웨이에 함께 적용됩니다. 아래 결제 코드가 FLUX 결제를 이 키와 연결해 줍니다.',
  connect_field_public_key: 'WireGuard 공개 키',
  connect_field_payment_code: '결제 코드 (메모)',

  upgrade_loading: '결제 정보를 불러오는 중…',
  upgrade_eyebrow: '업그레이드 · FLUX로 결제',
  upgrade_title: '전체 속도로 업그레이드',
  upgrade_lede:
    '아래의 정확한 메시지와 함께 FLUX를 보내세요. 각 게이트웨이가 체인을 스캔해 ~1 분 안에 키를 잠금 해제하며 — 모든 서버에서 동시에, 30일 동안 적용됩니다. 계정도, 카드도, 가진 적 없는 것을 내줄 수 있는 회사도 필요 없습니다.',
  upgrade_usd_line: '≈ {usd} · 30일마다',
  upgrade_qr_caption: 'Zelcore / SSP Wallet으로 스캔',
  upgrade_field_address: '결제 주소',
  upgrade_field_message: '메시지 (필수)',
  upgrade_open_wallet: '지갑에서 열기',
  upgrade_prepay_note:
    '<strong>미리 선결제:</strong> 금액의 배수를 결제하면 그만큼의 개월 수를 한 번에 추가할 수 있습니다 — 예: {amount} FLUX = 3개월. 추가 개월은 계속 누적되므로(최대 24개월) 언제든 충전할 수 있습니다.',
  upgrade_privacy_note:
    'Zelcore / SSP Wallet에서 열립니다. 결제는 Flux 블록체인에서 검증되며 — 당신이 누구인지는 저희도 알 수 없습니다. 메시지가 결제를 당신의 키와 연결해 주며, 메시지 없이 보내면 자금은 도착하지만 아무것도 잠금 해제되지 않습니다.',
  upgrade_back: '← 연결로 돌아가기',

  upgrade_eyebrow_card: '또는 카드로 결제',
  upgrade_card_lede:
    '카드, Apple Pay 또는 Google Pay로 구독하세요. 결제는 Stripe가 처리하며 — 저희는 당신의 카드를 절대 볼 수 없습니다. 프리미엄은 이 경우에도 Flux 블록체인에서 활성화되며, 익명 결제 코드에만 연결됩니다.',
  upgrade_plan_aria: '구독 플랜',
  upgrade_plan_monthly: '{usd} / 월',
  upgrade_plan_annual: '{usd} / 년',
  upgrade_card_cta: '카드로 결제',
  upgrade_card_cta_busy: '안전한 결제 페이지를 여는 중…',
  upgrade_card_error: '결제 페이지를 열 수 없습니다. 잠시 후 다시 시도해 주세요.',
  upgrade_card_note:
    '자동으로 갱신되며, Stripe 영수증 이메일에서 언제든 해지할 수 있습니다. 위의 FLUX 결제가 더 저렴합니다 — 카드 가격에는 결제 처리 수수료가 포함되어 있습니다.',
  upgrade_activating_title: '프리미엄을 활성화하는 중…',
  upgrade_state_pending: '결제가 접수되었습니다 — Flux 네트워크에서 활성화를 준비하고 있습니다.',
  upgrade_state_broadcast: '활성화가 Flux 네트워크로 전송되었습니다 — 확인을 기다리고 있습니다.',
  upgrade_state_confirmed: '확인 완료! 1분 안에 모든 서버에서 전체 속도가 잠금 해제됩니다.',
  upgrade_state_failed:
    '활성화 중 문제가 발생했습니다. 결제는 안전합니다 — 자동으로 다시 시도하며, 프리미엄이 곧 표시됩니다.',
  upgrade_activating_hint: '이 페이지를 닫아도 됩니다 — 활성화는 저절로 완료됩니다.',
  upgrade_activated_cta: '연결로 돌아가기 →',

  split_summary_title: '고급: 스플릿 터널링',
  split_tier_pill: '프리미엄 · 선택',
  split_lede:
    '어떤 목적지가 VPN을 사용할지 선택하세요. 생성된 구성은 규칙을 WireGuard AllowedIPs로 표현하므로 표준 WireGuard 앱에서 작동합니다 — IP 범위와 로컬 네트워크 우회만 지원합니다(앱별 규칙은 네이티브 앱이 필요합니다).',
  split_mode_aria: '스플릿 터널링 모드',
  split_mode_off: '끄기',
  split_mode_exclude: '목록 제외',
  split_mode_include: '이것만',
  split_warn_exclude: '제외된 트래픽은 보호 없이 기기를 떠나며 당신의 실제 IP 주소가 드러납니다.',
  split_warn_include:
    '나열된 목적지만 보호됩니다 — 나머지는 모두 당신의 실제 IP 주소가 드러납니다.',
  split_lan_label: '로컬 네트워크 접근 허용 (프린터, NAS, 캐스팅)',
  split_cidr_placeholder: '예: 192.168.0.0/16 또는 203.0.113.7',
  split_cidr_aria: 'IP 주소 또는 CIDR 범위',
  split_add: '추가',
  split_input_invalid: '유효한 IP 주소 또는 CIDR 범위가 아닙니다.',
  split_rules_empty:
    '아직 IP 규칙이 없습니다 — 위에서 범위를 추가하거나 로컬 네트워크 접근만 사용하세요.',
  split_remove_aria: '규칙 {value} 제거',
  split_next_note: '규칙은 이 페이지에서 다음에 생성하는 구성에 적용됩니다.',
  split_premium_required:
    '스플릿 터널링은 프리미엄 기능입니다. 대신 전체 터널 구성이 생성되었습니다 — 규칙을 적용하려면 업그레이드하세요.',
  split_applied: '스플릿 터널링 적용됨 — 이 구성은 규칙이 허용하는 것만 라우팅합니다.',

  multihop_summary_title: '고급: 멀티홉 (설정 2개)',
  multihop_tier_pill: '프리미엄 · 선택 사항',
  multihop_lede:
    '두 개의 게이트웨이를 경유해 <strong>어느 한 서버도 당신이 누구인지와 어디로 가는지를 동시에 알 수 없도록</strong> 합니다. 속도는 느려지고 지연 시간도 늘어납니다 — 싱글홉 대비 <strong>2× 핑</strong> 정도를 예상하시고, 이중 암호화로 인해 최대 처리량도 낮아집니다. 멀티홉은 프리미엄 기능이지만, <mono>$0.99</mono> 결제 한 번으로 두 홉이 모두 커버됩니다(동일한 키 K가 진입점과 종료점 양쪽에서 자동으로 프리미엄이 됩니다). 기본값은 꺼짐이며 — 위의 싱글홉 흐름이 계속 기본 경로입니다.',
  multihop_entry_label: '진입 국가 (당신의 IP를 확인함)',
  multihop_entry_aria: '진입 국가',
  multihop_exit_label: '종료 국가 (목적지를 확인함)',
  multihop_exit_aria: '종료 국가',
  multihop_style_same: '경로 방식: 균형 — 동일 국가 (단일 관할권)',
  multihop_style_cross: '경로 방식: 최대 프라이버시 — 관할권 교차 (운영자 2곳, 국가 2곳)',
  multihop_enrolling: '두 홉을 모두 등록하는 중…',
  multihop_generate: '설정 2개 생성',
  multihop_error_no_exit: '멀티홉에는 별도의 종료 게이트웨이가 필요하지만 찾지 못했습니다.',
  multihop_error_no_gateways:
    '브라우저에서 접속 가능한 활성 게이트웨이가 없어 경로를 정할 수 없었습니다. 멀티홉 중첩은 사실상 저희 앱 전용 기능입니다 — 데스크톱 및 모바일 클라이언트(동일한 코어)가 게이트웨이를 직접 탐색해 두 터널을 대신 실행해 줍니다.',
  multihop_error_failed: '멀티홉 생성에 실패했습니다.',
  multihop_internet: '인터넷',
  multihop_conf_outer_tag: '외부 · MTU 1420',
  multihop_conf_inner_tag: '내부 · MTU {mtu}',
  multihop_download_entry: 'wg-entry.conf 다운로드',
  multihop_download_exit: 'wg-exit.conf 다운로드',
  multihop_note:
    '<strong>이 설정을 라우팅하는 방법 (솔직한 안내).</strong> 기본 WireGuard 앱으로 진짜 중첩 구성을 하는 것은 번거롭습니다 — 한 번에 터널 하나만 실행되기 때문입니다 — 그래서 멀티홉은 사실상 <strong>저희 앱 전용 기능</strong>입니다 (데스크톱/모바일이 두 터널을 대신 연결해 줍니다). 수동으로 설정하려면 먼저 <mono>wg-entry.conf</mono>를 실행한 다음, 그 진입 터널을 통해 종료 주소 <mono>{exitIp}/32</mono>만 라우팅하고, 나머지는 <mono>wg-exit.conf</mono>를 통해 보내야 합니다 (내부 MTU {mtu} — WireGuard 헤더 2개가 들어갈 수 있는 크기입니다). 종료 엔드포인트: <mono>{endpoint}</mono>.<br/><strong>v1 유의 사항:</strong> 두 홉이 동일한 키 K를 사용하므로 <em>단일</em> 운영자는 무력화되지만, 당신의 <em>두</em> 홉을 모두 장악한 공격자라면 이 공유 키를 통해 상관관계를 파악할 수 있습니다. 홉마다 다른 키를 사용하는 기능은 v1.5에 도입될 예정입니다.',
};
