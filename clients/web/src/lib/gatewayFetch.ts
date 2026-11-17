/**
 * Same-origin proxy fetch for gateway / Flux-node calls.
 *
 * `vpn.cumulusvpn.com` is served over https, but the gateways expose their
 * control API over plain http (`:51821`, signed bodies instead of TLS), and the
 * Flux node index is http (`:16127`). Browsers BLOCK http requests from an https
 * page (mixed content), so a browser can neither probe `/v1/info` (every country
 * shows as "seed") nor POST enroll.
 *
 * We route those calls through the site's own Cloudflare Worker instead:
 *   `http://<ip>:<port>/<path>`  →  `/gw/<ip>:<port>/<path>`  (same origin, https)
 * The Worker forwards them to the gateway server-side (see clients/web/worker.js).
 * https URLs (the Flux public API) pass through untouched.
 */
export const proxiedFetch: typeof fetch = (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  if (url.startsWith('http://')) {
    return fetch(`/gw/${url.slice('http://'.length)}`, init);
  }
  return fetch(input, init);
};

/**
 * How long each gateway took to answer its `/v1/info` probe, by IP (the fastest
 * of its answers). The probe runs through this site's Worker, which executes at
 * the Cloudflare edge nearest the visitor, so the time is dominated by that
 * edge's distance to the gateway: a fair stand-in for the visitor's own, and
 * enough to tell Singapore from Frankfurt. Used to pre-select the nearest
 * location (lib/gateways `nearestOption`).
 */
export const probeTimes = new Map<string, number>();

const INFO_PROBE = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3}):51821\/v1\/info(?:[?#]|$)/;

/** {@link proxiedFetch}, recording {@link probeTimes} for gateway info probes. */
export const timedProxiedFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const probe = INFO_PROBE.exec(url);
  const started = performance.now();
  const res = await proxiedFetch(input, init);
  const ip = probe?.[1];
  if (ip && res.ok) {
    const ms = performance.now() - started;
    const prev = probeTimes.get(ip);
    probeTimes.set(ip, prev === undefined ? ms : Math.min(prev, ms));
  }
  return res;
};
