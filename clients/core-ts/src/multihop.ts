/**
 * Opt-in multi-hop ("ultimate privacy" mode) for `@cumulusvpn/core`.
 *
 * Implements the client-side nested onion of `docs/11-multihop.md`: two stacked
 * WireGuard interfaces that share the *same* client key `K`. The outer tunnel
 * (to the ENTRY gateway) carries only the inner tunnel's packets to the exit's
 * public IP (`AllowedIPs = <exitIp>/32`); the inner tunnel (to the EXIT gateway)
 * carries all real traffic (`AllowedIPs = 0.0.0.0/0, ::/0`). No gateway protocol
 * change is required — the entry merely forwards a premium peer's traffic to
 * another gateway's `:51820`, and entitlement follows the key on every gateway,
 * so one payment covers both hops.
 *
 * Multi-hop is OFF by default (the {@link RouteStyle} `'single'` selects the
 * classic single-hop path). It trades latency and throughput for the guarantee
 * that no single operator sees both who you are and where you go.
 *
 * v1 caveat (stated honestly in-app): both hops use the same key `K`, so an
 * adversary controlling *both* chosen hops could correlate via that shared key.
 * v1.5 introduces distinct keys per hop to close that gap.
 */
import { WG_PORT } from './types.js';
import type { EnrollResponse, GatewayInfo } from './types.js';

/**
 * How the tunnel path is routed.
 *
 * - `'single'`: classic single-hop. Best speed; the default (multi-hop off).
 * - `'multihop-same-country'`: entry ≠ exit within one jurisdiction. ~1.3–1.6×
 *   latency; defeats any single operator.
 * - `'multihop-cross-jurisdiction'`: entry and exit in *different* countries.
 *   Highest latency; strongest correlation resistance (needs two operators in
 *   two countries to deanonymize).
 */
export type RouteStyle = 'single' | 'multihop-same-country' | 'multihop-cross-jurisdiction';

/** One resolved hop in a route: its gateway, jurisdiction, info and enrollment. */
export interface Hop {
  /** Gateway public IP (port stripped). */
  readonly gatewayIp: string;
  /** ISO country of the gateway. */
  readonly country: string;
  /** Verified `/v1/info` for the gateway. */
  readonly info: GatewayInfo;
  /** Enrollment of key `K` at this gateway. */
  readonly enroll: EnrollResponse;
}

/** Optional explicit picks for {@link selectHops}. */
export interface SelectHopsOptions {
  /** Restrict the entry to this country. */
  readonly entryCountry?: string;
  /** Restrict the exit to this country. */
  readonly exitCountry?: string;
}

/** The ordered hops chosen by {@link selectHops}. `exit` is absent for `'single'`. */
export interface SelectedHops {
  readonly entry: GatewayInfo;
  readonly exit?: GatewayInfo;
}

/** The two nested interface configs plus the routing facts a client needs. */
export interface MultihopConfig {
  /** wg-entry `.conf`: `AllowedIPs = <exitIp>/32`, MTU 1420, no DNS. */
  readonly outer: string;
  /** wg-exit `.conf`: `AllowedIPs = 0.0.0.0/0, ::/0`, MTU 1340, DNS = exit dns. */
  readonly inner: string;
  /** `<exitIp>:51820` — must route via the outer interface. */
  readonly exitEndpoint: string;
  /** Inner interface MTU (leaves headroom for two WireGuard headers). */
  readonly innerMtu: number;
}

/** MTU for the outer interface (single WireGuard header of headroom). */
const OUTER_MTU = 1420;
/** MTU for the inner interface (headroom for two stacked WireGuard headers). */
const INNER_MTU = 1340;

/**
 * Strip a trailing `:port` from an endpoint, leaving IPv6 forms untouched.
 * `"1.2.3.4:51820"` → `"1.2.3.4"`; `"1.2.3.4"` → `"1.2.3.4"`.
 */
function stripEndpointPort(endpoint: string): string {
  const trimmed = endpoint.trim();
  // Only strip a single trailing :port (IPv4 / host); leave IPv6 alone.
  if (trimmed.includes(':') && trimmed.split(':').length === 2) {
    return trimmed.slice(0, trimmed.lastIndexOf(':'));
  }
  return trimmed;
}

/**
 * Deterministic ordering: least-loaded first, then country as a stable
 * tie-break, then IP so equal-load same-country gateways still order stably.
 */
function byLoadThenCountry(a: GatewayInfo, b: GatewayInfo): number {
  if (a.load !== b.load) {
    return a.load - b.load;
  }
  if (a.country !== b.country) {
    return a.country < b.country ? -1 : 1;
  }
  if (a.ip !== b.ip) {
    return a.ip < b.ip ? -1 : 1;
  }
  return 0;
}

/**
 * Choose the ordered hops for a route.
 *
 * The entry is the least-loaded gateway (deterministic tie-break by load, then
 * country, then IP), optionally constrained to `opts.entryCountry`. For
 * multi-hop styles an exit is also chosen — never equal to the entry
 * (`entry.gatewayIp !== exit.gatewayIp`) — with the jurisdiction rule for the
 * style: `'multihop-same-country'` requires `entry.country === exit.country`,
 * `'multihop-cross-jurisdiction'` requires `entry.country !== exit.country`.
 * `'single'` returns just the entry (no exit).
 *
 * @param gateways - Discovered, verified gateways to choose from.
 * @param style - The desired {@link RouteStyle}.
 * @param opts - Optional explicit entry/exit country picks.
 * @returns The chosen `entry` and, for multi-hop styles, `exit`.
 * @throws {Error} If no gateway satisfies the constraints (empty fleet, no
 *   distinct exit, or no exit in the required jurisdiction).
 */
export function selectHops(
  gateways: readonly GatewayInfo[],
  style: RouteStyle,
  opts: SelectHopsOptions = {},
): SelectedHops {
  const sorted = [...gateways].sort(byLoadThenCountry);

  const entryPool = opts.entryCountry
    ? sorted.filter((g) => g.country === opts.entryCountry)
    : sorted;
  const entry = entryPool[0];
  if (!entry) {
    throw new Error(
      opts.entryCountry
        ? `selectHops: no gateway available in entry country "${opts.entryCountry}"`
        : 'selectHops: no gateways available',
    );
  }

  if (style === 'single') {
    return { entry };
  }

  const exitPool = sorted.filter((g) => {
    if (g.ip === entry.ip) {
      return false; // enforce entry !== exit
    }
    if (opts.exitCountry && g.country !== opts.exitCountry) {
      return false;
    }
    if (style === 'multihop-same-country') {
      return g.country === entry.country;
    }
    // multihop-cross-jurisdiction
    return g.country !== entry.country;
  });

  const exit = exitPool[0];
  if (!exit) {
    const reason =
      style === 'multihop-cross-jurisdiction'
        ? `no distinct exit in a different country from entry "${entry.country}"`
        : `no distinct exit in country "${entry.country}"`;
    throw new Error(`selectHops: ${reason}`);
  }

  return { entry, exit };
}

/**
 * Build the two nested WireGuard interface configs for a multi-hop route.
 *
 * Both interfaces use the *same* client private key (one payment, key `K` is
 * premium at entry and exit). The outer interface pins `AllowedIPs` to the
 * exit's IP `/32` only, so exclusively the inner tunnel's UDP packets to the
 * exit traverse the entry; the inner interface routes all traffic and sets the
 * exit's DNS and the reduced 1340 MTU.
 *
 * @param args.privateKey - Client WireGuard private key (base64), used on both.
 * @param args.entry - Enrollment of key `K` at the ENTRY gateway.
 * @param args.exit - Enrollment of key `K` at the EXIT gateway.
 * @returns The `outer`/`inner` `.conf` strings, `exitEndpoint`, and `innerMtu`.
 */
export function buildMultihopConfig(args: {
  privateKey: string;
  entry: EnrollResponse;
  exit: EnrollResponse;
}): MultihopConfig {
  const { privateKey, entry, exit } = args;
  const exitIp = stripEndpointPort(exit.endpoint);
  const exitEndpoint = `${exitIp}:${WG_PORT}`;

  const outer = `[Interface]
PrivateKey = ${privateKey}
Address = ${entry.assigned_ip}/32
MTU = ${OUTER_MTU}

[Peer]
PublicKey = ${entry.server_pubkey}
Endpoint = ${entry.endpoint}
AllowedIPs = ${exitIp}/32
PersistentKeepalive = 25
`;

  const inner = `[Interface]
PrivateKey = ${privateKey}
Address = ${exit.assigned_ip}/32
DNS = ${exit.dns}
MTU = ${INNER_MTU}

[Peer]
PublicKey = ${exit.server_pubkey}
Endpoint = ${exit.endpoint}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;

  return { outer, inner, exitEndpoint, innerMtu: INNER_MTU };
}
