/**
 * In-app updates (tauri-plugin-updater). Checks the signed release feed
 * (`latest.json` on the newest published GitHub release — drafts are never
 * offered) shortly after launch, then every 6 h, and whenever the user presses
 * Settings → Check for updates.
 *
 * Nothing restarts on its own, because restarting the app ends the VPN
 * session. With "Download updates automatically" on (the default) a new
 * version is downloaded in the background and the banner offers a restart to
 * install it; with it off, the banner offers to download and install.
 * Download and install are separate steps on purpose: on Windows `install()`
 * hands over to the installer, which closes the app — that must only happen
 * when the user asked for the restart.
 *
 * The updater plugin is only registered where the app can replace itself
 * (macOS, Windows, a Linux AppImage — src-tauri/src/lib.rs `self_updating`);
 * deb / rpm installs update through the package manager instead.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
import { useCallback, useEffect, useRef, useState } from 'react';

const FIRST_CHECK_MS = 15_000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const AUTO_KEY = 'cvpn.autoUpdate';

/** What the main window's banner shows. */
export type UpdatePhase = 'none' | 'available' | 'ready' | 'installing' | 'failed';

/** The result of the last check, for Settings. */
export type CheckState = 'idle' | 'checking' | 'current' | 'found' | 'error';

export interface Updater {
  readonly phase: UpdatePhase;
  /** The version on offer, when one is. */
  readonly version: string | null;
  /** False on deb / rpm installs (package-manager updates); null until known. */
  readonly supported: boolean | null;
  readonly checkState: CheckState;
  readonly autoDownload: boolean;
  readonly setAutoDownload: (on: boolean) => void;
  /** Check now (Settings button). */
  readonly checkNow: () => void;
  /** Install (downloading first if needed) and relaunch. */
  readonly install: () => void;
  readonly dismiss: () => void;
}

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}

export function useUpdater(): Updater {
  const [phase, setPhase] = useState<UpdatePhase>('none');
  const [version, setVersion] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [checkState, setCheckState] = useState<CheckState>('idle');
  const [autoDownload, setAutoState] = useState(readAuto);
  const updateRef = useRef<Update | null>(null);
  const downloadedRef = useRef(false);
  const busyRef = useRef(false);
  const dismissedRef = useRef<string | null>(null);
  const autoRef = useRef(autoDownload);
  autoRef.current = autoDownload;

  const run = useCallback((manual: boolean) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    if (manual) {
      setCheckState('checking');
      dismissedRef.current = null;
    }
    void check()
      .then(async (u) => {
        if (!u) {
          setCheckState('current');
          return;
        }
        setCheckState('found');
        if (!manual && dismissedRef.current === u.version) {
          return;
        }
        // Already have this one downloaded: nothing more to fetch.
        if (updateRef.current?.version === u.version && downloadedRef.current) {
          setPhase((p) => (p === 'installing' ? p : 'ready'));
          return;
        }
        updateRef.current = u;
        downloadedRef.current = false;
        setVersion(u.version);
        if (autoRef.current) {
          try {
            await u.download();
            downloadedRef.current = true;
            setPhase((p) => (p === 'installing' ? p : 'ready'));
          } catch {
            // A failed background download is retried at the next check; the
            // user can still install from the banner, which downloads again.
            setPhase((p) => (p === 'installing' ? p : 'available'));
          }
        } else {
          setPhase((p) => (p === 'installing' ? p : 'available'));
        }
      })
      .catch(() => setCheckState('error'))
      .finally(() => {
        busyRef.current = false;
      });
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setSupported(false);
      return;
    }
    let alive = true;
    void invoke<boolean>('updates_supported')
      .then((ok) => {
        if (alive) {
          setSupported(ok);
        }
      })
      .catch(() => alive && setSupported(false));
    const first = setTimeout(() => run(false), FIRST_CHECK_MS);
    const id = setInterval(() => run(false), EVERY_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [run]);

  const setAutoDownload = useCallback((on: boolean) => {
    setAutoState(on);
    try {
      localStorage.setItem(AUTO_KEY, on ? '1' : '0');
    } catch {
      // Storage unavailable: the choice lasts for this run only.
    }
  }, []);

  const checkNow = useCallback(() => run(true), [run]);

  const install = useCallback(() => {
    const u = updateRef.current;
    if (!u) {
      return;
    }
    setPhase('installing');
    void (async () => {
      if (!downloadedRef.current) {
        await u.download();
        downloadedRef.current = true;
      }
      await u.install();
      await relaunch();
    })().catch(() => setPhase('failed'));
  }, []);

  const dismiss = useCallback(() => {
    dismissedRef.current = updateRef.current?.version ?? null;
    setPhase('none');
  }, []);

  return {
    phase,
    version,
    supported,
    checkState,
    autoDownload,
    setAutoDownload,
    checkNow,
    install,
    dismiss,
  };
}
