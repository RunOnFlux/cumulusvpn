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
