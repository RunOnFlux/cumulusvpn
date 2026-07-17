/**
 * Typed bridge to the Rust/Tauri backend commands defined in
 * `src-tauri/src/commands.rs`: `connect`, `connect_multihop`, `disconnect`,
 * `status`.
 *
 * When the frontend runs outside a Tauri window (plain `vite dev`, CI build,
 * Storybook), `isTauri()` is false and we fall back to an in-memory mock tunnel
 * so the UI is fully exercisable without the native sidecar. // POC: the mock
 * simulates handshake + byte counters; the real path invokes wireguard-go
 * (one device for single-hop, two stacked devices for multi-hop).
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

/** Lifecycle of the local WireGuard interface (native `TunnelStatus.state`). */
export type TunnelState = 'down' | 'connecting' | 'up' | 'error';

/** Native tunnel status reported by the Rust sidecar manager. */
export interface TunnelStatus {
  readonly state: TunnelState;
  /** `<nodeIP>:51820` currently configured, if any. */
  readonly endpoint: string | null;
  /** Tunnel address assigned by the gateway, e.g. `10.8.0.2`. */
  readonly assignedIp: string | null;
  /** ISO country code the user selected for this session. */
  readonly country: string | null;
  /** Bytes received / sent over the tunnel (from the UAPI `get` counters). */
  readonly rxBytes: number;
  readonly txBytes: number;
  /** Unix seconds of the last successful handshake, or null if none yet. */
  readonly lastHandshake: number | null;
  /** Populated when `state === 'error'`. */
  readonly error: string | null;
}

/** Everything the native side needs to bring the tunnel up. */
export interface ConnectArgs {
  /** ISO country code, kept for session state and kill-switch scoping. */
  readonly country: string;
  /** Full WireGuard `.conf` rendered by `@cumulusvpn/core`'s `buildWgConfig`. */
  readonly wgConfig: string;
  /** `<nodeIP>:51820` — used to allow-list the endpoint before the kill switch. */
  readonly endpoint: string;
  /** Assigned tunnel address, surfaced back in status. */
  readonly assignedIp: string;
}

/**
 * Everything the native side needs to bring a **multi-hop** tunnel up: the two
 * nested WireGuard configs from `@cumulusvpn/core`'s `buildMultihopConfig` plus
 * the routing facts. The native manager runs two wireguard-go devices — the
 * outer (to ENTRY) carries only the inner tunnel's packets to `exitEndpoint`
 * (host route `<exitIp>/32` → wg-entry), the inner (to EXIT) carries the default
 * route. See `docs/11-multihop.md`.
 */
export interface MultihopConnectArgs {
  /** ISO country of the ENTRY hop (sees your real IP, not your destination). */
  readonly entryCountry: string;
  /** ISO country of the EXIT hop (sees your destination, not your real IP). */
  readonly exitCountry: string;
  /** Outer `.conf` (wg-entry): `AllowedIPs = <exitIp>/32`, MTU 1420, no DNS. */
  readonly outer: string;
  /** Inner `.conf` (wg-exit): `AllowedIPs = 0.0.0.0/0, ::/0`, MTU 1340, exit DNS. */
  readonly inner: string;
  /** `<entryIp>:51820` — the only real UDP egress; allow-listed by the kill switch. */
  readonly entryEndpoint: string;
  /** `<exitIp>:51820` — routed via the outer interface (host route). */
  readonly exitEndpoint: string;
  /** Inner interface MTU (1340) — headroom for two stacked WireGuard headers. */
  readonly innerMtu: number;
  /** Inner (exit) assigned tunnel address, surfaced back in status. */
  readonly assignedIp: string;
}

const DOWN: TunnelStatus = {
  state: 'down',
  endpoint: null,
  assignedIp: null,
  country: null,
  rxBytes: 0,
  txBytes: 0,
  lastHandshake: null,
  error: null,
};

// ---- browser mock ---------------------------------------------------------

let mock: TunnelStatus = DOWN;
let mockTimer: ReturnType<typeof setInterval> | null = null;

function stopMockCounters(): void {
  if (mockTimer !== null) {
    clearInterval(mockTimer);
    mockTimer = null;
  }
}

async function bringMockUp(
  endpoint: string,
  country: string,
  assignedIp: string,
): Promise<TunnelStatus> {
  stopMockCounters();
  mock = { ...DOWN, state: 'connecting', endpoint, country };
  await new Promise((r) => setTimeout(r, 700));
  mock = {
    ...mock,
    state: 'up',
    assignedIp,
    lastHandshake: Math.floor(Date.now() / 1000),
  };
  mockTimer = setInterval(() => {
    mock = { ...mock, rxBytes: mock.rxBytes + 4096, txBytes: mock.txBytes + 1024 };
  }, 1000);
  return mock;
}

function mockConnect(args: ConnectArgs): Promise<TunnelStatus> {
  return bringMockUp(args.endpoint, args.country, args.assignedIp);
}

function mockConnectMultihop(args: MultihopConnectArgs): Promise<TunnelStatus> {
  // The mock surfaces the entry as the wire endpoint (the only real UDP egress)
  // and the exit country as the effective location (where traffic emerges).
  return bringMockUp(args.entryEndpoint, args.exitCountry, args.assignedIp);
}

function mockDisconnect(): TunnelStatus {
  stopMockCounters();
  mock = DOWN;
  return mock;
}

// ---- public API -----------------------------------------------------------

/** Bring the tunnel up via the native sidecar (or the browser mock). */
export async function connect(args: ConnectArgs): Promise<TunnelStatus> {
  if (!isTauri()) {
    return mockConnect(args);
  }
  return invoke<TunnelStatus>('connect', {
    country: args.country,
    wgConfig: args.wgConfig,
    endpoint: args.endpoint,
    assignedIp: args.assignedIp,
  });
}

/**
 * Bring a **multi-hop** tunnel up: two stacked wireguard-go devices via the
 * native `connect_multihop` command (or the browser mock). Tauri maps these
 * `camelCase` keys to the `snake_case` Rust parameters.
 */
export async function connectMultihop(args: MultihopConnectArgs): Promise<TunnelStatus> {
  if (!isTauri()) {
    return mockConnectMultihop(args);
  }
  return invoke<TunnelStatus>('connect_multihop', {
    entryCountry: args.entryCountry,
    exitCountry: args.exitCountry,
    outer: args.outer,
    inner: args.inner,
    entryEndpoint: args.entryEndpoint,
    exitEndpoint: args.exitEndpoint,
    innerMtu: args.innerMtu,
    assignedIp: args.assignedIp,
  });
}

/** Tear the tunnel down and drop the kill-switch rules. */
export async function disconnect(): Promise<TunnelStatus> {
  if (!isTauri()) {
    return mockDisconnect();
  }
  return invoke<TunnelStatus>('disconnect');
}

/** Poll the current native tunnel status (byte counters, last handshake). */
export async function status(): Promise<TunnelStatus> {
  if (!isTauri()) {
    return mock;
  }
  return invoke<TunnelStatus>('status');
}

/** True when running inside a real Tauri window (native tunnel available). */
export function nativeAvailable(): boolean {
  return isTauri();
}
