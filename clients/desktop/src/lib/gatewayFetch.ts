/**
 * The fetch every gateway / Flux call goes through (discovery, enroll,
 * entitlement status).
 *
 * Gateways serve their control API (`http://<ip>:51821`) over plain http with
 * signed bodies and no CORS headers, so the webview's own fetch cannot read
 * their replies: WebView2 rejects every cross-origin read with
 * `TypeError: Failed to fetch`. In the desktop app the request is therefore
 * made natively by `tauri-plugin-http` (Rust/reqwest), which CORS does not
 * apply to — the desktop counterpart of the web client's same-origin `/gw/`
 * proxy (`clients/web/src/lib/gatewayFetch.ts`). Trust rests on signatures:
 * core verifies every gateway signature. The URLs the plugin may
 * reach are scoped in `src-tauri/capabilities/default.json`.
 *
 * Outside Tauri (the plain-browser demo) the global fetch is used.
 *
 * Each request's outcome and duration are logged through {@link logLine};
 * discovery logs only its failures ({@link FetchLogging}). Core discovery
 * swallows per-gateway failures, so this is the only record of why a gateway
 * was dropped.
 */
import { isTauri } from '@tauri-apps/api/core';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { logLine } from './tauri.js';

/** What a {@link gatewayFetch} logs, and who hears about each outcome. */
export interface FetchLogging {
  /**
   * Log only requests that failed (a non-2xx status, or no response). For
   * discovery, which asks every gateway at every launch: its successes are
   * summed up by the caller, its failures are the record of why a gateway is
   * missing.
   */
  readonly failuresOnly?: boolean;
  /** Called once per request with whether it succeeded. */
  readonly onOutcome?: (ok: boolean) => void;
}

/**
 * The fetch for gateway / Flux calls. `override` (tests) replaces the
 * transport; logging applies either way.
 */
export function gatewayFetch(override?: typeof fetch, logging: FetchLogging = {}): typeof fetch {
  const via = override ? 'override' : isTauri() ? 'native' : 'webview';
  const inner: typeof fetch =
    override ??
    (isTauri() ? (input, init) => nativeFetch(input, init) : (input, init) => fetch(input, init));
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const started = performance.now();
    const took = (): string => `${Math.round(performance.now() - started)} ms`;
    try {
      const res = await inner(input, init);
      logging.onOutcome?.(res.ok);
      if (!res.ok || !logging.failuresOnly) {
        logLine(`fetch[${via}] ${url} -> ${res.status} in ${took()}`);
      }
      return res;
    } catch (err) {
      logging.onOutcome?.(false);
      const e = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      logLine(`fetch[${via}] ${url} -> ${e} in ${took()}`);
      throw err;
    }
  };
}
