import { generateKeypair } from '@cumulusvpn/core';
import type { Keypair } from '@cumulusvpn/core';
import { KEYPAIR_STORAGE_KEY } from '../config';

/**
 * Load the persisted in-browser WireGuard keypair, or generate and store a
 * fresh one. Persistence keeps the derived payment code stable between the
 * Connect and Upgrade pages so a payment made now unlocks the config generated
 * earlier. The private key never leaves the browser.
 */
export function loadOrCreateKeypair(): Keypair {
  try {
    const stored = localStorage.getItem(KEYPAIR_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Keypair>;
      if (typeof parsed.publicKey === 'string' && typeof parsed.privateKey === 'string') {
        return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
      }
    }
  } catch {
    // Corrupt or unavailable storage — fall through and mint a new key.
  }
  return regenerateKeypair();
}

/** Generate a new keypair and persist it, replacing any existing one. */
export function regenerateKeypair(): Keypair {
  const keypair = generateKeypair();
  try {
    localStorage.setItem(KEYPAIR_STORAGE_KEY, JSON.stringify(keypair));
  } catch {
    // Storage disabled (private mode) — the key still works for this session.
  }
  return keypair;
}
