/**
 * Cloudflare Worker for dashboard.cumulusvpn.com — the public fleet monitor.
 * Auto-deployed via the Worker's Git (Workers Builds) connection on push.
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
// se/ch/kr were dropped (2026-08-09): Flux has no usable nodes in those
// countries, so the specs will never be registered.
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
  'at',
  'fi',
  'mx',
  'in',
  'za',
  'ru',
  'my',
  'hk',
  'ae',
];
// Countries with a separate 443 stealth group (`cumulusvpntls<cc>`) — keep in
// sync with `stealth: true` in deploy/countries.yaml. Probed like the standard
// fleet, plus a TCP reachability check of the 443 TLS relay itself.
const STEALTH_CODES = ['de'];
const FLUX_API = 'https://api.runonflux.io';
const CONTROL_PORT = 51821;
const RELAY_PORT = 443;
const PROBE_TIMEOUT_MS = 4000;
/**
 * How many gateway probes may be in flight at once.
 *
 * A Worker sustains only a handful of simultaneous outbound connections; past
 * that they queue, and a queued socket can burn its whole timeout before it
 * even connects. That is the failure this replaces — the sweep opened one
 * socket per gateway and then reported the losers as offline.
 *
 * Six, and measured rather than guessed. Sixteen was tried to cut the sweep
 * time and immediately brought the original bug back in milder form: 11 of the
 * 17 gateways it called offline answered a direct probe with 200. Only the six
 * genuinely dead ones should have been listed.
 *
 * So the ceiling is low, and lower than feels necessary. A slow sweep costs
 * nothing now that no request waits for one; a fast sweep that invents outages
 * costs the page its only purpose. Local testing cannot tune this — wrangler
 * serialises connect(), so 8, 16 and 32 all measure identically there. Anything
 * above six must be validated against production by direct-probing every
 * gateway the sweep calls dead.
 */
const PROBE_CONCURRENCY = 6;
/** Same, for the Flux API placement lookups that feed the probe list. */
const LOCATION_CONCURRENCY = 6;
/**
 * How stale the fleet data may get before a request triggers a background
 * refresh. Matches the page's own poll interval, so a viewer watching the page
 * sees numbers that move about as often as they expect.
 */
const REFRESH_AFTER_MS = 30_000;

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

/**
 * True when `host:port` accepts a TCP connection within the timeout. Health
 * check for the stealth group's 443 relay: its TLS cert is deliberately
 * self-signed under a camouflage SNI, so a full TLS probe would fail
 * verification — the relay listening at all is the signal we need.
 */
async function tcpOpen(host, port, timeoutMs) {
  let socket;
  try {
    socket = connect({ hostname: host, port }, { secureTransport: 'off', allowHalfOpen: false });
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (socket) await socket.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Map `fn` over `items` with at most `limit` calls in flight.
 *
 * The fleet sweep used to be `Promise.all` over every gateway, which opened
 * ~139 TCP sockets from one Worker invocation. A Worker sustains nowhere near
 * that many, so most probes hit their timeout and the page reported healthy
 * nodes as offline — 16, then 48, then 2 across consecutive sweeps, while every
 * one of those "offline" nodes answered a direct probe with 200. A monitoring
 * page that invents outages is worse than no page, because it is consulted
 * first and believed during exactly the incidents it fabricates.
 *
 * Order is preserved, and a rejecting `fn` would reject the whole call — but
 * `probe` is written never to throw, which is what keeps one bad gateway from
 * emptying the map.
 */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const runner = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return out;
}

/** Probe one gateway's /v1/info (and, for stealth, its 443 relay); never throws. */
async function probe(ip, cc, spec, tier) {
  const inst = { ip, cc, spec, tier, up: false };
  if (!isPublicIPv4(ip)) return inst; // don't let a poisoned index point us inward
  // Run the relay check alongside the info probe — a stealth node whose control
  // API died can still have a live (or dead) relay, and both facts matter.
  const relayCheck = tier === 'stealth' ? tcpOpen(ip, RELAY_PORT, PROBE_TIMEOUT_MS) : null;
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
  if (relayCheck) inst.relay443 = await relayCheck;
  return inst;
}

async function fleet() {
  const groups = [
    ...COUNTRY_CODES.map((cc) => ({ cc, spec: `cumulusvpn${cc}`, tier: 'standard' })),
    ...STEALTH_CODES.map((cc) => ({ cc, spec: `cumulusvpntls${cc}`, tier: 'stealth' })),
  ];
  // Resolve every spec's placements first, then probe the flattened list. Two
  // bounded passes rather than nested Promise.all: nesting made the real
  // in-flight count the PRODUCT of the two fan-outs, which is how one page load
  // came to open a socket per gateway all at once.
  const perSpec = await mapPool(groups, LOCATION_CONCURRENCY, async ({ cc, spec, tier }) => {
    const ips = await locations(spec);
    return ips.map((ip) => ({ ip, cc: cc.toUpperCase(), spec, tier }));
  });
  const targets = perSpec.flat();
  const instances = await mapPool(targets, PROBE_CONCURRENCY, (t) =>
    probe(t.ip, t.cc, t.spec, t.tier),
  );

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
// Every per-platform flag the apps understand (see repo flags.json). Each is
// {android, ios} and is the ONLY gate — the apps no longer exclude a platform
// at build level, so what is set here is what ships:
//   inAppUpgrade  — crypto/FLUX purchase UI (direct-APK / testing builds only)
//   iapPurchase   — store-billing subscription UI (must be ON before store review)
//   voucherRedeem — our own code-redeem box (Play build shares the APK binary)
const FLAG_NAMES = ['inAppUpgrade', 'iapPurchase', 'voucherRedeem'];
// Fail-safe fallback when KV is empty/unreadable: everything OFF (store-safe).
const DEFAULT_FLAGS = Object.fromEntries(
  FLAG_NAMES.map((name) => [name, { android: false, ios: false }]),
);

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

/**
 * Coerce arbitrary input to the strict flags shape, or null if invalid.
 * A flag absent from the input resolves to all-OFF (fail-closed) — so a KV
 * record written before a new flag existed stays valid after a deploy, and a
 * partial POST can never accidentally clear an unrelated flag to a non-shape.
 * At least one known flag must be present and well-formed.
 */
function validateFlags(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  let sawAny = false;
  for (const name of FLAG_NAMES) {
    const u = body[name];
    if (u === undefined) {
      out[name] = { android: false, ios: false };
      continue;
    }
    if (!u || typeof u !== 'object') return null;
    if (typeof u.android !== 'boolean' || typeof u.ios !== 'boolean') return null;
    out[name] = { android: u.android, ios: u.ios };
    sawAny = true;
  }
  return sawAny ? out : null;
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

    // ---- voucher admin: authenticated proxy to the payments bridge ----
    // The browser authenticates with the DASHBOARD token it already holds;
    // the bridge's own admin token (BRIDGE_ADMIN_TOKEN secret) never leaves
    // this Worker. Setup:
    //   wrangler secret put BRIDGE_ADMIN_TOKEN --config clients/dashboard/wrangler.jsonc
    // `/api/subscriptions?code=` is the support lookup (which subscription
    // does this device's payment code belong to, and did its settlements
    // land) — same proxy, same token handling.
    const bridgeRoute = ['/api/vouchers', '/api/subscriptions'].find((p) =>
      url.pathname.startsWith(p),
    );
    if (bridgeRoute) {
      if (!(await tokenMatches(bearerToken(request), env.ADMIN_TOKEN))) {
        return jsonResponse({ error: 'unauthorized' }, {}, 401);
      }
      if (!env.BRIDGE_URL || !env.BRIDGE_ADMIN_TOKEN) {
        return jsonResponse({ error: 'bridge proxy not configured' }, {}, 503);
      }
      const upstream = new URL(
        url.pathname.replace(bridgeRoute, bridgeRoute.replace('/api/', '/internal/')) + url.search,
        env.BRIDGE_URL,
      );
      const init = {
        method: request.method,
        headers: {
          authorization: `Bearer ${env.BRIDGE_ADMIN_TOKEN}`,
          'content-type': 'application/json',
        },
      };
      if (request.method === 'POST') {
        init.body = await request.text();
      }
      return fetch(upstream, init);
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
          { error: 'expected { <flag>: { android: boolean, ios: boolean } } with at least one of: ' + FLAG_NAMES.join(', ') },
          {},
          400,
        );
      }
      // Merge over the CURRENT stored flags, not all-false defaults: a POST
      // that omits a flag (e.g. a browser-cached older admin.html that only
      // knows inAppUpgrade) must not silently force the omitted flag OFF —
      // iapPurchase being remotely cleared mid-store-review is exactly the
      // failure this prevents. Fail-closed defaults still apply on READ.
      const current = await readFlags(env);
      const merged = {};
      for (const name of FLAG_NAMES) {
        merged[name] = body[name] !== undefined ? valid[name] : (current[name] ?? { android: false, ios: false });
      }
      const record = { ...merged, updatedAt: new Date().toISOString() };
      await env.FLAGS_KV.put(FLAGS_KEY, JSON.stringify(record));
      return jsonResponse(record, { 'access-control-allow-origin': '*' });
    }

    if (url.pathname === '/api/fleet') {
      const cache = caches.default;
      const key = new Request(new URL('/api/fleet', url.origin).toString(), { method: 'GET' });
      const sweep = async () => {
        const data = await fleet();
        const fresh = new Response(JSON.stringify(data), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            // Long on purpose. This is how long a copy remains SERVABLE, not
            // how long it is considered current — staleness is judged from the
            // payload's own generatedAt below. A short max-age here defeats the
            // whole design: cache.match misses on an expired entry, so there is
            // no stale copy left to answer with and the request blocks on a
            // sweep. That is exactly what the first version of this did, and it
            // cost ~30s on every other request.
            'cache-control': 'public, max-age=600',
            'access-control-allow-origin': '*',
          },
        });
        await cache.put(key, fresh.clone());
        return fresh;
      };

      // Stale-while-revalidate. Probing the fleet is inherently slow — it is a
      // hundred-odd round trips to gateways worldwide, deliberately run a few
      // at a time so none of them are wrongly declared dead. Making a viewer
      // wait for that is what pushed the old code into cranking concurrency up
      // until the sweep started lying.
      //
      // A cached copy answers instantly and a refresh runs behind it, so how
      // long a sweep takes stops being a constraint on the design. Worst case a
      // viewer sees numbers one sweep old, on a page that already refreshes
      // every 30s. Nothing waits for a sweep, cold cache included.
      const cached = await cache.match(key);
      if (!cached) {
        // Cold cache. caches.default is per-DATACENTER, so this is not a rare
        // one-off — it is paid at every edge location the page is opened from,
        // and a full sweep at this concurrency took 48s and 31s on two colos
        // when it blocked. Kick it off and answer immediately instead: the page
        // already retries a failed fetch on its 30s poll, and by then the cache
        // is populated. Better a brief "retrying" than a minute of blank tab.
        //
        // Safe to rely on waitUntil here because a sweep demonstrably outlives
        // the response — the background refresh below has been observed
        // completing and resetting the data age in production.
        ctx.waitUntil(sweep().catch(() => undefined));
        return jsonResponse({ error: 'warming up', retry_after_s: 15 }, { 'retry-after': '15' }, 503);
      }
      {
        // Refresh only once the data has actually aged, or every viewer's poll
        // would launch its own sweep and they would stampede the gateways.
        let age = Infinity;
        try {
          const { generatedAt } = await cached.clone().json();
          if (typeof generatedAt === 'number') age = Date.now() - generatedAt;
        } catch {
          // Unparseable cache entry — treat as ancient and re-sweep.
        }
        if (age > REFRESH_AFTER_MS) {
          ctx.waitUntil(sweep().catch(() => undefined));
        }
        return cached;
      }
      return sweep();
    }

    return env.ASSETS.fetch(request);
  },
};
