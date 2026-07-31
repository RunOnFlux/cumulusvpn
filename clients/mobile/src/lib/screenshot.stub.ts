/**
 * Stub for `./screenshot`, substituted at RESOLVE time by metro.config.js in
 * every build that is not `CVPN_SCREENSHOT=1`.
 *
 * This is what actually keeps demo data out of a store binary. Gating on
 * `if (__SCREENSHOT_MODE__)` alone is NOT enough: the branch is dropped, but
 * the real module is still an import edge in the dependency graph, so its
 * latency table and demo IP end up in the bundle anyway (verified — they were
 * greppable in a `--dev false` bundle). Swapping the module out at the resolver
 * means the data never enters the graph at all.
 *
 * Keep the exported surface identical to ./screenshot.ts, or a screenshot-mode
 * build and a normal build stop type-checking the same way.
 */
import type { GatewayInfo } from '@cumulusvpn/core';
import type { RouteEndpoint } from './gateways';

/** Always false here — this module only loads in non-screenshot builds. */
export const SCREENSHOT_MODE = false;

/** See ./screenshot.ts. Unreachable: every call site is behind SCREENSHOT_MODE. */
export interface DemoSession {
  readonly entry: RouteEndpoint;
  readonly connectedSince: number;
  readonly speed: { readonly down: number; readonly up: number };
  readonly pingMs: number;
}

/**
 * Unreachable in this build; present only to match the real module's shape.
 * The arguments are folded into the message rather than ignored, so if this
 * ever DOES throw the log says which gateway tripped it.
 */
export function demoLatency(gw: GatewayInfo): number {
  throw new Error(`demoLatency(${gw.ip}): screenshot mode is not enabled in this build`);
}

/** As {@link demoLatency} — unreachable, and self-identifying if it isn't. */
export function demoSession(entry: RouteEndpoint | null): DemoSession {
  throw new Error(
    `demoSession(${entry?.code ?? 'auto'}): screenshot mode is not enabled in this build`,
  );
}
