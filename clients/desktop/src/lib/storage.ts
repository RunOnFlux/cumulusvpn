/**
 * Local persistence for the device keypair and last-selected country.
 *
 * One WireGuard keypair per device enrolls at many gateways; entitlement
 * follows the key on the chain (see `docs/05-clients.md`). // POC: stored in
 * `localStorage`; a real desktop build persists the private key in the OS
 * keychain (macOS Keychain / Windows Credential Manager / libsecret) via a
 * Tauri command, never in the webview's storage.
 */
import { generateKeypair } from '@cumulusvpn/core';
import type { Keypair } from '@cumulusvpn/core';

const KEYPAIR_KEY = 'cvpn.keypair.v1';
const COUNTRY_KEY = 'cvpn.country.v1';

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
  safeSet(KEYPAIR_KEY, JSON.stringify(fresh));
  return fresh;
}

/** Read the last-selected country code, if any. */
export function loadSelectedCountry(): string | null {
  return safeGet(COUNTRY_KEY);
}

/** Persist the user's selected country code. */
export function saveSelectedCountry(code: string): void {
  safeSet(COUNTRY_KEY, code);
}
