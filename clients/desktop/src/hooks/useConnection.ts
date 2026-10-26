/**
 * The single stateful hook the tray window is built around: it owns the device
 * keypair, the discovered country list, the connect/disconnect lifecycle, and
 * live polling of native tunnel status + chain entitlement.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GatewayInfo, Keypair, Tier, TransportMode } from '@cumulusvpn/core';
// (Tier is used for both the displayed entitlement and transport gating.)
import { loadOrCreateKeypair, loadSelectedCountry, saveSelectedCountry } from '../lib/storage.js';
import {
  discoverFleetAndCountries,
  establish,
  establishMultihop,
  fetchEntitlement,
  teardown,
} from '../lib/session.js';
import { KeyedGateways } from '../lib/session.js';
import type { CountryOption } from '../lib/session.js';
import { status as nativeStatus, helperRegistration, helperReady, logLine } from '../lib/tauri.js';
import type { TunnelStatus, HelperRegistration } from '../lib/tauri.js';

export type Phase = 'loading' | 'idle' | 'connecting' | 'connected' | 'error';

/**
 * The two multi-hop route styles offered in the UI (a subset of the core
 * `RouteStyle`; single-hop is expressed by the `multihop` toggle being off).
 * - `'multihop-same-country'` — Balanced: entry ≠ exit within one jurisdiction.
 * - `'multihop-cross-jurisdiction'` — Max privacy: entry and exit in different
 *   countries, so deanonymizing needs two operators in two countries.
 */
export type MultihopStyle = 'multihop-same-country' | 'multihop-cross-jurisdiction';

export interface Entitlement {
  readonly tier: Tier;
  readonly paidUntil: string;
  readonly bytesUsed: number;
}

export interface ConnectionModel {
  readonly phase: Phase;
  /**
   * Setup state of the tunnel engine. `enabled` (the privileged helper daemon
   * serves this app), `notNeeded` (macOS run as root) and `elevated` (Linux
   * run as root without a daemon) are ready; anything else is a setup
   * step, and no tunnel is possible until it is done — the app itself holds no
   * privileges. See `helperReady` and `lib/setup.ts`.
   */
  readonly helperState: HelperRegistration;
  readonly countries: readonly CountryOption[];
  /** Single-hop location, or the ENTRY hop when multi-hop is on. */
  readonly selected: CountryOption | null;
  readonly tunnel: TunnelStatus;
  /**
   * Why DNS is not (fully) going through the tunnel, while connected; `null`
   * when it is. Comes from the native status (`dnsWarning`), refreshed by the
   * status poll, so a DNS setting the OS reclaims after a roam shows up too.
   */
  readonly dnsWarning: string | null;
  readonly entitlement: Entitlement | null;
  /** True when the live session has split-tunneling rules applied (docs/17 §8). */
  readonly splitActive: boolean;
  readonly error: string | null;
  readonly select: (code: string) => void;
  readonly connect: () => void;
  readonly disconnect: () => void;
  // ---- multi-hop (opt-in; OFF by default) --------------------------------
  /** Whether multi-hop ("ultimate privacy") mode is engaged. */
  readonly multihop: boolean;
  /** Chosen route style — only meaningful while `multihop` is true. */
  readonly routeStyle: MultihopStyle;
  /** The EXIT hop chosen for multi-hop (entry is `selected`). */
  readonly exit: CountryOption | null;
  /** Toggle multi-hop on/off. */
  readonly setMultihop: (on: boolean) => void;
  /** Pick the multi-hop route style. */
  readonly setRouteStyle: (style: MultihopStyle) => void;
  /** Pick the EXIT country for multi-hop. */
  readonly selectExit: (code: string) => void;

  // ---- kill switch (leak protection) -------------------------------------
  /** Whether to engage the kill switch when connecting (persisted; default on). */
  readonly killSwitch: boolean;
  /** Transport mode: 'auto' (fastest) or 'stealth' (obfuscated); persisted. */
  readonly transportMode: TransportMode;
  readonly setTransportMode: (mode: TransportMode) => void;
  /** Toggle the kill switch; applies on the next connect. */
  readonly setKillSwitch: (on: boolean) => void;
  /** Auto-connect on launch once discovery settles (persisted; default off). */
  readonly autoConnect: boolean;
  /** Toggle auto-connect on launch. */
  readonly setAutoConnect: (on: boolean) => void;
  /** Unix-ms when the active session connected, or null when not connected. */
  readonly connectedSince: number | null;
  /** Re-discover the fleet (re-test node load/quality); keeps the selection. */
  readonly refresh: () => Promise<void>;
  /** Favorited (pinned) country codes, surfaced first in the picker. */
  readonly favorites: readonly string[];
  /** Pin/unpin a country. */
  readonly toggleFavorite: (code: string) => void;
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

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Backoff for auto-reconnect attempts, in milliseconds.
 *
 * Starts at 5s, not 3: a reconnect re-runs the whole transport sweep, which
 * begins with a fresh enrollment, and the gateway rate-limits enroll to one per
 * source IP per 2s. Too eager a retry collides with the enroll the failed
 * attempt just made and fails on the rate limit rather than the actual
 * condition. Doubling from there gives a roam ~3 minutes to settle, which
 * covers a slow DHCP lease or a phone bringing up a hotspot.
 */
const RECONNECT_DELAYS_MS = [5000, 10000, 20000, 40000, 60000, 60000] as const;

/**
 * What a status read at launch says about a session that outlived the previous
 * app instance. The helper daemon keeps the tunnel (and its kill switch and
 * repair loop) when the app is killed, so a relaunched app must reattach to it
 * rather than show a fresh "disconnected" over a tunnel that is up:
 *
 * - `connected` — up (or still coming up): show it as connected; the status
 *   poll takes it from there.
 * - `error` — it dropped while no app was watching (the watchdog fired, the
 *   kill switch is still holding): surface the error and let auto-reconnect
 *   bring it back, as it would have had the app been running.
 * - `null` — nothing to reattach to.
 */
export function reattachPhase(status: TunnelStatus): 'connected' | 'error' | null {
  switch (status.state) {
    case 'up':
    case 'connecting':
      return 'connected';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

/**
 * The DNS warning to show: only while connected (a stale one from the last
 * session must not outlive it), and `null` rather than `undefined` when a
 * helper too old to send the field answers.
 */
export function dnsWarningOf(phase: Phase, tunnel: TunnelStatus): string | null {
  return phase === 'connected' ? (tunnel.dnsWarning ?? null) : null;
}

export function useConnection(): ConnectionModel {
  const keypairRef = useRef<Keypair | null>(null);
  if (keypairRef.current === null) {
    keypairRef.current = loadOrCreateKeypair();
  }
  const keypair = keypairRef.current;

  const [phase, setPhase] = useState<Phase>('loading');
  const [countries, setCountries] = useState<readonly CountryOption[]>([]);
  // The full discovered fleet (several gateways per country), kept for multi-hop
  // hop selection — the collapsed `countries` list can't supply a distinct
  // second in-country gateway for a same-country route.
  const fleetRef = useRef<readonly GatewayInfo[]>([]);
  const [selected, setSelected] = useState<CountryOption | null>(null);
  const [tunnel, setTunnel] = useState<TunnelStatus>(DOWN);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  // Session truth for the split-tunneling indicator (docs/17 §8) — set from
  // the establish result, not the stored policy (a tier lapse or kill-switch
  // conflict makes them differ), and cleared with the session.
  const [splitActive, setSplitActive] = useState(false);
  // Tier for TRANSPORT SELECTION, mirrored into a ref so `connect` can read it
  // without taking `entitlement` as a dependency — that would re-create
  // `connect` on every poll, and the auto-reconnect effect depends on it (its
  // cleanup would clear the pending retry timer).
  const tierRef = useRef<Tier>('free');
  // Cancels an in-flight transport sweep. Without it, a Disconnect landing
  // mid-sweep looks exactly like "this transport failed", and the loop would
  // re-engage the kill switch and rebuild the tunnel the user just cancelled.
  const sweepRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Multi-hop is OFF by default; Balanced (same country) is the default style.
  const [multihop, setMultihopState] = useState(false);
  const [routeStyle, setRouteStyleState] = useState<MultihopStyle>('multihop-same-country');
  const [exit, setExit] = useState<CountryOption | null>(null);
  // Transport mode: 'auto' (fastest) or 'stealth' (obfuscated); persisted.
  const [transportMode, setTransportModeState] = useState<TransportMode>(() =>
    localStorage.getItem('cvpn.transportMode') === 'stealth' ? 'stealth' : 'auto',
  );
  // Kill switch defaults ON (leak protection by default); persisted in localStorage.
  const [killSwitch, setKillSwitchState] = useState(
    () => localStorage.getItem('cvpn.killSwitch') !== '0',
  );
  const [autoConnect, setAutoConnectState] = useState(
    () => localStorage.getItem('cvpn.autoConnect') === '1',
  );
  const autoConnectedRef = useRef(false);
  // Unix-ms when the current session connected (for the session timer), and
  // whether we ever reached 'connected' this session (for auto-reconnect).
  const [connectedSince, setConnectedSince] = useState<number | null>(null);
  const wasConnectedRef = useRef(false);
  // Consecutive failed auto-reconnects, for the backoff below. Reset on every
  // successful connect.
  const reconnectAttemptsRef = useRef(0);
  // Bumped by every connect and disconnect: a status poll applies its result
  // only while the session it was started for is still the current one.
  const sessionRef = useRef(0);
  // Every gateway the client key has been sent to since launch; never a
  // multi-hop exit (see establishMultihop).
  const [keyed] = useState(() => new KeyedGateways());
  // Setup state of the tunnel engine (the helper daemon, or a ready state
  // where the tunnel runs in-process). Optimistic default: assume it is fine
  // until told otherwise, so the setup banner never flashes on a normal launch
  // before the first check comes back.
  const [helperState, setHelperState] = useState<HelperRegistration>('notNeeded');
  const [favorites, setFavorites] = useState<readonly string[]>(() =>
    (localStorage.getItem('cvpn.favorites') ?? '').split(',').filter(Boolean),
  );

  // The selected country's code, for updaters that must not read state.
  const selectedCodeRef = useRef<string | null>(null);
  useEffect(() => {
    selectedCodeRef.current = selected?.code ?? null;
  }, [selected]);

  // Install a discovery result, complete or partial: the fleet hop selection
  // reads, the picker rows, and the chosen entry and exit rows moved to the
  // least-loaded gateway now known for their country. An exit still unset
  // takes the first country other than the entry's once one has verified.
  const applyFleet = useCallback(
    (list: readonly CountryOption[], fleet: readonly GatewayInfo[]) => {
      fleetRef.current = fleet;
      setCountries(list);
      const fresh = (prev: CountryOption | null): CountryOption | null =>
        prev ? (list.find((c) => c.code === prev.code) ?? prev) : prev;
      setSelected(fresh);
      setExit((prev) => {
        if (prev) {
          return fresh(prev);
        }
        const entry = selectedCodeRef.current;
        return entry ? (list.find((c) => c.code !== entry) ?? null) : null;
      });
    },
    [],
  );

  // Bootstrap: reattach to a session that outlived the previous app instance,
  // discover the fleet, and restore the last-selected country.
  useEffect(() => {
    let alive = true;
    void (async () => {
      // First, and independently of discovery: a live tunnel is the truth to
      // show whether or not the fleet can be listed right now. An unreachable
      // helper simply means nothing to reattach to; the setup banner covers it.
      let live: TunnelStatus | null = null;
      try {
        const s = await nativeStatus();
        live = reattachPhase(s) ? s : null;
      } catch {
        live = null;
      }
      const reattach = (s: TunnelStatus): void => {
        const to = reattachPhase(s);
        if (!to) {
          return;
        }
        // A live session is what auto-connect would have produced; never start
        // a second one on top of it.
        autoConnectedRef.current = true;
        // So a drop (now, or later) is auto-reconnected like any other.
        wasConnectedRef.current = true;
        setTunnel(s);
        if (to === 'error') {
          setError(s.error ?? 'connection lost');
        }
        setPhase(to);
      };
      // The country to open on: a live tunnel's, else the remembered one. The
      // picker fills in as gateways verify; the app is ready as soon as that
      // country has a gateway, and otherwise when discovery has finished.
      const remembered = loadSelectedCountry();
      const wanted = live?.country ?? remembered;
      const started = performance.now();
      let ready = false;
      const show = (
        list: readonly CountryOption[],
        fleet: readonly GatewayInfo[],
        final: boolean,
      ) => {
        if (!alive) {
          return;
        }
        applyFleet(list, fleet);
        if (ready) {
          return;
        }
        const pick =
          list.find((c) => c.code === wanted) ??
          (final ? (list.find((c) => c.code === remembered) ?? list[0] ?? null) : undefined);
        if (pick === undefined) {
          return;
        }
        ready = true;
        logLine(
          `ui: ready on ${pick?.code ?? 'no location'} after ` +
            `${Math.round(performance.now() - started)} ms, ${fleet.length} gateway(s) verified` +
            `${final ? ', discovery complete' : ''}`,
        );
        setSelected(pick);
        // Default the exit to the first country different from the entry, so
        // multi-hop has a sane cross-jurisdiction pair the moment it's toggled
        // (applyFleet fills it in if no other country has verified yet).
        setExit(list.find((c) => c.code !== pick?.code) ?? null);
        if (live) {
          reattach(live);
        } else {
          setPhase('idle');
        }
      };
      try {
        const { countries: list, fleet } = await discoverFleetAndCountries(undefined, (d) =>
          show(d.countries, d.fleet, false),
        );
        show(list, fleet, true);
      } catch (err) {
        if (!alive) {
          return;
        }
        if (live) {
          reattach(live);
          return;
        }
        setError(messageOf(err));
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyFleet]);

  // Re-discover the fleet on demand (re-tests each node's live load, updating
  // the quality ratings). Keeps the current selection.
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { countries: list, fleet } = await discoverFleetAndCountries(undefined, (d) =>
        applyFleet(d.countries, d.fleet),
      );
      applyFleet(list, fleet);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [applyFleet]);

  const select = useCallback(
    (code: string) => {
      const next = countries.find((c) => c.code === code);
      if (next) {
        setSelected(next);
        saveSelectedCountry(code);
      }
    },
    [countries],
  );

  const selectExit = useCallback(
    (code: string) => {
      const next = countries.find((c) => c.code === code);
      if (next) {
        setExit(next);
      }
    },
    [countries],
  );

  const setMultihop = useCallback((on: boolean) => setMultihopState(on), []);
  const setRouteStyle = useCallback((style: MultihopStyle) => setRouteStyleState(style), []);

  const setTransportMode = useCallback((mode: TransportMode) => {
    setTransportModeState(mode);
    localStorage.setItem('cvpn.transportMode', mode);
  }, []);

  const setKillSwitch = useCallback((on: boolean) => {
    setKillSwitchState(on);
    localStorage.setItem('cvpn.killSwitch', on ? '1' : '0');
  }, []);

  const setAutoConnect = useCallback((on: boolean) => {
    setAutoConnectState(on);
    localStorage.setItem('cvpn.autoConnect', on ? '1' : '0');
  }, []);

  const toggleFavorite = useCallback((code: string) => {
    setFavorites((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
      localStorage.setItem('cvpn.favorites', next.join(','));
      return next;
    });
  }, []);

  /** Poll chain entitlement from the metering gateway; never drops the tunnel. */
  const refreshEntitlement = useCallback(
    async (gatewayIp: string, signPubKey: string) => {
      try {
        const ent = await fetchEntitlement(gatewayIp, keypair.publicKey, signPubKey, keyed);
        setEntitlement({
          tier: ent.tier,
          paidUntil: ent.paid_until,
          bytesUsed: ent.bytes_used,
        });
        tierRef.current = ent.tier;
      } catch {
        // Preserve the last known entitlement: the tier now drives transport
        // selection, so treating one flaky poll as a downgrade would silently
        // demote a paying user's stealth transport mid-session.
        setEntitlement((prev) => prev);
      }
    },
    [keypair, keyed],
  );

  // Populate the tier badge before the first connect — entitlement is otherwise
  // only fetched once a tunnel is up, so a fresh launch would always read
  // "free". This is a DISPLAY hint and a cheap hot cache; it is deliberately not
  // what decides a premium-gated transport, because it can't be relied on (it is
  // fire-and-forget, so an auto-connect can race it). That decision is made in
  // `establish`, against the gateway that actually enforces the gate.
  //
  // Once per launch, when the app is ready, at the selected country's gateway:
  // the one a connect would dial. Every request carries the client key, and
  // each gateway it reaches is excluded as a multi-hop exit (`keyed`).
  const tierCheckedRef = useRef(false);
  useEffect(() => {
    if (tierCheckedRef.current || phase === 'loading' || !selected?.signPubKey) {
      return;
    }
    tierCheckedRef.current = true;
    void refreshEntitlement(selected.gatewayIp, selected.signPubKey);
  }, [phase, selected, refreshEntitlement]);

  const connect = useCallback(() => {
    const entry = selected;
    logLine(
      `ui: connect ${multihop ? routeStyle : 'single-hop'} ${entry?.code ?? 'none'}` +
        `${multihop && exit ? ` -> ${exit.code}` : ''}, kill switch ${killSwitch ? 'on' : 'off'}, ` +
        `phase ${phase}`,
    );
    if (!entry || phase === 'connecting') {
      return;
    }
    // Only cross-jurisdiction needs an explicit exit pick; Balanced (same-country)
    // auto-selects a second gateway in the entry country and ignores any pick.
    if (multihop && routeStyle === 'multihop-cross-jurisdiction' && !exit) {
      setError('Pick an exit location for cross-jurisdiction multi-hop.');
      return;
    }
    sessionRef.current += 1;
    setError(null);
    setPhase('connecting');
    // Abort any sweep still running (double-click, or a reconnect racing a
    // manual connect) so two sweeps can't interleave against one TunnelManager.
    sweepRef.current?.abort();
    const sweep = new AbortController();
    sweepRef.current = sweep;
    setTunnel((t) => ({ ...t, state: 'connecting', country: entry.code }));
    void (async () => {
      try {
        if (multihop) {
          // Same key K enrolls at both hops (one payment); exit meters egress.
          // Same-country ignores the exit pick (auto-chosen in the entry country),
          // so pass a non-null placeholder; cross-jurisdiction required a pick.
          const exitArg = exit ?? entry;
          const result = await establishMultihop(
            fleetRef.current,
            entry,
            exitArg,
            routeStyle,
            keypair,
            keyed,
            killSwitch,
            transportMode,
            tierRef.current,
          );
          setTunnel(result.tunnel);
          setSplitActive(result.splitApplied);
          setPhase('connected');
          // Entitlement follows the client key, which only the entry hop knows:
          // the exit is never asked about it.
          await refreshEntitlement(result.entryGatewayIp, result.entrySignPubKey);
        } else {
          const result = await establish(
            entry,
            keypair,
            keyed,
            killSwitch,
            transportMode,
            tierRef.current,
            undefined,
            undefined,
            sweep.signal,
          );
          setTunnel(result.tunnel);
          setSplitActive(result.splitApplied);
          setPhase('connected');
          await refreshEntitlement(result.gatewayIp, entry.signPubKey);
        }
      } catch (err) {
        setError(messageOf(err));
        setTunnel({ ...DOWN, state: 'error', error: messageOf(err) });
        setPhase('error');
      }
    })();
  }, [
    selected,
    exit,
    multihop,
    routeStyle,
    phase,
    keypair,
    killSwitch,
    transportMode,
    refreshEntitlement,
  ]);

  const disconnect = useCallback(() => {
    logLine('ui: disconnect');
    sessionRef.current += 1;
    // Cancel the sweep FIRST so it cannot misread this teardown as a failed
    // transport and immediately reconnect.
    sweepRef.current?.abort();
    sweepRef.current = null;
    wasConnectedRef.current = false;
    void (async () => {
      try {
        const s = await teardown();
        setTunnel(s);
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setSplitActive(false);
        setPhase('idle');
      }
    })();
  }, []);

  // Session timer + drop detection: stamp the connect time, remember we reached
  // 'connected', and clear on idle.
  useEffect(() => {
    if (phase === 'connected') {
      wasConnectedRef.current = true;
      reconnectAttemptsRef.current = 0;
      setConnectedSince((prev) => prev ?? Date.now());
    } else if (phase === 'idle') {
      setConnectedSince(null);
    }
  }, [phase]);

  // Auto-reconnect an unexpected drop: if the tunnel errors out after having been
  // connected (not a user disconnect, not an initial connect failure), bring it
  // back up.
  //
  // Retried with backoff rather than once. The single attempt this replaced was
  // written for a tunnel that drops while the network is fine, where one retry
  // is enough. The cases the native watchdog now surfaces are the opposite: a
  // roam or a wake-from-sleep fires while the new interface is still coming up,
  // so the first attempt is the one most likely to fail — and giving up there
  // left the user in Error with the kill switch engaged and nothing retrying.
  //
  // The tunnel is NOT torn down between attempts, so leak protection stays on
  // for the whole sequence; failing closed while we retry is the point.
  useEffect(() => {
    if (phase !== 'error' || !wasConnectedRef.current) {
      return undefined;
    }
    const attempt = reconnectAttemptsRef.current;
    if (attempt >= RECONNECT_DELAYS_MS.length) {
      // Out of attempts (~3 minutes). Stop, and leave the error on screen for
      // the user to act on rather than churning against a gateway that is gone.
      wasConnectedRef.current = false;
      return undefined;
    }
    reconnectAttemptsRef.current = attempt + 1;
    setConnectedSince(null);
    logLine(`auto-reconnect attempt ${attempt + 1} in ${RECONNECT_DELAYS_MS[attempt]} ms`);
    const id = setTimeout(() => connect(), RECONNECT_DELAYS_MS[attempt]);
    return () => clearTimeout(id);
  }, [phase, connect]);

  // Watch the helper's setup state.
  //
  // Re-checked on an interval only while it is NOT ready: the user is over in
  // System Settings flipping the approval switch (macOS), or installing,
  // starting or joining the group for the service (Linux / Windows), and the
  // app should notice when they are done rather than making them relaunch.
  // Once ready, the polling stops — nothing revokes it behind our back except
  // the user, who is then looking at the setup anyway.
  useEffect(() => {
    let alive = true;
    const check = (): void => {
      void helperRegistration().then((s) => {
        if (alive) {
          setHelperState(s);
        }
      });
    };
    check();
    if (helperReady(helperState)) {
      return () => {
        alive = false;
      };
    }
    const id = setInterval(check, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [helperState]);

  // Auto-connect on launch (opt-in): once discovery settles and a location is
  // selected, bring the tunnel up automatically.
  useEffect(() => {
    if (autoConnect && !autoConnectedRef.current && phase === 'idle' && selected) {
      autoConnectedRef.current = true;
      logLine('auto-connect on launch');
      connect();
    }
  }, [autoConnect, phase, selected, connect]);

  // Poll native tunnel status for the counters the UI renders.
  //
  // This used to be the only thing calling `status()`, which made roam repair
  // and the dead-tunnel watchdog depend on a live foreground webview. Both now
  // run on a native thread (`spawn_repair_loop` in the tunnel crate): inside the
  // helper daemon, or inside the app process in the macOS / Linux root mode (see
  // `src-tauri/src/backend.rs`). So this poll is purely cosmetic — it may be
  // throttled or stop entirely with the window hidden without affecting
  // whether the tunnel recovers.
  useEffect(() => {
    if (phase !== 'connected') {
      return;
    }
    const session = sessionRef.current;
    const id = setInterval(() => {
      void (async () => {
        try {
          const s = await nativeStatus();
          // A disconnect or reconnect since: this reading belongs to a session
          // that is being torn down, and a 'down' here is that teardown.
          if (sessionRef.current !== session) {
            return;
          }
          setTunnel(s);
          // A drop shows up as an error or a 'down' state while we think we're
          // connected — surface it as an error so auto-reconnect can kick in.
          if (s.state === 'error' || s.state === 'down') {
            logLine(`tunnel ${s.state} while connected: ${s.error ?? 'no error reported'}`);
            setError(s.error ?? 'connection lost');
            setPhase('error');
          }
        } catch {
          /* transient; keep last known status */
        }
      })();
    }, 1500);
    return () => clearInterval(id);
  }, [phase]);

  return {
    phase,
    helperState,
    countries,
    selected,
    tunnel,
    dnsWarning: dnsWarningOf(phase, tunnel),
    entitlement,
    splitActive,
    error,
    select,
    connect,
    disconnect,
    multihop,
    routeStyle,
    exit,
    setMultihop,
    setRouteStyle,
    selectExit,
    killSwitch,
    setKillSwitch,
    transportMode,
    setTransportMode,
    autoConnect,
    setAutoConnect,
    connectedSince,
    refresh,
    favorites,
    toggleFavorite,
  };
}
