/**
 * `useVpn` — the whole app's brain in one hook.
 *
 * Ties the shared `@cumulusvpn/core` logic (keygen, discovery, enroll, status,
 * wg-config) to the native tunnel bridge and exposes the small surface the
 * three screens need: connection state, selected country, tier, and the
 * payment identity for the manage-on-web upgrade screen.
 *
 * First-launch flow (docs/05 "connected in < 5 seconds"):
 *   generate/restore key → discover fleet → pick nearest → enroll → build
 *   config → hand to native tunnel → poll status for tier.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildMultihopConfig,
  buildWgConfig,
  enroll,
  generateKeypair,
  paymentCode,
  paymentMemo,
  selectHops,
  status as fetchStatus,
} from '@cumulusvpn/core';
import type { EnrollResponse, GatewayInfo, Keypair, RouteStyle, Tier } from '@cumulusvpn/core';
import {
  CumulusTunnel,
  onTunnelStatus,
  type TunnelState,
  type TunnelStatus,
} from '../native/CumulusTunnel';
import { discoverFleet, groupByCountry, measureLatency, type Country } from '../lib/gateways';
import {
  loadAutoConnect,
  loadEntryCountry,
  loadExitCountry,
  loadKeypair,
  loadKillSwitch,
  loadRouteStyle,
  loadSelectedCountry,
  saveAutoConnect,
  saveEntryCountry,
  saveExitCountry,
  saveKeypair,
  saveKillSwitch,
  saveRouteStyle,
  saveSelectedCountry,
} from './storage';

/** True for any route style that stacks two hops (multi-hop is off by default). */
export function isMultihop(style: RouteStyle): boolean {
  return style !== 'single';
}

/** Everything the UI renders from. */
export interface VpnModel {
  readonly keypair: Keypair | null;
  readonly countries: readonly Country[];
  readonly selected: Country | null;
  readonly state: TunnelState;
  readonly status: TunnelStatus | null;
  readonly tier: Tier;
  /** True while the initial discovery/enroll bootstrap is running. */
  readonly booting: boolean;
  readonly error: string | null;
  /** Payment identity for the (web) upgrade screen. */
  readonly payment: PaymentIdentity | null;
  /**
   * Route style. `'single'` is the default (multi-hop OFF); the two `multihop-*`
   * styles opt into the nested-onion path from `docs/11-multihop.md`.
   */
  readonly routeStyle: RouteStyle;
  /** Convenience flag: true for any `multihop-*` style. */
  readonly multihop: boolean;
  /** Chosen multi-hop entry country, or null to auto-pick the nearest healthy. */
  readonly entry: Country | null;
  /** Chosen multi-hop exit country, or null to auto-pick a well-connected exit. */
  readonly exit: Country | null;
  /** Kill switch: block all non-tunnel traffic while connected (persisted). */
  readonly killSwitch: boolean;
  /** Auto-connect on app launch once discovery completes (persisted). */
  readonly autoConnect: boolean;
}

/** Chain-payment identity derived from the device key + last enrollment. */
export interface PaymentIdentity {
  /** `base58btc(sha256(pubkey)[0:20])`. */
  readonly code: string;
  /** `CVPN1:<code>` OP_RETURN memo. */
  readonly memo: string;
  /** FLUX address to pay (from the gateway enroll response). */
  readonly address: string;
  /** Price per 30 days, in FLUX. */
  readonly priceFlux: number;
}

/** Actions the screens invoke. */
export interface VpnActions {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  selectCountry(code: string): Promise<void>;
  refresh(): Promise<void>;
  /** Switch route style (Fast vs the two multi-hop styles); persisted. */
  setRouteStyle(style: RouteStyle): Promise<void>;
  /** Pick the multi-hop entry country (`null` = auto-pick nearest); persisted. */
  selectEntryCountry(code: string | null): Promise<void>;
  /** Pick the multi-hop exit country (`null` = auto-pick); persisted. */
  selectExitCountry(code: string | null): Promise<void>;
  /** Toggle the kill switch (persisted). Applies on the next connect. */
  setKillSwitch(enabled: boolean): Promise<void>;
  /** Toggle auto-connect on launch (persisted). */
  setAutoConnect(enabled: boolean): Promise<void>;
  /** Open the OS VPN settings (Android lockdown hand-off; no-op on iOS). */
  openVpnSettings(): Promise<void>;
}

const STATUS_POLL_MS = 30_000;

export function useVpn(): VpnModel & VpnActions {
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [countries, setCountries] = useState<readonly Country[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [state, setState] = useState<TunnelState>('disconnected');
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [tier, setTier] = useState<Tier>('free');
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollResponse | null>(null);
  const [routeStyle, setRouteStyleState] = useState<RouteStyle>('single');
  const [entryCode, setEntryCode] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<string | null>(null);
  const [killSwitch, setKillSwitchState] = useState(false);
  const [autoConnect, setAutoConnectState] = useState(false);
  const autoConnectedRef = useRef(false);

  // Latest enrolled gateway IP, kept in a ref for the status poller.
  const gatewayIpRef = useRef<string | null>(null);
  // Flat, verified fleet from the last discovery — core `selectHops` needs the
  // whole list (not just the per-country `best`) to find a distinct exit.
  const gatewaysRef = useRef<readonly GatewayInfo[]>([]);

  const selected = useMemo<Country | null>(
    () => countries.find((c) => c.code === selectedCode) ?? null,
    [countries, selectedCode],
  );

  const entry = useMemo<Country | null>(
    () => countries.find((c) => c.code === entryCode) ?? null,
    [countries, entryCode],
  );
  const exit = useMemo<Country | null>(
    () => countries.find((c) => c.code === exitCode) ?? null,
    [countries, exitCode],
  );
  const multihop = isMultihop(routeStyle);

  const payment = useMemo<PaymentIdentity | null>(() => {
    if (!keypair || !enrollment) {
      return null;
    }
    return {
      code: paymentCode(keypair.publicKey),
      memo: paymentMemo(keypair.publicKey),
      address: enrollment.payment_address,
      priceFlux: enrollment.price_flux,
    };
  }, [keypair, enrollment]);

  // ---- bootstrap: key + discovery ----------------------------------------
  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    const gateways = await discoverFleet();
    gatewaysRef.current = gateways;
    // POC: measure latency only for the least-loaded gateway per country to
    // keep first paint fast; a background pass can fill in the rest.
    const firstPass = groupByCountry(gateways);
    const measured = await Promise.all(
      firstPass.map(async (c) => [c.best.ip, await measureLatency(c.best)] as const),
    );
    const latencyByIp: Record<string, number> = {};
    for (const [ip, ms] of measured) {
      if (ms !== null) {
        latencyByIp[ip] = ms;
      }
    }
    setCountries(groupByCountry(gateways, latencyByIp));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const restored = (await loadKeypair()) ?? generateKeypair();
        await saveKeypair(restored);
        if (!alive) {
          return;
        }
        setKeypair(restored);
        setSelectedCode(await loadSelectedCountry());
        setRouteStyleState(await loadRouteStyle());
        setEntryCode(await loadEntryCountry());
        setExitCode(await loadExitCountry());
        setKillSwitchState(await loadKillSwitch());
        setAutoConnectState(await loadAutoConnect());
        await refresh();
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (alive) {
          setBooting(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  // ---- native tunnel status stream ---------------------------------------
  useEffect(() => {
    const sub = onTunnelStatus((s) => {
      setStatus(s);
      setState(s.state);
    });
    return () => sub.remove();
  }, []);

  // ---- connect watchdog: never hang on "connecting" forever --------------
  // The enroll network step is bounded by core's fetch timeout, but a config
  // that never completes the WireGuard handshake would otherwise leave the UI
  // stuck. If we're still connecting after a generous window (multi-hop enrolls
  // twice + handshakes twice), fail cleanly and tear down.
  useEffect(() => {
    if (state !== 'connecting') {
      return;
    }
    const id = setTimeout(() => {
      setState('error');
      setError('Connection timed out. Try another location.');
      void CumulusTunnel.stopTunnel().catch(() => undefined);
    }, 40_000);
    return () => clearTimeout(id);
  }, [state]);

  // ---- entitlement polling (tier unlocks ~1 min after on-chain payment) ---
  useEffect(() => {
    if (!keypair) {
      return;
    }
    let alive = true;
    const poll = async () => {
      const ip = gatewayIpRef.current;
      if (!ip) {
        return;
      }
      try {
        const st = await fetchStatus(ip, keypair.publicKey);
        if (alive) {
          setTier(st.tier);
        }
      } catch {
        // Non-fatal: keep the last known tier.
      }
    };
    const id = setInterval(poll, STATUS_POLL_MS);
    void poll();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [keypair, enrollment]);

  // ---- actions ------------------------------------------------------------
  const connect = useCallback(async (): Promise<void> => {
    if (!keypair) {
      return;
    }
    setError(null);
    setState('connecting');
    try {
      // Android/iOS require explicit VPN consent before a tunnel can be created;
      // without it the native backend throws (Android: GoBackend BackendException).
      // Ask once — no-op if already granted (VpnService.prepare()==null).
      if (!(await CumulusTunnel.isPrepared())) {
        const granted = await CumulusTunnel.requestPermission();
        if (!granted) {
          setState('error');
          setError('VPN permission is required to connect.');
          return;
        }
      }

      if (isMultihop(routeStyle)) {
        await connectMultihop({
          keypair,
          routeStyle,
          gateways: gatewaysRef.current,
          entryCountry: entryCode,
          exitCountry: exitCode,
          gatewayIpRef,
          setEnrollment,
          killSwitch,
        });
        return;
      }

      // ---- single-hop (Fast, default) ----
      const target = countries.find((c) => c.code === selectedCode) ?? countries[0] ?? null;
      if (!target) {
        setState('error');
        setError('No gateways reachable');
        return;
      }
      const resp = await enroll(target.best.ip, keypair.publicKey, {
        signPubKey: target.best.sign_pubkey,
      });
      gatewayIpRef.current = target.best.ip;
      setEnrollment(resp);

      const wgConfig = buildWgConfig({
        privateKey: keypair.privateKey,
        assignedIp: resp.assigned_ip,
        dns: resp.dns,
        serverPubKey: resp.server_pubkey,
        endpoint: resp.endpoint,
      });
      await CumulusTunnel.startTunnel(wgConfig, target.name, killSwitch);
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [keypair, countries, selectedCode, routeStyle, entryCode, exitCode, killSwitch]);

  const disconnect = useCallback(async (): Promise<void> => {
    setState('disconnecting');
    try {
      await CumulusTunnel.stopTunnel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ---- auto-connect on launch (opt-in) -----------------------------------
  // Once, after the first successful discovery, if the user enabled auto-connect
  // and nothing is up yet, bring the tunnel up automatically.
  useEffect(() => {
    if (
      autoConnect &&
      !autoConnectedRef.current &&
      !booting &&
      keypair &&
      state === 'disconnected' &&
      countries.length > 0
    ) {
      autoConnectedRef.current = true;
      void connect();
    }
  }, [autoConnect, booting, keypair, state, countries, connect]);

  const selectCountry = useCallback(async (code: string): Promise<void> => {
    setSelectedCode(code);
    await saveSelectedCountry(code);
  }, []);

  const setRouteStyle = useCallback(async (style: RouteStyle): Promise<void> => {
    setRouteStyleState(style);
    await saveRouteStyle(style);
  }, []);

  const selectEntryCountry = useCallback(async (code: string | null): Promise<void> => {
    setEntryCode(code);
    await saveEntryCountry(code);
  }, []);

  const selectExitCountry = useCallback(async (code: string | null): Promise<void> => {
    setExitCode(code);
    await saveExitCountry(code);
  }, []);

  const setKillSwitch = useCallback(async (enabled: boolean): Promise<void> => {
    setKillSwitchState(enabled);
    await saveKillSwitch(enabled);
  }, []);

  const setAutoConnect = useCallback(async (enabled: boolean): Promise<void> => {
    setAutoConnectState(enabled);
    await saveAutoConnect(enabled);
  }, []);

  const openVpnSettings = useCallback(async (): Promise<void> => {
    await CumulusTunnel.openVpnSettings();
  }, []);

  return {
    keypair,
    countries,
    selected,
    state,
    status,
    tier,
    booting,
    error,
    payment,
    routeStyle,
    multihop,
    entry,
    exit,
    killSwitch,
    autoConnect,
    connect,
    disconnect,
    selectCountry,
    refresh,
    setRouteStyle,
    selectEntryCountry,
    selectExitCountry,
    setKillSwitch,
    setAutoConnect,
    openVpnSettings,
  };
}

/**
 * Bring up a multi-hop route: enroll the *same* key `K` at both the entry and
 * exit gateways (one payment covers both — entitlement follows the key on every
 * gateway, docs/11), resolve the ordered hops with core `selectHops`, render the
 * two nested `.conf`s with `buildMultihopConfig`, and hand them to the native
 * chained-wireguard-go bridge. No gateway protocol change is involved.
 */
async function connectMultihop(args: {
  keypair: Keypair;
  routeStyle: RouteStyle;
  gateways: readonly GatewayInfo[];
  entryCountry: string | null;
  exitCountry: string | null;
  gatewayIpRef: { current: string | null };
  setEnrollment: (r: EnrollResponse) => void;
  killSwitch: boolean;
}): Promise<void> {
  const {
    keypair,
    routeStyle,
    gateways,
    entryCountry,
    exitCountry,
    gatewayIpRef,
    setEnrollment,
    killSwitch,
  } = args;

  // core enforces entry !== exit and the per-style jurisdiction rule; a null
  // country means "auto-pick" (nearest healthy entry / well-connected exit).
  const hops = selectHops(gateways, routeStyle, {
    ...(entryCountry ? { entryCountry } : {}),
    ...(exitCountry ? { exitCountry } : {}),
  });
  if (!hops.exit) {
    throw new Error('Multi-hop needs a distinct exit gateway');
  }

  // Enroll key K at both hops. Same key → premium at both automatically.
  const entryEnroll = await enroll(hops.entry.ip, keypair.publicKey, {
    signPubKey: hops.entry.sign_pubkey,
  });
  const exitEnroll = await enroll(hops.exit.ip, keypair.publicKey, {
    signPubKey: hops.exit.sign_pubkey,
  });

  // Poll entitlement against the entry (key K is premium on both hops).
  gatewayIpRef.current = hops.entry.ip;
  setEnrollment(entryEnroll);

  const mh = buildMultihopConfig({
    privateKey: keypair.privateKey,
    entry: entryEnroll,
    exit: exitEnroll,
  });

  const label = `${hops.entry.country} → ${hops.exit.country}`;
  await CumulusTunnel.startMultihop(mh.outer, mh.inner, label, killSwitch);
}
