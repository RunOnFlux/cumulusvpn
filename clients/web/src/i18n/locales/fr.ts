import type { Catalog } from '../index';

export const fr: Catalog = {
  app_title: 'CumulusVPN — Internet privé, sans compte, sans journaux',

  header_nav_connect: 'Connexion',
  header_nav_upgrade: 'Passer en premium',
  header_theme_label: 'Thème : {mode}',
  header_theme_system: 'système',
  header_theme_light: 'clair',
  header_theme_dark: 'sombre',
  header_language_label: 'Langue',

  footer_tagline: 'CumulusVPN — VPN décentralisé sur Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Filière bêta · sans compte · sans journaux',

  common_copy: 'Copier',
  common_copied: 'Copié',
  common_qr_alt: 'Code QR',
  common_powered_by_flux_link: 'Powered by Flux — ouvre runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'amorce',
  common_directory: 'annuaire',

  error_gateway_rejected: "La passerelle a rejeté l'inscription ({slug}) : {message}",

  countries_search_placeholder: '🔎  Rechercher parmi {n} pays…',
  countries_search_label: 'Rechercher un pays',
  countries_list_label: 'Pays',
  countries_no_match: 'Aucun pays ne correspond à « {query} ».',
  countries_nodes: { one: '{n} nœud', other: '{n} nœuds' },

  connect_eyebrow: 'Filière bêta · configuration WireGuard',
  connect_title: 'Une clé, <glow>toutes les passerelles.</glow>',
  connect_lede:
    'Votre paire de clés WireGuard est générée ici, dans votre navigateur — la clé privée ne quitte jamais cet onglet. Choisissez un pays, inscrivez-vous sur la passerelle Flux la plus proche et exportez un<mono> .conf</mono> prêt à importer avec son QR. Gratuit à vie à 100 KB/s ; <upgrade>passez en premium avec FLUX</upgrade> pour la pleine vitesse.',
  connect_verify_warn:
    "La signature de l'annuaire n'a pas pu être vérifiée — les points de terminaison sont affichés à titre informatif uniquement.",
  connect_notice_no_live_gateway:
    "Aucune passerelle active accessible depuis le navigateur. Les pays de l'annuaire signé sont affichés — les configurations s'inscrivent sur une passerelle active dès qu'une devient disponible.",
  connect_choose_location: 'Choisissez un emplacement',
  connect_tier_free: 'GRATUIT · 100 KB/s',
  connect_loading_directory: "Résolution de l'annuaire signé et découverte des passerelles…",
  connect_your_config: 'Votre configuration',
  connect_source_directory: 'Annuaire {source}',
  connect_live_nodes: { one: '{n} nœud actif', other: '{n} nœuds actifs' },
  connect_select_country: 'Sélectionnez un pays pour continuer',
  connect_enrolling: 'Inscription…',
  connect_generate: 'Générer le .conf',
  connect_no_gateway_in_country:
    "Aucune passerelle active accessible dans {country} depuis le navigateur. L'inscription est envoyée à l'API de contrôle d'une passerelle (http :51821), inaccessible depuis les pages https — cela fonctionne depuis les clients desktop et mobile, qui partagent ce même cœur.",
  connect_error_enroll_failed: "Échec de l'inscription.",
  connect_qr_caption: "Scannez avec l'app WireGuard",
  connect_stat_assigned_ip: 'IP attribuée',
  connect_stat_endpoint: 'Point de terminaison',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Télécharger le .conf',
  connect_upgrade_cta: 'Passer en premium pour la pleine vitesse →',
  connect_identity_title: 'Identité de cet appareil',
  connect_regenerate: 'Régénérer la clé',
  connect_identity_note:
    "Une paire de clés par appareil s'inscrit sur de nombreuses passerelles ; le premium suit la clé sur toutes via la chaîne. Le code de paiement ci-dessous relie un paiement en FLUX à cette clé.",
  connect_field_public_key: 'Clé publique WireGuard',
  connect_field_payment_code: 'Code de paiement (mémo)',

  upgrade_loading: 'Chargement des détails de paiement…',
  upgrade_eyebrow: 'Premium · payez en FLUX',
  upgrade_title: 'Passez à la vitesse maximale',
  upgrade_lede:
    'Envoyez FLUX avec le message exact ci-dessous. Chaque passerelle scanne la chaîne et débloque votre clé en ~1 minute — sur tous les serveurs à la fois, pendant 30 jours. Sans compte, sans carte, sans aucune société capable de livrer ce qu\'elle n\'a jamais eu.',
  upgrade_usd_line: '≈ {usd} · tous les 30 jours',
  upgrade_qr_caption: 'Scannez avec Zelcore / SSP Wallet',
  upgrade_field_address: 'Adresse de paiement',
  upgrade_field_message: 'Message (obligatoire)',
  upgrade_open_wallet: 'Ouvrir dans le wallet',
  upgrade_prepay_note:
    '<strong>Prépayez à l\'avance :</strong> payez un multiple du montant pour ajouter autant de mois d\'un coup — p. ex. {amount} FLUX = 3 mois. Les mois supplémentaires se cumulent (jusqu\'à 24), vous pouvez donc recharger à tout moment.',
  upgrade_privacy_note:
    "S'ouvre dans Zelcore / SSP Wallet. Le paiement est vérifié sur la blockchain Flux — nous ne voyons jamais qui vous êtes. Le message relie le paiement à votre clé ; l'envoyer sans lui fait arriver les fonds, mais rien ne se débloque.",
  upgrade_back: '← Retour à Connexion',

  multihop_summary_title: 'Avancé : multi-hop (deux configurations)',
  multihop_tier_pill: 'PREMIUM · OPTIONNEL',
  multihop_lede:
    "Routez via deux passerelles pour qu'<strong>aucun serveur unique ne voie à la fois qui vous êtes et où vous allez</strong>. C'est plus lent et ajoute de la latence — comptez environ <strong>2× le ping</strong> par rapport au saut unique, avec un débit de pointe plus faible à cause du double chiffrement. Le multi-hop est premium, mais un seul paiement de <mono>$0.99</mono> couvre les deux sauts (la même clé K devient premium à l'entrée et à la sortie automatiquement). Désactivé par défaut — le flux à saut unique ci-dessus reste le mode principal.",
  multihop_entry_label: "Pays d'entrée (voit votre IP)",
  multihop_entry_aria: "Pays d'entrée",
  multihop_exit_label: 'Pays de sortie (voit votre destination)',
  multihop_exit_aria: 'Pays de sortie',
  multihop_style_same: 'Style de route : équilibré — même pays (une seule juridiction)',
  multihop_style_cross:
    'Style de route : confidentialité maximale — inter-juridictions (deux opérateurs, deux pays)',
  multihop_enrolling: 'Inscription des deux sauts…',
  multihop_generate: 'Générer les deux configurations',
  multihop_error_no_exit: "Le multi-hop nécessite une passerelle de sortie distincte ; aucune n'a été résolue.",
  multihop_error_no_gateways:
    "Aucune passerelle active accessible depuis le navigateur, donc aucune route n'a pu être résolue. L'imbrication multi-hop est en réalité une fonctionnalité de nos apps — les clients desktop et mobile (même cœur) sondent les passerelles directement et font tourner les deux tunnels pour vous.",
  multihop_error_failed: 'Échec de la génération multi-hop.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'externe · MTU 1420',
  multihop_conf_inner_tag: 'interne · MTU {mtu}',
  multihop_download_entry: 'Télécharger wg-entry.conf',
  multihop_download_exit: 'Télécharger wg-exit.conf',
  multihop_note:
    "<strong>Comment router tout ça (note honnête).</strong> Une vraie imbrication avec l'app WireGuard standard est peu pratique — elle ne fait tourner qu'un tunnel à la fois — donc le multi-hop est en réalité une <strong>fonctionnalité de nos apps</strong> (desktop/mobile enchaînent les deux tunnels pour vous). Pour une configuration manuelle, montez d'abord <mono>wg-entry.conf</mono>, puis routez uniquement l'adresse de sortie <mono>{exitIp}/32</mono> via ce tunnel d'entrée et envoyez le reste via <mono>wg-exit.conf</mono> (MTU interne {mtu}, pour que les deux en-têtes WireGuard tiennent). Point de terminaison de sortie : <mono>{endpoint}</mono>.<br/><strong>Réserve v1 :</strong> les deux sauts utilisent la même clé K, ce qui déjoue tout opérateur <em>isolé</em>, mais un adversaire contrôlant <em>les deux</em> sauts pourrait les corréler via cette clé partagée. Des clés distinctes par saut arrivent en v1.5.",
};
