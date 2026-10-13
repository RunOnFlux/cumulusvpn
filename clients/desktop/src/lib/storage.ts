/**
 * Local persistence for the identity keypair, last-selected country, and the
 * tunnel settings that are read at connect time (split tunneling, DNS).
 *
 * The WireGuard keypair is the identity: it enrolls at many gateways, and
 * entitlement follows the key on the chain (see `docs/05-clients.md`), not the
 * computer — the recovery key (Settings → Identity) carries it to another
 * device. Kept in the webview's `localStorage` by owner decision; the OS
 * keychain (macOS Keychain / Windows Credential Manager / libsecret) via a
 * Tauri command is the hardening path.
 */
import {
  EMPTY_POLICY,
  generateKeypair,
  parseDnsChoice,
  sanitizeSplitPolicy,
} from '@cumulusvpn/core';
import type { DnsChoice, Keypair, SplitPolicy } from '@cumulusvpn/core';

const KEYPAIR_KEY = 'cvpn.keypair.v1';
const COUNTRY_KEY = 'cvpn.country.v1';
const SPLIT_KEY = 'cvpn.split.v1';
const DNS_KEY = 'cvpn.dns.v1';

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / headless) — session-only is fine */
  }
}

/** Load the persisted device keypair, generating and storing one on first run. */
export function loadOrCreateKeypair(): Keypair {
  const raw = safeGet(KEYPAIR_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Keypair>;
      if (
        typeof parsed.publicKey === 'string' &&
        typeof parsed.privateKey === 'string' &&
        parsed.publicKey.length > 0 &&
        parsed.privateKey.length > 0
      ) {
        return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
      }
    } catch {
      /* fall through and regenerate */
    }
  }
  const fresh = generateKeypair();
  saveKeypair(fresh);
  return fresh;
}

/** Make `keypair` this device's identity (e.g. one restored from a recovery key). */
export function saveKeypair(keypair: Keypair): void {
  safeSet(KEYPAIR_KEY, JSON.stringify(keypair));
}

/** Read the last-selected country code, if any. */
export function loadSelectedCountry(): string | null {
  return safeGet(COUNTRY_KEY);
}

/** Persist the user's selected country code. */
export function saveSelectedCountry(code: string): void {
  safeSet(COUNTRY_KEY, code);
}

/**
 * Load the split-tunneling policy. Anything absent, corrupt or from a future
 * schema collapses to EMPTY_POLICY — full tunnel, never a partially-applied
 * policy (docs/17 §3.4). The rule list is sensitive (it fingerprints what the
 * user runs): it stays on-device and must never enter logs or support bundles.
 */
export function loadSplitPolicy(): SplitPolicy {
  const raw = safeGet(SPLIT_KEY);
  if (!raw) {
    return EMPTY_POLICY;
  }
  try {
    return sanitizeSplitPolicy(JSON.parse(raw));
  } catch {
    return EMPTY_POLICY;
  }
}

/** Persist the split-tunneling policy (device-local only, by design). */
export function saveSplitPolicy(policy: SplitPolicy): void {
  safeSet(SPLIT_KEY, JSON.stringify(policy));
}

/**
 * Load the DNS choice (Settings → DNS). Absent, corrupt, or an option a newer
 * build added all read as the default, so a bad value can never block a
 * connect. Device-local, like every tunnel setting.
 */
export function loadDnsChoice(): DnsChoice {
  return parseDnsChoice(safeGet(DNS_KEY));
}

/** Persist the DNS choice; it takes effect on the next connect. */
export function saveDnsChoice(choice: DnsChoice): void {
  safeSet(DNS_KEY, choice);
}
