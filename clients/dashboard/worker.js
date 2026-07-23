/**
 * Cloudflare Worker for dashboard.cumulusvpn.com — the public fleet monitor.
 *
 * Serves the static page (ASSETS binding) and exposes `/api/fleet`, which
 * aggregates every gateway's /v1/info SERVER-SIDE (no mixed-content block) and
 * returns one cached JSON snapshot the page renders. The gateways are plain
 * http; the Worker can reach them, the browser can't.
 *
 * IMPORTANT — why raw TCP, not fetch(): the gateway control API listens on port
 * 51821, and a Worker's fetch() can ONLY reach Cloudflare's supported ports
 * (HTTP 80/8080/8880/2052/2082/2086/2095, HTTPS 443/...). A fetch to :51821
 * fails for EVERY gateway, so the page painted the whole fleet "down" while the
 * fleet was perfectly healthy. The `cloudflare:sockets` connect() API is NOT
 * subject to that allowlist, so we speak minimal HTTP/1.1 over a raw socket.
 *
 * The snapshot is edge-cached ~30s so a busy dashboard doesn't hammer the fleet.
 */

import { connect } from 'cloudflare:sockets';

// Planned fleet (keep in sync with deploy/countries.yaml). Undeployed specs just
// return zero instances — which is itself useful (shows roadmap vs live).
const COUNTRY_CODES = [
  'us',
  'ca',
  'de',
  'nl',
  'fr',
  'gb',
  'cz',
  'pl',
  'sg',
  'jp',
  'au',
  'br',
  'es',
  'it',
  'se',
  'ch',
  'at',
  'fi',
  'mx',
  'kr',
  'in',
  'za',
];
const FLUX_API = 'https://api.runonflux.io';
const CONTROL_PORT = 51821;
const PROBE_TIMEOUT_MS = 6000;

/** Public IPv4 literal only — hardens the probe against a poisoned Flux-API
 *  response steering us at private/reserved hosts. Rejects zero-padded (octal)
 *  octets. */
function isPublicIPv4(host) {
  const parts = String(host).split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || (p.length > 1 && p[0] === '0')) return false;
  }
  const o = parts.map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

/** Live instance IPs for a spec, from the Flux app-location index. */
async function locations(spec) {
  try {
    const r = await fetch(`${FLUX_API}/apps/location/${spec}`, { cf: { cacheTtl: 20 } });
    if (!r.ok) return [];
    const j = await r.json();
    const list = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : [];
    return [...new Set(list.map((x) => String(x.ip || '').split(':')[0]).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Index of the CRLF-CRLF that ends the HTTP header block, or -1. */
function headerEnd(buf) {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

/**
 * Minimal HTTP/1.1 GET over a raw TCP socket (plain http, no TLS). Returns the
 * response body as text for a 200, else throws. Used instead of fetch() because
 * fetch can't reach the gateway's non-standard control port (see file header).
 * The gateway replies with Content-Length + `Connection: close`, so we read to
 * EOF and slice the body — no chunked path needed for our own server.
 */
async function httpGet(host, port, path, timeoutMs) {
  const socket = connect(
    { hostname: host, port },
    { secureTransport: 'off', allowHalfOpen: false },
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      socket.close();
    } catch {
      /* already closing */
    }
  }, timeoutMs);
  try {
    const writer = socket.writable.getWriter();
    await writer.write(
      new TextEncoder().encode(
        `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nAccept: application/json\r\nConnection: close\r\n\r\n`,
      ),
    );
    writer.releaseLock();

    const reader = socket.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
        if (total > 65536) break; // /v1/info is ~350 bytes; cap a misbehaving peer
      }
    }

    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.length;
    }
    const sep = headerEnd(buf);
    if (sep < 0) throw new Error('no header terminator');
    const head = new TextDecoder().decode(buf.subarray(0, sep));
    if (!/^HTTP\/1\.\d\s+200\b/.test(head)) throw new Error('non-200 status');
    let body = buf.subarray(sep + 4);
    const cl = /^content-length:\s*(\d+)/im.exec(head);
    if (cl) body = body.subarray(0, Number(cl[1]));
    return new TextDecoder().decode(body);
  } catch (e) {
    throw timedOut ? new Error('probe timeout') : e;
  } finally {
    clearTimeout(timer);
    try {
      await socket.close();
    } catch {
      /* already closed */
    }
  }
}

/** Probe one gateway's /v1/info; never throws. */
async function probe(ip, cc, spec) {
  const inst = { ip, cc, spec, up: false };
  if (!isPublicIPv4(ip)) return inst; // don't let a poisoned index point us inward
  try {
    const text = await httpGet(ip, CONTROL_PORT, '/v1/info', PROBE_TIMEOUT_MS);
    const j = JSON.parse(text);
    const d = j && j.data ? j.data : j;
    inst.up = true;
    inst.version = d.version ?? null;
    inst.buildCommit = d.build_commit ?? null;
    inst.load = typeof d.load === 'number' ? d.load : null;
    inst.capacity = typeof d.capacity === 'number' ? d.capacity : null;
    inst.region = d.region || '';
    inst.city = d.city || '';
  } catch {
    // unreachable → stays up:false
  }
  return inst;
}

async function fleet() {
  const perSpec = await Promise.all(
    COUNTRY_CODES.map(async (cc) => {
      const spec = `cumulusvpn${cc}`;
      const ips = await locations(spec);
      return Promise.all(ips.map((ip) => probe(ip, cc.toUpperCase(), spec)));
    }),
  );
  const instances = perSpec.flat();

  // "latest" build = the most common build_commit among reachable instances, so
  // the page can flag stragglers on an older image (or with the field absent).
  const counts = {};
  for (const i of instances) {
    if (i.up && i.buildCommit) counts[i.buildCommit] = (counts[i.buildCommit] || 0) + 1;
  }
  let latestCommit = null;
  let best = 0;
  for (const [commit, n] of Object.entries(counts)) {
    if (n > best) {
      best = n;
      latestCommit = commit;
    }
  }

  return {
    generatedAt: Date.now(),
    latestCommit,
    planned: COUNTRY_CODES.map((c) => c.toUpperCase()),
    instances,
  };
}

// ---- Feature flags (KV-backed, edited via /admin) ---------------------------
// The mobile app fetches GET /api/flags at launch (same JSON shape as the repo's
// flags.json). Writes go through POST /api/flags, gated by the ADMIN_TOKEN secret.
const FLAGS_KEY = 'flags';
// Fail-safe fallback when KV is empty/unreadable: everything OFF (store-safe).
const DEFAULT_FLAGS = { inAppUpgrade: { android: false, ios: false } };

function jsonResponse(obj, extraHeaders = {}, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

/** Bearer token from the Authorization header, or null. */
function bearerToken(request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return m ? m[1].trim() : null;
}

/** Constant-time compare of provided vs secret via fixed-length SHA-256 digests. */
async function tokenMatches(provided, secret) {
  if (!provided || !secret) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(secret)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Coerce arbitrary input to the strict flags shape, or null if invalid. */
function validateFlags(body) {
  if (!body || typeof body !== 'object') return null;
  const u = body.inAppUpgrade;
  if (!u || typeof u !== 'object') return null;
  if (typeof u.android !== 'boolean' || typeof u.ios !== 'boolean') return null;
  return { inAppUpgrade: { android: u.android, ios: u.ios } };
}

/** Current flags from KV (validated), or the fail-safe default. */
async function readFlags(env) {
  try {
    const raw = await env.FLAGS_KV.get(FLAGS_KEY);
    if (!raw) return { ...DEFAULT_FLAGS, updatedAt: null };
    const parsed = JSON.parse(raw);
    const valid = validateFlags(parsed);
    if (!valid) return { ...DEFAULT_FLAGS, updatedAt: null };
    return { ...valid, updatedAt: parsed.updatedAt ?? null };
  } catch {
    return { ...DEFAULT_FLAGS, updatedAt: null };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---- feature flags: public read, token-gated write ----
    if (url.pathname === '/api/flags' && request.method === 'GET') {
      const flags = await readFlags(env);
      return jsonResponse(flags, {
        'cache-control': 'public, max-age=60',
        'access-control-allow-origin': '*',
      });
    }

    if (url.pathname === '/api/admin/verify' && request.method === 'POST') {
      const ok = await tokenMatches(bearerToken(request), env.ADMIN_TOKEN);
      return jsonResponse({ ok }, {}, ok ? 200 : 401);
    }

    if (url.pathname === '/api/flags' && request.method === 'POST') {
      if (!(await tokenMatches(bearerToken(request), env.ADMIN_TOKEN))) {
        return jsonResponse({ error: 'unauthorized' }, {}, 401);
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'invalid JSON' }, {}, 400);
      }
      const valid = validateFlags(body);
      if (!valid) {
        return jsonResponse(
          { error: 'expected { inAppUpgrade: { android: boolean, ios: boolean } }' },
          {},
          400,
        );
      }
      const record = { ...valid, updatedAt: new Date().toISOString() };
      await env.FLAGS_KV.put(FLAGS_KEY, JSON.stringify(record));
      return jsonResponse(record, { 'access-control-allow-origin': '*' });
    }

    if (url.pathname === '/api/fleet') {
      const cache = caches.default;
      const key = new Request(new URL('/api/fleet', url.origin).toString(), { method: 'GET' });
      let resp = await cache.match(key);
      if (!resp) {
        const data = await fleet();
        resp = new Response(JSON.stringify(data), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'public, max-age=30',
            'access-control-allow-origin': '*',
          },
        });
        ctx.waitUntil(cache.put(key, resp.clone()));
      }
      return resp;
    }

    return env.ASSETS.fetch(request);
  },
};
