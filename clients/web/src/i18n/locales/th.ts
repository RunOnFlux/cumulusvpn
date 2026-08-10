import type { Catalog } from '../index';

export const th: Catalog = {
  app_title: 'CumulusVPN — อินเทอร์เน็ตส่วนตัว ไม่มีบัญชี ไม่มีล็อก',

  header_nav_connect: 'เชื่อมต่อ',
  header_nav_upgrade: 'อัปเกรด',
  header_theme_label: 'ธีม: {mode}',
  header_theme_system: 'ระบบ',
  header_theme_light: 'สว่าง',
  header_theme_dark: 'มืด',
  header_language_label: 'ภาษา',

  footer_tagline: 'CumulusVPN — VPN แบบกระจายศูนย์บน Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'เส้นทางเบต้า · ไม่มีบัญชี · ไม่มีล็อก',

  common_copy: 'คัดลอก',
  common_copied: 'คัดลอกแล้ว',
  common_qr_alt: 'รหัส QR',
  common_powered_by_flux_link: 'Powered by Flux — เปิด runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'ซีด',
  common_directory: 'ไดเรกทอรี',

  error_gateway_rejected: 'เกตเวย์ปฏิเสธการลงทะเบียน ({slug}): {message}',

  countries_search_placeholder: '🔎  ค้นหาใน {n} ประเทศ…',
  countries_search_label: 'ค้นหาประเทศ',
  countries_list_label: 'ประเทศ',
  countries_no_match: 'ไม่มีประเทศที่ตรงกับ “{query}”',
  countries_nodes: { other: '{n} โหนด' },

  connect_eyebrow: 'เส้นทางเบต้า · config ของ WireGuard',
  connect_title: 'คีย์เดียว <glow>ทุกเกตเวย์</glow>',
  connect_lede:
    'คู่คีย์ WireGuard ของคุณถูกสร้างขึ้นที่นี่ ในเบราว์เซอร์ของคุณ — คีย์ส่วนตัวจะไม่ออกจากแท็บนี้เลย เลือกประเทศ ลงทะเบียนที่เกตเวย์ Flux ที่ใกล้ที่สุด แล้วส่งออกไฟล์<mono> .conf</mono> พร้อมใช้งานและ QR ฟรีตลอดไปที่ 100 KB/s <upgrade>อัปเกรดด้วย FLUX</upgrade> เพื่อความเร็วเต็มสปีด',
  connect_verify_warn:
    'ไม่สามารถยืนยันลายเซ็นของไดเรกทอรีได้ — เอนด์พอยต์ที่แสดงมีไว้เพื่อข้อมูลเท่านั้น',
  connect_notice_no_live_gateway:
    'ไม่มีเกตเวย์ที่ใช้งานได้จากเบราว์เซอร์ กำลังแสดงประเทศจากไดเรกทอรีที่มีลายเซ็น — config จะลงทะเบียนกับเกตเวย์ที่ใช้งานได้เมื่อมีเกตเวย์พร้อม',
  connect_choose_location: 'เลือกตำแหน่งที่ตั้ง',
  connect_tier_free: 'ฟรี · 100 KB/s',
  connect_loading_directory: 'กำลังตรวจสอบไดเรกทอรีที่มีลายเซ็นและค้นหาเกตเวย์…',
  connect_your_config: 'config ของคุณ',
  connect_source_directory: 'ไดเรกทอรี {source}',
  connect_live_nodes: { other: '{n} โหนดที่ใช้งานอยู่' },
  connect_select_country: 'เลือกประเทศเพื่อดำเนินการต่อ',
  connect_enrolling: 'กำลังลงทะเบียน…',
  connect_generate: 'สร้าง .conf',
  connect_no_gateway_in_country:
    'ไม่มีเกตเวย์ที่ใช้งานได้ใน {country} จากเบราว์เซอร์ การลงทะเบียนจะส่งไปยัง control API ของเกตเวย์ (http :51821) ซึ่งหน้า https เข้าถึงไม่ได้ — วิธีนี้ใช้ได้จากไคลเอนต์เดสก์ท็อปและมือถือที่ใช้ core เดียวกัน',
  connect_error_enroll_failed: 'ลงทะเบียนไม่สำเร็จ',
  connect_qr_caption: 'สแกนเข้าแอป WireGuard',
  connect_stat_assigned_ip: 'IP ที่ได้รับ',
  connect_stat_endpoint: 'เอนด์พอยต์',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'ดาวน์โหลด .conf',
  connect_conf_note:
    'ผูกกับเซิร์ฟเวอร์นี้ หากเซิร์ฟเวอร์รีสตาร์ตหรือย้าย WireGuard จะยังแสดงว่าอุโมงค์เชื่อมต่ออยู่ทั้งที่ไม่มีอะไรผ่าน — กลับมาที่นี่แล้วสร้าง .conf ใหม่',
  connect_conf_regenerate: 'สร้าง .conf ใหม่',
  connect_conf_stale:
    'เซิร์ฟเวอร์ที่ออกการตั้งค่าล่าสุดของคุณสำหรับ {country} ถูกเปลี่ยนแล้ว — การตั้งค่านั้นเชื่อมต่อไม่ได้อีก สร้างใหม่ด้านล่าง',
  connect_conf_unsure:
    'ติดต่อเซิร์ฟเวอร์ที่ออกการตั้งค่าล่าสุดของคุณสำหรับ {country} ไม่ได้ อาจปิดชั่วคราวหรือหายไปถาวร — หากอุโมงค์ไม่ส่งข้อมูลผ่าน ให้สร้างการตั้งค่าใหม่ด้านล่าง',
  connect_conf_checking: 'กำลังตรวจสอบการตั้งค่าล่าสุดของคุณ…',
  connect_upgrade_cta: 'อัปเกรดเป็นความเร็วเต็มสปีด →',
  connect_identity_title: 'ตัวตนของอุปกรณ์นี้',
  connect_regenerate: 'สร้างคีย์ใหม่',
  connect_identity_note:
    'คู่คีย์หนึ่งชุดต่ออุปกรณ์หนึ่งเครื่องลงทะเบียนได้กับหลายเกตเวย์ พรีเมียมจะติดตามคีย์นั้นไปทุกที่ผ่าน chain รหัสการชำระเงินด้านล่างคือสิ่งที่ผูกการชำระเงิน FLUX เข้ากับคีย์นี้',
  connect_field_public_key: 'คีย์สาธารณะของ WireGuard',
  connect_field_payment_code: 'รหัสการชำระเงิน (memo)',

  upgrade_loading: 'กำลังโหลดรายละเอียดการชำระเงิน…',
  upgrade_eyebrow: 'อัปเกรด · จ่ายด้วย FLUX',
  upgrade_title: 'อัปเกรดเป็นความเร็วเต็มสปีด',
  upgrade_lede:
    'ส่ง FLUX พร้อมข้อความที่ตรงกับด้านล่างนี้ทุกตัวอักษร ทุกเกตเวย์จะสแกน chain และปลดล็อกคีย์ของคุณภายใน ~1 นาที — บนเซิร์ฟเวอร์ทั้งหมดพร้อมกัน เป็นเวลา 30 วัน ไม่ต้องมีบัญชี ไม่ต้องมีบัตร ไม่มีบริษัทใดที่จะส่งมอบสิ่งที่มันไม่เคยมีได้',
  upgrade_usd_line: '≈ {usd} · ต่อ 30 วัน',
  upgrade_qr_caption: 'สแกนด้วย Zelcore / SSP Wallet',
  upgrade_field_address: 'ที่อยู่สำหรับชำระเงิน',
  upgrade_field_message: 'ข้อความ (จำเป็น)',
  upgrade_open_wallet: 'เปิดใน wallet',
  upgrade_prepay_note:
    '<strong>จ่ายล่วงหน้า:</strong> จ่ายเป็นจำนวนทวีคูณเพื่อเพิ่มจำนวนเดือนเท่านั้นในครั้งเดียว — เช่น {amount} FLUX = 3 เดือน เดือนที่เพิ่มจะสะสมได้ (สูงสุด 24) คุณจึงเติมได้ทุกเมื่อ',
  upgrade_privacy_note:
    'เปิดใน Zelcore / SSP Wallet การชำระเงินจะถูกตรวจสอบบนบล็อกเชนของ Flux — เราไม่มีทางรู้เลยว่าคุณเป็นใคร ข้อความคือสิ่งที่ผูกการชำระเงินเข้ากับคีย์ของคุณ หากส่งโดยไม่มีข้อความ เงินจะมาถึงแต่จะไม่มีอะไรถูกปลดล็อก',
  upgrade_back: '← กลับไปที่เชื่อมต่อ',

  upgrade_eyebrow_card: 'หรือจ่ายด้วยบัตร',
  upgrade_card_lede:
    'สมัครสมาชิกด้วยบัตร, Apple Pay หรือ Google Pay ขั้นตอนชำระเงินดำเนินการโดย Stripe — เราไม่มีทางเห็นบัตรของคุณ พรีเมียมของคุณยังคงถูกเปิดใช้งานบนบล็อกเชนของ Flux โดยผูกกับรหัสการชำระเงินนิรนามของคุณเท่านั้น',
  upgrade_plan_aria: 'แผนสมัครสมาชิก',
  upgrade_plan_monthly: '{usd} / เดือน',
  upgrade_plan_annual: '{usd} / ปี',
  upgrade_card_cta: 'จ่ายด้วยบัตร',
  upgrade_card_cta_busy: 'กำลังเปิดหน้าชำระเงินที่ปลอดภัย…',
  upgrade_card_error: 'เปิดหน้าชำระเงินไม่ได้ โปรดลองอีกครั้งในอีกสักครู่',
  upgrade_card_note:
    'ต่ออายุอัตโนมัติ ยกเลิกได้ทุกเมื่อจากอีเมลใบเสร็จของ Stripe การจ่ายด้วย FLUX ด้านบนถูกกว่า — ราคาแบบบัตรรวมค่าธรรมเนียมการประมวลผลแล้ว',
  upgrade_activating_title: 'กำลังเปิดใช้งานพรีเมียมของคุณ…',
  upgrade_state_pending: 'ได้รับการชำระเงินแล้ว — กำลังเตรียมการเปิดใช้งานของคุณบนเครือข่าย Flux',
  upgrade_state_broadcast: 'ส่งการเปิดใช้งานไปยังเครือข่าย Flux แล้ว — กำลังรอการยืนยัน',
  upgrade_state_confirmed:
    'ยืนยันแล้ว! ความเร็วเต็มสปีดจะปลดล็อกบนเซิร์ฟเวอร์ทั้งหมดภายในหนึ่งนาที',
  upgrade_state_failed:
    'เกิดข้อผิดพลาดระหว่างการเปิดใช้งาน การชำระเงินของคุณปลอดภัย — เราลองใหม่ให้อัตโนมัติ และพรีเมียมของคุณจะปรากฏในไม่ช้า',
  upgrade_activating_hint: 'คุณปิดหน้านี้ได้เลย — การเปิดใช้งานจะเสร็จสมบูรณ์เอง',
  upgrade_activated_cta: 'กลับไปที่เชื่อมต่อ →',

  split_summary_title: 'ขั้นสูง: split tunneling',
  split_tier_pill: 'พรีเมียม · ตัวเลือก',
  split_lede:
    'เลือกว่าปลายทางใดใช้ VPN คอนฟิกที่สร้างขึ้นแสดงกฎเป็น AllowedIPs ของ WireGuard จึงใช้ได้กับแอป WireGuard มาตรฐาน — รองรับเฉพาะช่วง IP และการข้ามเครือข่ายท้องถิ่น (กฎรายแอปต้องใช้แอปเนทีฟของเรา)',
  split_mode_aria: 'โหมด split tunneling',
  split_mode_off: 'ปิด',
  split_mode_exclude: 'ยกเว้นรายการ',
  split_mode_include: 'เฉพาะรายการนี้',
  split_warn_exclude:
    'ทราฟฟิกที่ยกเว้นจะออกจากอุปกรณ์ของคุณโดยไม่มีการป้องกันและเผยที่อยู่ IP จริงของคุณ',
  split_warn_include:
    'เฉพาะปลายทางในรายการเท่านั้นที่ได้รับการป้องกัน — อย่างอื่นทั้งหมดเผยที่อยู่ IP จริงของคุณ',
  split_lan_label: 'อนุญาตการเข้าถึงเครือข่ายท้องถิ่น (เครื่องพิมพ์, NAS, แคสต์)',
  split_cidr_placeholder: 'เช่น 192.168.0.0/16 หรือ 203.0.113.7',
  split_cidr_aria: 'ที่อยู่ IP หรือช่วง CIDR',
  split_add: 'เพิ่ม',
  split_input_invalid: 'ไม่ใช่ที่อยู่ IP หรือช่วง CIDR ที่ถูกต้อง',
  split_rules_empty: 'ยังไม่มีกฎ IP — เพิ่มช่วงด้านบน หรือใช้เพียงการเข้าถึงเครือข่ายท้องถิ่น',
  split_remove_aria: 'ลบกฎ {value}',
  split_next_note: 'กฎจะมีผลกับคอนฟิกถัดไปที่คุณสร้างในหน้านี้',
  split_premium_required:
    'Split tunneling เป็นฟีเจอร์พรีเมียม ระบบสร้างคอนฟิกอุโมงค์เต็มแทน — อัปเกรดเพื่อใช้กฎของคุณ',
  split_applied: 'ใช้ split tunneling แล้ว — คอนฟิกนี้กำหนดเส้นทางเฉพาะที่กฎของคุณอนุญาต',

  multihop_summary_title: 'ขั้นสูง: multi-hop (config สองชุด)',
  multihop_tier_pill: 'พรีเมียม · เลือกเปิดใช้เอง',
  multihop_lede:
    'กำหนดเส้นทางผ่านสองเกตเวย์ เพื่อให้ <strong>ไม่มีเซิร์ฟเวอร์เดียวที่รู้ทั้งว่าคุณเป็นใครและกำลังไปที่ไหน</strong> วิธีนี้ช้ากว่าและเพิ่ม latency — คาดว่าจะได้ <strong>ปิง 2×</strong> เมื่อเทียบกับ single-hop และปริมาณงานสูงสุดจะลดลงเพราะการเข้ารหัสสองชั้น multi-hop เป็นฟีเจอร์พรีเมียม แต่การชำระเงินเพียง <mono>$0.99</mono> ครั้งเดียวครอบคลุมทั้งสอง hop (คีย์ K เดียวกันจะกลายเป็นพรีเมียมทั้งที่ entry และ exit โดยอัตโนมัติ) ปิดใช้งานเป็นค่าเริ่มต้น — โฟลว์ single-hop ด้านบนยังคงเป็นหลัก',
  multihop_entry_label: 'ประเทศ entry (เห็น IP ของคุณ)',
  multihop_entry_aria: 'ประเทศ entry',
  multihop_exit_label: 'ประเทศ exit (เห็นปลายทางของคุณ)',
  multihop_exit_aria: 'ประเทศ exit',
  multihop_style_same: 'รูปแบบเส้นทาง: สมดุล — ประเทศเดียวกัน (เขตอำนาจศาลเดียว)',
  multihop_style_cross:
    'รูปแบบเส้นทาง: ความเป็นส่วนตัวสูงสุด — ข้ามเขตอำนาจศาล (สองผู้ให้บริการ สองประเทศ)',
  multihop_enrolling: 'กำลังลงทะเบียนทั้งสอง hop…',
  multihop_generate: 'สร้าง config สองชุด',
  multihop_error_no_exit: 'multi-hop ต้องการเกตเวย์ exit ที่แยกต่างหาก แต่ไม่พบเกตเวย์ที่เหมาะสม',
  multihop_error_no_gateways:
    'ไม่มีเกตเวย์ที่ใช้งานได้จากเบราว์เซอร์ จึงไม่สามารถกำหนดเส้นทางได้ การซ้อน multi-hop จริง ๆ แล้วเป็นฟีเจอร์เฉพาะแอปของเรา — ไคลเอนต์เดสก์ท็อปและมือถือ (core เดียวกัน) จะตรวจสอบเกตเวย์โดยตรงและรัน tunnel ทั้งสองให้คุณ',
  multihop_error_failed: 'สร้าง multi-hop ไม่สำเร็จ',
  multihop_internet: 'อินเทอร์เน็ต',
  multihop_conf_outer_tag: 'ชั้นนอก · MTU 1420',
  multihop_conf_inner_tag: 'ชั้นใน · MTU {mtu}',
  multihop_download_entry: 'ดาวน์โหลด wg-entry.conf',
  multihop_download_exit: 'ดาวน์โหลด wg-exit.conf',
  multihop_note:
    '<strong>วิธีกำหนดเส้นทางสิ่งเหล่านี้ (บันทึกที่ตรงไปตรงมา)</strong> การซ้อนแบบแท้จริงด้วยแอป WireGuard มาตรฐานนั้นยุ่งยาก — มันรัน tunnel ได้ทีละหนึ่งเท่านั้น — ดังนั้น multi-hop จริง ๆ แล้วคือ <strong>ฟีเจอร์เฉพาะแอปของเรา</strong> (เดสก์ท็อป/มือถือจะเชื่อม tunnel ทั้งสองให้คุณ) สำหรับการตั้งค่าด้วยตนเอง คุณต้องเปิด <mono>wg-entry.conf</mono> ก่อน จากนั้นกำหนดเส้นทางเฉพาะที่อยู่ของ exit <mono>{exitIp}/32</mono> ผ่าน tunnel entry นั้น แล้วส่งที่เหลือผ่าน <mono>wg-exit.conf</mono> (MTU ชั้นใน {mtu} เพื่อให้ใส่ header ของ WireGuard สองชุดได้พอดี) exit endpoint: <mono>{endpoint}</mono><br/><strong>ข้อจำกัดของ v1:</strong> ทั้งสอง hop ใช้คีย์ K เดียวกัน ซึ่งทำให้ผู้ให้บริการ <em>รายเดียว</em> ไม่สามารถล่วงรู้ได้ แต่หมายความว่าผู้ประสงค์ร้ายที่ควบคุม hop <em>ทั้งสอง</em> ของคุณจะสามารถเชื่อมโยงได้ผ่านคีย์ที่ใช้ร่วมกันนั้น คีย์ที่แยกกันในแต่ละ hop จะมาถึงใน v1.5',
};
