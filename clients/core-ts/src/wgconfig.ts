import type { WgConfigParams } from './types.js';
import type { CompiledSplit } from './split.js';

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

/**
 * The AmneziaWG `[Interface]` obfuscation lines (`Jc`/`Jmin`/…/`H4`) for a
 * profile, in canonical order, skipping empty values. Empty array when no
 * profile — so a config stays byte-identical to vanilla. Shared with
 * `buildMultihopConfig` (the entry hop's obfuscation).
 */
export function obfsInterfaceLines(obfs?: Readonly<Record<string, string>>): string[] {
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
 * The `AllowedIPs` value for a compiled split policy, or the full-tunnel
 * default. A `.conf` is inclusion-only, so callers must compile with
 * `supportsExcludeRoute: false` — `tunnelRoutes` then already holds the
 * complement (exclude mode) or the inclusion list (include mode).
 *
 * An active include-mode policy with an empty route list falls back to the
 * full tunnel: failing toward MORE protection, never toward an interface that
 * silently carries nothing. (The UI should prevent that state from being
 * saved; this is the belt to its suspenders.)
 *
 * Shared with `buildMultihopConfig` (the inner/exit hop's `AllowedIPs`) — not
 * part of the public API.
 */
export function allowedIpsFor(split?: CompiledSplit): string {
  if (!split || split.isNoop || split.tunnelRoutes.length === 0) {
    return '0.0.0.0/0, ::/0';
  }
  return split.tunnelRoutes.join(', ');
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
 * When `params.split` is set (a {@link CompiledSplit} compiled with
 * `supportsExcludeRoute: false`, since a `.conf` can only express inclusion),
 * its `tunnelRoutes` replace the default `AllowedIPs`. A noop split — or none —
 * keeps the output byte-identical to before (validation gate V1).
 *
 * @param params - Client private key, assigned IP, DNS, server key, endpoint,
 *   and optionally the obfuscation profile and compiled split policy.
 * @returns The complete WireGuard configuration text.
 */
export function buildWgConfig(params: WgConfigParams): string {
  const { privateKey, assignedIp, dns, serverPubKey, endpoint, obfs, split } = params;
  // Android app rules (docs/17 §4.1): `com.wireguard.config.Interface` parses
  // these two keys and applies them to the VpnService builder, so the vanilla
  // GoBackend path gets per-app split for free. The compiler only populates
  // the app lists for the platform it compiled for, so a desktop/web config
  // never carries them (and the desktop/iOS parsers ignore unknown keys).
  const appLines = [
    ...(split && split.appsIncluded.length > 0
      ? [`IncludedApplications = ${split.appsIncluded.join(', ')}`]
      : []),
    ...(split && split.appsExcluded.length > 0
      ? [`ExcludedApplications = ${split.appsExcluded.join(', ')}`]
      : []),
  ];
  const iface = [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `Address = ${assignedIp}/32`,
    `DNS = ${dns}`,
    ...appLines,
    ...obfsInterfaceLines(obfs),
  ];
  const peer = [
    '[Peer]',
    `PublicKey = ${serverPubKey}`,
    `Endpoint = ${endpoint}`,
    `AllowedIPs = ${allowedIpsFor(split)}`,
    'PersistentKeepalive = 25',
  ];
  return `${iface.join('\n')}\n\n${peer.join('\n')}\n`;
}
