import { encodeRecoveryKey, generateKeypair, paymentCode, type Keypair } from '@cumulusvpn/core';
import type { BackupRead, BackupWhere } from '../native/CumulusIdentity';
import {
  readBackedUp,
  removeBackup,
  replaceBackup,
  resolveIdentity,
  syncBackup,
  type BackupPort,
  type KeyStore,
} from './identity';

/** An in-memory backup; `failRead` makes load() reject (store couldn't answer). */
function fakeBackup(
  initial: string | null = null,
  opts: {
    failRead?: boolean;
    failWrite?: boolean;
    failRemove?: boolean;
    unavailable?: boolean;
    where?: BackupWhere;
  } = {},
) {
  const state = { value: initial, saves: 0, failRead: opts.failRead ?? false };
  const port: BackupPort = {
    async save(secret: string): Promise<BackupWhere> {
      if (opts.unavailable) {
        return 'unavailable';
      }
      if (opts.failWrite) {
        throw new Error('keychain write failed');
      }
      state.value = secret;
      state.saves += 1;
      return opts.where ?? 'cloud';
    },
    async load(): Promise<BackupRead> {
      if (state.failRead) {
        throw new Error('block store unavailable right now');
      }
      return opts.unavailable ? { status: 'unavailable' } : { status: 'ok', value: state.value };
    },
    async remove(): Promise<boolean> {
      if (opts.failRemove) {
        throw new Error('keychain delete failed');
      }
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
    const r = await resolveIdentity(fakeStore(kp).store, [b.port], true);
    expect(r.keypair).toEqual(kp);
    expect(r.restored).toBe(false);
    expect(r.backup).toEqual({ where: 'cloud', other: null });
    expect(b.state.value).toBe(secret(kp));
  });

  it('brings the identity back on a fresh install (the uninstall case)', async () => {
    const paid = generateKeypair();
    const s = fakeStore();
    const r = await resolveIdentity(s.store, [fakeBackup(secret(paid)).port], true);
    expect(r.keypair).toEqual(paid);
    expect(r.restored).toBe(true);
    expect(s.state.kp).toEqual(paid);
  });

  it('mints and backs up a new key when there is nothing to restore', async () => {
    const b = fakeBackup();
    const s = fakeStore();
    const r = await resolveIdentity(s.store, [b.port], true);
    expect(r.restored).toBe(false);
    expect(s.state.kp).toEqual(r.keypair);
    expect(b.state.value).toBe(secret(r.keypair));
  });

  it('never overwrites a backup it could not read', async () => {
    const paid = generateKeypair();
    const b = fakeBackup(secret(paid), { failRead: true });
    const r = await resolveIdentity(fakeStore().store, [b.port], true);
    expect(r.keypair).not.toEqual(paid);
    expect(b.state.saves).toBe(0);
    expect(b.state.value).toBe(secret(paid));

    // Next launch the backup answers: the paid identity is offered, not replaced.
    b.state.failRead = false;
    const next = await syncBackup(r.keypair, [b.port]);
    expect(next.other).toEqual({ code: paymentCode(paid.publicKey) });
    expect(b.state.value).toBe(secret(paid));
  });

  it('reports a different backed-up identity instead of replacing it', async () => {
    const local = generateKeypair();
    const other = generateKeypair();
    const b = fakeBackup(secret(other));
    const r = await resolveIdentity(fakeStore(local).store, [b.port], true);
    expect(r.keypair).toEqual(local);
    expect(r.backup).toEqual({ where: null, other: { code: paymentCode(other.publicKey) } });
    expect(b.state.value).toBe(secret(other));
  });

  it('replaces a corrupt backup', async () => {
    const kp = generateKeypair();
    const b = fakeBackup('CVPN-not-a-real-key');
    const r = await resolveIdentity(fakeStore(kp).store, [b.port], true);
    expect(r.backup.where).toBe('cloud');
    expect(b.state.value).toBe(secret(kp));
  });

  it('leaves the backup alone when the user turned it off', async () => {
    const paid = generateKeypair();
    const b = fakeBackup(secret(paid));
    const r = await resolveIdentity(fakeStore().store, [b.port], false);
    expect(r.keypair).not.toEqual(paid);
    expect(r.backup).toEqual({ where: null, other: null });
    expect(b.state.saves).toBe(0);
  });

  it('says so when this device has no backup at all', async () => {
    const r = await resolveIdentity(
      fakeStore().store,
      [fakeBackup(null, { unavailable: true }).port],
      true,
    );
    expect(r.backup).toEqual({ where: 'unavailable', other: null });
  });
});

/**
 * iOS keeps two copies: the default Keychain access group (team-bound, read
 * first) and the App Group access group (survives an App Store transfer).
 * `team` / `group` below stand for those two places.
 */
describe('two backup places (iOS: team access group + App Group)', () => {
  const code = (kp: Keypair) => paymentCode(kp.publicKey);

  it('copies an existing backup into the App Group on the first launch of this build', async () => {
    const kp = generateKeypair();
    const team = fakeBackup(secret(kp), { where: 'device' });
    const group = fakeBackup(null, { where: 'device' });
    const r = await resolveIdentity(fakeStore(kp).store, [team.port, group.port], true);
    expect(r.backup).toEqual({ where: 'device', other: null });
    expect(team.state.value).toBe(secret(kp));
    expect(group.state.value).toBe(secret(kp));
  });

  it('restores from the App Group copy after a transfer (team copy unreadable to the new team)', async () => {
    const paid = generateKeypair();
    const newTeam = fakeBackup(null, { where: 'device' }); // the old team's item is invisible
    const group = fakeBackup(secret(paid), { where: 'device' });
    const s = fakeStore();
    const r = await resolveIdentity(s.store, [newTeam.port, group.port], true);
    expect(r.keypair).toEqual(paid);
    expect(r.restored).toBe(true);
    expect(s.state.kp).toEqual(paid);
    // …and the new team's own default group gets a copy again.
    expect(newTeam.state.value).toBe(secret(paid));
    expect(r.backup).toEqual({ where: 'device', other: null });
  });

  it('reads the team copy first when both hold an identity, and reports the other one', async () => {
    const x = generateKeypair();
    const y = generateKeypair();
    const team = fakeBackup(secret(x));
    const group = fakeBackup(secret(y));
    const r = await resolveIdentity(fakeStore().store, [team.port, group.port], true);
    expect(r.keypair).toEqual(x);
    expect(r.backup).toEqual({ where: null, other: { code: code(y) } });
    expect(team.state.value).toBe(secret(x));
    expect(group.state.value).toBe(secret(y));
  });

  it('never overwrites a copy that disagrees with this device, in either place', async () => {
    const local = generateKeypair();
    const y = generateKeypair();
    const team = fakeBackup(secret(local));
    const group = fakeBackup(secret(y));
    const r = await syncBackup(local, [team.port, group.port]);
    expect(r).toEqual({ where: null, other: { code: code(y) } });
    expect(group.state.value).toBe(secret(y));
    expect(group.state.saves).toBe(0);

    // Same with the places swapped: the team copy differs.
    const team2 = fakeBackup(secret(y));
    const group2 = fakeBackup(secret(local));
    const r2 = await syncBackup(local, [team2.port, group2.port]);
    expect(r2).toEqual({ where: null, other: { code: code(y) } });
    expect(team2.state.value).toBe(secret(y));
    expect(team2.state.saves).toBe(0);
  });

  it('while paused, copies the identity a restore would bring back into an empty place', async () => {
    // This install minted Z while the team copy (X, maybe paid) was unreadable.
    // X must not be lost when the team copy becomes unreadable for good.
    const x = generateKeypair();
    const z = generateKeypair();
    const team = fakeBackup(secret(x));
    const group = fakeBackup(null);
    const r = await syncBackup(z, [team.port, group.port]);
    expect(r).toEqual({ where: null, other: { code: code(x) } });
    expect(team.state.value).toBe(secret(x));
    expect(group.state.value).toBe(secret(x));
  });

  it('never writes a place it could not read', async () => {
    const kp = generateKeypair();
    const paid = generateKeypair();
    const team = fakeBackup(secret(kp));
    const group = fakeBackup(secret(paid), { failRead: true });
    const r = await syncBackup(kp, [team.port, group.port]);
    expect(r.where).toBe('cloud');
    expect(team.state.value).toBe(secret(kp));
    expect(group.state.saves).toBe(0);
    expect(group.state.value).toBe(secret(paid));
  });

  it('a fresh install backs up a new key only when every place answered', async () => {
    const paid = generateKeypair();
    const team = fakeBackup(null);
    const group = fakeBackup(secret(paid), { failRead: true });
    const r = await resolveIdentity(fakeStore().store, [team.port, group.port], true);
    expect(r.keypair).not.toEqual(paid);
    expect(r.backup).toEqual({ where: null, other: null });
    expect(team.state.saves).toBe(0);
    expect(group.state.value).toBe(secret(paid));
  });

  it('restores from the App Group copy when the team copy cannot be read', async () => {
    const paid = generateKeypair();
    const team = fakeBackup(null, { failRead: true });
    const group = fakeBackup(secret(paid));
    const r = await resolveIdentity(fakeStore().store, [team.port, group.port], true);
    expect(r.keypair).toEqual(paid);
    expect(r.restored).toBe(true);
    expect(team.state.saves).toBe(0);
  });

  it('confirms the backup when only one place took the write', async () => {
    const kp = generateKeypair();
    const team = fakeBackup(null, { failWrite: true });
    const group = fakeBackup(null, { where: 'device' });
    expect(await syncBackup(kp, [team.port, group.port])).toEqual({ where: 'device', other: null });

    const noGroup = fakeBackup(null, { unavailable: true }); // e.g. build without the app group
    const team2 = fakeBackup(null, { where: 'device' });
    expect(await syncBackup(kp, [team2.port, noGroup.port])).toEqual({
      where: 'device',
      other: null,
    });
    expect(
      await syncBackup(kp, [
        fakeBackup(null, { unavailable: true }).port,
        fakeBackup(null, { unavailable: true }).port,
      ]),
    ).toEqual({ where: 'unavailable', other: null });
  });

  it('turning the backup off deletes every copy, even when one delete fails', async () => {
    const kp = generateKeypair();
    const team = fakeBackup(secret(kp), { failRemove: true });
    const group = fakeBackup(secret(kp));
    await expect(removeBackup([team.port, group.port])).resolves.toBeUndefined();
    expect(group.state.value).toBeNull();
  });

  it('switching reads the identity Settings showed, from whichever place holds it', async () => {
    const x = generateKeypair();
    const y = generateKeypair();
    const places = [fakeBackup(secret(x)).port, fakeBackup(secret(y)).port];
    expect(await readBackedUp(places, code(y))).toEqual(y);
    expect(await readBackedUp(places)).toEqual(x);
    expect(await readBackedUp(places, code(generateKeypair()))).toBeNull();
  });

  it('a deliberate replace overwrites only the identities the user agreed to replace', async () => {
    const x = generateKeypair();
    const y = generateKeypair();
    const z = generateKeypair();

    // "Keep this one" on X: both copies of X become Z.
    const team = fakeBackup(secret(x));
    const group = fakeBackup(secret(x));
    expect(await replaceBackup(z, [team.port, group.port], [code(x)])).toEqual({
      where: 'cloud',
      other: null,
    });
    expect(team.state.value).toBe(secret(z));
    expect(group.state.value).toBe(secret(z));

    // A third identity (Y) the user wasn't shown stays, and is shown next.
    const team2 = fakeBackup(secret(x));
    const group2 = fakeBackup(secret(y));
    expect(await replaceBackup(z, [team2.port, group2.port], [code(x)])).toEqual({
      where: null,
      other: { code: code(y) },
    });
    expect(team2.state.value).toBe(secret(z));
    expect(group2.state.value).toBe(secret(y));

    // Nor is a place that couldn't be read.
    const team3 = fakeBackup(null);
    const group3 = fakeBackup(secret(x), { failRead: true });
    await replaceBackup(z, [team3.port, group3.port], [code(x)]);
    expect(team3.state.value).toBe(secret(z));
    expect(group3.state.value).toBe(secret(x));
    expect(group3.state.saves).toBe(0);
  });
});
