/**
 * The single stateful hook the tray window is built around: it owns the device
 * keypair, the discovered country list, the connect/disconnect lifecycle, and
 * live polling of native tunnel status + chain entitlement.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Keypair, Tier } from '@cumulusvpn/core';
import { loadOrCreateKeypair, loadSelectedCountry, saveSelectedCountry } from '../lib/storage.js';
import {
  discoverCountries,
  establish,
  establishMultihop,
  fetchEntitlement,
  teardown,
} from '../lib/session.js';
import type { CountryOption } from '../lib/session.js';
import { status as nativeStatus } from '../lib/tauri.js';
import type { TunnelStatus } from '../lib/tauri.js';

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
  readonly countries: readonly CountryOption[];
  /** Single-hop location, or the ENTRY hop when multi-hop is on. */
  readonly selected: CountryOption | null;
  readonly tunnel: TunnelStatus;
  readonly entitlement: Entitlement | null;
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

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function useConnection(): ConnectionModel {
  const keypairRef = useRef<Keypair | null>(null);
  if (keypairRef.current === null) {
    keypairRef.current = loadOrCreateKeypair();
  }
  const keypair = keypairRef.current;

  const [phase, setPhase] = useState<Phase>('loading');
  const [countries, setCountries] = useState<readonly CountryOption[]>([]);
  const [selected, setSelected] = useState<CountryOption | null>(null);
  const [tunnel, setTunnel] = useState<TunnelStatus>(DOWN);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Multi-hop is OFF by default; Balanced (same country) is the default style.
  const [multihop, setMultihopState] = useState(false);
  const [routeStyle, setRouteStyleState] = useState<MultihopStyle>('multihop-same-country');
  const [exit, setExit] = useState<CountryOption | null>(null);

  // Bootstrap: discover the fleet and restore the last-selected country.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await discoverCountries();
        if (!alive) {
          return;
        }
        setCountries(list);
        const remembered = loadSelectedCountry();
        const pick = list.find((c) => c.code === remembered) ?? list[0] ?? null;
        setSelected(pick);
        // Default the exit to the first country different from the entry, so
        // multi-hop has a sane cross-jurisdiction pair the moment it's toggled.
        setExit(list.find((c) => c.code !== pick?.code) ?? null);
        setPhase('idle');
      } catch (err) {
        if (!alive) {
          return;
        }
        setError(messageOf(err));
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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

  /** Poll chain entitlement from the metering gateway; never drops the tunnel. */
  const refreshEntitlement = useCallback(
    async (gatewayIp: string, signPubKey: string) => {
      try {
        const ent = await fetchEntitlement(gatewayIp, keypair.publicKey, signPubKey);
        setEntitlement({
          tier: ent.tier,
          paidUntil: ent.paid_until,
          bytesUsed: ent.bytes_used,
        });
      } catch {
        setEntitlement(null);
      }
    },
    [keypair],
  );

  const connect = useCallback(() => {
    const entry = selected;
    if (!entry || phase === 'connecting') {
      return;
    }
    if (multihop && !exit) {
      setError('Pick an exit location for multi-hop.');
      return;
    }
    setError(null);
    setPhase('connecting');
    setTunnel((t) => ({ ...t, state: 'connecting', country: entry.code }));
    void (async () => {
      try {
        if (multihop && exit) {
          // Same key K enrolls at both hops (one payment); exit meters egress.
          const result = await establishMultihop(entry, exit, routeStyle, keypair);
          setTunnel(result.tunnel);
          setPhase('connected');
          await refreshEntitlement(result.exitGatewayIp, exit.signPubKey);
        } else {
          const result = await establish(entry, keypair);
          setTunnel(result.tunnel);
          setPhase('connected');
          await refreshEntitlement(result.gatewayIp, entry.signPubKey);
        }
      } catch (err) {
        setError(messageOf(err));
        setTunnel({ ...DOWN, state: 'error', error: messageOf(err) });
        setPhase('error');
      }
    })();
  }, [selected, exit, multihop, routeStyle, phase, keypair, refreshEntitlement]);

  const disconnect = useCallback(() => {
    void (async () => {
      try {
        const s = await teardown();
        setTunnel(s);
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setPhase('idle');
      }
    })();
  }, []);

  // Poll native tunnel status (byte counters, handshake) while connected.
  useEffect(() => {
    if (phase !== 'connected') {
      return;
    }
    const id = setInterval(() => {
      void (async () => {
        try {
          const s = await nativeStatus();
          setTunnel(s);
          if (s.state === 'error') {
            setError(s.error ?? 'tunnel error');
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
    countries,
    selected,
    tunnel,
    entitlement,
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
  };
}
