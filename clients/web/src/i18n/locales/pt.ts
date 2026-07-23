import type { Catalog } from '../index';

export const pt: Catalog = {
  app_title: 'CumulusVPN — Internet privada, sem conta, sem registros',

  header_nav_connect: 'Conectar',
  header_nav_upgrade: 'Upgrade',
  header_theme_label: 'Tema: {mode}',
  header_theme_system: 'sistema',
  header_theme_light: 'claro',
  header_theme_dark: 'escuro',
  header_language_label: 'Idioma',

  footer_tagline: 'CumulusVPN — VPN descentralizada na Flux Cloud · vpn.cumulusvpn.com',
  footer_credit: 'Trilho beta · sem conta · sem registros',

  common_copy: 'Copiar',
  common_copied: 'Copiado',
  common_qr_alt: 'Código QR',
  common_powered_by_flux_link: 'Powered by Flux — abre runonflux.com',
  common_powered_by_flux_alt: 'Powered by Flux',
  common_seed: 'semente',
  common_directory: 'diretório',

  error_gateway_rejected: 'O gateway rejeitou a inscrição ({slug}): {message}',

  countries_search_placeholder: '🔎  Buscar entre {n} países…',
  countries_search_label: 'Buscar países',
  countries_list_label: 'Países',
  countries_no_match: 'Nenhum país corresponde a “{query}”.',
  countries_nodes: { one: '{n} nó', other: '{n} nós' },

  connect_eyebrow: 'Trilho beta · configuração WireGuard',
  connect_title: 'Uma chave, <glow>todos os gateways.</glow>',
  connect_lede:
    'Seu par de chaves WireGuard é gerado aqui, no seu navegador — a chave privada nunca sai desta aba. Escolha um país, inscreva-se no gateway Flux mais próximo e exporte um<mono> .conf</mono> pronto para importar com o QR. Grátis para sempre a 100 KB/s; <upgrade>faça upgrade com FLUX</upgrade> para velocidade máxima.',
  connect_verify_warn:
    'Não foi possível verificar a assinatura do diretório — os endpoints são exibidos apenas a título informativo.',
  connect_notice_no_live_gateway:
    'Nenhum gateway ativo acessível a partir do navegador. Exibindo os países do diretório assinado — as configurações se inscrevem em um gateway ativo quando houver um disponível.',
  connect_choose_location: 'Escolha uma localização',
  connect_tier_free: 'GRÁTIS · 100 KB/s',
  connect_loading_directory: 'Resolvendo o diretório assinado e descobrindo gateways…',
  connect_your_config: 'Sua configuração',
  connect_source_directory: 'Diretório de {source}',
  connect_live_nodes: { one: '{n} nó ativo', other: '{n} nós ativos' },
  connect_select_country: 'Selecione um país para continuar',
  connect_enrolling: 'Inscrevendo…',
  connect_generate: 'Gerar .conf',
  connect_no_gateway_in_country:
    'Nenhum gateway ativo acessível em {country} a partir do navegador. A inscrição é enviada à API de controle de um gateway (http :51821), que páginas https não conseguem alcançar — isso funciona nos clientes desktop e mobile, que compartilham este núcleo.',
  connect_error_enroll_failed: 'A inscrição falhou.',
  connect_qr_caption: 'Escaneie com o app WireGuard',
  connect_stat_assigned_ip: 'IP atribuído',
  connect_stat_endpoint: 'Endpoint',
  connect_stat_dns: 'DNS',
  connect_download_conf: 'Baixar .conf',
  connect_upgrade_cta: 'Fazer upgrade para velocidade máxima →',
  connect_identity_title: 'Identidade deste dispositivo',
  connect_regenerate: 'Regenerar chave',
  connect_identity_note:
    'Um par de chaves por dispositivo se inscreve em vários gateways; o premium acompanha a chave em todos eles pela chain. O código de pagamento abaixo é o que vincula um pagamento em FLUX a esta chave.',
  connect_field_public_key: 'Chave pública WireGuard',
  connect_field_payment_code: 'Código de pagamento (memo)',

  upgrade_loading: 'Carregando dados de pagamento…',
  upgrade_eyebrow: 'Upgrade · pague em FLUX',
  upgrade_title: 'Upgrade para velocidade máxima',
  upgrade_lede:
    'Envie FLUX com a mensagem exata abaixo. Cada gateway escaneia a chain e desbloqueia sua chave em ~1 minuto — em todos os servidores de uma vez, por 30 dias. Sem conta, sem cartão, sem nenhuma empresa que possa entregar o que nunca teve.',
  upgrade_usd_line: '≈ {usd} · a cada 30 dias',
  upgrade_qr_caption: 'Escaneie com Zelcore / SSP Wallet',
  upgrade_field_address: 'Endereço de pagamento',
  upgrade_field_message: 'Mensagem (obrigatória)',
  upgrade_open_wallet: 'Abrir na carteira',
  upgrade_prepay_note:
    '<strong>Pague adiantado:</strong> pague um múltiplo do valor para somar essa quantidade de meses de uma vez — ex.: {amount} FLUX = 3 meses. Meses extras se acumulam (até 24), então você pode recarregar quando quiser.',
  upgrade_privacy_note:
    'Abre no Zelcore / SSP Wallet. O pagamento é verificado na blockchain da Flux — nós nunca vemos quem você é. A mensagem vincula o pagamento à sua chave; enviá-lo sem ela faz os fundos chegarem, mas nada é desbloqueado.',
  upgrade_back: '← Voltar para Conectar',

  multihop_summary_title: 'Avançado: multi-hop (duas configurações)',
  multihop_tier_pill: 'PREMIUM · OPCIONAL',
  multihop_lede:
    'Faça o roteamento por dois gateways para que <strong>nenhum servidor sozinho veja quem você é e para onde vai</strong>. É mais lento e adiciona latência — espere aproximadamente <strong>2× de ping</strong> em relação ao salto único, e menor throughput de pico devido à dupla criptografia. Multi-hop é premium, mas um único pagamento de <mono>$0.99</mono> cobre os dois saltos (a mesma chave K é premium na entrada e na saída automaticamente). Desativado por padrão — o fluxo de salto único acima continua sendo o principal.',
  multihop_entry_label: 'País de entrada (vê seu IP)',
  multihop_entry_aria: 'País de entrada',
  multihop_exit_label: 'País de saída (vê seu destino)',
  multihop_exit_aria: 'País de saída',
  multihop_style_same: 'Estilo de rota: equilibrado — mesmo país (uma jurisdição)',
  multihop_style_cross:
    'Estilo de rota: privacidade máxima — entre jurisdições (dois operadores, dois países)',
  multihop_enrolling: 'Inscrevendo os dois saltos…',
  multihop_generate: 'Gerar duas configurações',
  multihop_error_no_exit:
    'Multi-hop precisa de um gateway de saída distinto; nenhum foi resolvido.',
  multihop_error_no_gateways:
    'Nenhum gateway ativo acessível a partir do navegador, então nenhuma rota pôde ser resolvida. O encadeamento multi-hop é, na verdade, um recurso dos nossos apps — os clientes desktop e mobile (mesmo núcleo) sondam os gateways diretamente e rodam os dois túneis por você.',
  multihop_error_failed: 'A geração do multi-hop falhou.',
  multihop_internet: 'internet',
  multihop_conf_outer_tag: 'externo · MTU 1420',
  multihop_conf_inner_tag: 'interno · MTU {mtu}',
  multihop_download_entry: 'Baixar wg-entry.conf',
  multihop_download_exit: 'Baixar wg-exit.conf',
  multihop_note:
    '<strong>Como rotear isto (nota honesta).</strong> O encadeamento real com o app padrão do WireGuard é complicado — ele roda apenas um túnel por vez — então o multi-hop é, na verdade, um <strong>recurso dos nossos apps</strong> (desktop/mobile encadeiam os dois túneis por você). Para uma configuração manual, você precisa subir primeiro o <mono>wg-entry.conf</mono>, depois rotear apenas o endereço de saída <mono>{exitIp}/32</mono> por esse túnel de entrada e enviar o resto pelo <mono>wg-exit.conf</mono> (MTU interno {mtu}, para que caibam dois cabeçalhos WireGuard). Endpoint de saída: <mono>{endpoint}</mono>.<br/><strong>Ressalva da v1:</strong> os dois saltos usam a mesma chave K, o que frustra qualquer operador <em>isolado</em>, mas significa que um adversário que controle <em>os dois</em> saltos poderia correlacioná-los por essa chave compartilhada. Chaves distintas por salto chegam na v1.5.',
};
