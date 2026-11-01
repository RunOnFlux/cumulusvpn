/**
 * The kill switch's one rule, end to end through `useVpn`: once a session is
 * up, only the user's Disconnect may call `stopTunnel`. A dead tunnel, a failed
 * failover and a country switch must HOLD the session or swap its route in
 * place — a stop in between is exactly the window in which traffic leaks.
 *
 * The native tunnel, discovery and enrollment are faked; everything between
 * them (the connect sweep, failover, the dead-tunnel check) is the real hook.
 */
import React from 'react';
import { create, act, type ReactTestRenderer } from 'react-test-renderer';
import { generateKeypair, type GatewayInfo, type TunnelStatus } from './killswitch.fixtures';

const mockNative = {
  startTunnel: jest.fn<Promise<void>, [string, string, boolean]>(async () => undefined),
  startMultihop: jest.fn(async () => undefined),
  stopTunnel: jest.fn(async () => undefined),
  holdTunnel: jest.fn(async () => undefined),
  getStatus: jest.fn(async (): Promise<TunnelStatus> => mockStatus),
  isPrepared: jest.fn(async () => true),
  requestPermission: jest.fn(async () => true),
  openVpnSettings: jest.fn(async () => undefined),
};
let mockStatus: TunnelStatus = { state: 'disconnected', rxBytes: 0, txBytes: 0, lastHandshake: 0 };
const nowSec = (): number => Math.floor(Date.now() / 1000);
const healthy = (): TunnelStatus => ({
  state: 'connected',
  rxBytes: 1,
  txBytes: 1,
  lastHandshake: nowSec(),
});

// Imports are hoisted above `mockNative`, so hand it over lazily.
jest.mock('../native/CumulusTunnel', () => ({
  get CumulusTunnel() {
    return mockNative;
  },
  onTunnelStatus: () => ({ remove: () => undefined }),
}));
jest.mock('../native/CumulusIdentity', () => ({ IDENTITY_BACKUPS: [] }));

const mockGateways: GatewayInfo[] = ['203.0.113.10', '203.0.113.11'].map(
  (ip) =>
    ({
      ip,
      country: 'DE',
      city: 'Frankfurt',
      controlUrl: `http://${ip}:51821`,
      sign_pubkey: 'pk',
      load: 0,
      transports: [{ type: 'wg', port: 51820 }],
    }) as unknown as GatewayInfo,
);
const mockGatewaysNl = mockGateways.map((g, i) => ({
  ...g,
  ip: `198.51.100.${i + 1}`,
  country: 'NL',
  city: 'Amsterdam',
}));

jest.mock('../lib/gateways', () => {
  const actual = jest.requireActual('../lib/gateways');
  return {
    ...actual,
    discoverFleet: jest.fn(async () => [...mockGateways, ...mockGatewaysNl]),
    measureLatency: jest.fn(async () => 20),
  };
});
jest.mock('../lib/pow', () => ({ solvePowFast: jest.fn(async () => '0') }));

const enrollOk = async (ip: string) => ({
  server_pubkey: 'c2VydmVy'.padEnd(44, 'A'),
  endpoint: `${ip}:51820`,
  assigned_ip: '10.8.0.2',
  dns: '1.1.1.1',
  payment_address: 't1pay',
  payment_memo: 'CVPN1:abc',
  price_flux: 12,
});
const mockEnroll = jest.fn(enrollOk);
jest.mock('@cumulusvpn/core', () => {
  const actual = jest.requireActual('@cumulusvpn/core');
  return {
    ...actual,
    enroll: (ip: string) => mockEnroll(ip),
    status: jest.fn(async () => ({ tier: 'free', paid_until: null })),
  };
});

import { useVpn, BLOCKED_MESSAGE } from './useVpn';
import { saveKeypair, saveKillSwitch, saveSelectedCountry } from './storage';

type Vpn = ReturnType<typeof useVpn>;
let vpn!: Vpn;
function Probe(): null {
  vpn = useVpn();
  return null;
}

async function settle(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, ms));
  });
}

async function until(cond: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for: ${label} (state=${vpn.state}, error=${vpn.error})`);
    }
    await settle(50);
  }
}

/** The gateway IP the n-th startTunnel call dialled. */
function dialled(n: number): string | undefined {
  const conf = mockNative.startTunnel.mock.calls[n]?.[0] ?? '';
  return /Endpoint = ([\d.]+):/.exec(conf)?.[1];
}

let tree: ReactTestRenderer | undefined;
async function boot(killSwitch: boolean): Promise<void> {
  await saveKeypair(generateKeypair());
  await saveKillSwitch(killSwitch);
  await saveSelectedCountry('DE');
  await act(async () => {
    tree = create(<Probe />);
  });
  await until(() => vpn.locations.length > 0 && vpn.killSwitch === killSwitch, 'boot');
}

async function connectHealthy(): Promise<void> {
  mockNative.startTunnel.mockImplementationOnce(async () => {
    mockStatus = healthy();
  });
  await act(async () => {
    await vpn.connect();
  });
  expect({ state: vpn.state, error: vpn.error }).toEqual({ state: 'connected', error: null });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockEnroll.mockImplementation(enrollOk);
  mockStatus = { state: 'disconnected', rxBytes: 0, txBytes: 0, lastHandshake: 0 };
  const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default;
  await AsyncStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
});

describe('kill switch on', () => {
  it('fails over from a dead tunnel by holding and swapping — never stopping', async () => {
    await boot(true);
    await connectHealthy();
    const first = dialled(0);

    // The node dies: the OS still says connected, but no handshake for ages.
    mockStatus = { ...healthy(), lastHandshake: nowSec() - 3600 };
    mockNative.startTunnel.mockImplementationOnce(async () => {
      mockStatus = healthy();
    });
    await until(
      () => mockNative.startTunnel.mock.calls.length === 2 && vpn.state === 'connected',
      'failover',
    );

    expect(mockNative.holdTunnel).toHaveBeenCalled();
    expect(mockNative.stopTunnel).not.toHaveBeenCalled();
    expect(dialled(1)).toBeDefined();
    expect(dialled(1)).not.toBe(first);
    expect(vpn.blocked).toBe(false);

    // Disconnect is the one thing that lowers it.
    await act(async () => {
      await vpn.disconnect();
    });
    expect(mockNative.stopTunnel).toHaveBeenCalledTimes(1);
  });

  it('stays held and says so when no node can be reached', async () => {
    await boot(true);
    await connectHealthy();

    // Every node now refuses enrollment.
    mockEnroll.mockRejectedValue(new Error('unreachable'));
    mockStatus = { ...healthy(), lastHandshake: nowSec() - 3600 };
    await until(() => vpn.blocked && vpn.state === 'error', 'blocked');

    expect(mockNative.holdTunnel).toHaveBeenCalled();
    expect(mockNative.stopTunnel).not.toHaveBeenCalled();
    expect(vpn.error).toBe(BLOCKED_MESSAGE);
  });

  it('switches country in place while connected', async () => {
    await boot(true);
    await connectHealthy();

    mockNative.startTunnel.mockImplementationOnce(async () => {
      mockStatus = healthy();
    });
    await act(async () => {
      await vpn.selectCountry('NL');
    });
    await until(
      () => mockNative.startTunnel.mock.calls.length === 2 && vpn.state === 'connected',
      'switch',
    );

    expect(dialled(1)).toMatch(/^198\.51\.100\./);
    expect(mockNative.stopTunnel).not.toHaveBeenCalled();
  });
});

describe('kill switch off', () => {
  it('still recovers a dead tunnel the old way (stop, then reconnect)', async () => {
    await boot(false);
    await connectHealthy();

    mockStatus = { ...healthy(), lastHandshake: nowSec() - 3600 };
    await until(() => mockNative.stopTunnel.mock.calls.length > 0, 'stop');
    expect(mockNative.holdTunnel).not.toHaveBeenCalled();
  });

  it('switches country in place too — no disconnect in between', async () => {
    await boot(false);
    await connectHealthy();

    mockNative.startTunnel.mockImplementationOnce(async () => {
      mockStatus = healthy();
    });
    await act(async () => {
      await vpn.selectCountry('NL');
    });
    await until(
      () => mockNative.startTunnel.mock.calls.length === 2 && vpn.state === 'connected',
      'switch',
    );
    expect(mockNative.stopTunnel).not.toHaveBeenCalled();
  });
});
