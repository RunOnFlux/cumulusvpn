import type { Catalog } from '../index';

export const es: Catalog = {
  app_title: 'CumulusVPN — Internet privado, sin cuenta, sin registros',

  header_nav_connect: 'Conectar',
  header_nav_upgrade: 'Mejorar',
  header_theme_label: 'Tema: {mode}',
  header_theme_system: 'sistema',
  header_theme_light: 'claro',
  header_theme_dark: 'oscuro',
  header_language_label: 'Idioma',

  footer_tagline: 'CumulusVPN — VPN descentralizada en Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Vía beta · sin cuenta · sin registros',

  common_copy: 'Copiar',
  common_copied: 'Copiado',
  common_qr_alt: 'Código QR',
  common_powered_by_flux_link: 'Powered by Flux — abre runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'semilla',
  common_directory: 'directorio',

  error_gateway_rejected: 'El gateway rechazó la inscripción ({slug}): {message}',

  countries_search_placeholder: '🔎  Buscar entre {n} países…',
  countries_search_label: 'Buscar países',
  countries_list_label: 'Países',
  countries_no_match: 'Ningún país coincide con “{query}”.',
  countries_nodes: { one: '{n} nodo', other: '{n} nodos' },

  connect_eyebrow: 'Vía beta · configuración WireGuard',
  connect_title: 'Una clave, <glow>todos los gateways.</glow>',
  connect_lede:
    'Tu par de claves WireGuard se genera aquí, en tu navegador — la clave privada nunca sale de esta pestaña. Elige un país, inscríbete en el gateway Flux más cercano y exporta un<mono> .conf</mono> listo para importar junto con su QR. Gratis para siempre a 100 KB/s; <upgrade>mejora con FLUX</upgrade> para velocidad completa.',
  connect_verify_warn:
    'No se pudo verificar la firma del directorio — los endpoints se muestran solo a título informativo.',
  connect_notice_no_live_gateway:
    'No hay ningún gateway activo accesible desde el navegador. Se muestran los países del directorio firmado — las configuraciones se inscriben en un gateway activo cuando hay uno disponible.',
  connect_choose_location: 'Elige una ubicación',
  connect_tier_free: 'GRATIS · 100 KB/s',
  connect_loading_directory: 'Resolviendo el directorio firmado y descubriendo gateways…',
  connect_your_config: 'Tu configuración',
  connect_source_directory: 'Directorio de {source}',
  connect_live_nodes: { one: '{n} nodo activo', other: '{n} nodos activos' },
  connect_select_country: 'Selecciona un país para continuar',
  connect_enrolling: 'Inscribiendo…',
  connect_generate: 'Generar .conf',
  connect_no_gateway_in_country:
    'No hay ningún gateway activo accesible en {country} desde el navegador. La inscripción se envía a la API de control de un gateway (http :51821), a la que las páginas https no pueden llegar — esto funciona desde los clientes de escritorio y móvil que comparten este núcleo.',
  connect_error_enroll_failed: 'Falló la inscripción.',
  connect_qr_caption: 'Escanea con la app WireGuard',
  connect_stat_assigned_ip: 'IP asignada',
  connect_stat_endpoint: 'Endpoint',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Descargar .conf',
  connect_upgrade_cta: 'Mejorar a velocidad completa →',
  connect_identity_title: 'Identidad de este dispositivo',
  connect_regenerate: 'Regenerar clave',
  connect_identity_note:
    'Un par de claves por dispositivo se inscribe en muchos gateways; el premium sigue a la clave en todos ellos a través de la cadena. El código de pago de abajo es lo que vincula un pago en FLUX con esta clave.',
  connect_field_public_key: 'Clave pública WireGuard',
  connect_field_payment_code: 'Código de pago (memo)',

  upgrade_loading: 'Cargando datos de pago…',
  upgrade_eyebrow: 'Mejora · paga en FLUX',
  upgrade_title: 'Mejora a velocidad completa',
  upgrade_lede:
    'Envía FLUX con el mensaje exacto de abajo. Cada gateway escanea la cadena y desbloquea tu clave en ~1 minuto — en todos los servidores a la vez, durante 30 días. Sin cuenta, sin tarjeta, sin ninguna empresa que pueda entregar lo que nunca tuvo.',
  upgrade_usd_line: '≈ {usd} · cada 30 días',
  upgrade_qr_caption: 'Escanea con Zelcore / SSP Wallet',
  upgrade_field_address: 'Dirección de pago',
  upgrade_field_message: 'Mensaje (obligatorio)',
  upgrade_open_wallet: 'Abrir en la billetera',
  upgrade_prepay_note:
    '<strong>Paga por adelantado:</strong> paga un múltiplo del monto para sumar esa cantidad de meses de una vez — p. ej. {amount} FLUX = 3 meses. Los meses extra se acumulan (hasta 24), así que puedes recargar cuando quieras.',
  upgrade_privacy_note:
    'Se abre en Zelcore / SSP Wallet. El pago se verifica en la blockchain de Flux — nunca vemos quién eres. El mensaje vincula el pago con tu clave; enviarlo sin él hace que los fondos lleguen pero nada se desbloquee.',
  upgrade_back: '← Volver a Conectar',

  multihop_summary_title: 'Avanzado: multi-hop (dos configuraciones)',
  multihop_tier_pill: 'PREMIUM · OPCIONAL',
  multihop_lede:
    'Enruta a través de dos gateways para que <strong>ningún servidor por sí solo vea quién eres y a dónde vas</strong>. Es más lento y añade latencia — espera aproximadamente <strong>2× de ping</strong> frente a un solo salto, y menor rendimiento máximo por el doble cifrado. Multi-hop es premium, pero un solo pago de <mono>$0.99</mono> cubre ambos saltos (la misma clave K es premium en la entrada y la salida automáticamente). Desactivado por defecto — el flujo de un solo salto de arriba sigue siendo el principal.',
  multihop_entry_label: 'País de entrada (ve tu IP)',
  multihop_entry_aria: 'País de entrada',
  multihop_exit_label: 'País de salida (ve tu destino)',
  multihop_exit_aria: 'País de salida',
  multihop_style_same: 'Estilo de ruta: equilibrado — mismo país (una sola jurisdicción)',
  multihop_style_cross:
    'Estilo de ruta: máxima privacidad — entre jurisdicciones (dos operadores, dos países)',
  multihop_enrolling: 'Inscribiendo ambos saltos…',
  multihop_generate: 'Generar dos configuraciones',
  multihop_error_no_exit: 'Multi-hop necesita un gateway de salida distinto; no se resolvió ninguno.',
  multihop_error_no_gateways:
    'No hay gateways activos accesibles desde el navegador, así que no se pudo resolver ninguna ruta. El anidamiento multi-hop es en realidad una función de nuestras apps — los clientes de escritorio y móvil (mismo núcleo) prueban los gateways directamente y ejecutan los dos túneles por ti.',
  multihop_error_failed: 'Falló la generación de multi-hop.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'externo · MTU 1420',
  multihop_conf_inner_tag: 'interno · MTU {mtu}',
  multihop_download_entry: 'Descargar wg-entry.conf',
  multihop_download_exit: 'Descargar wg-exit.conf',
  multihop_note:
    '<strong>Cómo enrutar esto (nota honesta).</strong> El anidamiento real con la app estándar de WireGuard es incómodo — solo ejecuta un túnel a la vez — así que multi-hop es en realidad una <strong>función de nuestras apps</strong> (escritorio/móvil encadenan los dos túneles por ti). Para una configuración manual debes levantar primero <mono>wg-entry.conf</mono>, luego enrutar solo la dirección de salida <mono>{exitIp}/32</mono> a través de ese túnel de entrada y enviar el resto por <mono>wg-exit.conf</mono> (MTU interno {mtu}, para que quepan dos cabeceras WireGuard). Endpoint de salida: <mono>{endpoint}</mono>.<br/><strong>Advertencia de v1:</strong> ambos saltos usan la misma clave K, lo que frustra a cualquier operador <em>individual</em>, pero significa que un adversario que controle <em>ambos</em> saltos podría correlacionarlos mediante esa clave compartida. Claves distintas por salto llegan en v1.5.',
};
