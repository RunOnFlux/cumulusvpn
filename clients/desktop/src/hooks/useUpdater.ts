/**
 * In-app updates (tauri-plugin-updater). Checks the signed release feed
 * (`latest.json` on the newest published GitHub release — drafts are never
 * offered) shortly after launch and then every 6 h. Nothing installs on its
 * own: the main window shows a banner, and the user restarts when it suits
 * them, because restarting the app ends the VPN session.
 *
 * The updater plugin is only registered where the app can replace itself
 * (macOS, Windows, a Linux AppImage — src-tauri/src/lib.rs `self_updating`);
 * elsewhere `check()` throws and this stays quiet.
 */
import { isTauri } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
import { useCallback, useEffect, useRef, useState } from 'react';

const FIRST_CHECK_MS = 15_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdatePhase = 'none' | 'available' | 'installing' | 'failed';

export interface Updater {
  readonly phase: UpdatePhase;
  /** The version on offer, when one is. */
  readonly version: string | null;
  /** Download, install and relaunch. */
  readonly install: () => void;
  readonly dismiss: () => void;
}

export function useUpdater(): Updater {
  const [phase, setPhase] = useState<UpdatePhase>('none');
  const [version, setVersion] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const dismissedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let alive = true;
    const run = (): void => {
      void check()
        .then((u) => {
          if (!alive || !u || dismissedRef.current === u.version) {
            return;
          }
          updateRef.current = u;
          setVersion(u.version);
          setPhase((p) => (p === 'installing' ? p : 'available'));
        })
        .catch(() => undefined);
    };
    const first = setTimeout(run, FIRST_CHECK_MS);
    const id = setInterval(run, EVERY_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const install = useCallback(() => {
    const u = updateRef.current;
    if (!u) {
      return;
    }
    setPhase('installing');
    void u
      .downloadAndInstall()
      .then(() => relaunch())
      .catch(() => setPhase('failed'));
  }, []);

  const dismiss = useCallback(() => {
    dismissedRef.current = updateRef.current?.version ?? null;
    setPhase('none');
  }, []);

  return { phase, version, install, dismiss };
}
