import type { WgConfigParams } from './types.js';

// AmneziaWG obfuscation keys as they appear in a wg-quick [Interface] block
// (capitalized), mapped from the lowercase keys the gateway advertises in
// /v1/info transports[].params. Fixed order for deterministic output. Native
// clients on an AmneziaWG engine read these back and re-emit them as UAPI.
const OBFS_CONF_KEYS: readonly (readonly [wire: string, conf: string])[] = [
  ['jc', 'Jc'],
  ['jmin', 'Jmin'],
  ['jmax', 'Jmax'],
  ['s1', 'S1'],
  ['s2', 'S2'],
  ['h1', 'H1'],
  ['h2', 'H2'],
  ['h3', 'H3'],
  ['h4', 'H4'],
];

function obfsInterfaceLines(obfs?: Readonly<Record<string, string>>): string[] {
  if (!obfs) return [];
  const lines: string[] = [];
  for (const [wire, conf] of OBFS_CONF_KEYS) {
    const v = obfs[wire];
    if (v !== undefined && v !== '') {
      lines.push(`${conf} = ${v}`);
    }
  }
  return lines;
}

/**
 * Render a ready-to-use WireGuard client configuration (`.conf` / `.ini`).
 *
 * The output matches the API contract exactly: a `/32` tunnel address, the
 * gateway as the sole peer, all traffic routed (`0.0.0.0/0, ::/0`), and a
 * 25 s keepalive so the tunnel survives NAT. The trailing newline is part of
 * the canonical form.
 *
 * When `params.obfs` is set (the AmneziaWG params from an `awg` transport's
 * advertised profile), the matching `[Interface]` obfuscation lines
 * (`Jc`/`Jmin`/…/`H4`) are appended — otherwise the output is byte-identical to
 * the vanilla config, so nothing changes for the default path.
 *
 * @param params - Client private key, assigned IP, DNS, server key, endpoint,
 *   and optionally the obfuscation profile.
 * @returns The complete WireGuard configuration text.
 */
export function buildWgConfig(params: WgConfigParams): string {
  const { privateKey, assignedIp, dns, serverPubKey, endpoint, obfs } = params;
  const iface = [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `Address = ${assignedIp}/32`,
    `DNS = ${dns}`,
    ...obfsInterfaceLines(obfs),
  ];
  const peer = [
    '[Peer]',
    `PublicKey = ${serverPubKey}`,
    `Endpoint = ${endpoint}`,
    'AllowedIPs = 0.0.0.0/0, ::/0',
    'PersistentKeepalive = 25',
  ];
  return `${iface.join('\n')}\n\n${peer.join('\n')}\n`;
}
