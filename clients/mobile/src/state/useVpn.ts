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
import { Platform } from 'react-native';
import {
  applyTransportToEndpoint,
  buildMultihopConfig,
  buildWgConfig,
  enroll,
  generateKeypair,
  obfsForTransport,
  paymentCode,
  paymentMemo,
  selectHops,
  selectTransport,
  status as fetchStatus,
} from '@cumulusvpn/core';
import type {
  EnrollResponse,
  GatewayInfo,
  Keypair,
  RouteStyle,
  Tier,
  TransportMode,
} from '@cumulusvpn/core';
import {
  CumulusTunnel,
  onTunnelStatus,
  type TunnelState,
  type TunnelStatus,
} from '../native/CumulusTunnel';
import {
  discoverFleet,
  groupByCountry,
  groupByLocation,
  localityOf,
  measureLatency,
  routeEndpoint,
  type Country,
  type RouteEndpoint,
} from '../lib/gateways';
import { solvePowFast } from '../lib/pow';
import { bundledDirectory } from '../lib/directory';
import {
  loadActiveRoute,
  loadAutoConnect,
  loadEntryCountry,
  loadExitCountry,
  loadFavorites,
  loadFleet,
  loadKeypair,
  loadKillSwitch,
  loadNodeDiversity,
  loadRouteStyle,
  loadTransportMode,
  loadSelectedCountry,
  saveActiveRoute,
  saveAutoConnect,
  saveEntryCountry,
  saveExitCountry,
  saveFavorites,
  saveFleet,
  saveKeypair,
  saveKillSwitch,
  saveNodeDiversity,
  saveRouteStyle,
  saveTransportMode,
  saveSelectedCountry,
} from './storage';

/** True for any route style that stacks two hops (multi-hop is off by default). */
export function isMultihop(style: RouteStyle): boolean {
  return style !== 'single';
}

/**
 * Transport slugs THIS platform's native tunnel can actually dial. iOS runs the
 * amneziawg-go engine via wgnest for single-hop, so it can do `awg`; Android
 * single-hop still uses the official wireguard library (no obfs), so it stays
 * vanilla until it's rerouted through wgnest. `wg-tls` awaits the native TLS
 * bridge on each platform. Passed to core `selectTransport` so a mode only picks
 * a transport this build can bring up.
 */
const IMPLEMENTED_TRANSPORTS: ReadonlySet<string> =
  Platform.OS === 'ios' ? new Set(['wg', 'awg']) : new Set(['wg']);

/** Everything the UI renders from. */
export interface VpnModel {
  readonly keypair: Keypair | null;
  readonly countries: readonly Country[];
  /** Per-city rows for the single-hop picker (see `groupByLocation`). */
  readonly locations: readonly Country[];
  readonly selected: Country | null;
  readonly state: TunnelState;
  readonly status: TunnelStatus | null;
  readonly tier: Tier;
  /** RFC3339 timestamp premium is paid through, or null when free/unknown. */
  readonly paidUntil: string | null;
  /** True while the initial discovery/enroll bootstrap is running. */
  readonly booting: boolean;
  /** True while a fleet discovery is in flight (initial or pull-to-refresh). */
  readonly discovering: boolean;
  readonly error: string | null;
  /** Payment identity for the (web) upgrade screen. */
  readonly payment: PaymentIdentity | null;
  /**
   * Route style. `'single'` is the default (multi-hop OFF); the two `multihop-*`
   * styles opt into the nested-onion path from `docs/11-multihop.md`.
   */
  readonly routeStyle: RouteStyle;
  /**
   * Transport mode (DPI resistance). `'auto'` (default) prefers the fastest that
   * connects; `'stealth'` picks an obfuscated transport (AmneziaWG / WG-over-TLS)
   * where the gateway advertises one and this build implements it. Persisted.
   */
  readonly transportMode: TransportMode;
  /** Convenience flag: true for any `multihop-*` style. */
  readonly multihop: boolean;
  /** Chosen multi-hop entry country, or null to auto-pick the nearest healthy. */
  readonly entry: Country | null;
  /** Chosen multi-hop exit country, or null to auto-pick a well-connected exit. */
  readonly exit: Country | null;
  /** Kill switch: block all non-tunnel traffic while connected (persisted). */
  readonly killSwitch: boolean;
  /**
   * Multi-hop node diversity: require the entry and exit gateways to sit on
   * different subnets, so a route can't be built from two co-located nodes.
   * Off by default; a small fleet may make a diverse route impossible, in which
   * case a multi-hop connect fails with a clear message (persisted).
   */
  readonly nodeDiversity: boolean;
  /** Auto-connect on app launch once discovery completes (persisted). */
  readonly autoConnect: boolean;
  /** Unix-ms when the active session connected, or null when not connected. */
  readonly connectedSince: number | null;
  /**
   * The actual entry hop of the live route (country + gateway IP). Reflects what
   * `selectHops` really chose — NOT the picker selection — so the connected
   * screen can't disagree with reality. Null when not connected.
   */
  readonly activeEntry: RouteEndpoint | null;
  /**
   * The actual exit hop for a multi-hop route (the egress the world sees). Null
   * for single-hop (entry === exit) and when not connected.
   */
  readonly activeExit: RouteEndpoint | null;
  /** Live throughput in bytes/sec (down = rx rate, up = tx rate). */
  readonly speed: { readonly down: number; readonly up: number };
  /** Live round-trip to the connected exit gateway in ms, or null. */
  readonly pingMs: number | null;
  /** Favorited (pinned) country codes, surfaced first in the picker. */
  readonly favorites: readonly string[];
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
  /** Pick the single-hop country (`null` = Automatic / nearest); persisted. */
  selectCountry(code: string | null): Promise<void>;
  refresh(): Promise<void>;
  /** Switch route style (Fast vs the two multi-hop styles); persisted. */
  setRouteStyle(style: RouteStyle): Promise<void>;
  /** Switch transport mode (Auto vs Stealth); persisted. Applies on next connect. */
  setTransportMode(mode: TransportMode): Promise<void>;
  /** Pick the multi-hop entry country (`null` = auto-pick nearest); persisted. */
  selectEntryCountry(code: string | null): Promise<void>;
  /** Pick the multi-hop exit country (`null` = auto-pick); persisted. */
  selectExitCountry(code: string | null): Promise<void>;
  /** Toggle the kill switch (persisted). Applies on the next connect. */
  setKillSwitch(enabled: boolean): Promise<void>;
  /** Toggle multi-hop node diversity (persisted). Applies on the next connect. */
  setNodeDiversity(enabled: boolean): Promise<void>;
  /** Toggle auto-connect on launch (persisted). */
  setAutoConnect(enabled: boolean): Promise<void>;
  /** Pin/unpin a country as a favorite (persisted). */
  toggleFavorite(code: string): Promise<void>;
  /** Open the OS VPN settings (Android lockdown hand-off; no-op on iOS). */
  openVpnSettings(): Promise<void>;
}

const STATUS_POLL_MS = 30_000;

export function useVpn(): VpnModel & VpnActions {
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [countries, setCountries] = useState<readonly Country[]>([]);
  // Per-CITY rows for the single-hop picker (a country can appear as several
  // cities, e.g. US New York / California). Country-level `countries` still
  // drives multi-hop entry/exit (jurisdiction is a country, not a city).
  const [locations, setLocations] = useState<readonly Country[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [state, setState] = useState<TunnelState>('disconnected');
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [tier, setTier] = useState<Tier>('free');
  // RFC3339 timestamp premium is paid through (null when free / unknown).
  const [paidUntil, setPaidUntil] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  // True while a fleet discovery is in flight (initial + pull-to-refresh). Lets
  // the UI show a lightweight "finding servers" hint instead of pinning the
  // full-screen boot splash for the whole discovery + latency pass.
  const [discovering, setDiscovering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollResponse | null>(null);
  const [routeStyle, setRouteStyleState] = useState<RouteStyle>('single');
  const [transportMode, setTransportModeState] = useState<TransportMode>('auto');
  const [entryCode, setEntryCode] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<string | null>(null);
  const [killSwitch, setKillSwitchState] = useState(false);
  const [nodeDiversity, setNodeDiversityState] = useState(false);
  const [autoConnect, setAutoConnectState] = useState(false);
  const [favorites, setFavorites] = useState<readonly string[]>([]);
  // Mirror of `favorites` for toggleFavorite to read the current value without a
  // stale closure or a side-effecting setState updater (which could persist a
  // stale array on rapid taps).
  const favoritesRef = useRef<readonly string[]>([]);
  const autoConnectedRef = useRef(false);
  // Unix-ms when the current session connected, for the session timer.
  const [connectedSince, setConnectedSince] = useState<number | null>(null);
  // The route actually established (from selectHops), for an honest connected
  // display. activeExit is null for single-hop.
  const [activeEntry, setActiveEntry] = useState<RouteEndpoint | null>(null);
  const [activeExit, setActiveExit] = useState<RouteEndpoint | null>(null);
  // Live metrics while connected: down/up bytes/sec (from counter deltas) and a
  // round-trip ping to the exit. Derived by the polling effects below.
  const [speed, setSpeed] = useState<{ down: number; up: number }>({ down: 0, up: 0 });
  const [pingMs, setPingMs] = useState<number | null>(null);
  const lastSampleRef = useRef<{ rx: number; tx: number; t: number } | null>(null);
  // Whether the user currently wants a tunnel (true after connect, false after
  // an explicit disconnect) + whether we reached 'connected' — together these
  // distinguish an unexpected drop from a user disconnect, for auto-reconnect.
  const wantConnectedRef = useRef(false);
  const wasConnectedRef = useRef(false);

  // Latest enrolled gateway IP, kept in a ref for the status poller.
  const gatewayIpRef = useRef<string | null>(null);
  // Flat, verified fleet from the last discovery — core `selectHops` needs the
  // whole list (not just the per-country `best`) to find a distinct exit.
  const gatewaysRef = useRef<readonly GatewayInfo[]>([]);
  // Failover: gateway IP → unix-ms until which it's avoided (a node that just
  // dropped/failed us). Lets a reconnect hop to the next-best node instead of
  // re-dialling the dead one. Entries expire; a manual disconnect clears them.
  const avoidRef = useRef<Map<string, number>>(new Map());
  const AVOID_MS = 90_000;

  /** Mark a gateway IP as recently-failed so failover skips it for a while. */
  const avoidGateway = useCallback((ip: string | null): void => {
    if (ip) {
      avoidRef.current.set(ip, Date.now() + AVOID_MS);
    }
  }, []);

  /**
   * Pick the gateway to dial for a single-hop location, preferring the least-
   * loaded node that isn't currently avoided: same city first, then anywhere in
   * the country, then the location's default as a last resort.
   */
  const pickGateway = useCallback((location: Country): GatewayInfo => {
    const now = Date.now();
    const all = gatewaysRef.current;
    const free = (gs: readonly GatewayInfo[]): GatewayInfo[] =>
      gs.filter((g) => (avoidRef.current.get(g.ip) ?? 0) <= now);
    const inCity = all.filter(
      (g) => g.country === location.code && localityOf(g.city, g.country) === location.city,
    );
    const inCountry = all.filter((g) => g.country === location.code);
    for (const pool of [free(inCity), free(inCountry)]) {
      if (pool.length > 0) {
        return [...pool].sort((a, b) => a.load - b.load)[0]!;
      }
    }
    return location.best;
  }, []);

  /** The fleet minus currently-avoided nodes (fallback: everything). */
  const availableGateways = useCallback((): readonly GatewayInfo[] => {
    const now = Date.now();
    const free = gatewaysRef.current.filter((g) => (avoidRef.current.get(g.ip) ?? 0) <= now);
    return free.length > 0 ? free : gatewaysRef.current;
  }, []);

  // Single-hop selection is a LOCATION (city) id; `selectedCode` holds it. Old
  // persisted country codes still resolve because a single-city country's id
  // equals its code.
  const selected = useMemo<Country | null>(
    () => locations.find((l) => l.id === selectedCode) ?? null,
    [locations, selectedCode],
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
    if (!keypair) {
      return null;
    }
    // Pay-to address + price come from the SIGNED DIRECTORY (bundled, always
    // available) so Upgrade works before the user has ever connected. A live
    // enrollment overrides them when present. (Previously this required an
    // enrollment, so opening Upgrade before connecting showed nothing.)
    return {
      code: paymentCode(keypair.publicKey),
      memo: paymentMemo(keypair.publicKey),
      address: enrollment?.payment_address ?? bundledDirectory.payment_address,
      priceFlux: enrollment?.price_flux ?? bundledDirectory.price_flux,
    };
  }, [keypair, enrollment]);

  // ---- bootstrap: key + discovery ----------------------------------------
  // Latency pass, run AFTER first paint. Measuring each country's best gateway
  // is N network round-trips; doing it before showing the list is what kept the
  // boot splash up "for quite some time". So the list paints from discovery
  // alone and the latency dots fill in here, asynchronously.
  const measureLatencies = useCallback(
    async (
      gateways: readonly GatewayInfo[],
      countryRows: readonly Country[],
      locationRows: readonly Country[],
    ): Promise<void> => {
      // Ping every distinct "best" across both groupings (deduped by IP).
      const bests = new Map<string, GatewayInfo>();
      for (const c of countryRows) {
        bests.set(c.best.ip, c.best);
      }
      for (const l of locationRows) {
        bests.set(l.best.ip, l.best);
      }
      const measured = await Promise.all(
        [...bests.values()].map(async (gw) => [gw.ip, await measureLatency(gw)] as const),
      );
      const latencyByIp: Record<string, number> = {};
      for (const [ip, ms] of measured) {
        if (ms !== null) {
          latencyByIp[ip] = ms;
        }
      }
      setCountries(groupByCountry(gateways, latencyByIp));
      setLocations(groupByLocation(gateways, latencyByIp));
      // Persist this good snapshot as the launch cache (best-effort).
      void saveFleet(gateways, latencyByIp, Date.now()).catch(() => undefined);
    },
    [],
  );

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    setDiscovering(true);
    try {
      const gateways = await discoverFleet();
      gatewaysRef.current = gateways;
      // Paint the server list immediately (this dismisses the boot splash);
      // latency dots stream in from the background pass so first paint isn't
      // blocked on the ping round-trips.
      const countryRows = groupByCountry(gateways);
      const locationRows = groupByLocation(gateways);
      setCountries(countryRows);
      setLocations(locationRows);
      void measureLatencies(gateways, countryRows, locationRows);
    } finally {
      setDiscovering(false);
    }
  }, [measureLatencies]);

  useEffect(() => {
    let alive = true;
    // Hard cap: never hold the boot splash longer than this. If discovery is
    // slow (an unreachable gateway can stall up to the fetch timeout), reveal
    // the app anyway — discovery keeps running in the background and the list
    // populates when it resolves. (The splash also clears the moment countries
    // paint, via the `booting && countries.length === 0` gate in App.tsx.)
    const bootCap = setTimeout(() => {
      if (alive) {
        setBooting(false);
      }
    }, 2500);
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
        setTransportModeState(await loadTransportMode());
        setEntryCode(await loadEntryCountry());
        setExitCode(await loadExitCountry());
        setKillSwitchState(await loadKillSwitch());
        setNodeDiversityState(await loadNodeDiversity());
        setAutoConnectState(await loadAutoConnect());
        favoritesRef.current = await loadFavorites();
        setFavorites(favoritesRef.current);
        // Paint the cached fleet first (instant, dismisses the splash), then
        // refresh live in the background. On a cold first launch there's no
        // cache, so this is a no-op and the splash waits for live discovery.
        const cached = await loadFleet();
        if (alive && cached) {
          gatewaysRef.current = cached.gateways;
          setCountries(groupByCountry(cached.gateways, cached.latencyByIp));
          setLocations(groupByLocation(cached.gateways, cached.latencyByIp));
        }
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
      clearTimeout(bootCap);
    };
  }, [refresh]);

  // ---- native tunnel status stream ---------------------------------------
  useEffect(() => {
    const sub = onTunnelStatus((s) => {
      setStatus(s);
      setState(s.state);
      if (s.state === 'connected') {
        setConnectedSince((prev) => prev ?? Date.now());
      } else if (s.state === 'disconnected' || s.state === 'error') {
        setConnectedSince(null);
      }
    });
    return () => sub.remove();
  }, []);

  // ---- adopt a tunnel that outlived a previous app session ----------------
  // After a force-quit while connected, the NE extension keeps running but the
  // JS state machine boots at 'disconnected' and NO status event fires (nothing
  // changed). Ask the native side once on launch; if a tunnel is already up,
  // adopt 'connected' so the UI is honest and Disconnect works — otherwise the
  // app looks idle over a live tunnel and connecting "on top" gets into a bad
  // state. Only ever promotes idle→connected; never fights the connect flow.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await CumulusTunnel.getStatus();
        if (alive && s.state === 'connected') {
          setStatus(s);
          setState((prev) => (prev === 'disconnected' ? 'connected' : prev));
          setConnectedSince((prev) => prev ?? Date.now());
          // Restore which gateway(s) the live tunnel runs through so the
          // connected screen shows the route/city/IP, not a blank card.
          const route = await loadActiveRoute();
          if (alive && route) {
            setActiveEntry((prev) => prev ?? route.entry);
            setActiveExit((prev) => prev ?? route.exit);
          }
        }
      } catch {
        // No tunnel / not reachable — stay disconnected.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ---- live counters + speed: poll while connected -----------------------
  // The event stream only fires on state changes, so the byte/handshake
  // counters never move without an explicit poll. Sample every 1.5s and derive
  // down/up throughput from the deltas.
  useEffect(() => {
    if (state !== 'connected') {
      lastSampleRef.current = null;
      setSpeed({ down: 0, up: 0 });
      return undefined;
    }
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const s = await CumulusTunnel.getStatus();
        if (!alive) {
          return;
        }
        setStatus(s);
        const t = Date.now();
        const prev = lastSampleRef.current;
        if (prev) {
          const dt = (t - prev.t) / 1000;
          if (dt > 0) {
            setSpeed({
              down: Math.max(0, (s.rxBytes - prev.rx) / dt),
              up: Math.max(0, (s.txBytes - prev.tx) / dt),
            });
          }
        }
        lastSampleRef.current = { rx: s.rxBytes, tx: s.txBytes, t };
      } catch {
        // Ignore a transient poll failure; keep the last sample.
      }
    };
    const id = setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [state]);

  // ---- live ping while connected -----------------------------------------
  // Measure round-trip THROUGH the tunnel to a tiny, ubiquitous connectivity
  // endpoint (Google's generate_204 → an empty 204). We can't ping the gateway's
  // own control API once connected: that request hairpins at the gateway and
  // times out, so the Ping stat always read "—". This is the user's effective
  // latency via the VPN, which is the more useful number anyway.
  useEffect(() => {
    if (state !== 'connected') {
      setPingMs(null);
      return undefined;
    }
    let alive = true;
    const PING_URL = 'https://www.gstatic.com/generate_204';
    const sample = async (): Promise<number | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const started = Date.now();
      try {
        await fetch(PING_URL, { method: 'GET', signal: controller.signal });
        return Date.now() - started;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };
    const tick = async (): Promise<void> => {
      // Two samples, keep the lower — the second reuses the warm connection, so
      // it excludes most of the TCP/TLS setup and reads closer to true latency.
      const a = await sample();
      const b = await sample();
      const best = [a, b].filter((x): x is number => x !== null).sort((x, y) => x - y)[0] ?? null;
      if (alive) {
        setPingMs(best);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [state]);

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

  // ---- disconnect watchdog: never hang on "disconnecting" forever ---------
  // stopTunnel() can resolve without a following native status event (e.g. iOS
  // after an app relaunch, when no NEVPNStatus observer is attached). Without
  // this, `state` sticks on 'disconnecting' → the orb and button stay disabled.
  useEffect(() => {
    if (state !== 'disconnecting') {
      return;
    }
    const id = setTimeout(() => setState('disconnected'), 8_000);
    return () => clearTimeout(id);
  }, [state]);

  // ---- entitlement polling (tier unlocks ~1 min after on-chain payment) ---
  // Entitlement is chain-derived and GLOBAL: every gateway reports the same tier
  // for a key, independent of where (or whether) it enrolled. We sample a few
  // DISCOVERED gateways — never the one we're tunnelled through, since a request
  // to it hairpins and times out (same reason the live-ping targets gstatic, not
  // the gateway). This works connected (routed through the tunnel to another
  // node) and disconnected (direct), so "pay, then reopen the app" reflects
  // before any connect, and a mid-session expiry/upgrade is still picked up.
  // Premium from ANY node is the truth (one node lagging the chain can't hide
  // it); fall back to Free only when reachable nodes agree. `countries` is in the
  // deps so the first poll fires as soon as the fleet is discovered.
  useEffect(() => {
    if (!keypair) {
      return;
    }
    let alive = true;
    const poll = async () => {
      const pubkey = keypair.publicKey;
      const activeIp = gatewayIpRef.current;
      const sample = gatewaysRef.current.filter((g) => g.ip !== activeIp).slice(0, 3);
      if (sample.length === 0) {
        return;
      }
      const results = await Promise.all(
        sample.map((g) => fetchStatus(g.ip, pubkey).catch(() => null)),
      );
      if (!alive) {
        return;
      }
      const premiumResult = results.find((r) => r?.tier === 'premium');
      if (premiumResult) {
        setTier('premium');
        setPaidUntil(premiumResult.paid_until);
      } else if (results.some((r) => r)) {
        setTier('free');
        setPaidUntil(null);
      }
    };
    const id = setInterval(poll, STATUS_POLL_MS);
    void poll();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [keypair, enrollment, countries]);

  // ---- actions ------------------------------------------------------------
  const connect = useCallback(async (): Promise<void> => {
    if (!keypair) {
      return;
    }
    wantConnectedRef.current = true;
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
        // Auto entry: prefer the NEAREST measured country (countries are
        // latency-sorted) that can satisfy the route, instead of letting
        // selectHops fall back to the globally least-loaded gateway — which can
        // be on another continent (the "I picked auto and got Canada" surprise).
        const autoEntry =
          routeStyle === 'multihop-same-country'
            ? countries.find((c) => c.nodeCount >= 2)?.code
            : countries[0]?.code;
        const hops = await connectMultihop({
          keypair,
          routeStyle,
          gateways: availableGateways(),
          entryCountry: entryCode ?? autoEntry ?? null,
          exitCountry: exitCode,
          gatewayIpRef,
          setEnrollment,
          killSwitch,
          requireDistinctSubnet: nodeDiversity,
        });
        const entryEp = routeEndpoint(hops.entry);
        const exitEp = routeEndpoint(hops.exit);
        setActiveEntry(entryEp);
        setActiveExit(exitEp);
        // Persist the live route so a force-quit + relaunch can restore where
        // we're connected (see the launch-reconciliation effect).
        void saveActiveRoute({ entry: entryEp, exit: exitEp });
        return;
      }

      // ---- single-hop (Fast, default) ----
      // `selectedCode` is a LOCATION id; auto (null) → nearest location.
      const target = locations.find((l) => l.id === selectedCode) ?? locations[0] ?? null;
      if (!target) {
        setState('error');
        setError('No gateways reachable');
        return;
      }
      // Failover-aware: skip any node that just dropped/failed us.
      const gw = pickGateway(target);
      gatewayIpRef.current = gw.ip;
      try {
        const resp = await enroll(gw.ip, keypair.publicKey, {
          signPubKey: gw.sign_pubkey,
          powSolver: solvePowFast,
        });
        setEnrollment(resp);
        const entryEp = routeEndpoint(gw);
        setActiveEntry(entryEp);
        setActiveExit(null);

        // Transport negotiation (docs/15-transports.md): pick the transport this
        // gateway advertises for the current mode and point the config at its
        // port. M0 implements vanilla WG only, so this resolves to :51820 — a
        // no-op today — but wires the seam the obfuscated/TLS tiers will use.
        // Mode is fixed to 'auto' until the M3 Speed/Stealth UI toggle.
        const transport = selectTransport(gw.transports, transportMode, IMPLEMENTED_TRANSPORTS);
        const endpoint = transport
          ? applyTransportToEndpoint(resp.endpoint, transport)
          : resp.endpoint;
        const obfs = transport ? obfsForTransport(transport) : undefined;

        const wgConfig = buildWgConfig({
          privateKey: keypair.privateKey,
          assignedIp: resp.assigned_ip,
          dns: resp.dns,
          serverPubKey: resp.server_pubkey,
          endpoint,
          ...(obfs ? { obfs } : {}),
        });
        await CumulusTunnel.startTunnel(wgConfig, target.name, killSwitch);
        // Persist the live route so a force-quit + relaunch can restore where
        // we're connected (see the launch-reconciliation effect).
        void saveActiveRoute({ entry: entryEp, exit: null });
      } catch (e) {
        // This node failed — avoid it so the reconnect/retry hops elsewhere.
        avoidGateway(gw.ip);
        throw e;
      }
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [
    keypair,
    countries,
    locations,
    selectedCode,
    routeStyle,
    transportMode,
    entryCode,
    exitCode,
    killSwitch,
    nodeDiversity,
    pickGateway,
    avoidGateway,
    availableGateways,
  ]);

  const disconnect = useCallback(async (): Promise<void> => {
    wantConnectedRef.current = false;
    wasConnectedRef.current = false;
    setState('disconnecting');
    setActiveEntry(null);
    setActiveExit(null);
    void saveActiveRoute(null);
    // A deliberate disconnect is a clean slate — forget failed-node history and
    // the enrolled-gateway IP, so entitlement polling resumes sampling the whole
    // fleet (not a node we're no longer on) instead of latching one address.
    avoidRef.current.clear();
    gatewayIpRef.current = null;
    try {
      await CumulusTunnel.stopTunnel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ---- auto-reconnect on an unexpected drop ------------------------------
  // If the tunnel drops while the user still wants it (they didn't tap
  // Disconnect) and we had reached 'connected', bring it back up shortly. Only
  // reconnects a genuine drop — initial connect failures are handled by the
  // watchdog + the error message, not a retry loop.
  useEffect(() => {
    if (state === 'connected') {
      wasConnectedRef.current = true;
      return;
    }
    if (state === 'disconnected' && wantConnectedRef.current && wasConnectedRef.current) {
      wasConnectedRef.current = false;
      // The node we were on just dropped us — avoid it so the reconnect fails
      // OVER to the next-best node instead of re-dialling the dead one.
      avoidGateway(gatewayIpRef.current);
      const id = setTimeout(() => void connect(), 3000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [state, connect, avoidGateway]);

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

  const selectCountry = useCallback(async (code: string | null): Promise<void> => {
    setSelectedCode(code);
    await saveSelectedCountry(code);
  }, []);

  const setRouteStyle = useCallback(async (style: RouteStyle): Promise<void> => {
    setRouteStyleState(style);
    await saveRouteStyle(style);
  }, []);

  const setTransportMode = useCallback(async (mode: TransportMode): Promise<void> => {
    setTransportModeState(mode);
    await saveTransportMode(mode);
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

  const setNodeDiversity = useCallback(async (enabled: boolean): Promise<void> => {
    setNodeDiversityState(enabled);
    await saveNodeDiversity(enabled);
  }, []);

  const setAutoConnect = useCallback(async (enabled: boolean): Promise<void> => {
    setAutoConnectState(enabled);
    await saveAutoConnect(enabled);
  }, []);

  const toggleFavorite = useCallback(async (code: string): Promise<void> => {
    const cur = favoritesRef.current;
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    favoritesRef.current = next;
    setFavorites(next);
    await saveFavorites(next);
  }, []);

  const openVpnSettings = useCallback(async (): Promise<void> => {
    await CumulusTunnel.openVpnSettings();
  }, []);

  return {
    keypair,
    countries,
    locations,
    selected,
    state,
    status,
    tier,
    paidUntil,
    booting,
    discovering,
    error,
    payment,
    routeStyle,
    transportMode,
    multihop,
    entry,
    exit,
    killSwitch,
    nodeDiversity,
    autoConnect,
    connectedSince,
    activeEntry,
    activeExit,
    speed,
    pingMs,
    favorites,
    connect,
    disconnect,
    selectCountry,
    refresh,
    setRouteStyle,
    setTransportMode,
    selectEntryCountry,
    selectExitCountry,
    setKillSwitch,
    setNodeDiversity,
    setAutoConnect,
    toggleFavorite,
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
  requireDistinctSubnet: boolean;
}): Promise<{ entry: GatewayInfo; exit: GatewayInfo }> {
  const {
    keypair,
    routeStyle,
    gateways,
    entryCountry,
    exitCountry,
    gatewayIpRef,
    setEnrollment,
    killSwitch,
    requireDistinctSubnet,
  } = args;

  // core enforces entry !== exit and the per-style jurisdiction rule; a null
  // country means "auto-pick" (nearest healthy entry / well-connected exit).
  // With node diversity on, entry and exit must also differ by subnet — which a
  // small fleet may not allow, so translate that failure into a clear message.
  let hops;
  try {
    hops = selectHops(gateways, routeStyle, {
      ...(entryCountry ? { entryCountry } : {}),
      ...(exitCountry ? { exitCountry } : {}),
      ...(requireDistinctSubnet ? { requireDistinctSubnet: true } : {}),
    });
  } catch (e) {
    if (requireDistinctSubnet) {
      throw new Error(
        'No distinct-network route available. Turn off Node diversity, or pick different entry/exit countries.',
      );
    }
    throw e;
  }
  if (!hops.exit) {
    throw new Error('Multi-hop needs a distinct exit gateway');
  }

  // Enroll key K at both hops. Same key → premium at both automatically.
  // Run both concurrently: each solves an independent PoW, and the native
  // solver runs them off the JS thread (on separate cores), so the two solves
  // overlap instead of adding up — roughly halving multi-hop setup time.
  const [entryEnroll, exitEnroll] = await Promise.all([
    enroll(hops.entry.ip, keypair.publicKey, {
      signPubKey: hops.entry.sign_pubkey,
      powSolver: solvePowFast,
    }),
    enroll(hops.exit.ip, keypair.publicKey, {
      signPubKey: hops.exit.sign_pubkey,
      powSolver: solvePowFast,
    }),
  ]);

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
  return { entry: hops.entry, exit: hops.exit };
}
