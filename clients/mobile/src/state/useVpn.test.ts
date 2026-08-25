/**
 * Unit tests for the `useVpn` route-style predicate.
 *
 * `isMultihop` is the single branch that decides whether `connect()` takes the
 * single-hop (Fast) path or the two-hop onion path, so it is worth pinning.
 * The native tunnel bridge is mocked out: importing `useVpn` would otherwise
 * construct a `NativeEventEmitter` at module load, which has no place in a pure
 * logic test.
 */
import type { RouteStyle } from '@cumulusvpn/core';

jest.mock('../native/CumulusTunnel', () => ({
  CumulusTunnel: {},
  onTunnelStatus: () => ({ remove: () => undefined }),
}));

import { isMultihop, isTunnelDead } from './useVpn';

describe('isMultihop', () => {
  it('is false only for the default single-hop style', () => {
    expect(isMultihop('single')).toBe(false);
  });

  it('is true for every multi-hop style', () => {
    const multihopStyles: readonly RouteStyle[] = [
      'multihop-same-country',
      'multihop-cross-jurisdiction',
    ];
    for (const style of multihopStyles) {
      expect(isMultihop(style)).toBe(true);
    }
  });
});

describe('isTunnelDead — the roam backstop', () => {
  const now = (): number => Math.floor(Date.now() / 1000);

  it('is false for a healthy tunnel across the whole rekey sawtooth', () => {
    // A live tunnel's handshake age cycles 0..~120s (REKEY_AFTER_TIME), because
    // keepalives count as sends. Every point on that curve must read healthy or
    // the backstop would tear down working tunnels every two minutes.
    for (const age of [0, 1, 30, 90, 119, 120, 150, 199]) {
      expect(isTunnelDead({ state: 'connected', lastHandshake: now() - age })).toBe(false);
    }
  });

  it('is true once the session is past WireGuard’s reject window', () => {
    expect(isTunnelDead({ state: 'connected', lastHandshake: now() - 201 })).toBe(true);
    expect(isTunnelDead({ state: 'connected', lastHandshake: now() - 3600 })).toBe(true);
  });

  it('ignores a tunnel that has never handshaked', () => {
    // Nothing has come up yet; the connect watchdog owns this window, and
    // treating 0 as "ancient" would kill every tunnel the moment it started.
    expect(isTunnelDead({ state: 'connected', lastHandshake: 0 })).toBe(false);
  });

  it('only applies while connected', () => {
    for (const state of ['disconnected', 'connecting', 'disconnecting', 'error']) {
      expect(isTunnelDead({ state, lastHandshake: now() - 3600 })).toBe(false);
    }
  });
});
