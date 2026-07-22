import type { Catalog } from '../index';

export const sw: Catalog = {
  app_title: 'CumulusVPN — Intaneti ya faragha, bila akaunti, bila kumbukumbu',

  header_nav_connect: 'Unganisha',
  header_nav_upgrade: 'Boresha',
  header_theme_label: 'Mandhari: {mode}',
  header_theme_system: 'mfumo',
  header_theme_light: 'angavu',
  header_theme_dark: 'giza',
  header_language_label: 'Lugha',

  footer_tagline: 'CumulusVPN — VPN isiyo na kituo kimoja kwenye Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Njia ya beta · bila akaunti · bila kumbukumbu',

  common_copy: 'Nakili',
  common_copied: 'Imenakiliwa',
  common_qr_alt: 'Msimbo wa QR',
  common_powered_by_flux_link: 'Powered by Flux — inafungua runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'orodha ya awali',
  common_directory: 'saraka',

  error_gateway_rejected: 'Lango limekataa usajili ({slug}): {message}',

  countries_search_placeholder: '🔎  Tafuta miongoni mwa nchi {n}…',
  countries_search_label: 'Tafuta nchi',
  countries_list_label: 'Nchi',
  countries_no_match: 'Hakuna nchi inayolingana na “{query}”.',
  countries_nodes: { one: '{n} nodi', other: '{n} nodi' },

  connect_eyebrow: 'Njia ya beta · Usanidi wa WireGuard',
  connect_title: 'Ufunguo mmoja, <glow>kila lango.</glow>',
  connect_lede:
    'Jozi yako ya funguo za WireGuard inatengenezwa hapa, kwenye kivinjari chako — ufunguo wa faragha haondoki kwenye kichupo hiki kamwe. Chagua nchi, jisajili kwenye lango la Flux lililo karibu zaidi, kisha hamisha faili<mono> .conf</mono> tayari kutumika pamoja na msimbo wa QR. Bure milele kwa 100 KB/s; <upgrade>boresha kwa FLUX</upgrade> kupata kasi kamili.',
  connect_verify_warn:
    'Sahihi ya saraka haikuweza kuthibitishwa — vituo vinaonyeshwa kwa taarifa tu.',
  connect_notice_no_live_gateway:
    'Hakuna lango tendaji linaloweza kufikiwa kutoka kwa kivinjari. Nchi za saraka iliyotiwa sahihi zinaonyeshwa — usanidi husajiliwa kwenye lango tendaji linapopatikana.',
  connect_choose_location: 'Chagua eneo',
  connect_tier_free: 'BURE · 100 KB/s',
  connect_loading_directory: 'Inatatua saraka iliyotiwa sahihi na kugundua malango…',
  connect_your_config: 'Usanidi wako',
  connect_source_directory: 'Saraka ya {source}',
  connect_live_nodes: { one: '{n} nodi tendaji', other: '{n} nodi tendaji' },
  connect_select_country: 'Chagua nchi ili kuendelea',
  connect_enrolling: 'Inasajili…',
  connect_generate: 'Tengeneza .conf',
  connect_no_gateway_in_country:
    'Hakuna lango tendaji linaloweza kufikiwa nchini {country} kutoka kwa kivinjari. Usajili hutumwa kwa API ya udhibiti ya lango (http :51821), ambayo kurasa za https haziwezi kufikia — hii inafanya kazi kutoka kwa programu za kompyuta na simu zinazoshiriki kiini hiki.',
  connect_error_enroll_failed: 'Usajili umeshindwa.',
  connect_qr_caption: 'Changanua kwenye programu ya WireGuard',
  connect_stat_assigned_ip: 'IP iliyotolewa',
  connect_stat_endpoint: 'Kituo',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Pakua .conf',
  connect_upgrade_cta: 'Boresha upate kasi kamili →',
  connect_identity_title: 'Utambulisho wa kifaa hiki',
  connect_regenerate: 'Tengeneza upya ufunguo',
  connect_identity_note:
    'Jozi moja ya funguo kwa kila kifaa husajili kwenye malango mengi; huduma ya premium hufuata ufunguo kwenye yote kupitia mnyororo. Msimbo wa malipo ulio hapa chini ndio unaounganisha malipo ya FLUX na ufunguo huu.',
  connect_field_public_key: 'Ufunguo wa umma wa WireGuard',
  connect_field_payment_code: 'Msimbo wa malipo (ujumbe)',

  upgrade_loading: 'Inapakia maelezo ya malipo…',
  upgrade_eyebrow: 'Boresha · lipa kwa FLUX',
  upgrade_title: 'Boresha upate kasi kamili',
  upgrade_lede:
    'Tuma FLUX ukitumia ujumbe hasa ulio hapa chini. Kila lango huchanganua mnyororo na kufungua ufunguo wako ndani ya ~1 dakika — kwenye seva zote kwa wakati mmoja, kwa siku 30. Hakuna akaunti, hakuna kadi, hakuna kampuni inayoweza kutoa kitu ambacho haikuwa nacho kamwe.',
  upgrade_usd_line: '≈ {usd} · kwa kila siku 30',
  upgrade_qr_caption: 'Changanua kwa Zelcore / SSP Wallet',
  upgrade_field_address: 'Lipa kwenye anwani',
  upgrade_field_message: 'Ujumbe (unahitajika)',
  upgrade_open_wallet: 'Fungua kwenye pochi',
  upgrade_prepay_note:
    '<strong>Lipa mapema:</strong> lipa kizidishi cha kiasi ili kuongeza miezi mingi kwa wakati mmoja — mfano, FLUX {amount} = miezi 3. Miezi ya ziada hurundikana (hadi 24), hivyo unaweza kuongeza wakati wowote.',
  upgrade_privacy_note:
    'Inafungua kwenye Zelcore / SSP Wallet. Malipo yanathibitishwa kwenye mnyororo wa vizuizi wa Flux — hatuoni kamwe wewe ni nani. Ujumbe unaunganisha malipo na ufunguo wako; kutuma bila huo kunamaanisha fedha zinawasili lakini hakuna kinachofunguliwa.',
  upgrade_back: '← Rudi kwenye Unganisha',

  multihop_summary_title: 'Mavaidha ya juu: multi-hop (usanidi mbili)',
  multihop_tier_pill: 'PREMIUM · HIARI',
  multihop_lede:
    'Pitisha trafiki kwenye malango mawili ili <strong>hakuna seva moja inayoona wewe ni nani na unakoenda</strong>. Ni polepole zaidi na huongeza ukawiaji — tarajia takribani <strong>2× ping</strong> ikilinganishwa na hop moja, na kiwango cha juu cha upitishaji kilicho chini kutokana na usimbaji fiche mara mbili. Multi-hop ni huduma ya premium, lakini malipo moja ya <mono>$0.99</mono> hufunika hop zote mbili (ufunguo uleule K unakuwa premium kiotomatiki kwenye kuingia na kutoka). Imezimwa kwa default — mtiririko wa hop moja ulio hapo juu unabaki kuwa msingi.',
  multihop_entry_label: 'Nchi ya kuingilia (inaona IP yako)',
  multihop_entry_aria: 'Nchi ya kuingilia',
  multihop_exit_label: 'Nchi ya kutokea (inaona unakoenda)',
  multihop_exit_aria: 'Nchi ya kutokea',
  multihop_style_same: 'Mtindo wa njia: uwiano — nchi ile ile (mamlaka moja)',
  multihop_style_cross:
    'Mtindo wa njia: faragha ya juu zaidi — kuvuka mamlaka (waendeshaji wawili, nchi mbili)',
  multihop_enrolling: 'Inasajili hop zote mbili…',
  multihop_generate: 'Tengeneza usanidi mbili',
  multihop_error_no_exit: 'Multi-hop inahitaji lango tofauti la kutokea; hakuna lililopatikana.',
  multihop_error_no_gateways:
    'Hakuna malango tendaji yanayoweza kufikiwa kutoka kwa kivinjari, hivyo hakuna njia iliyoweza kupatikana. Uunganishaji wa multi-hop kwa kweli ni kipengele cha programu zetu — programu za kompyuta na simu (kiini kile kile) huchunguza malango moja kwa moja na kuendesha vichuguu viwili kwa niaba yako.',
  multihop_error_failed: 'Kutengeneza multi-hop kumeshindwa.',
  multihop_internet: 'intaneti',
  multihop_conf_outer_tag: 'nje · MTU 1420',
  multihop_conf_inner_tag: 'ndani · MTU {mtu}',
  multihop_download_entry: 'Pakua wg-entry.conf',
  multihop_download_exit: 'Pakua wg-exit.conf',
  multihop_note:
    '<strong>Jinsi ya kupitisha hizi (taarifa ya uwazi).</strong> Uunganishaji wa kweli kwa kutumia programu asilia ya WireGuard ni mgumu — huendesha kichuguu kimoja kwa wakati — kwa hivyo multi-hop kwa kweli ni <strong>kipengele cha programu zetu</strong> (kompyuta/simu huunganisha vichuguu viwili kwa niaba yako). Kwa usanidi wa mkono lazima uanzishe <mono>wg-entry.conf</mono> kwanza, kisha upitishe anwani ya kutokea pekee <mono>{exitIp}/32</mono> kupitia kichuguu hicho cha kuingilia na kutuma yaliyobaki kupitia <mono>wg-exit.conf</mono> (MTU ya ndani {mtu}, ili vichwa viwili vya WireGuard vitoshee). Kituo cha kutokea: <mono>{endpoint}</mono>.<br/><strong>Onyo la v1:</strong> hop zote mbili hutumia ufunguo uleule K, jambo linalozuia mwendeshaji yeyote <em>mmoja</em> lakini linamaanisha kuwa adui anayedhibiti hop zako <em>zote mbili</em> anaweza kuunganisha kupitia ufunguo huo unaoshirikiwa. Funguo tofauti kwa kila hop zitakuja katika v1.5.',
};
