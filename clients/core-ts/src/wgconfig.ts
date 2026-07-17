import type { WgConfigParams } from './types.js';

/**
 * Render a ready-to-use WireGuard client configuration (`.conf` / `.ini`).
 *
 * The output matches the API contract exactly: a `/32` tunnel address, the
 * gateway as the sole peer, all traffic routed (`0.0.0.0/0, ::/0`), and a
 * 25 s keepalive so the tunnel survives NAT. The trailing newline is part of
 * the canonical form.
 *
 * @param params - Client private key, assigned IP, DNS, server key, endpoint.
 * @returns The complete WireGuard configuration text.
 */
export function buildWgConfig(params: WgConfigParams): string {
  const { privateKey, assignedIp, dns, serverPubKey, endpoint } = params;
  return `[Interface]
PrivateKey = ${privateKey}
Address = ${assignedIp}/32
DNS = ${dns}

[Peer]
PublicKey = ${serverPubKey}
Endpoint = ${endpoint}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;
}
