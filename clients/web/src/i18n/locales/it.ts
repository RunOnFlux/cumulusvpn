import type { Catalog } from '../index';

export const it: Catalog = {
  app_title: 'CumulusVPN — Internet privato, senza account, senza log',

  header_nav_connect: 'Connetti',
  header_nav_upgrade: 'Upgrade',
  header_theme_label: 'Tema: {mode}',
  header_theme_system: 'sistema',
  header_theme_light: 'chiaro',
  header_theme_dark: 'scuro',
  header_language_label: 'Lingua',

  footer_tagline: 'CumulusVPN — VPN decentralizzata su Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Canale beta · senza account · senza log',

  common_copy: 'Copia',
  common_copied: 'Copiato',
  common_qr_alt: 'Codice QR',
  common_powered_by_flux_link: 'Powered by Flux — apre runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'seed',
  common_directory: 'directory',

  error_gateway_rejected: "Il gateway ha rifiutato l'iscrizione ({slug}): {message}",

  countries_search_placeholder: '🔎  Cerca tra {n} paesi…',
  countries_search_label: 'Cerca paesi',
  countries_list_label: 'Paesi',
  countries_no_match: 'Nessun paese corrisponde a “{query}”.',
  countries_nodes: { one: '{n} nodo', other: '{n} nodi' },

  connect_eyebrow: 'Canale beta · configurazione WireGuard',
  connect_title: 'Una chiave, <glow>ogni gateway.</glow>',
  connect_lede:
    "La tua coppia di chiavi WireGuard viene generata qui, nel tuo browser — la chiave privata non lascia mai questa scheda. Scegli un paese, iscriviti al gateway Flux più vicino ed esporta un<mono> .conf</mono> pronto da importare con il suo QR. Gratis per sempre a 100 KB/s; <upgrade>fai l'upgrade con FLUX</upgrade> per la piena velocità.",
  connect_verify_warn:
    'Impossibile verificare la firma della directory — gli endpoint sono mostrati solo a titolo informativo.',
  connect_notice_no_live_gateway:
    'Nessun gateway attivo raggiungibile dal browser. Vengono mostrati i paesi della directory firmata — le configurazioni si iscrivono a un gateway attivo quando ne è raggiungibile uno.',
  connect_choose_location: 'Scegli una località',
  connect_tier_free: 'GRATIS · 100 KB/s',
  connect_loading_directory: 'Risoluzione della directory firmata e scoperta dei gateway…',
  connect_your_config: 'La tua configurazione',
  connect_source_directory: 'Directory {source}',
  connect_live_nodes: { one: '{n} nodo attivo', other: '{n} nodi attivi' },
  connect_select_country: 'Seleziona un paese per continuare',
  connect_enrolling: 'Iscrizione in corso…',
  connect_generate: 'Genera .conf',
  connect_no_gateway_in_country:
    "Nessun gateway attivo raggiungibile in {country} dal browser. L'iscrizione viene inviata all'API di controllo di un gateway (http :51821), non raggiungibile dalle pagine https — funziona dai client desktop e mobile, che condividono questo stesso core.",
  connect_error_enroll_failed: 'Iscrizione non riuscita.',
  connect_qr_caption: "Scansiona con l'app WireGuard",
  connect_stat_assigned_ip: 'IP assegnato',
  connect_stat_endpoint: 'Endpoint',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Scarica .conf',
  connect_conf_note:
    'Legata a questo server. Se si riavvia o cambia, WireGuard continuerà a mostrare il tunnel come connesso senza che passi nulla — torna qui e genera un nuovo .conf.',
  connect_conf_regenerate: 'Genera un nuovo .conf',
  connect_conf_stale:
    'Il server che ha emesso la tua ultima configurazione per {country} è stato sostituito: quella configurazione non può più connettersi. Generane una nuova qui sotto.',
  connect_conf_unsure:
    'Non è stato possibile raggiungere il server che ha emesso la tua ultima configurazione per {country}. Potrebbe essere temporaneamente non disponibile o sparito — se il tunnel non fa passare traffico, genera una nuova configurazione qui sotto.',
  connect_conf_checking: 'Verifica della tua ultima configurazione…',
  connect_upgrade_cta: "Fai l'upgrade alla piena velocità →",
  connect_identity_title: 'Identità di questo dispositivo',
  connect_regenerate: 'Rigenera chiave',
  connect_identity_note:
    'Una coppia di chiavi per dispositivo si iscrive a molti gateway; il premium segue la chiave su tutti tramite la chain. Il codice di pagamento qui sotto collega un pagamento in FLUX a questa chiave.',
  connect_field_public_key: 'Chiave pubblica WireGuard',
  connect_field_payment_code: 'Codice di pagamento (memo)',

  upgrade_loading: 'Caricamento dei dettagli di pagamento…',
  upgrade_eyebrow: 'Upgrade · paga in FLUX',
  upgrade_title: 'Upgrade alla piena velocità',
  upgrade_lede:
    'Invia FLUX con esattamente il messaggio qui sotto. Ogni gateway scansiona la chain e sblocca la tua chiave entro ~1 minuto — su tutti i server contemporaneamente, per 30 giorni. Senza account, senza carta, senza alcuna azienda che possa consegnare ciò che non ha mai avuto.',
  upgrade_usd_line: '≈ {usd} · ogni 30 giorni',
  upgrade_qr_caption: 'Scansiona con Zelcore / SSP Wallet',
  upgrade_field_address: 'Indirizzo di pagamento',
  upgrade_field_message: 'Messaggio (obbligatorio)',
  upgrade_open_wallet: 'Apri nel wallet',
  upgrade_prepay_note:
    "<strong>Paga in anticipo:</strong> paga un multiplo dell'importo per aggiungere altrettanti mesi in una volta — es. {amount} FLUX = 3 mesi. I mesi extra si accumulano (fino a 24), così puoi ricaricare quando vuoi.",
  upgrade_privacy_note:
    'Si apre in Zelcore / SSP Wallet. Il pagamento è verificato sulla blockchain di Flux — non vediamo mai chi sei. Il messaggio collega il pagamento alla tua chiave; inviarlo senza significa che i fondi arrivano ma nulla si sblocca.',
  upgrade_back: '← Torna a Connetti',

  upgrade_eyebrow_card: 'Oppure paga con carta',
  upgrade_card_lede:
    'Abbonati con carta, Apple Pay o Google Pay. Il checkout è gestito da Stripe — non vediamo mai la tua carta. Il tuo premium viene comunque attivato sulla blockchain di Flux, legato solo al tuo codice di pagamento anonimo.',
  upgrade_plan_aria: 'Piano di abbonamento',
  upgrade_plan_monthly: '{usd} / mese',
  upgrade_plan_annual: '{usd} / anno',
  upgrade_card_cta: 'Paga con carta',
  upgrade_card_cta_busy: 'Apertura del checkout sicuro…',
  upgrade_card_error: 'Impossibile aprire il checkout. Riprova tra un momento.',
  upgrade_card_note:
    "Si rinnova automaticamente; disdici quando vuoi dall'email di ricevuta Stripe. Pagare in FLUX qui sopra costa meno — il prezzo con carta copre le commissioni di elaborazione.",
  upgrade_activating_title: 'Attivazione del tuo premium…',
  upgrade_state_pending: 'Pagamento ricevuto — prepariamo la tua attivazione sulla rete Flux.',
  upgrade_state_broadcast: 'Attivazione inviata alla rete Flux — in attesa di conferma.',
  upgrade_state_confirmed:
    'Confermato! La piena velocità si sblocca su tutti i server entro un minuto.',
  upgrade_state_failed:
    "Qualcosa è andato storto durante l'attivazione. Il tuo pagamento è al sicuro — riproviamo automaticamente e il tuo premium comparirà a breve.",
  upgrade_activating_hint: "Puoi chiudere questa pagina — l'attivazione si completa da sola.",
  upgrade_activated_cta: 'Torna a Connetti →',

  split_summary_title: 'Avanzato: split tunneling',
  split_tier_pill: 'PREMIUM · OPT-IN',
  split_lede:
    'Scegli quali destinazioni usano la VPN. La configurazione generata esprime le regole come AllowedIPs di WireGuard, quindi funziona con l’app WireGuard standard — solo intervalli IP e bypass della rete locale (le regole per app richiedono le nostre app native).',
  split_mode_aria: 'Modalità split tunneling',
  split_mode_off: 'Disattivato',
  split_mode_exclude: 'Escludi elencati',
  split_mode_include: 'Solo questi',
  split_warn_exclude:
    'Il traffico escluso lascia il tuo dispositivo senza protezione e mostra il tuo vero indirizzo IP.',
  split_warn_include:
    'Solo le destinazioni elencate sono protette — tutto il resto mostra il tuo vero indirizzo IP.',
  split_lan_label: 'Consenti accesso alla rete locale (stampanti, NAS, casting)',
  split_cidr_placeholder: 'es. 192.168.0.0/16 o 203.0.113.7',
  split_cidr_aria: 'Indirizzo IP o intervallo CIDR',
  split_add: 'Aggiungi',
  split_input_invalid: 'Indirizzo IP o intervallo CIDR non valido.',
  split_rules_empty:
    'Ancora nessuna regola IP — aggiungi un intervallo sopra, o usa semplicemente l’accesso alla rete locale.',
  split_remove_aria: 'Rimuovi la regola {value}',
  split_next_note:
    'Le regole si applicano alla prossima configurazione che generi su questa pagina.',
  split_premium_required:
    'Lo split tunneling è una funzione premium. È stata generata una configurazione full-tunnel — passa a premium per applicare le tue regole.',
  split_applied:
    'Split tunneling applicato — questa configurazione instrada solo ciò che le tue regole consentono.',

  multihop_summary_title: 'Avanzato: multi-hop (due configurazioni)',
  multihop_tier_pill: 'PREMIUM · OPZIONALE',
  multihop_lede:
    'Instrada attraverso due gateway così che <strong>nessun singolo server veda sia chi sei sia dove vai</strong>. È più lento e aggiunge latenza — aspettati circa <strong>2× il ping</strong> rispetto al single-hop, e un throughput di picco inferiore per la doppia cifratura. Il multi-hop è premium, ma un unico pagamento di <mono>$0.99</mono> copre entrambi gli hop (la stessa chiave K diventa premium in entrata e in uscita automaticamente). Disattivato di default — il flusso single-hop qui sopra resta quello principale.',
  multihop_entry_label: 'Paese di ingresso (vede il tuo IP)',
  multihop_entry_aria: 'Paese di ingresso',
  multihop_exit_label: 'Paese di uscita (vede la tua destinazione)',
  multihop_exit_aria: 'Paese di uscita',
  multihop_style_same: 'Stile del percorso: bilanciato — stesso paese (una sola giurisdizione)',
  multihop_style_cross:
    'Stile del percorso: massima privacy — tra giurisdizioni (due operatori, due paesi)',
  multihop_enrolling: 'Iscrizione di entrambi gli hop…',
  multihop_generate: 'Genera due configurazioni',
  multihop_error_no_exit:
    'Il multi-hop richiede un gateway di uscita distinto; nessuno è stato risolto.',
  multihop_error_no_gateways:
    "Nessun gateway attivo raggiungibile dal browser, quindi non è stato possibile risolvere alcun percorso. L'annidamento multi-hop è in realtà una funzione delle nostre app — i client desktop e mobile (stesso core) verificano i gateway direttamente e gestiscono i due tunnel al posto tuo.",
  multihop_error_failed: 'Generazione multi-hop non riuscita.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'esterno · MTU 1420',
  multihop_conf_inner_tag: 'interno · MTU {mtu}',
  multihop_download_entry: 'Scarica wg-entry.conf',
  multihop_download_exit: 'Scarica wg-exit.conf',
  multihop_note:
    "<strong>Come instradarlo (nota onesta).</strong> Un vero annidamento con l'app WireGuard standard è scomodo — esegue un solo tunnel alla volta — quindi il multi-hop è in realtà una <strong>funzione delle nostre app</strong> (desktop/mobile incatenano i due tunnel al posto tuo). Per una configurazione manuale devi prima attivare <mono>wg-entry.conf</mono>, poi instradare solo l'indirizzo di uscita <mono>{exitIp}/32</mono> tramite quel tunnel di ingresso e inviare il resto tramite <mono>wg-exit.conf</mono> (MTU interna {mtu}, così ci stanno due header WireGuard). Endpoint di uscita: <mono>{endpoint}</mono>.<br/><strong>Avvertenza v1:</strong> entrambi gli hop usano la stessa chiave K, il che vanifica qualsiasi operatore <em>singolo</em>, ma significa che un avversario che controlli <em>entrambi</em> i tuoi hop potrebbe correlarli tramite quella chiave condivisa. Chiavi distinte per hop arrivano nella v1.5.",
};
