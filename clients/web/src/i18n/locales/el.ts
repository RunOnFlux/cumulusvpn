import type { Catalog } from '../index';

export const el: Catalog = {
  app_title: 'CumulusVPN — Ιδιωτικό ίντερνετ, χωρίς λογαριασμό, χωρίς logs',

  header_nav_connect: 'Σύνδεση',
  header_nav_upgrade: 'Αναβάθμιση',
  header_theme_label: 'Θέμα: {mode}',
  header_theme_system: 'σύστημα',
  header_theme_light: 'ανοιχτό',
  header_theme_dark: 'σκούρο',
  header_language_label: 'Γλώσσα',

  footer_tagline: 'CumulusVPN — Αποκεντρωμένο VPN πάνω σε Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Δίαυλος beta · χωρίς λογαριασμό · χωρίς logs',

  common_copy: 'Αντιγραφή',
  common_copied: 'Αντιγράφηκε',
  common_qr_alt: 'Κωδικός QR',
  common_powered_by_flux_link: 'Powered by Flux — ανοίγει το runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'seed',
  common_directory: 'κατάλογος',

  error_gateway_rejected: 'Η πύλη απέρριψε την εγγραφή ({slug}): {message}',

  countries_search_placeholder: '🔎  Αναζήτηση σε {n} χώρες…',
  countries_search_label: 'Αναζήτηση χωρών',
  countries_list_label: 'Χώρες',
  countries_no_match: 'Καμία χώρα δεν ταιριάζει με «{query}».',
  countries_nodes: { one: '{n} κόμβος', other: '{n} κόμβοι' },

  connect_eyebrow: 'Δίαυλος beta · ρύθμιση WireGuard',
  connect_title: 'Ένα κλειδί, <glow>κάθε πύλη.</glow>',
  connect_lede:
    'Το ζεύγος κλειδιών WireGuard δημιουργείται εδώ, στο πρόγραμμα περιήγησής σου — το ιδιωτικό κλειδί δεν φεύγει ποτέ από αυτή την καρτέλα. Επίλεξε μια χώρα, εγγράψου στην κοντινότερη πύλη Flux και εξήγαγε ένα έτοιμο για εισαγωγή<mono> .conf</mono> μαζί με το QR του. Δωρεάν για πάντα στα 100 KB/s· <upgrade>αναβάθμισε με FLUX</upgrade> για πλήρη ταχύτητα.',
  connect_verify_warn:
    'Δεν ήταν δυνατή η επαλήθευση της υπογραφής του καταλόγου — τα endpoints εμφανίζονται μόνο ενημερωτικά.',
  connect_notice_no_live_gateway:
    'Δεν υπάρχει προσβάσιμη ενεργή πύλη από το πρόγραμμα περιήγησης. Εμφανίζονται οι χώρες του υπογεγραμμένου καταλόγου — οι ρυθμίσεις εγγράφονται σε ενεργή πύλη μόλις γίνει προσβάσιμη μία.',
  connect_choose_location: 'Επίλεξε τοποθεσία',
  connect_tier_free: 'ΔΩΡΕΑΝ · 100 KB/s',
  connect_loading_directory: 'Ανάλυση του υπογεγραμμένου καταλόγου και ανίχνευση πυλών…',
  connect_your_config: 'Η ρύθμισή σου',
  connect_source_directory: 'Κατάλογος {source}',
  connect_live_nodes: { one: '{n} ενεργός κόμβος', other: '{n} ενεργοί κόμβοι' },
  connect_select_country: 'Επίλεξε χώρα για να συνεχίσεις',
  connect_enrolling: 'Γίνεται εγγραφή…',
  connect_generate: 'Δημιουργία .conf',
  connect_no_gateway_in_country:
    'Δεν υπάρχει προσβάσιμη ενεργή πύλη στη χώρα {country} από το πρόγραμμα περιήγησης. Η εγγραφή στέλνεται στο API ελέγχου μιας πύλης (http :51821), στο οποίο δεν έχουν πρόσβαση οι σελίδες https — αυτό λειτουργεί από τους πελάτες desktop και κινητού που μοιράζονται αυτόν τον πυρήνα.',
  connect_error_enroll_failed: 'Η εγγραφή απέτυχε.',
  connect_qr_caption: 'Σάρωσε με την εφαρμογή WireGuard',
  connect_stat_assigned_ip: 'Ανατεθειμένη IP',
  connect_stat_endpoint: 'Endpoint',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Λήψη .conf',
  connect_upgrade_cta: 'Αναβάθμιση σε πλήρη ταχύτητα →',
  connect_identity_title: 'Ταυτότητα αυτής της συσκευής',
  connect_regenerate: 'Επαναδημιουργία κλειδιού',
  connect_identity_note:
    'Ένα ζεύγος κλειδιών ανά συσκευή εγγράφεται σε πολλές πύλες· το premium ακολουθεί το κλειδί σε όλες μέσω του chain. Ο παρακάτω κωδικός πληρωμής συνδέει μια πληρωμή σε FLUX με αυτό το κλειδί.',
  connect_field_public_key: 'Δημόσιο κλειδί WireGuard',
  connect_field_payment_code: 'Κωδικός πληρωμής (memo)',

  upgrade_loading: 'Φόρτωση στοιχείων πληρωμής…',
  upgrade_eyebrow: 'Αναβάθμιση · πληρωμή σε FLUX',
  upgrade_title: 'Αναβάθμιση σε πλήρη ταχύτητα',
  upgrade_lede:
    'Στείλε FLUX με ακριβώς το παρακάτω μήνυμα. Κάθε πύλη σαρώνει το chain και ξεκλειδώνει το κλειδί σου μέσα σε ~1 λεπτό — σε όλους τους διακομιστές ταυτόχρονα, για 30 ημέρες. Χωρίς λογαριασμό, χωρίς κάρτα, χωρίς καμία εταιρεία που να μπορεί να παραδώσει κάτι που ποτέ δεν είχε.',
  upgrade_usd_line: '≈ {usd} · ανά 30 ημέρες',
  upgrade_qr_caption: 'Σάρωσε με Zelcore / SSP Wallet',
  upgrade_field_address: 'Διεύθυνση πληρωμής',
  upgrade_field_message: 'Μήνυμα (υποχρεωτικό)',
  upgrade_open_wallet: 'Άνοιγμα στο wallet',
  upgrade_prepay_note:
    '<strong>Προπλήρωσε εκ των προτέρων:</strong> πλήρωσε πολλαπλάσιο του ποσού για να προσθέσεις αντίστοιχους μήνες μονομιάς — π.χ. {amount} FLUX = 3 μήνες. Οι επιπλέον μήνες συσσωρεύονται (έως 24), οπότε μπορείς να ανανεώνεις όποτε θέλεις.',
  upgrade_privacy_note:
    'Ανοίγει στο Zelcore / SSP Wallet. Η πληρωμή επαληθεύεται στο blockchain του Flux — δεν βλέπουμε ποτέ ποιος είσαι. Το μήνυμα συνδέει την πληρωμή με το κλειδί σου· αν το στείλεις χωρίς αυτό, τα χρήματα φτάνουν αλλά τίποτα δεν ξεκλειδώνει.',
  upgrade_back: '← Πίσω στη Σύνδεση',

  multihop_summary_title: 'Για προχωρημένους: multi-hop (δύο ρυθμίσεις)',
  multihop_tier_pill: 'PREMIUM · ΠΡΟΑΙΡΕΤΙΚΟ',
  multihop_lede:
    'Δρομολόγησε μέσω δύο πυλών ώστε <strong>κανένας μεμονωμένος διακομιστής να μη βλέπει ταυτόχρονα ποιος είσαι και πού πηγαίνεις</strong>. Είναι πιο αργό και προσθέτει καθυστέρηση — περίμενε περίπου <strong>2× ping</strong> σε σχέση με το single-hop, και χαμηλότερη μέγιστη ρυθμαπόδοση λόγω της διπλής κρυπτογράφησης. Το multi-hop είναι premium λειτουργία, αλλά μία μόνο πληρωμή <mono>$0.99</mono> καλύπτει και τα δύο hops (το ίδιο κλειδί K γίνεται αυτόματα premium στην είσοδο και στην έξοδο). Απενεργοποιημένο εξ ορισμού — η παραπάνω ροή single-hop παραμένει η βασική.',
  multihop_entry_label: 'Χώρα εισόδου (βλέπει την IP σου)',
  multihop_entry_aria: 'Χώρα εισόδου',
  multihop_exit_label: 'Χώρα εξόδου (βλέπει τον προορισμό σου)',
  multihop_exit_aria: 'Χώρα εξόδου',
  multihop_style_same: 'Στυλ διαδρομής: ισορροπημένο — ίδια χώρα (μία δικαιοδοσία)',
  multihop_style_cross:
    'Στυλ διαδρομής: μέγιστο απόρρητο — μεταξύ δικαιοδοσιών (δύο πάροχοι, δύο χώρες)',
  multihop_enrolling: 'Εγγραφή και των δύο hops…',
  multihop_generate: 'Δημιουργία δύο ρυθμίσεων',
  multihop_error_no_exit: 'Το multi-hop χρειάζεται ξεχωριστή πύλη εξόδου· δεν βρέθηκε καμία.',
  multihop_error_no_gateways:
    'Δεν υπάρχει προσβάσιμη ενεργή πύλη από το πρόγραμμα περιήγησης, οπότε δεν ήταν δυνατή η επίλυση καμίας διαδρομής. Η ενσωμάτωση multi-hop είναι στην πραγματικότητα λειτουργία των εφαρμογών μας — οι πελάτες desktop και κινητού (ίδιος πυρήνας) ελέγχουν τις πύλες απευθείας και τρέχουν τα δύο tunnel για σένα.',
  multihop_error_failed: 'Η δημιουργία multi-hop απέτυχε.',
  multihop_internet: 'διαδίκτυο',
  multihop_conf_outer_tag: 'εξωτερικό · MTU 1420',
  multihop_conf_inner_tag: 'εσωτερικό · MTU {mtu}',
  multihop_download_entry: 'Λήψη wg-entry.conf',
  multihop_download_exit: 'Λήψη wg-exit.conf',
  multihop_note:
    '<strong>Πώς να το δρομολογήσεις (ειλικρινής σημείωση).</strong> Η πραγματική ενσωμάτωση με τη βασική εφαρμογή WireGuard είναι δύσχρηστη — τρέχει μόνο ένα tunnel τη φορά — οπότε το multi-hop είναι στην πραγματικότητα <strong>λειτουργία των εφαρμογών μας</strong> (desktop/κινητό αλυσιδώνουν τα δύο tunnel για σένα). Για χειροκίνητη ρύθμιση πρέπει πρώτα να ενεργοποιήσεις το <mono>wg-entry.conf</mono>, μετά να δρομολογήσεις μόνο τη διεύθυνση εξόδου <mono>{exitIp}/32</mono> μέσω αυτού του tunnel εισόδου και να στείλεις τα υπόλοιπα μέσω του <mono>wg-exit.conf</mono> (εσωτερικό MTU {mtu}, ώστε να χωρούν δύο κεφαλίδες WireGuard). Endpoint εξόδου: <mono>{endpoint}</mono>.<br/><strong>Επιφύλαξη v1:</strong> και τα δύο hops χρησιμοποιούν το ίδιο κλειδί K, κάτι που εξουδετερώνει κάθε <em>μεμονωμένο</em> πάροχο, αλλά σημαίνει ότι ένας αντίπαλος που ελέγχει <em>και τα δύο</em> hops σου θα μπορούσε να τα συσχετίσει μέσω αυτού του κοινού κλειδιού. Ξεχωριστά κλειδιά ανά hop έρχονται στην v1.5.',
};
