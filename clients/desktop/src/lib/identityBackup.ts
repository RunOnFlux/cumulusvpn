/**
 * Keep the device identity backed up in the OS credential store (macOS
 * Keychain, Windows Credential Manager, the Secret Service on Linux), and bring
 * it back from there when the app's own storage was wiped — the desktop port of
 * mobile's `state/identity.ts`.
 *
 * The identity IS the WireGuard keypair, and Premium is paid to its payment
 * code: losing it loses the Premium. `localStorage` goes with a reinstall or a
 * "reset app data"; the credential store does not.
 *
 * The one rule, as on mobile: NEVER overwrite a backup that holds a different
 * valid identity. It may be the one with paid Premium (this install minted a
 * fresh key while the store was momentarily unreadable, say). It is reported as
 * `other`, for the user to switch back to or deliberately replace. A store that
 * could not be read is never written, and neither is one holding something we
 * can't parse.
 *
 * Runs once in `main.tsx`, BEFORE the app renders, so every synchronous reader
 * of the identity (`loadOrCreateKeypair`) already sees the restored key.
 */
import { isTauri, invoke } from '@tauri-apps/api/core';
import type { Keypair } from '@cumulusvpn/core';
import { loadOrCreateKeypair, loadStoredKeypair, saveKeypair } from './storage.js';

export type BackupState =
  /** The credential store holds this device's identity. */
  | 'saved'
  /** This launch restored the identity from the credential store. */
  | 'restored'
  /** The store holds a DIFFERENT identity; left untouched. */
  | 'other'
  /** The store couldn't be read or written (or this isn't the desktop app). */
  | 'unavailable';

/** What the store returned: a blob, nothing, or a read failure. */
export type BackupRead =
  { readonly ok: true; readonly value: string | null } | { readonly ok: false };

export interface Plan {
  readonly state: BackupState;
  /** The identity this device should run (null: mint a fresh one). */
  readonly use: Keypair | null;
  /** Write `use` to the store. */
  readonly write: boolean;
  /** The different identity found in the store, when `state` is `other`. */
  readonly other: Keypair | null;
}

export function parseKeypair(raw: string | null): Keypair | null {
  if (!raw) {
    return null;
  }
  try {
    const p = JSON.parse(raw) as Partial<Keypair>;
    return typeof p.publicKey === 'string' &&
      typeof p.privateKey === 'string' &&
      p.publicKey.length > 0 &&
      p.privateKey.length > 0
      ? { publicKey: p.publicKey, privateKey: p.privateKey }
      : null;
  } catch {
    return null;
  }
}

/** Pure: decide what to do from the local identity and the store's contents. */
export function planBackup(local: Keypair | null, read: BackupRead): Plan {
  if (!read.ok) {
    return { state: 'unavailable', use: local, write: false, other: null };
  }
  if (read.value === null) {
    // Nothing backed up yet: back up whatever this device runs (a fresh key
    // on a first launch).
    return { state: 'saved', use: local, write: true, other: null };
  }
  const backup = parseKeypair(read.value);
  if (!backup) {
    // Something we can't read sits there — never replace it blindly.
    return { state: 'unavailable', use: local, write: false, other: null };
  }
  if (!local) {
    return { state: 'restored', use: backup, write: false, other: null };
  }
  if (local.privateKey === backup.privateKey) {
    return { state: 'saved', use: local, write: false, other: null };
  }
  return { state: 'other', use: local, write: false, other: backup };
}

let current: { state: BackupState; other: Keypair | null } = {
  state: 'unavailable',
  other: null,
};

/** The outcome of this launch's reconcile, for Settings → Identity. */
export function backupStatus(): { readonly state: BackupState; readonly other: Keypair | null } {
  return current;
}

async function readStore(): Promise<BackupRead> {
  try {
    return { ok: true, value: await invoke<string | null>('identity_backup_get') };
  } catch {
    return { ok: false };
  }
}

/** Write `keypair` to the store. Resolves false if the store refused it. */
export async function writeBackup(keypair: Keypair): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }
  try {
    await invoke('identity_backup_set', { value: JSON.stringify(keypair) });
    return true;
  } catch {
    return false;
  }
}

/** Run once at startup, before the app renders. Never throws. */
export async function reconcileIdentity(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  const plan = planBackup(loadStoredKeypair(), await readStore());
  if (plan.use) {
    saveKeypair(plan.use);
  }
  // Mint now (if needed) so the key that gets backed up is the one in use.
  const inUse = plan.use ?? loadOrCreateKeypair();
  let state = plan.state;
  if (plan.write && !(await writeBackup(inUse))) {
    state = 'unavailable';
  }
  current = { state, other: plan.other };
}

/** The user chose to make this device's identity the backed-up one. */
export async function replaceBackupWithThisDevice(): Promise<boolean> {
  const ok = await writeBackup(loadOrCreateKeypair());
  if (ok) {
    current = { state: 'saved', other: null };
  }
  return ok;
}

/** Where the backup lives, in the platform's own words. */
export function storeName(platform: string = navigator.userAgent): string {
  if (/Mac/i.test(platform)) {
    return 'the macOS Keychain';
  }
  if (/Win/i.test(platform)) {
    return 'Windows Credential Manager';
  }
  return 'the system keyring';
}
