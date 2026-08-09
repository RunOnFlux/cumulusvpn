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
import type { EnrollResponse, GatewayInfo, Transport } from './types.js';
import { allowedIpsFor, obfsInterfaceLines } from './wgconfig.js';
import { applyTransportToEndpoint, obfsForTransport } from './transport.js';
import type { CompiledSplit } from './split.js';

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
  /**
   * Restrict the ENTRY to these gateway IPs — the city-level pick.
   *
   * A country can span cities whose latency differs by hundreds of ms, so
   * "Germany" is not always a fine enough choice for the hop that carries your
   * traffic. The caller passes the IPs it already grouped under the chosen city
   * rather than a city NAME: gateways may report an empty `city` (clients
   * substitute a country fallback for display), so name matching would silently
   * drop exactly those nodes. Composes with {@link entryCountry}.
   */
  readonly entryIps?: readonly string[];
  /** Restrict the EXIT to these gateway IPs. See {@link entryIps}. */
  readonly exitIps?: readonly string[];
  /**
   * Require the entry and exit to sit on different subnets (IPv4 /24, IPv6 /48)
   * — a co-location guard so a route can't be built from two gateways in the
   * same rack. OFF by default; the UI exposes it as an opt-in toggle because a
   * small fleet may not offer a distinct-subnet pair, in which case
   * {@link selectHops} throws rather than silently returning a co-located route.
   *
   * This is the *subnet* leg of node diversity, and the only one enforceable
   * from the client today: operator- and ASN-level separation need node
   * metadata the gateway does not yet expose in `/v1/info`. Distinct subnets is
   * a strong proxy — two different /24s are not the same rack — but it does not,
   * on its own, prove two different operators.
   */
  readonly requireDistinctSubnet?: boolean;
}

/** The ordered hops chosen by {@link selectHops}. `exit` is absent for `'single'`. */
export interface SelectedHops {
  readonly entry: GatewayInfo;
  readonly exit?: GatewayInfo;
}

/** The two nested interface configs plus the routing facts a client needs. */
export interface MultihopConfig {
  /** wg-entry `.conf`: `AllowedIPs = <exitIp>/32`, MTU 1420, no DNS. Carries the
   *  entry hop's AmneziaWG obfuscation `[Interface]` lines when Stealth is on. */
  readonly outer: string;
  /** wg-exit `.conf`: `AllowedIPs = 0.0.0.0/0, ::/0`, MTU 1340, DNS = exit dns. */
  readonly inner: string;
  /** The ENTRY hop's wire endpoint — `<entryIp>:51820` normally, or `<entryIp>:51821`
   *  for an obfuscated (awg) entry. The native side allow-lists/routes on this. */
  readonly entryEndpoint: string;
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
 * Group key identifying a gateway's subnet for the distinct-subnet diversity
 * rule: IPv4 collapses to its /24 (first three octets), IPv6 to its /48 (first
 * three hextets, best-effort without full normalization). A malformed address
 * falls back to itself, so it only ever collides with an identical string —
 * never wrongly treating two distinct gateways as co-located.
 */
function subnetGroup(ip: string): string {
  if (ip.includes(':')) {
    return ip.split(':').slice(0, 3).join(':').toLowerCase();
  }
  const octets = ip.split('.');
  return octets.length === 4 ? octets.slice(0, 3).join('.') : ip;
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
 * With `opts.requireDistinctSubnet`, entry and exit must also fall in different
 * subnets. The entry is not fixed to the least-loaded node: entry candidates
 * are tried in load order until one yields a valid exit, so a constraint that
 * merely disqualifies the first candidate (its subnet, or a city pin claiming
 * its only counterpart) cannot fail a satisfiable route.
 *
 * @param gateways - Discovered, verified gateways to choose from.
 * @param style - The desired {@link RouteStyle}.
 * @param opts - Optional explicit entry/exit country picks and diversity rule.
 * @returns The chosen `entry` and, for multi-hop styles, `exit`.
 * @throws {Error} If no gateway satisfies the constraints (empty fleet, no
 *   distinct exit, no exit in the required jurisdiction, or — with
 *   `requireDistinctSubnet` — no entry/exit pair on distinct subnets).
 */
export function selectHops(
  gateways: readonly GatewayInfo[],
  style: RouteStyle,
  opts: SelectHopsOptions = {},
): SelectedHops {
  const sorted = [...gateways].sort(byLoadThenCountry);

  const entryIps = opts.entryIps ? new Set(opts.entryIps) : undefined;
  const exitIps = opts.exitIps ? new Set(opts.exitIps) : undefined;
  const entryPool = sorted.filter(
    (g) =>
      (!opts.entryCountry || g.country === opts.entryCountry) && (!entryIps || entryIps.has(g.ip)),
  );
  const entry = entryPool[0];
  if (!entry) {
    const where = opts.entryCountry ? ` in entry country "${opts.entryCountry}"` : '';
    throw new Error(
      opts.entryCountry || entryIps
        ? `selectHops: no gateway available${where}${entryIps ? ' at the chosen entry city' : ''}`
        : 'selectHops: no gateways available',
    );
  }

  if (style === 'single') {
    return { entry };
  }

  // The least-loaded valid exit for a given entry, or undefined if none.
  const exitFor = (from: GatewayInfo): GatewayInfo | undefined =>
    sorted.find((g) => {
      if (g.ip === from.ip) {
        return false; // enforce entry !== exit
      }
      if (opts.exitCountry && g.country !== opts.exitCountry) {
        return false;
      }
      if (exitIps && !exitIps.has(g.ip)) {
        return false; // city-level exit pick
      }
      if (opts.requireDistinctSubnet && subnetGroup(g.ip) === subnetGroup(from.ip)) {
        return false; // co-location guard: entry and exit must differ by subnet
      }
      if (style === 'multihop-same-country') {
        return g.country === from.country;
      }
      // multihop-cross-jurisdiction
      return g.country !== from.country;
    });

  // Walk entry candidates in load order: the least-loaded entry is tried first
  // (so the happy path is unchanged), but when its exit set is empty — its
  // subnet has no partner, or a city pin claimed its only counterpart — the
  // next candidate gets a chance instead of failing a satisfiable route.
  for (const candidate of entryPool) {
    const exit = exitFor(candidate);
    if (exit) {
      return { entry: candidate, exit };
    }
  }

  const jurisdiction =
    style === 'multihop-cross-jurisdiction'
      ? `in a different country from entry "${entry.country}"`
      : `in country "${entry.country}"`;
  const subnetNote = opts.requireDistinctSubnet ? ' on a distinct subnet' : '';
  const cityNote = exitIps ? ' at the chosen exit city' : '';
  throw new Error(`selectHops: no distinct exit ${jurisdiction}${cityNote}${subnetNote}`);
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
 * Stealth multi-hop obfuscates the ENTRY hop only (the local censor sees just the
 * entry handshake; the inner exit hop travels encapsulated). Pass the entry
 * gateway's chosen `entryTransport` (an `awg` transport) and the outer config
 * gains its AmneziaWG `[Interface]` lines and points at the awg port; the inner
 * (exit) hop stays vanilla. Omit it (or pass a vanilla `wg` transport) for a
 * fully vanilla multi-hop — the output is then byte-identical to before.
 *
 * Split tunneling (docs/17 §7.2): rules apply to the INNER (exit) hop — that is
 * where the default route lives. Pass a `split` compiled with
 * `supportsExcludeRoute: false` and the inner `.conf`'s `AllowedIPs` becomes the
 * compiled `tunnelRoutes`; the outer hop's `<exitIp>/32` pin is untouched. The
 * compile step must have been given both hop IPs as `endpointIps` so no rule
 * can shadow either pin. Absent or noop keeps the output byte-identical.
 *
 * @param args.privateKey - Client WireGuard private key (base64), used on both.
 * @param args.entry - Enrollment of key `K` at the ENTRY gateway.
 * @param args.exit - Enrollment of key `K` at the EXIT gateway.
 * @param args.entryTransport - ENTRY hop transport (an `awg` profile obfuscates it).
 * @param args.split - Compiled split policy for the exit hop's `AllowedIPs`.
 * @returns The `outer`/`inner` `.conf` strings, `entryEndpoint`, `exitEndpoint`, `innerMtu`.
 */
export function buildMultihopConfig(args: {
  privateKey: string;
  entry: EnrollResponse;
  exit: EnrollResponse;
  entryTransport?: Transport;
  split?: CompiledSplit;
}): MultihopConfig {
  const { privateKey, entry, exit, entryTransport, split } = args;
  const exitIp = stripEndpointPort(exit.endpoint);
  const exitEndpoint = `${exitIp}:${WG_PORT}`;

  // Stealth: fold the entry hop's awg obfuscation into the outer [Interface] and
  // point it at the transport's port (awg = 51821). Vanilla when absent.
  const entryObfs = entryTransport ? obfsForTransport(entryTransport) : undefined;
  const entryEndpoint = entryTransport
    ? applyTransportToEndpoint(entry.endpoint, entryTransport)
    : entry.endpoint;

  const outerIface = [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `Address = ${entry.assigned_ip}/32`,
    `MTU = ${OUTER_MTU}`,
    ...obfsInterfaceLines(entryObfs),
  ];
  const outerPeer = [
    '[Peer]',
    `PublicKey = ${entry.server_pubkey}`,
    `Endpoint = ${entryEndpoint}`,
    `AllowedIPs = ${exitIp}/32`,
    'PersistentKeepalive = 25',
  ];
  const outer = `${outerIface.join('\n')}\n\n${outerPeer.join('\n')}\n`;

  // Android per-app rules (docs/17 §4.1) ride the INNER config's [Interface]
  // like the single-hop path: the official Config parser reads these keys and
  // the controller forwards them to the nested service. The compiler only
  // populates the app lists for the platform it compiled for, so a desktop
  // inner config never carries them. Empty → byte-identical output.
  const appLines = [
    ...(split && split.appsIncluded.length > 0
      ? [`IncludedApplications = ${split.appsIncluded.join(', ')}`]
      : []),
    ...(split && split.appsExcluded.length > 0
      ? [`ExcludedApplications = ${split.appsExcluded.join(', ')}`]
      : []),
  ];
  const innerIface = [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `Address = ${exit.assigned_ip}/32`,
    `DNS = ${exit.dns}`,
    `MTU = ${INNER_MTU}`,
    ...appLines,
  ];
  const innerPeer = [
    '[Peer]',
    `PublicKey = ${exit.server_pubkey}`,
    `Endpoint = ${exit.endpoint}`,
    `AllowedIPs = ${allowedIpsFor(split)}`,
    'PersistentKeepalive = 25',
  ];
  const inner = `${innerIface.join('\n')}\n\n${innerPeer.join('\n')}\n`;

  return { outer, inner, entryEndpoint, exitEndpoint, innerMtu: INNER_MTU };
}
