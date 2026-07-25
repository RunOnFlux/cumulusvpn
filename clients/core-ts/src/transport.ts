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
import type { Tier, Transport } from './types.js';

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

/** A usable TCP/UDP port — guards against a gateway advertising 0/negative/>65535
 *  or a non-integer, which would otherwise produce a bogus `host:port` endpoint. */
function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Whether `tier` may use a transport, honouring the gateway's `params.tier`
 * gate. A transport tagged `tier: 'premium'` (the scarce 443 stealth tier) is
 * reserved for paying users; everything else is ungated.
 *
 * The gateway ENFORCES this by keeping free keys out of the gated listener's
 * peer set — this filter is the client half, so a free user quietly gets the
 * next-best transport instead of completing TLS and then failing an inner
 * handshake with no diagnostic. Unknown gate values (a future tier) fail OPEN,
 * so an old client keeps working against a newer gateway.
 */
function tierAllows(t: Transport, tier: Tier): boolean {
  return t.params?.tier !== 'premium' || tier === 'premium';
}

/**
 * Whether a gateway advertises any entitlement-gated transport — i.e. whether
 * the caller's tier can actually change which transport is chosen here.
 *
 * Callers use this to decide when a cached, fleet-wide tier is not good enough.
 * Entitlement is chain-derived and each gateway evaluates it independently, so
 * a tier learned from gateway A can disagree with gateway B that actually
 * enforces the gate — and the cost of guessing high is not a clean error but a
 * TLS session that connects and then hangs, because the relay bridges opaque
 * WireGuard frames into a device the key isn't a member of. When this returns
 * true, resolve the tier against THIS gateway before selecting.
 */
export function hasPremiumTransport(transports: readonly Transport[] | undefined): boolean {
  return (transports ?? []).some((t) => t.params?.tier === 'premium');
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
 * @param tier - The user's entitlement, which gates `params.tier: 'premium'`
 *   transports. Defaults to `'free'` — fail-closed, so a caller that hasn't been
 *   taught about tiers can never dial a transport it may not be entitled to
 *   (which would fail as an opaque handshake timeout rather than a clean skip).
 */
export function transportFallbackChain(
  transports: readonly Transport[] | undefined,
  mode: TransportMode,
  implemented: ReadonlySet<string> = IMPLEMENTED_TRANSPORTS,
  tier: Tier = 'free',
): Transport[] {
  const order = PREFERENCE[mode];
  return advertisedOrLegacy(transports)
    .filter(
      (t) =>
        implemented.has(t.type) &&
        order.includes(t.type) &&
        isValidPort(t.port) &&
        tierAllows(t, tier),
    )
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

/**
 * The AmneziaWG obfuscation params to feed {@link buildWgConfig} for a chosen
 * transport, or undefined for transports that carry no `[Interface]` obfuscation
 * (`wg` vanilla and `wg-tls`, whose obfuscation is the TLS wrapper, not WG
 * framing). Only `awg` transports advertise the jc/jmin/…/h4 profile.
 */
export function obfsForTransport(t: Transport): Readonly<Record<string, string>> | undefined {
  return t.type === 'awg' ? t.params : undefined;
}

/** The single best transport for a gateway under `mode`, or null if none fit. */
export function selectTransport(
  transports: readonly Transport[] | undefined,
  mode: TransportMode,
  implemented: ReadonlySet<string> = IMPLEMENTED_TRANSPORTS,
  tier: Tier = 'free',
): Transport | null {
  return transportFallbackChain(transports, mode, implemented, tier)[0] ?? null;
}

/**
 * Like {@link selectTransport} but THROWS instead of returning null, so a caller
 * can never silently downgrade. This is the load-bearing guarantee for Stealth:
 * `auto` always resolves (vanilla `wg` is its floor against any normal gateway),
 * but an explicit `stealth`/`speed` request against a gateway that offers nothing
 * the mode + this build allow is a hard error the UI surfaces — NOT a quiet
 * fallback to plain, DPI-fingerprintable WireGuard. The thrown message is
 * mode-aware so the user knows to pick another location or switch to Auto.
 */
export function requireTransport(
  transports: readonly Transport[] | undefined,
  mode: TransportMode,
  implemented: ReadonlySet<string> = IMPLEMENTED_TRANSPORTS,
  tier: Tier = 'free',
): Transport {
  const t = selectTransport(transports, mode, implemented, tier);
  if (!t) {
    // Distinguish "nothing here fits your mode" from "the only thing that fits
    // is Premium-only": telling a free user to pick another location is wrong
    // advice when every location gates it. Re-runs the chain once, on the
    // failure path only.
    if (
      tier !== 'premium' &&
      transportFallbackChain(transports, mode, implemented, 'premium').length > 0
    ) {
      throw new Error(
        "This location's DPI-resistant transport is Premium-only. Upgrade, or switch to Auto.",
      );
    }
    if (mode === 'stealth') {
      throw new Error(
        'Stealth mode: this location offers no DPI-resistant transport. Pick another location, or switch to Auto.',
      );
    }
    throw new Error('This location offers no transport compatible with the selected mode.');
  }
  return t;
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
