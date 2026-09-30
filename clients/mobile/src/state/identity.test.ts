import { encodeRecoveryKey, generateKeypair, paymentCode, type Keypair } from '@cumulusvpn/core';
import type { BackupRead, BackupWhere } from '../native/CumulusIdentity';
import { resolveIdentity, syncBackup, type BackupPort, type KeyStore } from './identity';

/** An in-memory backup; `failRead` makes load() reject (store couldn't answer). */
function fakeBackup(
  initial: string | null = null,
  opts: { failRead?: boolean; unavailable?: boolean } = {},
) {
  const state = { value: initial, saves: 0, failRead: opts.failRead ?? false };
  const port: BackupPort = {
    async save(secret: string): Promise<BackupWhere> {
      if (opts.unavailable) {
        return 'unavailable';
      }
      state.value = secret;
      state.saves += 1;
      return 'cloud';
    },
    async load(): Promise<BackupRead> {
      if (state.failRead) {
        throw new Error('block store unavailable right now');
      }
      return opts.unavailable ? { status: 'unavailable' } : { status: 'ok', value: state.value };
    },
    async remove(): Promise<boolean> {
      state.value = null;
      return true;
    },
  };
  return { port, state };
}

function fakeStore(initial: Keypair | null = null) {
  const state = { kp: initial };
  const store: KeyStore = {
    load: async () => state.kp,
    save: async (kp) => {
      state.kp = kp;
    },
  };
  return { store, state };
}

const secret = (kp: Keypair) => encodeRecoveryKey(kp.privateKey);

describe('resolveIdentity', () => {
  it('keeps the existing key and backs it up when the backup is empty', async () => {
    const kp = generateKeypair();
    const b = fakeBackup();
    const r = await resolveIdentity(fakeStore(kp).store, b.port, true);
    expect(r.keypair).toEqual(kp);
    expect(r.restored).toBe(false);
    expect(r.backup).toEqual({ where: 'cloud', other: null });
    expect(b.state.value).toBe(secret(kp));
  });

  it('brings the identity back on a fresh install (the uninstall case)', async () => {
    const paid = generateKeypair();
    const s = fakeStore();
    const r = await resolveIdentity(s.store, fakeBackup(secret(paid)).port, true);
    expect(r.keypair).toEqual(paid);
    expect(r.restored).toBe(true);
    expect(s.state.kp).toEqual(paid);
  });

  it('mints and backs up a new key when there is nothing to restore', async () => {
    const b = fakeBackup();
    const s = fakeStore();
    const r = await resolveIdentity(s.store, b.port, true);
    expect(r.restored).toBe(false);
    expect(s.state.kp).toEqual(r.keypair);
    expect(b.state.value).toBe(secret(r.keypair));
  });

  it('never overwrites a backup it could not read', async () => {
    const paid = generateKeypair();
    const b = fakeBackup(secret(paid), { failRead: true });
    const r = await resolveIdentity(fakeStore().store, b.port, true);
    expect(r.keypair).not.toEqual(paid);
    expect(b.state.saves).toBe(0);
    expect(b.state.value).toBe(secret(paid));

    // Next launch the backup answers: the paid identity is offered, not replaced.
    b.state.failRead = false;
    const next = await syncBackup(r.keypair, b.port);
    expect(next.other).toEqual({ code: paymentCode(paid.publicKey) });
    expect(b.state.value).toBe(secret(paid));
  });

  it('reports a different backed-up identity instead of replacing it', async () => {
    const local = generateKeypair();
    const other = generateKeypair();
    const b = fakeBackup(secret(other));
    const r = await resolveIdentity(fakeStore(local).store, b.port, true);
    expect(r.keypair).toEqual(local);
    expect(r.backup).toEqual({ where: null, other: { code: paymentCode(other.publicKey) } });
    expect(b.state.value).toBe(secret(other));
  });

  it('replaces a corrupt backup', async () => {
    const kp = generateKeypair();
    const b = fakeBackup('CVPN-not-a-real-key');
    const r = await resolveIdentity(fakeStore(kp).store, b.port, true);
    expect(r.backup.where).toBe('cloud');
    expect(b.state.value).toBe(secret(kp));
  });

  it('leaves the backup alone when the user turned it off', async () => {
    const paid = generateKeypair();
    const b = fakeBackup(secret(paid));
    const r = await resolveIdentity(fakeStore().store, b.port, false);
    expect(r.keypair).not.toEqual(paid);
    expect(r.backup).toEqual({ where: null, other: null });
    expect(b.state.saves).toBe(0);
  });

  it('says so when this device has no backup at all', async () => {
    const r = await resolveIdentity(
      fakeStore().store,
      fakeBackup(null, { unavailable: true }).port,
      true,
    );
    expect(r.backup).toEqual({ where: 'unavailable', other: null });
  });
});
