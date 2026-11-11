/**
 * Keeps the menu-bar / tray menu in step with the connection, and carries its
 * clicks back into the same connect/disconnect paths the window uses.
 *
 * Every action goes through `useConnection` — never a direct native call — so a
 * tray Disconnect is a user disconnect (no auto-reconnect), and a tray
 * "Connect to …" runs the normal transport sweep.
 */
import { isTauri, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionModel } from './useConnection.js';
import { trayStateOf } from '../lib/tray.js';
import type { Speed, TrayAction } from '../lib/tray.js';

export function useTray(conn: ConnectionModel): void {
  // Throughput from successive tunnel samples (the status poll runs ~1.5 s).
  const [speed, setSpeed] = useState<Speed | null>(null);
  const sampleRef = useRef<{ rx: number; tx: number; t: number } | null>(null);
  useEffect(() => {
    if (conn.phase !== 'connected') {
      sampleRef.current = null;
      setSpeed(null);
      return;
    }
    const now = Date.now();
    const prev = sampleRef.current;
    const { rxBytes: rx, txBytes: tx } = conn.tunnel;
    if (prev && now > prev.t && rx >= prev.rx && tx >= prev.tx) {
      const dt = (now - prev.t) / 1000;
      setSpeed({ down: (rx - prev.rx) / dt, up: (tx - prev.tx) / dt });
    }
    sampleRef.current = { rx, tx, t: now };
  }, [conn.phase, conn.tunnel]);

  const state = useMemo(
    () =>
      trayStateOf({
        phase: conn.phase,
        selected: conn.selected,
        exit: conn.exit,
        multihop: conn.multihop,
        countries: conn.countries,
        favorites: conn.favorites,
        killSwitch: conn.killSwitch,
        speed,
        connectedSince: conn.connectedSince,
        now: Date.now(),
      }),
    // `tunnel` re-renders us every poll, which is also what refreshes the
    // session time without a timer of its own.
    [
      conn.phase,
      conn.selected,
      conn.exit,
      conn.multihop,
      conn.countries,
      conn.favorites,
      conn.killSwitch,
      conn.connectedSince,
      conn.tunnel,
      speed,
    ],
  );

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    void invoke('set_tray', { state }).catch(() => undefined);
  }, [state]);

  // Latest model for the event handler, which is registered once.
  const connRef = useRef(conn);
  connRef.current = conn;
  // "Connect to X" while connected elsewhere: disconnect, wait for idle with X
  // selected, then connect.
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      return undefined;
    }
    const unlisten = listen<TrayAction>('tray-action', ({ payload }) => {
      const c = connRef.current;
      switch (payload.kind) {
        case 'connect':
          c.connect();
          break;
        case 'disconnect':
          pendingRef.current = null;
          c.disconnect();
          break;
        case 'toggleKillSwitch':
          c.setKillSwitch(!c.killSwitch);
          break;
        case 'connectTo':
          if (c.selected?.code === payload.code && c.phase === 'connected') {
            break;
          }
          pendingRef.current = payload.code;
          c.select(payload.code);
          if (c.phase === 'connected' || c.phase === 'connecting') {
            c.disconnect();
          }
          break;
      }
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  useEffect(() => {
    const code = pendingRef.current;
    if (!code || conn.selected?.code !== code) {
      return;
    }
    if (conn.phase === 'idle' || conn.phase === 'error') {
      pendingRef.current = null;
      conn.connect();
    }
  }, [conn]);
}
