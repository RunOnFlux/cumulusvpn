/**
 * Screenshot mode — fixed demo data for App Store / Play Store captures.
 *
 * WHY THIS EXISTS
 * Two frames cannot be captured from a normal dev machine:
 *   1. The connected hero. iOS packet-tunnel extensions do not run on the
 *      Simulator, so the app can never reach `connected` there, and a device
 *      capture needs the phone physically attached for every retake.
 *   2. The country list. Latency is measured live, so the ratings depend on
 *      where the capture machine happens to sit. From Asia-Pacific every
 *      European node reads 300-800 ms and the whole list renders "Good".
 *
 * HONESTY RULES — these are load-bearing, do not relax them:
 *   - Every latency below is what a user NEAR that node genuinely measures.
 *     Latency has no single true value; it is a property of the pair (user,
 *     node). These are modelled on a Central-European client, which is where
 *     most of the fleet is. Numbers the service could not actually deliver
 *     (say 5 ms to Australia) would be a performance claim, not a viewpoint.
 *   - Throughput stays UNDER the free tier's 100 KB/s cap, because the same
 *     frame shows the "FREE · 100 KB/s" pill. A screenshot may not show the
 *     app beating its own advertised limit.
 *   - Nothing here invents a FEATURE. The app really does connect, really does
 *     rate nodes this way; only the vantage point is fixed.
 *
 * SAFETY
 * `__SCREENSHOT_MODE__` is inlined by babel.config.js as a boolean literal and
 * is `false` unless the bundle was built with `CVPN_SCREENSHOT=1`. Every branch
 * here is therefore dead code the minifier removes from a store build — the
 * demo data cannot ship. Never convert this to a runtime or remote flag.
 *
 * Usage:
 *   CVPN_SCREENSHOT=1 yarn ios --configuration Release   (or the xcodebuild
 *   invocation in .claude/skills/appstore-screenshots/SKILL.md)
 */
import type { GatewayInfo } from '@cumulusvpn/core';
import type { RouteEndpoint } from './gateways';

/** True only in a bundle built with `CVPN_SCREENSHOT=1`. */
export const SCREENSHOT_MODE: boolean = __SCREENSHOT_MODE__;

/**
 * Round-trip in ms from a Central-European client to each country's nodes.
 *
 * Calibrated so the list reads the way it does for a real European user:
 * nearby Europe lands "Excellent", intercontinental hops land "Good". The
 * boundary is not arbitrary — `gatewayQuality` weights load 0.6 / latency 0.4,
 * so at 0% load "Excellent" (score >= 78) needs <= 247 ms. Australia at 254 ms
 * deliberately sits just the other side of it: a list where every single row
 * says "Excellent" reads as fake, and would also misrepresent what a
 * trans-Pacific hop costs.
 */
const LATENCY_MS: Readonly<Record<string, number>> = {
  de: 12,
  nl: 19,
  fr: 24,
  cz: 27,
  gb: 28,
  at: 31,
  pl: 34,
  it: 38,
  ch: 22,
  es: 45,
  se: 41,
  fi: 42,
  ru: 48,
  ae: 118,
  us: 92,
  ca: 104,
  mx: 142,
  br: 178,
  za: 168,
  in: 132,
  hk: 196,
  sg: 168,
  my: 189,
  jp: 224,
  kr: 236,
  au: 254,
};

/** Fallback for a country not in the table — mid-range, still "Good". */
const DEFAULT_LATENCY_MS = 148;

/**
 * Deterministic 0-11 ms spread derived from the gateway IP, so several nodes in
 * one country don't all report an identical figure (which is the tell that a
 * list is mocked). Deterministic rather than random so repeated captures of the
 * same frame are pixel-identical and a retake doesn't reshuffle the numbers.
 */
function jitter(ip: string): number {
  let h = 0;
  for (let i = 0; i < ip.length; i += 1) {
    h = (h * 31 + ip.charCodeAt(i)) % 997;
  }
  return h % 12;
}

/** Demo latency for one gateway, in ms. */
export function demoLatency(gw: GatewayInfo): number {
  const base = LATENCY_MS[gw.country.toLowerCase()] ?? DEFAULT_LATENCY_MS;
  return base + jitter(gw.ip);
}

/** The session the connected hero frame shows. */
export interface DemoSession {
  readonly entry: RouteEndpoint;
  /** Unix-ms the session started — fixed offset so the timer reads 3m 01s. */
  readonly connectedSince: number;
  /** Bytes/sec. Deliberately under the free tier's 100 KB/s ceiling. */
  readonly speed: { readonly down: number; readonly up: number };
  readonly pingMs: number;
}

/**
 * Build the demo session. Prefers the country the picker currently has selected
 * so the hero matches whatever was chosen before the capture; falls back to the
 * Netherlands, the fleet's best-connected European exit.
 */
export function demoSession(entry: RouteEndpoint | null): DemoSession {
  const fallback: RouteEndpoint = {
    code: 'NL',
    flag: '🇳🇱',
    name: 'Netherlands',
    city: 'Amsterdam',
    ip: '185.201.148.62',
    controlUrl: 'http://185.201.148.62:51821',
  };
  const hop = entry ?? fallback;
  return {
    entry: hop,
    // 3m 01s ago — long enough to look like a real session, short enough that
    // the duration stays two digits and the layout never reflows.
    connectedSince: Date.now() - 181_000,
    speed: { down: 94_208, up: 11_776 },
    pingMs: LATENCY_MS[hop.code.toLowerCase()] ?? DEFAULT_LATENCY_MS,
  };
}
