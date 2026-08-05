/**
 * Remembers which gateway issued the user's last `.conf`, so a return visit can
 * tell them it stopped working.
 *
 * The page could not do this before: only the keypair was persisted, so on a
 * second visit it had no idea which gateway the downloaded file pointed at and
 * could offer nothing but a manual regenerate. Storing the two pinned facts
 * makes the check possible — see `checkIssuedConfig` in core.
 *
 * Deliberately NOT stored: the config text or the private key beyond the
 * existing keypair entry. This record is a pointer, not a copy of the secret.
 */
import type { IssuedConfigRef } from '@cumulusvpn/core';
import { ISSUED_CONFIG_STORAGE_KEY } from '../config';

/** What we remember about the last issued config. */
export interface IssuedConfigRecord extends IssuedConfigRef {
  /** Country code it was issued for, so the banner can name the location. */
  readonly cc: string;
  /** ISO timestamp of issue, for display and future expiry policy. */
  readonly issuedAt: string;
}

/** Read the stored record; null when absent or unparseable. */
export function loadIssuedConfig(): IssuedConfigRecord | null {
  try {
    const raw = localStorage.getItem(ISSUED_CONFIG_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<IssuedConfigRecord>;
    if (!parsed.ip || !parsed.serverPubKey) {
      return null;
    }
    return {
      ip: parsed.ip,
      serverPubKey: parsed.serverPubKey,
      cc: parsed.cc ?? '',
      issuedAt: parsed.issuedAt ?? '',
    };
  } catch {
    // Private-mode / disabled storage: the check is a nicety, never a blocker.
    return null;
  }
}

/** Remember the gateway behind a freshly issued config. */
export function saveIssuedConfig(record: IssuedConfigRecord): void {
  try {
    localStorage.setItem(ISSUED_CONFIG_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Non-fatal: the user still has their config, they just won't get warned.
  }
}

/** Forget it — used when the identity keypair is regenerated, since every
 *  config issued against the old key is void anyway. */
export function clearIssuedConfig(): void {
  try {
    localStorage.removeItem(ISSUED_CONFIG_STORAGE_KEY);
  } catch {
    // ignore
  }
}
