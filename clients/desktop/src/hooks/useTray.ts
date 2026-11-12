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
import { useEffect, useMemo, useRef } from 'react';
import type { ConnectionModel } from './useConnection.js';
import { trayStateOf } from '../lib/tray.js';
import type { TrayAction } from '../lib/tray.js';

export function useTray(conn: ConnectionModel): void {
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
        blocked: conn.blocked,
        speed: conn.phase === 'connected' ? conn.speed : null,
        pingMs: conn.pingMs,
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
      conn.blocked,
      conn.speed,
      conn.pingMs,
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
