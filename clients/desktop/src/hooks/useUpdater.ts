/**
 * In-app updates (tauri-plugin-updater). Checks the signed release feed
 * (`latest.json` on the newest published GitHub release — drafts are never
 * offered) shortly after launch, then every 6 h, and whenever the user presses
 * Settings → Check for updates.
 *
 * Nothing restarts on its own, because restarting the app ends the VPN
 * session. With "Download updates automatically" on (the default) the banner
 * appears as soon as a new version is found and shows the download's
 * progress, then offers a restart to install it; with it off, the banner
 * offers to download and install. Either way a system notification says so
 * once per version (when notifications are on), since the window is usually
 * closed to the menu bar.
 * Download and install are separate steps on purpose: on Windows `install()`
 * hands over to the installer, which closes the app — that must only happen
 * when the user asked for the restart.
 *
 * The updater plugin is only registered where the app can replace itself
 * (macOS, Windows, a Linux AppImage — src-tauri/src/lib.rs `self_updating`);
 * deb / rpm installs update through the package manager instead. There the
 * same feed is still checked (`latest_version`), and a newer version gets the
 * `external` banner: "update it with your system's software updater".
 */
import { getVersion } from '@tauri-apps/api/app';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { ensureNotificationPermission } from './useNotifications.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isNewerVersion } from '../lib/version.js';

const FIRST_CHECK_MS = 15_000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const AUTO_KEY = 'cvpn.autoUpdate';

/** What the main window's banner shows. */
export type UpdatePhase =
  | 'none'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'failed'
  /** A newer version exists, installed through apt / dnf, not by the app. */
  | 'external';

/** The result of the last check, for Settings. */
export type CheckState = 'idle' | 'checking' | 'current' | 'found' | 'error';

export interface Updater {
  readonly phase: UpdatePhase;
  /** The version on offer, when one is. */
  readonly version: string | null;
  /** Download progress 0–1 while downloading; null when the size is unknown. */
  readonly progress: number | null;
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

/**
 * Download with progress. `onProgress` gets 0–1, or null when the server sent
 * no size.
 */
async function downloadWithProgress(
  u: Update,
  onProgress: (p: number | null) => void,
): Promise<void> {
  let total: number | null = null;
  let got = 0;
  onProgress(0);
  await u.download((e: DownloadEvent) => {
    if (e.event === 'Started') {
      total = e.data.contentLength ?? null;
    } else if (e.event === 'Progress') {
      got += e.data.chunkLength;
      onProgress(total ? Math.min(1, got / total) : null);
    } else {
      onProgress(1);
    }
  });
}

export function useUpdater(notify = true): Updater {
  const [phase, setPhase] = useState<UpdatePhase>('none');
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const notifiedRef = useRef<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [checkState, setCheckState] = useState<CheckState>('idle');
  const [autoDownload, setAutoState] = useState(readAuto);
  const updateRef = useRef<Update | null>(null);
  const downloadedRef = useRef(false);
  const busyRef = useRef(false);
  const dismissedRef = useRef<string | null>(null);
  const autoRef = useRef(autoDownload);
  autoRef.current = autoDownload;
  const supportedRef = useRef<boolean | null>(null);
  supportedRef.current = supported;

  /** One system notification per version, if the user has them on. */
  const announce = useCallback((v: string, body: string) => {
    if (!notifyRef.current || notifiedRef.current === v) {
      return;
    }
    notifiedRef.current = v;
    void ensureNotificationPermission().then((ok) => {
      if (ok) {
        sendNotification({ title: `CumulusVPN ${v}`, body });
      }
    });
  }, []);

  /** Shown unless the user closed the banner for this version. */
  const show = useCallback((v: string, next: UpdatePhase) => {
    setPhase((p) => {
      if (p === 'installing') {
        return p;
      }
      return dismissedRef.current === v ? 'none' : next;
    });
  }, []);

  const run = useCallback(
    (manual: boolean) => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      if (manual) {
        setCheckState('checking');
        dismissedRef.current = null;
      }
      if (supportedRef.current === false) {
        // A .deb / .rpm install: the package manager updates it. Only say so.
        if (!isTauri()) {
          busyRef.current = false;
          return;
        }
        void Promise.all([invoke<string>('latest_version'), getVersion()])
          .then(([latest, current]) => {
            if (!isNewerVersion(latest, current)) {
              setCheckState('current');
              return;
            }
            setCheckState('found');
            setVersion(latest);
            show(latest, 'external');
            announce(
              latest,
              'A new version is available. Update it with your system’s software updater.',
            );
          })
          .catch(() => setCheckState('error'))
          .finally(() => {
            busyRef.current = false;
          });
        return;
      }
      void check()
        .then(async (u) => {
          if (!u) {
            setCheckState('current');
            return;
          }
          setCheckState('found');
          const v = u.version;
          // Already have this one downloaded: nothing more to fetch.
          if (updateRef.current?.version === v && downloadedRef.current) {
            show(v, 'ready');
            return;
          }
          updateRef.current = u;
          downloadedRef.current = false;
          setVersion(v);
          if (autoRef.current) {
            show(v, 'downloading');
            try {
              await downloadWithProgress(u, setProgress);
              downloadedRef.current = true;
              show(v, 'ready');
              announce(v, 'The update is downloaded. Restart CumulusVPN to install it.');
            } catch {
              // A failed background download is retried at the next check; the
              // user can still install from the banner, which downloads again.
              show(v, 'available');
            }
          } else {
            show(v, 'available');
            announce(v, 'A new version is available. Open CumulusVPN to update.');
          }
        })
        .catch(() => setCheckState('error'))
        .finally(() => {
          busyRef.current = false;
        });
    },
    [show, announce],
  );

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
    dismissedRef.current = null;
    void (async () => {
      if (!downloadedRef.current) {
        setPhase('downloading');
        await downloadWithProgress(u, setProgress);
        downloadedRef.current = true;
      }
      setPhase('installing');
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
    progress,
    supported,
    checkState,
    autoDownload,
    setAutoDownload,
    checkNow,
    install,
    dismiss,
  };
}
