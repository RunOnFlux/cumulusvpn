/**
 * JS bridge to the native WireGuard tunnel.
 *
 * On iOS this proxies a `NEPacketTunnelProvider` extension driven by
 * WireGuardKit; on Android a `VpnService` driven by
 * `com.wireguard.android:tunnel`. Both native sides are scaffolded under
 * `ios/` and `android/` with real method signatures and `// POC:` seams — the
 * actual tunnel establishment is not wired in this scaffold.
 *
 * The bridge deliberately accepts a rendered WireGuard config string (produced
 * by `@cumulusvpn/core` `buildWgConfig`) so the native layer stays dumb: it
 * knows how to bring a tunnel up/down, nothing about discovery or entitlement.
 */
/*
 * ── CHAINED-WIREGUARD-GO NESTING (multi-hop native design, docs/11 §Mobile) ──
 *
 * iOS (NEPacketTunnelProvider) and Android (VpnService) each hand the extension
 * exactly one virtual interface (`packetFlow` / the tun fd). Multi-hop can't use
 * two OS-level tunnels at once, so the extension chains two *userspace*
 * wireguard-go devices behind that single tun and does the nesting itself:
 *
 *     ┌── OS tun (NEPacketTunnelProvider.packetFlow / VpnService tun fd) ──┐
 *     │  IP packet to the real destination (MTU 1340)                      │
 *     │            │                                                       │
 *     │            ▼                                                       │
 *     │   [ INNER wireguard-go device ]  peer = EXIT, key K                │
 *     │     encrypts to EXIT → a UDP datagram addressed to <exitIp>:51820  │
 *     │            │                                                       │
 *     │            ▼  (this UDP packet is the ONLY thing the outer carries)│
 *     │   [ OUTER wireguard-go device ]  peer = ENTRY, key K               │
 *     │     AllowedIPs pins <exitIp>/32, encrypts to ENTRY (MTU 1420)      │
 *     │            │                                                       │
 *     │            ▼                                                       │
 *     │   real UDP socket → ENTRY:51820  ────────────────────────────────▶│
 *     └───────────────────────────────────────────────────────────────────┘
 *
 * Wiring inside the extension:
 *   - Bind the INNER device's UDP "bind" so its outbound packets to <exitIp>
 *     are fed into the OUTER device rather than the real network — the outer's
 *     AllowedIPs=<exitIp>/32 route matches them and re-encrypts to ENTRY.
 *   - Only the OUTER device owns the real UDP socket to the internet.
 *   - Set the tun MTU to 1340 (inner) so the doubly-encapsulated packet still
 *     fits ENTRY's 1420 path — wrong MTU = mysterious stalls (docs/11 §MTU).
 *   - DNS inside the tunnel = the EXIT's DNS (set on the inner interface).
 *
 * The entry gateway never sees plaintext: it only forwards a premium peer's
 * ciphertext to another gateway's :51820. No gateway protocol change (docs/11).
 *
 * POC: like the single-hop path, the native devices are scaffolded under
 * `ios/`/`android/` with real signatures and `// POC:` seams; this JS bridge
 * carries the two configs across but the chained wireguard-go plumbing above is
 * not wired in this scaffold.
 */
import { NativeEventEmitter, NativeModules } from 'react-native';
import type { EmitterSubscription } from 'react-native';

/** Runtime tunnel state reported by the native layer. */
export type TunnelState =
  'disconnected' | 'connecting' | 'connected' | 'reasserting' | 'disconnecting' | 'error';

/** A single status sample pushed from the native tunnel. */
export interface TunnelStatus {
  readonly state: TunnelState;
  /** Total bytes received over the tunnel since it came up. */
  readonly rxBytes: number;
  /** Total bytes sent over the tunnel since it came up. */
  readonly txBytes: number;
  /** Unix-seconds of the last successful WireGuard handshake, or 0. */
  readonly lastHandshake: number;
  /** Populated when `state === 'error'`. */
  readonly error?: string;
}

/** The native module contract, implemented in Swift (iOS) and Kotlin (Android). */
export interface CumulusTunnelModule {
  /**
   * Bring the tunnel up from a rendered WireGuard config.
   * Resolves once the OS reports the tunnel started (not yet handshaked).
   * @param wgConfig - `.conf` text from core `buildWgConfig`.
   * @param serverName - Human label shown in the OS VPN UI, e.g. "Germany".
   * @param killSwitch - When true, block all non-tunnel traffic (iOS: on-demand
   *   + `includeAllNetworks`; Android: a no-op here — the OS lockdown toggle is
   *   reached via {@link openVpnSettings}).
   */
  startTunnel(wgConfig: string, serverName: string, killSwitch: boolean): Promise<void>;

  /**
   * Bring up an opt-in **multi-hop** tunnel: two stacked WireGuard interfaces
   * sharing the same client key, per `docs/11-multihop.md`.
   *
   * The native extension runs *two chained userspace wireguard-go instances*
   * inside a single OS tun (see the CHAINED-WIREGUARD-GO block below):
   *   - `outerConfig` — wg-entry: `AllowedIPs = <exitIp>/32`, MTU 1420, no DNS.
   *     Carries only the inner tunnel's UDP packets to the exit's public IP.
   *   - `innerConfig` — wg-exit: `AllowedIPs = 0.0.0.0/0, ::/0`, MTU 1340,
   *     DNS = exit's DNS. Carries all real traffic; its packets to the exit IP
   *     are routed *through* the outer interface.
   *
   * Both `.conf` strings come from core `buildMultihopConfig`. Resolves once the
   * OS reports the composite tunnel started (outer up; not yet fully handshaked).
   *
   * @param outerConfig - wg-entry `.conf` (`MultihopConfig.outer`).
   * @param innerConfig - wg-exit `.conf` (`MultihopConfig.inner`).
   * @param routeLabel - Human label for the OS VPN UI, e.g. "Germany → Japan".
   * @param killSwitch - See {@link startTunnel}.
   */
  startMultihop(
    outerConfig: string,
    innerConfig: string,
    routeLabel: string,
    killSwitch: boolean,
  ): Promise<void>;

  /** Tear the tunnel down. Idempotent. */
  stopTunnel(): Promise<void>;

  /**
   * Open the OS VPN settings so the user can enable the system kill switch
   * ("Always-on VPN" / "Block connections without VPN" on Android). Apps cannot
   * toggle lockdown programmatically, so this is the correct hand-off. On iOS the
   * kill switch is fully in-app (see the `killSwitch` params) and this resolves
   * without navigating.
   */
  openVpnSettings(): Promise<void>;

  /** One-shot status poll (also emitted continuously via the event emitter). */
  getStatus(): Promise<TunnelStatus>;

  /**
   * Whether the app currently holds an OS VPN configuration/permission.
   * iOS: a saved `NETunnelProviderManager`; Android: `VpnService.prepare()==null`.
   */
  isPrepared(): Promise<boolean>;

  /**
   * Request the OS VPN permission (iOS: save the tunnel manager; Android: the
   * `VpnService.prepare()` consent dialog). Resolves true if granted.
   */
  requestPermission(): Promise<boolean>;
}

const LINKING_ERROR =
  "The native module 'CumulusTunnel' is not linked. Rebuild the app after " +
  'pod install (iOS) / gradle sync (Android). POC: native tunnel not yet wired.';

/**
 * The real native module when present, otherwise a proxy that rejects clearly.
 * This keeps JS/typecheck green on a machine with no native build.
 */
const native: CumulusTunnelModule =
  (NativeModules.CumulusTunnel as CumulusTunnelModule | undefined) ??
  new Proxy({} as CumulusTunnelModule, {
    get() {
      // POC: no-op stand-in until the Swift/Kotlin modules are built.
      return () => Promise.reject(new Error(LINKING_ERROR));
    },
  });

const emitter = new NativeEventEmitter(
  NativeModules.CumulusTunnel as ConstructorParameters<typeof NativeEventEmitter>[0],
);

/** Subscribe to continuous tunnel status updates. Returns an unsubscribe handle. */
export function onTunnelStatus(listener: (status: TunnelStatus) => void): EmitterSubscription {
  return emitter.addListener('CumulusTunnelStatus', listener);
}

export const CumulusTunnel = native;
