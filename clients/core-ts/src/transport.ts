/**
 * Transport negotiation for `@cumulusvpn/core` (docs/15-transports.md).
 *
 * A gateway advertises the transports it can serve in `/v1/info.transports`
 * (see {@link Transport}). The client picks the best one for the user's mode
 * that it also implements, and can fall back through the rest. This module is
 * the pure selection logic — it dials nothing; callers apply the chosen
 * transport's port to the enrollment endpoint via {@link applyTransportToEndpoint}.
 *
 * Backward compatibility: a pre-negotiation (0.1.0) gateway omits `transports`
 * entirely. That is treated as **vanilla WireGuard on {@link WG_PORT}**, so old
 * gateways and old apps keep interoperating with no flag-day.
 */
import { WG_PORT } from './types.js';
import type { Transport } from './types.js';

/**
 * How aggressively to trade speed for un-blockability.
 * - `auto`: fastest that connects, then fall back (vanilla → obfuscated → TLS).
 * - `speed`: only the fast tiers (vanilla, obfuscated UDP).
 * - `stealth`: only DPI-resistant tiers — never silently downgrades to plain WG.
 */
export type TransportMode = 'auto' | 'speed' | 'stealth';

/**
 * Transport slugs THIS client build can actually dial. M0 ships vanilla only;
 * M1/M2 add `'awg'` and `'wg-tls'` here as the native data paths land. Anything
 * a gateway advertises but this set omits is ignored during selection.
 */
export const IMPLEMENTED_TRANSPORTS: ReadonlySet<string> = new Set(['wg']);

/**
 * Per-mode preference order, most-preferred first. `stealth` deliberately omits
 * plain `wg` so an explicit stealth request never falls back to an
 * un-obfuscated path; `auto` includes everything, fastest-first.
 */
const PREFERENCE: Record<TransportMode, readonly string[]> = {
  speed: ['wg', 'awg'],
  auto: ['wg', 'awg', 'wg-tls'],
  stealth: ['wg-tls', 'awg'],
};

/** A gateway with no advertised transports is 0.1.0 → assume vanilla WG. */
function advertisedOrLegacy(transports: readonly Transport[] | undefined): readonly Transport[] {
  return transports && transports.length > 0 ? transports : [{ type: 'wg', port: WG_PORT }];
}

/**
 * Ordered transports to attempt for a gateway under `mode` — filtered to those
 * this client implements and the mode permits, most-preferred first. Empty when
 * the gateway offers nothing the mode allows (e.g. Stealth against a
 * vanilla-only gateway); the caller then skips that gateway or surfaces it.
 *
 * @param transports - The gateway's advertised `/v1/info.transports` (or undefined for 0.1.0).
 * @param mode - The user's {@link TransportMode}.
 * @param implemented - Slugs this client can dial (defaults to {@link IMPLEMENTED_TRANSPORTS}).
 */
export function transportFallbackChain(
  transports: readonly Transport[] | undefined,
  mode: TransportMode,
  implemented: ReadonlySet<string> = IMPLEMENTED_TRANSPORTS,
): Transport[] {
  const order = PREFERENCE[mode];
  return advertisedOrLegacy(transports)
    .filter((t) => implemented.has(t.type) && order.includes(t.type))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

/** The single best transport for a gateway under `mode`, or null if none fit. */
export function selectTransport(
  transports: readonly Transport[] | undefined,
  mode: TransportMode,
  implemented: ReadonlySet<string> = IMPLEMENTED_TRANSPORTS,
): Transport | null {
  return transportFallbackChain(transports, mode, implemented)[0] ?? null;
}

/**
 * Rewrite an endpoint's port to the chosen transport's port, host untouched.
 * `"1.2.3.4:51820"` + `{port:443}` → `"1.2.3.4:443"`; a bare host gains the port.
 * A bracketed IPv6 `"[::1]:51820"` keeps its host. For M0 the vanilla transport
 * keeps {@link WG_PORT}, so this is a no-op on the current path.
 */
export function applyTransportToEndpoint(endpoint: string, transport: Transport): string {
  return `${stripEndpointPort(endpoint)}:${transport.port}`;
}

/** Host of an endpoint with any trailing `:port` removed (IPv4/host + `[ipv6]`). */
function stripEndpointPort(endpoint: string): string {
  const s = endpoint.trim();
  if (s.startsWith('[')) {
    const close = s.indexOf(']');
    return close === -1 ? s : s.slice(0, close + 1); // keep [ipv6], drop :port after
  }
  // IPv4/host: strip a single trailing :port. A bare (unbracketed) IPv6 has
  // multiple colons and is returned as-is — callers use bracketed IPv6.
  if (s.includes(':') && s.split(':').length === 2) {
    return s.slice(0, s.lastIndexOf(':'));
  }
  return s;
}
