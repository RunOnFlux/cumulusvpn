import { EMPTY_POLICY, sanitizeSplitPolicy } from '@cumulusvpn/core';
import type { SplitPolicy } from '@cumulusvpn/core';

const SPLIT_STORAGE_KEY = 'cvpn.split.v1';

/**
 * Load the split-tunneling policy for the `.conf` generator. On web only CIDR
 * rules and LAN bypass matter — the stock WireGuard app consuming the config
 * can only express inclusion via `AllowedIPs` (docs/17 §4.6).
 *
 * Anything absent, corrupt or from a future schema collapses to EMPTY_POLICY —
 * full tunnel, never a partially-applied policy (docs/17 §3.4).
 */
export function loadSplitPolicy(): SplitPolicy {
  try {
    const stored = localStorage.getItem(SPLIT_STORAGE_KEY);
    if (stored) {
      return sanitizeSplitPolicy(JSON.parse(stored));
    }
  } catch {
    // Corrupt or unavailable storage — full tunnel.
  }
  return EMPTY_POLICY;
}

/** Persist the split-tunneling policy (device-local only, by design). */
export function saveSplitPolicy(policy: SplitPolicy): void {
  try {
    localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify(policy));
  } catch {
    // Storage disabled (private mode) — the policy still applies this session.
  }
}
