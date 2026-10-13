import { DEFAULT_DNS, parseDnsChoice } from '@cumulusvpn/core';
import type { DnsChoice } from '@cumulusvpn/core';
import { DNS_STORAGE_KEY } from '../config';

/**
 * Load the DNS choice for the `.conf` generators. Anything absent, corrupt or
 * unknown (an option a newer build added) falls back to the default, so a bad
 * value can never block generating a config.
 */
export function loadDnsChoice(): DnsChoice {
  try {
    return parseDnsChoice(localStorage.getItem(DNS_STORAGE_KEY));
  } catch {
    // Storage unavailable (private mode) — the default.
    return DEFAULT_DNS;
  }
}

/** Persist the DNS choice (device-local only — it never leaves this browser). */
export function saveDnsChoice(choice: DnsChoice): void {
  try {
    localStorage.setItem(DNS_STORAGE_KEY, choice);
  } catch {
    // Storage disabled (private mode) — the choice still applies this session.
  }
}
