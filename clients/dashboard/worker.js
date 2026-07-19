/**
 * Cloudflare Worker for dashboard.cumulusvpn.com — the public fleet monitor.
 *
 * Serves the static page (ASSETS binding) and exposes `/api/fleet`, which
 * aggregates every gateway's /v1/info SERVER-SIDE (no mixed-content block) and
 * returns one cached JSON snapshot the page renders. The gateways are plain
 * http; the Worker can reach them, the browser can't.
 *
 * The snapshot is edge-cached ~30s so a busy dashboard doesn't hammer the fleet.
 */

// Planned fleet (keep in sync with deploy/countries.yaml). Undeployed specs just
// return zero instances — which is itself useful (shows roadmap vs live).
const COUNTRY_CODES = [
  'us', 'ca', 'de', 'nl', 'fr', 'gb', 'cz', 'pl', 'sg', 'jp', 'au', 'br',
  'es', 'it', 'se', 'ch', 'at', 'fi', 'mx', 'kr', 'in', 'za',
];
const FLUX_API = 'https://api.runonflux.io';
const CONTROL_PORT = 51821;
const PROBE_TIMEOUT_MS = 6000;

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

/** Probe one gateway's /v1/info; never throws. */
async function probe(ip, cc, spec) {
  const inst = { ip, cc, spec, up: false };
  try {
    const r = await fetch(`http://${ip}:${CONTROL_PORT}/v1/info`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (r.ok) {
      const j = await r.json();
      const d = j && j.data ? j.data : j;
      inst.up = true;
      inst.version = d.version ?? null;
      inst.buildCommit = d.build_commit ?? null;
      inst.load = typeof d.load === 'number' ? d.load : null;
      inst.capacity = typeof d.capacity === 'number' ? d.capacity : null;
      inst.region = d.region || '';
      inst.city = d.city || '';
    }
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
