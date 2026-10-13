import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeRecoveryKey, generateKeypair, paymentCode } from '@cumulusvpn/core';
import type { TunnelStatus } from './tauri';
import {
  checkRestore,
  DISCONNECT_FAILED,
  recoveryKeySaved,
  shortCode,
  switchIdentity,
  wasRestored,
} from './identity';
import type { SwitchDeps } from './identity';

function tunnel(state: TunnelStatus['state']): TunnelStatus {
  return {
    state,
    endpoint: null,
    assignedIp: null,
    country: null,
    rxBytes: 0,
    txBytes: 0,
    lastHandshake: null,
    error: null,
    dnsWarning: null,
  };
}

function deps(over: Partial<SwitchDeps> = {}): SwitchDeps {
  return {
    status: vi.fn().mockResolvedValue(tunnel('down')),
    disconnect: vi.fn().mockResolvedValue(tunnel('down')),
    save: vi.fn(),
    reload: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('checkRestore', () => {
  const current = generateKeypair();
  const other = generateKeypair();

  it('accepts another identity and names its code', () => {
    expect(checkRestore(encodeRecoveryKey(other.privateKey), current)).toEqual({
      ok: true,
      keypair: other,
      code: paymentCode(other.publicKey),
    });
  });

  it('says why a key cannot be restored', () => {
    expect(checkRestore(encodeRecoveryKey(current.privateKey), current)).toMatchObject({
      ok: false,
      message: 'That is already this computer’s identity.',
    });
    expect(checkRestore('nope', current)).toMatchObject({
      ok: false,
      message: 'That doesn’t look like a CumulusVPN recovery key.',
    });
  });

  it('shortens codes the way the other apps do', () => {
    expect(shortCode('2RkUfDC55GMndKreXqK7Jruu8Snx')).toBe('2RkU…8Snx');
  });
});

describe('switchIdentity', () => {
  const next = generateKeypair();

  it('stores the new key and reloads when nothing is connected — without a disconnect', async () => {
    const d = deps();
    await switchIdentity(next, d);
    // An idle app must not reset the firewall default (that is all a disconnect
    // of nothing would do).
    expect(d.disconnect).not.toHaveBeenCalled();
    expect(d.save).toHaveBeenCalledWith(next);
    expect(d.reload).toHaveBeenCalled();
    expect(wasRestored()).toBe(true);
    expect(recoveryKeySaved(paymentCode(next.publicKey))).toBe(true);
  });

  // The tunnel outlives the webview and a relaunch reattaches to it: reloading
  // over a live session would show the new identity on a tunnel keyed to the old.
  it('brings a live tunnel down before switching', async () => {
    const order: string[] = [];
    const d = deps({
      status: vi.fn().mockResolvedValue(tunnel('up')),
      disconnect: vi.fn(async () => {
        order.push('disconnect');
        return tunnel('down');
      }),
      save: vi.fn(() => {
        order.push('save');
      }),
      reload: vi.fn(() => {
        order.push('reload');
      }),
    });
    await switchIdentity(next, d);
    expect(order).toEqual(['disconnect', 'save', 'reload']);
  });

  it('also clears a session that failed with the kill switch holding', async () => {
    const d = deps({ status: vi.fn().mockResolvedValue(tunnel('error')) });
    await switchIdentity(next, d);
    expect(d.disconnect).toHaveBeenCalled();
  });

  it('changes nothing when the tunnel cannot be brought down', async () => {
    const d = deps({
      status: vi.fn().mockResolvedValue(tunnel('up')),
      disconnect: vi.fn().mockRejectedValue(new Error('helper gone')),
    });
    await expect(switchIdentity(next, d)).rejects.toThrow(DISCONNECT_FAILED);
    expect(d.save).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
    expect(wasRestored()).toBe(false);
  });

  it('changes nothing when the disconnect leaves the tunnel up', async () => {
    const d = deps({
      status: vi.fn().mockResolvedValue(tunnel('up')),
      disconnect: vi.fn().mockResolvedValue(tunnel('up')),
    });
    await expect(switchIdentity(next, d)).rejects.toThrow(DISCONNECT_FAILED);
    expect(d.save).not.toHaveBeenCalled();
  });

  it('still switches when the tunnel engine is unreachable (nothing to reattach to)', async () => {
    const d = deps({ status: vi.fn().mockRejectedValue(new Error('no helper')) });
    await switchIdentity(next, d);
    expect(d.disconnect).not.toHaveBeenCalled();
    expect(d.save).toHaveBeenCalledWith(next);
  });
});
