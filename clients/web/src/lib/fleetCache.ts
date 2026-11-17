/**
 * The discovered fleet from this browser's last visit, so the location list
 * shows at once instead of after a full discovery (several seconds through the
 * site's Worker). The live discovery always runs and replaces it; the desktop
 * app keeps the same cache (clients/desktop/src/lib/storage.ts).
 *
 * Every entry is a gateway's own signed `/v1/info` as verified on that visit;
 * a stale one can only point at a node that has since gone, which the live
 * discovery corrects a few seconds later.
 */
import type { GatewayInfo } from '@cumulusvpn/core';

const KEY = 'cvpn.web.fleet.v1';

/** Older than this, the list is too likely to have moved to be worth showing. */
export const FLEET_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface FleetCache {
  readonly at: number;
  readonly gateways: readonly GatewayInfo[];
  /** Probe time (ms) by gateway IP from that visit. */
  readonly times: Readonly<Record<string, number>>;
}

function isFleetCache(v: unknown): v is FleetCache {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const c = v as Record<string, unknown>;
  return (
    typeof c.at === 'number' &&
    Array.isArray(c.gateways) &&
    c.gateways.every(
      (g) =>
        typeof g === 'object' &&
        g !== null &&
        typeof (g as Record<string, unknown>).ip === 'string' &&
        typeof (g as Record<string, unknown>).country === 'string',
    ) &&
    typeof c.times === 'object' &&
    c.times !== null
  );
}

/** The cached fleet, or null when there is none, it is unreadable or too old. */
export function loadFleetCache(now: number): FleetCache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isFleetCache(parsed) || parsed.gateways.length === 0) {
      return null;
    }
    if (now - parsed.at > FLEET_CACHE_MAX_AGE_MS || parsed.at > now + 60_000) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveFleetCache(cache: FleetCache): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private mode / quota: the next visit simply discovers from scratch.
  }
}
