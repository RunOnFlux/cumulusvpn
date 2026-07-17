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

import { isMultihop } from './useVpn';

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
