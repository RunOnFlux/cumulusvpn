// The connect/disconnect lifecycle of useConnection against a mocked native
// side: what the user sees when a status poll and a teardown overlap.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TunnelStatus } from '../lib/tauri';
import type { CountryOption } from '../lib/session';
import type * as Session from '../lib/session.js';

const native = vi.hoisted(() => ({
  entitlement: vi.fn<
    (gatewayIp: string) => Promise<{ tier: string; paid_until: null; bytes_used: number }>
  >(async () => ({ tier: 'free', paid_until: null, bytes_used: 0 })),
  status: vi.fn<() => Promise<TunnelStatus>>(),
  teardown: vi.fn<() => Promise<TunnelStatus>>(),
  discover:
    vi.fn<
      (
        fetchImpl?: typeof fetch,
        onProgress?: (d: { countries: CountryOption[]; fleet: never[] }) => void,
      ) => Promise<{ countries: CountryOption[]; fleet: never[] }>
    >(),
}));

const DOWN: TunnelStatus = {
  state: 'down',
  endpoint: null,
  assignedIp: null,
  country: null,
  rxBytes: 0,
  txBytes: 0,
  lastHandshake: null,
  error: null,
  dnsWarning: null,
};
const UP: TunnelStatus = {
  ...DOWN,
  state: 'up',
  endpoint: '198.51.100.2:51820',
  assignedIp: '10.8.0.2',
  country: 'DE',
  lastHandshake: 1,
};
const DE: CountryOption = {
  code: 'DE',
  name: 'Germany',
  flag: '🇩🇪',
  gatewayIp: '198.51.100.2',
  city: 'Frankfurt',
  load: 0.2,
  signPubKey: 'sign-de',
};

vi.mock('../lib/tauri.js', () => ({
  status: native.status,
  helperRegistration: vi.fn(async () => 'notNeeded'),
  helperReady: () => true,
  logLine: vi.fn(),
}));
vi.mock('../lib/session.js', async (importOriginal) => ({
  KeyedGateways: (await importOriginal<typeof Session>()).KeyedGateways,
  discoverFleetAndCountries: native.discover,
  establish: vi.fn(async () => ({ tunnel: UP, splitApplied: false, gatewayIp: DE.gatewayIp })),
  establishMultihop: vi.fn(),
  fetchEntitlement: native.entitlement,
  teardown: native.teardown,
}));

import { useConnection } from './useConnection';

describe('useConnection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    native.status.mockReset();
    native.teardown.mockReset();
    native.discover.mockReset();
    native.entitlement.mockClear();
    native.discover.mockResolvedValue({ countries: [DE], fleet: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a status poll that lands during a user disconnect does not report a lost connection', async () => {
    native.status.mockResolvedValue(DOWN); // nothing to reattach to at launch
    const { result } = renderHook(() => useConnection());
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    act(() => result.current.connect());
    await waitFor(() => expect(result.current.phase).toBe('connected'));

    // The teardown is slow; the native side already reports 'down' while it runs.
    let finishTeardown: (s: TunnelStatus) => void = () => undefined;
    native.teardown.mockReturnValue(
      new Promise((resolve) => {
        finishTeardown = resolve;
      }),
    );
    native.status.mockResolvedValue(DOWN);
    act(() => result.current.disconnect());
    // A poll tick while the teardown is in flight.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    await act(async () => {
      finishTeardown(DOWN);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.error).toBeNull();
  });

  it('a drop while connected is still surfaced as an error', async () => {
    native.status.mockResolvedValue(DOWN);
    const { result } = renderHook(() => useConnection());
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.connect());
    await waitFor(() => expect(result.current.phase).toBe('connected'));

    native.status.mockResolvedValue({
      ...DOWN,
      state: 'error',
      error: 'connection lost — no handshake',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toBe('connection lost — no handshake');
  });
  describe('discovery in progress', () => {
    const NL: CountryOption = { ...DE, code: 'NL', name: 'Netherlands', gatewayIp: '198.51.100.3' };

    it('is ready once the remembered country has a gateway, before discovery finishes', async () => {
      localStorage.setItem('cvpn.country.v1', 'DE');
      native.status.mockResolvedValue(DOWN);
      native.discover.mockImplementation((_f, onProgress) => {
        onProgress?.({ countries: [NL], fleet: [] });
        onProgress?.({ countries: [DE, NL], fleet: [] });
        return new Promise(() => undefined); // a gateway that never answers
      });

      const { result } = renderHook(() => useConnection());

      await waitFor(() => expect(result.current.phase).toBe('idle'));
      expect(result.current.selected?.code).toBe('DE');
      expect(result.current.exit?.code).toBe('NL');
    });

    it('waits for the remembered country while it has not verified', async () => {
      localStorage.setItem('cvpn.country.v1', 'DE');
      native.status.mockResolvedValue(DOWN);
      let finish: (d: { countries: CountryOption[]; fleet: never[] }) => void = () => undefined;
      native.discover.mockImplementation((_f, onProgress) => {
        onProgress?.({ countries: [NL], fleet: [] });
        return new Promise((resolve) => {
          finish = resolve;
        });
      });

      const { result } = renderHook(() => useConnection());
      await waitFor(() => expect(result.current.countries).toHaveLength(1));
      expect(result.current.phase).toBe('loading');

      // Discovery ends without DE: the first country is the pick.
      await act(async () => {
        finish({ countries: [NL], fleet: [] });
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.phase).toBe('idle'));
      expect(result.current.selected?.code).toBe('NL');
    });

    it('checks entitlement once, at the selected gateway, however many gateways arrive', async () => {
      localStorage.setItem('cvpn.country.v1', 'DE');
      native.status.mockResolvedValue(DOWN);
      let report: (d: { countries: CountryOption[]; fleet: never[] }) => void = () => undefined;
      native.discover.mockImplementation((_f, onProgress) => {
        report = (d) => onProgress?.(d);
        onProgress?.({ countries: [DE], fleet: [] });
        return new Promise(() => undefined);
      });

      const { result } = renderHook(() => useConnection());
      await waitFor(() => expect(result.current.phase).toBe('idle'));
      act(() => report({ countries: [DE, NL], fleet: [] }));
      act(() => report({ countries: [DE, NL, { ...NL, code: 'AT', name: 'Austria' }], fleet: [] }));
      await waitFor(() => expect(result.current.countries).toHaveLength(3));

      expect(native.entitlement).toHaveBeenCalledTimes(1);
      expect(native.entitlement.mock.calls[0]?.[0]).toBe(DE.gatewayIp);
    });

    it('moves the chosen row to a less-loaded gateway that verifies later', async () => {
      localStorage.setItem('cvpn.country.v1', 'DE');
      native.status.mockResolvedValue(DOWN);
      const busyDe = { ...DE, gatewayIp: '198.51.100.9', load: 0.9 };
      let report: (d: { countries: CountryOption[]; fleet: never[] }) => void = () => undefined;
      native.discover.mockImplementation((_f, onProgress) => {
        report = (d) => onProgress?.(d);
        onProgress?.({ countries: [busyDe], fleet: [] });
        return new Promise(() => undefined);
      });

      const { result } = renderHook(() => useConnection());
      await waitFor(() => expect(result.current.selected?.gatewayIp).toBe('198.51.100.9'));

      act(() => report({ countries: [DE, NL], fleet: [] }));
      await waitFor(() => expect(result.current.selected?.gatewayIp).toBe('198.51.100.2'));
      expect(result.current.exit?.code).toBe('NL'); // filled in once another country verified
    });
  });
});
