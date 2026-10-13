/**
 * JS bridge to the native identity backup.
 *
 * Android keeps the copy in Google's Block Store (survives uninstall, moves to
 * a new phone, and goes to the cloud only when that copy is end-to-end
 * encrypted); iOS keeps it in the Keychain (survives delete + reinstall; not
 * synced to the Apple ID's other devices). See the native files for why.
 *
 * iOS keeps TWO Keychain copies (state/identity.ts reads them in this order):
 *  - `CumulusIdentity`: the app's default access group. It is prefixed with the
 *    Apple team ID, so builds from another team (after an App Store transfer)
 *    can't read it.
 *  - `CumulusIdentityShared`: the App Group access group
 *    (`group.com.cumulusvpn.app`). It has no team prefix and moves with the app
 *    group, so it survives the transfer.
 * Android has only the first; the second reports "unavailable" there.
 *
 * The native side stores an opaque string — the checksummed recovery key — and
 * never interprets it. Absent the native module (Jest, a build without it)
 * every call reports "unavailable" rather than throwing: a missing backup must
 * never stop the app from starting.
 */
import { NativeModules, Platform } from 'react-native';

/** Where a saved copy lives: Google's cloud (E2EE), this device only, or nowhere. */
export type BackupWhere = 'cloud' | 'device' | 'unavailable';

/** A read: the stored value (null = nothing stored), or no backup on this device. */
export type BackupRead =
  { readonly status: 'ok'; readonly value: string | null } | { readonly status: 'unavailable' };

type NativeRead = Promise<{ status: string; value?: string | null }>;

interface CumulusIdentityModule {
  save(secret: string): Promise<BackupWhere>;
  /** Rejects when the store could not answer — "unknown", not "empty". */
  load(): NativeRead;
  remove(): Promise<boolean>;
  /** iOS only: the same three against the App Group access group. */
  saveShared?(secret: string): Promise<BackupWhere>;
  loadShared?(): NativeRead;
  removeShared?(): Promise<boolean>;
}

/** One place a copy lives (structurally a `BackupPort`, state/identity.ts). */
export interface IdentityBackupPlace {
  /** Store the secret. Rejects on a store failure. */
  save(secret: string): Promise<BackupWhere>;
  /** Read the secret. Rejects when the store could not answer. */
  load(): Promise<BackupRead>;
  /** Delete the secret (and, on Android, its cloud copy on the next sync). */
  remove(): Promise<boolean>;
}

const native = NativeModules.CumulusIdentity as CumulusIdentityModule | undefined;

function place(
  save: ((secret: string) => Promise<BackupWhere>) | undefined,
  load: (() => NativeRead) | undefined,
  remove: (() => Promise<boolean>) | undefined,
): IdentityBackupPlace {
  return {
    async save(secret: string): Promise<BackupWhere> {
      return save ? save(secret) : 'unavailable';
    },
    async load(): Promise<BackupRead> {
      if (!load) {
        return { status: 'unavailable' };
      }
      const r = await load();
      if (r.status !== 'ok') {
        return { status: 'unavailable' };
      }
      return {
        status: 'ok',
        value: typeof r.value === 'string' && r.value !== '' ? r.value : null,
      };
    },
    async remove(): Promise<boolean> {
      return remove ? remove() : false;
    },
  };
}

/** Block Store (Android) / the app's default Keychain access group (iOS). */
export const CumulusIdentity: IdentityBackupPlace = place(
  native?.save.bind(native),
  native?.load.bind(native),
  native?.remove.bind(native),
);

/** iOS: the App Group Keychain access group. Elsewhere: always "unavailable". */
export const CumulusIdentityShared: IdentityBackupPlace = place(
  native?.saveShared?.bind(native),
  native?.loadShared?.bind(native),
  native?.removeShared?.bind(native),
);

/** Every place this platform keeps the backup, in the order a restore reads them. */
export const IDENTITY_BACKUPS: readonly IdentityBackupPlace[] =
  Platform.OS === 'ios' ? [CumulusIdentity, CumulusIdentityShared] : [CumulusIdentity];
