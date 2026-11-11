/**
 * Route the fleet's HTTP through Rust (`@tauri-apps/plugin-http`), not the web
 * view.
 *
 * The web view cannot talk to the fleet itself, on any platform:
 *  - **CORS.** The page's origin is the app (`tauri://localhost`,
 *    `http://tauri.localhost`), and gateways and Flux nodes send no
 *    `Access-Control-Allow-Origin`, so every cross-origin response is withheld
 *    from JavaScript — WebKit cancels the load (NSURLErrorDomain -999).
 *  - **ATS (macOS).** Cleartext HTTP from the web view is refused outright
 *    (-1022) without an Info.plist exemption.
 * desktop-v1.4.2 hit both and listed no servers at all. Gateways are raw IPs
 * on residential nodes, so neither TLS nor CORS can be fixed at the source
 * quickly; requests made from Rust are subject to neither.
 *
 * Integrity does not depend on the transport: gateway answers are Ed25519
 * signed and verified (`fetchSigned`), and WireGuard authenticates the tunnel.
 *
 * Installed once at startup as `globalThis.fetch`, because the shared core
 * (`@cumulusvpn/core`) defaults to the global fetch at many call sites. Only
 * external http(s) URLs are routed; Tauri's own IPC and local URLs (the dev
 * server) stay on the web view. What Rust may reach is limited by the `http:`
 * scope in `src-tauri/capabilities/default.json`.
 */
import { isTauri } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/** True for URLs that must go through Rust. */
export function routesNatively(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return false;
  }
  const host = u.hostname;
  return !(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost'));
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/** Wrap `webFetch` so fleet URLs go to `native` instead. */
export function routedFetch(webFetch: typeof fetch, native: typeof fetch): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) =>
    routesNatively(urlOf(input)) ? native(input, init) : webFetch(input, init);
}

/** Install the routed fetch globally — a no-op outside the desktop app. */
export function installNativeFetch(): void {
  if (!isTauri()) {
    return;
  }
  globalThis.fetch = routedFetch(globalThis.fetch.bind(globalThis), tauriFetch);
}
