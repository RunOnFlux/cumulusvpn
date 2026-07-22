/**
 * Cloudflare Worker for vpn.cumulusvpn.com.
 *
 * Serves the built static site (via the ASSETS binding) AND proxies the web
 * app's gateway calls so an https page can reach the plain-http gateway control
 * API without a mixed-content block:
 *
 *   GET/POST  /gw/<ip>:<port>/<path>   →   http://<ip>:<port>/<path>
 *
 * The gateway signs its response bodies, and this is same-origin, so the browser
 * can read the signature headers and verify as usual.
 *
 * SSRF guard: only the gateway control port + the Flux node port, and only
 * public IPv4 targets, so it can't be used as an open relay to arbitrary hosts
 * or internal addresses. (A tighter follow-up: allowlist IPs from the signed
 * directory.)
 */

const ALLOWED_PORTS = new Set(['51821', '16127']);

/** True only for a routable public IPv4 literal (blocks private / loopback /
 *  link-local / CGNAT / reserved). Rejects leading-zero octets, which
 *  `fetch`/WHATWG-URL would otherwise parse as OCTAL (e.g. "012" → 10), letting
 *  a padded form slip a private address past a decimal check. */
function isPublicIPv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    if (p.length > 1 && p[0] === '0') return false; // no octal / zero-padded octets
  }
  const o = parts.map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return false; // this-network / private / loopback
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT (100.64/10)
  if (a === 192 && b === 0 && o[2] === 0) return false; // 192.0.0/24 (IETF)
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking (198.18/15)
  if (a >= 224) return false; // multicast (224/4) + reserved (240/4) + 255.255.255.255
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/gw/')) {
      const rest = url.pathname.slice('/gw/'.length);
      const slash = rest.indexOf('/');
      const authority = slash === -1 ? rest : rest.slice(0, slash);
      const path = slash === -1 ? '/' : rest.slice(slash);
      const [host, port] = authority.split(':');

      if (!host || !port || !ALLOWED_PORTS.has(port) || !isPublicIPv4(host)) {
        return new Response('proxy target not allowed', { status: 403 });
      }

      const target = `http://${host}:${port}${path}${url.search}`;
      const init = { method: request.method, headers: {} };
      const ct = request.headers.get('content-type');
      if (ct) init.headers['content-type'] = ct;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = await request.text();
      }
      try {
        return await fetch(target, init);
      } catch {
        return new Response('gateway unreachable', { status: 502 });
      }
    }

    // Everything else: the static site (with SPA/hash-routing fallback).
    return env.ASSETS.fetch(request);
  },
};
