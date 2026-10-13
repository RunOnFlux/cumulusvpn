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
 * The backup can live in more than one place (`Backups`, in the order a restore
 * reads them). Android has one: Block Store. iOS has two Keychain copies: the
 * app's default access group, which is prefixed with the Apple team ID, and the
 * App Group access group, which is not. An App Store transfer to another team
 * makes the first unreadable to the new team's builds; the second moves with
 * the app group. A restore reads them in order and takes the first identity it
 * finds.
 *
 * One rule decides everything here, separately for EACH place: NEVER overwrite
 * a copy that holds a different valid identity. It may be the one with paid
 * premium, e.g. this install began while the backup was momentarily unreadable
 * and minted a new key. Such a copy is reported as `other`, for the user to
 * switch back to or deliberately replace; nothing replaces it silently. Two
 * places that disagree are the same case: the copy that differs from this
 * device is the `other`. And a place that could not be read is never written.
 */
import {
  decodeRecoveryKey,
  encodeRecoveryKey,
  generateKeypair,
  paymentCode,
  type Keypair,
} from '@cumulusvpn/core';
import type { BackupRead, BackupWhere } from '../native/CumulusIdentity';

/** One place the native backup keeps a copy, injectable for tests. */
export interface BackupPort {
  save(secret: string): Promise<BackupWhere>;
  /** Rejects when the store could not answer. */
  load(): Promise<BackupRead>;
  remove(): Promise<boolean>;
}

/** Every place the backup lives, in the order a restore reads them. */
export type Backups = readonly BackupPort[];

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

/** What one place answered. */
type Slot =
  /** The store could not answer: may hold anything, so it is never written. */
  | { readonly kind: 'unknown' }
  /** No backup of this kind on this device (or in this build). */
  | { readonly kind: 'unavailable' }
  /** Nothing stored, or something that isn't a recovery key. */
  | { readonly kind: 'empty' }
  | { readonly kind: 'held'; readonly keypair: Keypair };

function parse(value: string): Keypair | null {
  try {
    return decodeRecoveryKey(value);
  } catch {
    return null;
  }
}

const codeOf = (kp: Keypair): string => paymentCode(kp.publicKey);

async function readSlot(port: BackupPort): Promise<Slot> {
  let read: BackupRead;
  try {
    read = await port.load();
  } catch {
    return { kind: 'unknown' };
  }
  if (read.status === 'unavailable') {
    return { kind: 'unavailable' };
  }
  const keypair = read.value === null ? null : parse(read.value);
  return keypair ? { kind: 'held', keypair } : { kind: 'empty' };
}

async function readSlots(backups: Backups): Promise<Slot[]> {
  const slots: Slot[] = [];
  for (const port of backups) {
    slots.push(await readSlot(port));
  }
  return slots;
}

/** The first identity held, in read order: what a reinstall would bring back. */
function firstHeld(slots: readonly Slot[]): Keypair | null {
  for (const s of slots) {
    if (s.kind === 'held') {
      return s.keypair;
    }
  }
  return null;
}

/** Write one place; null when the write failed. */
async function write(port: BackupPort, keypair: Keypair): Promise<BackupWhere | null> {
  try {
    return await port.save(encodeRecoveryKey(keypair.privateKey));
  } catch {
    return null;
  }
}

/**
 * Where the backup lives after a round of writes (`saved[i]` = what place i
 * answered, null when not written): the first place that took it, in read
 * order; 'unavailable' when no place exists on this device; else unconfirmed.
 */
function whereOf(
  slots: readonly Slot[],
  saved: readonly (BackupWhere | null)[],
): BackupWhere | null {
  const took = saved.find((w) => w === 'cloud' || w === 'device');
  if (took) {
    return took;
  }
  const none = slots.every((s, i) => s.kind === 'unavailable' || saved[i] === 'unavailable');
  return none ? 'unavailable' : null;
}

/**
 * Write `keypair` to every place that answered and holds nothing (or garbage),
 * this same identity, or one of the identities in `replacing`. A place holding
 * any OTHER identity is left alone and reported as `other`; a place that could
 * not be read is left alone.
 */
async function writeAll(
  keypair: Keypair,
  backups: Backups,
  slots: readonly Slot[],
  replacing: readonly string[],
): Promise<BackupStatus> {
  const allowed = new Set([codeOf(keypair), ...replacing]);
  let other: string | null = null;
  const saved: (BackupWhere | null)[] = [];
  for (const [i, s] of slots.entries()) {
    const port = backups[i];
    if (s.kind === 'held' && !allowed.has(codeOf(s.keypair))) {
      other ??= codeOf(s.keypair);
      saved.push(null);
    } else if (port && (s.kind === 'empty' || s.kind === 'held')) {
      saved.push(await write(port, keypair));
    } else {
      saved.push(null);
    }
  }
  return other
    ? { where: null, other: { code: other } }
    : { where: whereOf(slots, saved), other: null };
}

/**
 * The identity held in the backup, or null when there is none (or it can't be
 * read). With `code`, only that identity, from whichever place holds it.
 */
export async function readBackedUp(backups: Backups, code?: string): Promise<Keypair | null> {
  for (const s of await readSlots(backups)) {
    if (s.kind === 'held' && (code === undefined || codeOf(s.keypair) === code)) {
      return s.keypair;
    }
  }
  return null;
}

/**
 * Make `keypair` the backup. Deliberate actions only: `replacing` names the
 * identities (payment codes) the user just agreed to replace. A copy of any
 * other identity still stays, reported as `other`, and a place that can't be
 * read is still not written.
 */
export async function replaceBackup(
  keypair: Keypair,
  backups: Backups,
  replacing: readonly string[],
): Promise<BackupStatus> {
  return writeAll(keypair, backups, await readSlots(backups), replacing);
}

/**
 * Bring the backup in line with `keypair`: write it where a place is empty (or
 * holds garbage) or already holds this key; report — never overwrite — a place
 * holding a different identity; touch nothing that can't be read.
 *
 * While a different identity is reported, the backup is paused for this key,
 * but an empty place still gets a copy of the identity a restore would bring
 * back now, so that identity is not lost with the place that holds it (on iOS:
 * the team-bound copy, after an App Store transfer).
 */
export async function syncBackup(keypair: Keypair, backups: Backups): Promise<BackupStatus> {
  const slots = await readSlots(backups);
  const differs = slots.find(
    (s): s is Extract<Slot, { kind: 'held' }> =>
      s.kind === 'held' && s.keypair.privateKey !== keypair.privateKey,
  );
  if (!differs) {
    return writeAll(keypair, backups, slots, []);
  }
  const backedUp = firstHeld(slots) ?? differs.keypair;
  for (const [i, s] of slots.entries()) {
    const port = backups[i];
    if (port && s.kind === 'empty') {
      await write(port, backedUp);
    }
  }
  return { where: null, other: { code: codeOf(differs.keypair) } };
}

/** Delete every copy (the user turned the backup off). Best effort per place. */
export async function removeBackup(backups: Backups): Promise<void> {
  for (const port of backups) {
    try {
      await port.remove();
    } catch {
      // Still off: the switch is the user's word, and a leftover copy is
      // removed on the next remove() or overwritten when turned back on.
    }
  }
}

/**
 * The identity to run with this launch. Existing key → keep it (and sync the
 * backup). No key → the backup's, when it holds one (the first place in read
 * order that does); otherwise a new key, which is written to the backup only
 * if EVERY place was read: one that couldn't answer may hold the paid identity.
 */
export async function resolveIdentity(
  store: KeyStore,
  backups: Backups,
  backupEnabled: boolean,
): Promise<ResolvedIdentity> {
  const local = await store.load();
  if (local) {
    return {
      keypair: local,
      restored: false,
      backup: backupEnabled ? await syncBackup(local, backups) : BACKUP_OFF,
    };
  }

  const slots = backupEnabled ? await readSlots(backups) : [];
  const stored = firstHeld(slots);
  if (stored) {
    await store.save(stored);
    return { keypair: stored, restored: true, backup: await syncBackup(stored, backups) };
  }

  const fresh = generateKeypair();
  await store.save(fresh);
  const allAnswered = backupEnabled && slots.every((s) => s.kind !== 'unknown');
  return {
    keypair: fresh,
    restored: false,
    backup: allAnswered ? await syncBackup(fresh, backups) : BACKUP_OFF,
  };
}
