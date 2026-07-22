import type { Catalog } from '../index';

export const hi: Catalog = {
  app_title: 'CumulusVPN — निजी इंटरनेट, न कोई खाता, न कोई लॉग',

  header_nav_connect: 'कनेक्ट',
  header_nav_upgrade: 'अपग्रेड',
  header_theme_label: 'थीम: {mode}',
  header_theme_system: 'सिस्टम',
  header_theme_light: 'लाइट',
  header_theme_dark: 'डार्क',
  header_language_label: 'भाषा',

  footer_tagline: 'CumulusVPN — Flux Cloud पर विकेंद्रीकृत VPN · vpn.cumulusvpn.com',
  footer_credit: 'बीटा पथ · न कोई खाता · न कोई लॉग',

  common_copy: 'कॉपी करें',
  common_copied: 'कॉपी हो गया',
  common_qr_alt: 'QR कोड',
  common_powered_by_flux_link: 'Powered by Flux — runonflux.com खोलता है',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'सीड',
  common_directory: 'डायरेक्टरी',

  error_gateway_rejected: 'गेटवे ने नामांकन अस्वीकार किया ({slug}): {message}',

  countries_search_placeholder: '🔎  {n} देशों में खोजें…',
  countries_search_label: 'देश खोजें',
  countries_list_label: 'देश',
  countries_no_match: '“{query}” से कोई देश मेल नहीं खाता।',
  countries_nodes: { one: '{n} नोड', other: '{n} नोड्स' },

  connect_eyebrow: 'बीटा पथ · WireGuard कॉन्फ़िग',
  connect_title: 'एक कुंजी, <glow>हर गेटवे।</glow>',
  connect_lede:
    'आपकी WireGuard कुंजी-जोड़ी यहीं, आपके ब्राउज़र में जनरेट होती है — निजी कुंजी इस टैब से कभी बाहर नहीं जाती। एक देश चुनें, निकटतम Flux गेटवे पर नामांकन करें, और इम्पोर्ट के लिए तैयार<mono> .conf</mono> व QR एक्सपोर्ट करें। 100 KB/s पर हमेशा मुफ़्त; पूरी स्पीड के लिए <upgrade>FLUX से अपग्रेड करें</upgrade>।',
  connect_verify_warn:
    'डायरेक्टरी हस्ताक्षर सत्यापित नहीं हो सका — एंडपॉइंट केवल जानकारी के लिए दिखाए गए हैं।',
  connect_notice_no_live_gateway:
    'ब्राउज़र से कोई लाइव गेटवे उपलब्ध नहीं है। हस्ताक्षरित डायरेक्टरी के देश दिखाए जा रहे हैं — लाइव गेटवे उपलब्ध होने पर कॉन्फ़िग उसी पर नामांकित होते हैं।',
  connect_choose_location: 'एक स्थान चुनें',
  connect_tier_free: 'मुफ़्त · 100 KB/s',
  connect_loading_directory: 'हस्ताक्षरित डायरेक्टरी रिज़ॉल्व और गेटवे खोजे जा रहे हैं…',
  connect_your_config: 'आपका कॉन्फ़िग',
  connect_source_directory: '{source} डायरेक्टरी',
  connect_live_nodes: { one: '{n} लाइव नोड', other: '{n} लाइव नोड्स' },
  connect_select_country: 'जारी रखने के लिए एक देश चुनें',
  connect_enrolling: 'नामांकन हो रहा है…',
  connect_generate: '.conf जनरेट करें',
  connect_no_gateway_in_country:
    '{country} में ब्राउज़र से कोई लाइव गेटवे उपलब्ध नहीं है। नामांकन गेटवे के कंट्रोल API (http :51821) पर भेजा जाता है, जहाँ तक https पेज नहीं पहुँच सकते — यह उन डेस्कटॉप और मोबाइल क्लाइंट से काम करता है जो यही कोर शेयर करते हैं।',
  connect_error_enroll_failed: 'नामांकन विफल हुआ।',
  connect_qr_caption: 'WireGuard ऐप में स्कैन करें',
  connect_stat_assigned_ip: 'असाइन की गई IP',
  connect_stat_endpoint: 'एंडपॉइंट',
  connect_stat_dns: 'DNS',
  connect_download_conf: '.conf डाउनलोड करें',
  connect_upgrade_cta: 'पूरी स्पीड के लिए अपग्रेड करें →',
  connect_identity_title: 'इस डिवाइस की पहचान',
  connect_regenerate: 'कुंजी फिर से जनरेट करें',
  connect_identity_note:
    'हर डिवाइस की एक कुंजी-जोड़ी कई गेटवे पर नामांकित होती है; प्रीमियम चेन के ज़रिए उन सभी पर उसी कुंजी के साथ लागू होता है। नीचे दिया गया पेमेंट कोड FLUX पेमेंट को इस कुंजी से जोड़ता है।',
  connect_field_public_key: 'WireGuard सार्वजनिक कुंजी',
  connect_field_payment_code: 'पेमेंट कोड (मेमो)',

  upgrade_loading: 'पेमेंट विवरण लोड हो रहा है…',
  upgrade_eyebrow: 'अपग्रेड · FLUX में भुगतान करें',
  upgrade_title: 'पूरी स्पीड के लिए अपग्रेड करें',
  upgrade_lede:
    'नीचे दिए गए सटीक मैसेज के साथ FLUX भेजें। हर गेटवे चेन स्कैन करता है और ~1 मिनट में आपकी कुंजी अनलॉक कर देता है — सभी सर्वर पर एक साथ, 30 दिनों के लिए। न कोई खाता, न कोई कार्ड, न कोई कंपनी जो वह सौंपे जो उसके पास कभी था ही नहीं।',
  upgrade_usd_line: '≈ {usd} · हर 30 दिन',
  upgrade_qr_caption: 'Zelcore / SSP Wallet से स्कैन करें',
  upgrade_field_address: 'भुगतान पता',
  upgrade_field_message: 'मैसेज (आवश्यक)',
  upgrade_open_wallet: 'वॉलेट में खोलें',
  upgrade_prepay_note:
    '<strong>पहले से भुगतान करें:</strong> राशि का गुणक भुगतान करके उतने ही महीने एक साथ जोड़ें — जैसे {amount} FLUX = 3 महीने। अतिरिक्त महीने जुड़ते जाते हैं (24 तक), तो आप कभी भी टॉप-अप कर सकते हैं।',
  upgrade_privacy_note:
    'Zelcore / SSP Wallet में खुलता है। भुगतान Flux ब्लॉकचेन पर सत्यापित होता है — हम कभी नहीं देखते कि आप कौन हैं। मैसेज भुगतान को आपकी कुंजी से जोड़ता है; इसके बिना भेजने पर पैसे पहुँच जाते हैं पर कुछ भी अनलॉक नहीं होता।',
  upgrade_back: '← कनेक्ट पर वापस जाएँ',

  multihop_summary_title: 'एडवांस्ड: मल्टी-हॉप (दो कॉन्फ़िग)',
  multihop_tier_pill: 'प्रीमियम · ऑप्ट-इन',
  multihop_lede:
    'दो गेटवे से होकर रूट करें ताकि <strong>कोई भी अकेला सर्वर यह न देख सके कि आप कौन हैं और कहाँ जा रहे हैं</strong>। यह धीमा है और लेटेंसी बढ़ाता है — सिंगल-हॉप के मुकाबले लगभग <strong>2× पिंग</strong> की उम्मीद करें, और डबल एन्क्रिप्शन से पीक थ्रूपुट भी कम रहता है। मल्टी-हॉप प्रीमियम है, पर एक <mono>$0.99</mono> भुगतान दोनों हॉप कवर करता है (वही कुंजी K एंट्री और एग्ज़िट दोनों पर अपने आप प्रीमियम हो जाती है)। डिफ़ॉल्ट रूप से बंद — ऊपर वाला सिंगल-हॉप फ़्लो ही मुख्य बना रहता है।',
  multihop_entry_label: 'एंट्री देश (आपकी IP देखता है)',
  multihop_entry_aria: 'एंट्री देश',
  multihop_exit_label: 'एग्ज़िट देश (आपकी मंज़िल देखता है)',
  multihop_exit_aria: 'एग्ज़िट देश',
  multihop_style_same: 'रूट स्टाइल: बैलेंस्ड — एक ही देश (एक अधिकार-क्षेत्र)',
  multihop_style_cross: 'रूट स्टाइल: अधिकतम प्राइवेसी — क्रॉस-ज्यूरिस्डिक्शन (दो ऑपरेटर, दो देश)',
  multihop_enrolling: 'दोनों हॉप नामांकित हो रहे हैं…',
  multihop_generate: 'दो कॉन्फ़िग जनरेट करें',
  multihop_error_no_exit: 'मल्टी-हॉप के लिए एक अलग एग्ज़िट गेटवे चाहिए; कोई तय नहीं हो पाया।',
  multihop_error_no_gateways:
    'ब्राउज़र से कोई लाइव गेटवे उपलब्ध नहीं है, इसलिए कोई रूट तय नहीं हो सका। मल्टी-हॉप नेस्टिंग असल में हमारे ऐप्स का फ़ीचर है — डेस्कटॉप और मोबाइल क्लाइंट (वही कोर) सीधे गेटवे जाँचते हैं और दोनों टनल आपके लिए चलाते हैं।',
  multihop_error_failed: 'मल्टी-हॉप जनरेशन विफल हुआ।',
  multihop_internet: 'इंटरनेट',
  multihop_conf_outer_tag: 'बाहरी · MTU 1420',
  multihop_conf_inner_tag: 'आंतरिक · MTU {mtu}',
  multihop_download_entry: 'wg-entry.conf डाउनलोड करें',
  multihop_download_exit: 'wg-exit.conf डाउनलोड करें',
  multihop_note:
    '<strong>इन्हें कैसे रूट करें (ईमानदार नोट)।</strong> स्टॉक WireGuard ऐप से असली नेस्टिंग अटपटी है — यह एक बार में एक ही टनल चलाता है — इसलिए मल्टी-हॉप असल में <strong>हमारे ऐप्स का फ़ीचर</strong> है (डेस्कटॉप/मोबाइल दोनों टनल आपके लिए चेन करते हैं)। मैनुअल सेटअप के लिए आपको पहले <mono>wg-entry.conf</mono> शुरू करना होगा, फिर एग्ज़िट के पते <mono>{exitIp}/32</mono> को उसी एंट्री टनल से रूट करना होगा और बाकी सब <mono>wg-exit.conf</mono> से भेजना होगा (आंतरिक MTU {mtu}, ताकि दो WireGuard हेडर फ़िट हो सकें)। एग्ज़िट एंडपॉइंट: <mono>{endpoint}</mono>।<br/><strong>v1 सीमा:</strong> दोनों हॉप एक ही कुंजी K इस्तेमाल करते हैं, जो किसी <em>अकेले</em> ऑपरेटर को बेअसर कर देती है, पर इसका मतलब है कि जो हमलावर आपके <em>दोनों</em> हॉप पर नियंत्रण रखता हो, वह उसी साझा कुंजी से सहसंबंध बना सकता है। हर हॉप के लिए अलग कुंजियाँ v1.5 में आएँगी।',
};
