/**
 * JS bridge to the native identity backup.
 *
 * Android keeps the copy in Google's Block Store (survives uninstall, moves to
 * a new phone, and goes to the cloud only when that copy is end-to-end
 * encrypted); iOS keeps it in the Keychain (survives delete + reinstall; not
 * synced to the Apple ID's other devices). See the native files for why.
 *
 * The native side stores an opaque string — the checksummed recovery key — and
 * never interprets it. Absent the native module (Jest, a build without it)
 * every call reports "unavailable" rather than throwing: a missing backup must
 * never stop the app from starting.
 */
import { NativeModules } from 'react-native';

/** Where a saved copy lives: Google's cloud (E2EE), this device only, or nowhere. */
export type BackupWhere = 'cloud' | 'device' | 'unavailable';

/** A read: the stored value (null = nothing stored), or no backup on this device. */
export type BackupRead =
  { readonly status: 'ok'; readonly value: string | null } | { readonly status: 'unavailable' };

interface CumulusIdentityModule {
  save(secret: string): Promise<BackupWhere>;
  /** Rejects when the store could not answer — "unknown", not "empty". */
  load(): Promise<{ status: string; value?: string | null }>;
  remove(): Promise<boolean>;
}

const native = NativeModules.CumulusIdentity as CumulusIdentityModule | undefined;

export const CumulusIdentity = {
  /** Store the secret. Rejects on a store failure. */
  async save(secret: string): Promise<BackupWhere> {
    return native ? native.save(secret) : 'unavailable';
  },
  /** Read the secret. Rejects when the store could not answer. */
  async load(): Promise<BackupRead> {
    if (!native) {
      return { status: 'unavailable' };
    }
    const r = await native.load();
    if (r.status !== 'ok') {
      return { status: 'unavailable' };
    }
    return { status: 'ok', value: typeof r.value === 'string' && r.value !== '' ? r.value : null };
  },
  /** Delete the secret (and, on Android, its cloud copy on the next sync). */
  async remove(): Promise<boolean> {
    return native ? native.remove() : false;
  },
};
