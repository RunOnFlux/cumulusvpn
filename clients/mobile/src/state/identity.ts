/**
 * The device identity across uninstalls: load it, bring it back from the
 * backup, and keep the backup in step.
 *
 * The identity IS the WireGuard keypair — its payment code is what premium is
 * paid to — so losing it loses the premium. The app's own storage is wiped on
 * uninstall; the backup (native/CumulusIdentity: Block Store on Android, the
 * Keychain on iOS) is not. On a fresh install the backup, when there is one,
 * becomes this device's identity again.
 *
 * One rule decides everything here: NEVER overwrite a backup that holds a
 * different valid identity. It may be the one with paid premium — e.g. this
 * install began while the backup was momentarily unreadable and minted a new
 * key. Such a backup is reported as `other`, for the user to switch back to or
 * deliberately replace; nothing replaces it silently.
 */
import {
  decodeRecoveryKey,
  encodeRecoveryKey,
  generateKeypair,
  paymentCode,
  type Keypair,
} from '@cumulusvpn/core';
import type { BackupRead, BackupWhere } from '../native/CumulusIdentity';

/** The native backup, injectable for tests. */
export interface BackupPort {
  save(secret: string): Promise<BackupWhere>;
  /** Rejects when the store could not answer. */
  load(): Promise<BackupRead>;
  remove(): Promise<boolean>;
}

/** The app's own key storage (AsyncStorage in the app), injectable for tests. */
export interface KeyStore {
  load(): Promise<Keypair | null>;
  save(kp: Keypair): Promise<void>;
}

/** What Settings shows about the backup. */
export interface BackupStatus {
  /** Where the copy lives; null when backup is off or couldn't be confirmed this launch. */
  readonly where: BackupWhere | null;
  /** A DIFFERENT identity found in the backup and not adopted — offer to switch to it. */
  readonly other: { readonly code: string } | null;
}

export interface ResolvedIdentity {
  readonly keypair: Keypair;
  /** True when this launch brought the identity back from the backup. */
  readonly restored: boolean;
  readonly backup: BackupStatus;
}

export const BACKUP_OFF: BackupStatus = { where: null, other: null };

function parse(value: string): Keypair | null {
  try {
    return decodeRecoveryKey(value);
  } catch {
    return null;
  }
}

/** The identity held in the backup, or null when there is none (or it can't be read). */
export async function readBackedUp(backup: BackupPort): Promise<Keypair | null> {
  try {
    const read = await backup.load();
    return read.status === 'ok' && read.value !== null ? parse(read.value) : null;
  } catch {
    return null;
  }
}

/** Write `keypair` to the backup, replacing whatever is there. Deliberate actions only. */
export async function overwriteBackup(keypair: Keypair, backup: BackupPort): Promise<BackupStatus> {
  try {
    return { where: await backup.save(encodeRecoveryKey(keypair.privateKey)), other: null };
  } catch {
    return BACKUP_OFF;
  }
}

/**
 * Bring the backup in line with `keypair`: write it when the backup is empty
 * (or holds garbage) or already holds this key; report — never overwrite — a
 * backup holding a different identity; touch nothing when it can't be read.
 */
export async function syncBackup(keypair: Keypair, backup: BackupPort): Promise<BackupStatus> {
  let read: BackupRead;
  try {
    read = await backup.load();
  } catch {
    return BACKUP_OFF;
  }
  if (read.status === 'unavailable') {
    return { where: 'unavailable', other: null };
  }
  const stored = read.value === null ? null : parse(read.value);
  if (stored && stored.privateKey !== keypair.privateKey) {
    return { where: null, other: { code: paymentCode(stored.publicKey) } };
  }
  return overwriteBackup(keypair, backup);
}

/**
 * The identity to run with this launch. Existing key → keep it (and sync the
 * backup). No key → the backup's, when it holds one; otherwise a new key, which
 * is written to the backup only if the backup was READ as empty.
 */
export async function resolveIdentity(
  store: KeyStore,
  backup: BackupPort,
  backupEnabled: boolean,
): Promise<ResolvedIdentity> {
  const local = await store.load();
  if (local) {
    return {
      keypair: local,
      restored: false,
      backup: backupEnabled ? await syncBackup(local, backup) : BACKUP_OFF,
    };
  }

  let read: BackupRead | null = null;
  if (backupEnabled) {
    try {
      read = await backup.load();
    } catch {
      // Unknown, not empty: don't adopt, don't overwrite (see syncBackup).
    }
  }
  const stored = read?.status === 'ok' && read.value !== null ? parse(read.value) : null;
  if (stored) {
    await store.save(stored);
    return { keypair: stored, restored: true, backup: await syncBackup(stored, backup) };
  }

  const fresh = generateKeypair();
  await store.save(fresh);
  return {
    keypair: fresh,
    restored: false,
    backup: read === null ? BACKUP_OFF : await syncBackup(fresh, backup),
  };
}
