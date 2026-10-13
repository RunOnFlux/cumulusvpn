import { describe, expect, it } from 'vitest';
import { dnsWarningOf, reattachPhase } from './useConnection';
import type { Phase } from './useConnection';
import type { TunnelStatus } from '../lib/tauri';

function status(overrides: Partial<TunnelStatus>): TunnelStatus {
  return {
    state: 'up',
    endpoint: '198.51.100.2:51820',
    assignedIp: '10.8.0.2',
    country: 'DE',
    rxBytes: 0,
    txBytes: 0,
    lastHandshake: 1,
    error: null,
    dnsWarning: null,
    ...overrides,
  };
}

describe('DNS warning', () => {
  const warning = 'DNS could not be pointed at the VPN (resolvconf missing).';

  // A connected tunnel whose DNS could not be set must not read as protected.
  it('surfaces the native DNS warning while connected', () => {
    expect(dnsWarningOf('connected', status({ dnsWarning: warning }))).toBe(warning);
  });

  it('is null when DNS goes through the tunnel', () => {
    expect(dnsWarningOf('connected', status({}))).toBeNull();
  });

  // The last session's warning must not linger on the idle / error screens.
  it('is not shown outside a connected session', () => {
    const phases: Phase[] = ['loading', 'idle', 'connecting', 'error'];
    for (const phase of phases) {
      expect(dnsWarningOf(phase, status({ dnsWarning: warning }))).toBeNull();
    }
  });

  // A helper built before the field existed sends no `dnsWarning` at all.
  it('treats a missing field as no warning', () => {
    const old = JSON.parse(
      '{"state":"up","endpoint":null,"assignedIp":null,"country":null,' +
        '"rxBytes":0,"txBytes":0,"lastHandshake":1,"error":null}',
    ) as TunnelStatus;
    expect(dnsWarningOf('connected', old)).toBeNull();
  });
});

// The helper daemon outlives the app (a force-quit leaves the tunnel up), so a
// relaunched app must pick the session back up instead of showing a fresh
// "disconnected" over a tunnel that is still carrying traffic.
describe('reattaching at launch', () => {
  it('shows a live tunnel as connected', () => {
    expect(reattachPhase(status({ state: 'up' }))).toBe('connected');
    expect(reattachPhase(status({ state: 'connecting', lastHandshake: null }))).toBe('connected');
  });

  // Dropped while no app was watching: the kill switch is still holding, so
  // surface it and let auto-reconnect do what it would have done.
  it('picks up a tunnel that dropped while the app was gone as an error', () => {
    expect(reattachPhase(status({ state: 'error', error: 'connection lost — no handshake' }))).toBe(
      'error',
    );
  });

  it('has nothing to reattach to when the tunnel is down', () => {
    expect(reattachPhase(status({ state: 'down', endpoint: null, country: null }))).toBeNull();
  });
});
