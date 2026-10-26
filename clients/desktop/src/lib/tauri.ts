/**
 * Typed bridge to the Rust/Tauri backend commands defined in
 * `src-tauri/src/commands.rs`: `connect`, `connect_multihop`, `disconnect`,
 * `status`, plus the helper setup commands. The same commands work on every
 * desktop OS: they reach the privileged helper daemon (a LaunchDaemon on macOS,
 * a systemd service on Linux, a Windows service), or, on macOS and Linux, the
 * tunnel inside the app when it runs as root without one
 * (`src-tauri/src/backend.rs`).
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
  /**
   * Set while the tunnel is up but the system resolver could not be pointed at
   * the tunnel's: lookups may be leaking (kill switch off) or failing (kill
   * switch on). Shown as a warning so the UI never reads "protected" over a DNS
   * leak. Native sends `null` when DNS is fine.
   */
  readonly dnsWarning: string | null;
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
  /** Engage the leak-protection kill switch (firewall rules) for this session. */
  readonly killSwitch: boolean;
  /**
   * `wg-tls` transport only: the gateway's TLS relay address (`endpoint`, a TCP
   * `ip:tlsPort`) + the SNI to present. When set, the native side bridges the WG
   * device over TLS instead of dialing UDP, so the tunnel survives UDP-blocking.
   */
  readonly tls?: {
    readonly serverAddr: string;
    readonly sni: string;
  };
  /**
   * Split tunneling (docs/17): compiled route lists from core-ts
   * `compileSplitPolicy` — `bypassRoutes` for exclude-direction policies
   * (egress on the physical path, punched through the kill switch),
   * `tunnelRoutes` for include mode (only these enter the tunnel; the default
   * route stays physical). Absent/empty = full tunnel, byte-identical to
   * pre-feature behaviour.
   */
  readonly split?: {
    readonly bypassRoutes: readonly string[];
    readonly tunnelRoutes: readonly string[];
  };
}

/**
 * Everything the native side needs to bring a **multi-hop** tunnel up: the two
 * nested WireGuard configs from `@cumulusvpn/core`'s `buildMultihopConfig` plus
 * the routing facts. The native manager runs two wireguard-go devices — the
 * outer (to ENTRY) carries only the inner tunnel's packets to `exitEndpoint`
 * (host route `<exitIp>/32` → wg-entry), the inner (to EXIT) carries the default
 * route. See `docs/11-multihop.md`.
 */
/** Split tunneling routes — see `ConnectArgs.split`. */
interface SplitRoutes {
  readonly bypassRoutes: readonly string[];
  readonly tunnelRoutes: readonly string[];
}

/** Multi-hop step 1: the ENTRY hop, with the exit gateway's IP routed through it. */
export interface MultihopEntryArgs {
  /** ISO country of the ENTRY hop (sees your real IP, not your destination). */
  readonly entryCountry: string;
  /** Outer `.conf` (wg-entry): `AllowedIPs = <exitIp>/32`, MTU 1420, no DNS. */
  readonly outer: string;
  /** `<entryIp>:<port>` — the only real UDP egress; allow-listed by the kill switch. */
  readonly entryEndpoint: string;
  /** `<exitIp>:51820` — routed via the outer interface (host route). */
  readonly exitEndpoint: string;
  /** Engage the leak-protection kill switch (firewall rules) for this session. */
  readonly killSwitch: boolean;
  /** Split tunneling; its bypass prefixes are punched through the kill switch. */
  readonly split?: SplitRoutes;
}

/** Multi-hop step 2: the EXIT hop, through the entry hop step 1 brought up. */
export interface MultihopExitArgs {
  /** ISO country of the EXIT hop (sees your destination, not your real IP). */
  readonly exitCountry: string;
  /** Inner `.conf` (wg-exit): `AllowedIPs = 0.0.0.0/0, ::/0`, MTU 1340, exit DNS. */
  readonly inner: string;
  /** Step 1's `entryEndpoint`. */
  readonly entryEndpoint: string;
  /** Step 1's `exitEndpoint`. */
  readonly exitEndpoint: string;
  /** Inner interface MTU (1340) — headroom for two stacked WireGuard headers. */
  readonly innerMtu: number;
  /** Inner (exit) assigned tunnel address, surfaced back in status. */
  readonly assignedIp: string;
  /** Step 1's `killSwitch`. */
  readonly killSwitch: boolean;
  /** Split tunneling — see `ConnectArgs.split`. Applies to the exit device. */
  readonly split?: SplitRoutes;
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
  dnsWarning: null,
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

function mockConnectMultihopEntry(args: MultihopEntryArgs): TunnelStatus {
  stopMockCounters();
  mock = { ...DOWN, state: 'connecting', endpoint: args.entryEndpoint, country: args.entryCountry };
  return mock;
}

function mockConnectMultihopExit(args: MultihopExitArgs): Promise<TunnelStatus> {
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
    killSwitch: args.killSwitch,
    // Flattened for Tauri's arg mapping (tlsServerAddr → tls_server_addr, etc.);
    // absent → the native side takes the plain UDP path.
    tlsServerAddr: args.tls?.serverAddr ?? null,
    tlsSni: args.tls?.sni ?? null,
    bypassRoutes: args.split?.bypassRoutes ?? null,
    tunnelRoutes: args.split?.tunnelRoutes ?? null,
  });
}

/**
 * Multi-hop, step 1: bring the entry hop up and route the exit gateway's IP
 * through it (native `connect_multihop_entry`, or the browser mock). Requests
 * to the exit gateway made after this leave inside the entry tunnel. Tauri
 * maps these `camelCase` keys to the `snake_case` Rust parameters.
 */
export async function connectMultihopEntry(args: MultihopEntryArgs): Promise<TunnelStatus> {
  if (!isTauri()) {
    return mockConnectMultihopEntry(args);
  }
  return invoke<TunnelStatus>('connect_multihop_entry', {
    entryCountry: args.entryCountry,
    outer: args.outer,
    entryEndpoint: args.entryEndpoint,
    exitEndpoint: args.exitEndpoint,
    killSwitch: args.killSwitch,
    bypassRoutes: args.split?.bypassRoutes ?? null,
    tunnelRoutes: args.split?.tunnelRoutes ?? null,
  });
}

/**
 * Multi-hop, step 2: bring the exit hop up through the entry hop and route all
 * traffic and DNS to it (native `connect_multihop_exit`, or the browser mock).
 */
export async function connectMultihopExit(args: MultihopExitArgs): Promise<TunnelStatus> {
  if (!isTauri()) {
    return mockConnectMultihopExit(args);
  }
  return invoke<TunnelStatus>('connect_multihop_exit', {
    exitCountry: args.exitCountry,
    inner: args.inner,
    entryEndpoint: args.entryEndpoint,
    exitEndpoint: args.exitEndpoint,
    innerMtu: args.innerMtu,
    assignedIp: args.assignedIp,
    killSwitch: args.killSwitch,
    bypassRoutes: args.split?.bypassRoutes ?? null,
    tunnelRoutes: args.split?.tunnelRoutes ?? null,
  });
}

/**
 * Diagnostic line to the native side (stderr + `desktop.log` in the app log
 * dir), so webview-only failures are visible without devtools. Never throws.
 */
export function logLine(line: string): void {
  console.info(line);
  if (!isTauri()) {
    return;
  }
  invoke('frontend_log', { line }).catch(() => undefined);
}

/** A solved enroll proof-of-work. */
export interface PowSolution {
  /** The winning counter, as a decimal string. */
  readonly nonce: string;
  /** Hashes computed across all threads. */
  readonly hashes: number;
}

/**
 * Solve the enroll proof-of-work natively, on every core, searching from
 * `start` (`src-tauri/src/pow.rs`).
 */
export async function solvePow(
  publicKey: string,
  bits: number,
  start: number,
): Promise<PowSolution> {
  return invoke<PowSolution>('solve_pow', { publicKey, bits, start });
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

/**
 * Setup state of the tunnel engine.
 *
 * Ready:
 * - `enabled` — the privileged helper daemon answers and serves this app.
 * - `notNeeded` — macOS launched as root: the tunnel runs inside the app.
 * - `elevated` — Linux run as root with no helper answering (an AppImage):
 *   the tunnel runs inside the app, and stops when the app quits. Windows runs
 *   the tunnel in its helper service only.
 *
 * Setup steps (Connect is disabled and a banner explains the fix — the app
 * itself holds no privileges, so nothing can connect until it is done):
 * - `requiresApproval` / `notRegistered` / `notFound` — macOS helper
 *   registration via `SMAppService`.
 * - `serviceNotInstalled` — Linux / Windows: the helper service is not
 *   installed (the .deb / .rpm / Windows installers install it).
 * - `serviceNotRunning` — installed but not answering.
 * - `serviceDenied` — it answered and refused this app: on Linux the account is
 *   not in the `cumulusvpn` group yet (or has not logged in again since), on
 *   Windows this is not the installed app.
 */
export type HelperRegistration =
  | 'notNeeded'
  | 'enabled'
  | 'elevated'
  | 'requiresApproval'
  | 'notRegistered'
  | 'notFound'
  | 'serviceNotInstalled'
  | 'serviceNotRunning'
  | 'serviceDenied';

/** Whether Connect can work in this setup state (no setup step outstanding). */
export function helperReady(state: HelperRegistration): boolean {
  return state === 'enabled' || state === 'notNeeded' || state === 'elevated';
}

/** Outside Tauri there is no daemon and none is needed — the mock tunnel is it. */
export async function helperRegistration(): Promise<HelperRegistration> {
  if (!isTauri()) {
    return 'notNeeded';
  }
  try {
    return await invoke<HelperRegistration>('helper_registration');
  } catch {
    // Registration itself failing (an incomplete bundle, an OS too old) is
    // indistinguishable to the user from "not set up", and has the same answer.
    // Only the macOS helper path can fail here; Linux and Windows always answer
    // with a state.
    return 'notRegistered';
  }
}

/** Whether the helper is answering right now (always true when the tunnel is in-process). */
export async function helperReachable(): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  try {
    return await invoke<boolean>('helper_status');
  } catch {
    return false;
  }
}

/** Open System Settings at the pane where the helper is approved (macOS; no-op elsewhere). */
export async function openHelperSettings(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke('open_helper_settings');
  } catch {
    /* the user can still navigate there by hand */
  }
}
