// price.mjs — the FLUX price schedule, for the deploy tooling.
//
// A port of gateway/internal/price (and bridge/src/price.ts); all three run the
// shared vectors in gateway/internal/price/testdata/vectors.json, so a schedule
// this tool writes is read identically by every gateway and the bridge.
//
//   20                  flat price for all of history
//   20@0,12@2215000     20 FLUX until block 2214999, 12 FLUX from 2215000
//
// A tx is judged by the EFFECTIVE price at its own height (the lowest price in
// force during the preceding GRACE_BLOCKS), so appending an entry never
// re-judges a mined payment. docs/04-payments.md "Price in FLUX vs $0.99".

/** 72 h at 30 s blocks. Mirrors price.GraceBlocks in the gateway. */
export const GRACE_BLOCKS = 8640;

/** Flux block time since PON, for turning block counts into wall-clock ETAs. */
export const BLOCK_SECONDS = 30;

const MAX_ENTRIES = 256;

/** Parse the wire format into [{ from, flux }], throwing on anything the gateway would reject. */
export function parseSchedule(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') throw new Error('price: empty schedule');
  const parts = s.split(',');
  if (parts.length > MAX_ENTRIES)
    throw new Error(`price: ${parts.length} entries, max ${MAX_ENTRIES}`);
  const entries = [];
  parts.forEach((part, i) => {
    const entry = part.trim();
    const at = entry.indexOf('@');
    const fluxStr = (at === -1 ? entry : entry.slice(0, at)).trim();
    // ≤ 9 integer digits, ≤ 8 decimals (one zat) — the Go parser's fluxRe.
    const flux = /^\d{1,9}(\.\d{1,8})?$/.test(fluxStr) ? Number(fluxStr) : NaN;
    if (!(flux > 0) || !Number.isFinite(flux)) {
      throw new Error(`price: entry ${i + 1} "${entry}": price must be a positive number`);
    }
    let from = 0;
    if (at !== -1) {
      const fromStr = entry.slice(at + 1).trim();
      if (!/^\d{1,16}$/.test(fromStr) || !Number.isSafeInteger(Number(fromStr))) {
        throw new Error(`price: entry ${i + 1} "${entry}": height must be a non-negative integer`);
      }
      from = Number(fromStr);
    } else if (i > 0) {
      throw new Error(`price: entry ${i + 1} "${entry}": needs an @height`);
    }
    if (i === 0 && from !== 0)
      throw new Error(`price: first entry "${entry}" must start at height 0`);
    if (i > 0 && from <= entries[i - 1].from) {
      throw new Error(`price: entry ${i + 1} "${entry}": heights must strictly increase`);
    }
    entries.push({ from, flux });
  });
  return entries;
}

/** Shortest plain decimal — never the exponent form `${n}` uses below 1e-6. */
export const formatFlux = (flux) => flux.toFixed(8).replace(/\.?0+$/, '');

/** Canonical wire form ("20@0,12@2215000"), identical to the gateway's. */
export function formatSchedule(entries) {
  return entries.map((e) => `${formatFlux(e.flux)}@${e.from}`).join(',');
}

export const latestPrice = (entries) => entries[entries.length - 1].flux;

function indexAt(entries, h) {
  let i = entries.length - 1;
  while (i > 0 && entries[i].from > h) i -= 1;
  return i;
}

/** The price in force at height h — what a new payment is quoted. */
export const priceAt = (entries, h) => entries[indexAt(entries, h)].flux;

/** The price a tx mined at height h is judged against (grace included). */
export function effectivePrice(entries, h) {
  const i = indexAt(entries, h);
  let p = entries[i].flux;
  const lo = h - GRACE_BLOCKS;
  for (let j = i - 1; j >= 0 && entries[j + 1].from > lo; j -= 1) p = Math.min(p, entries[j].flux);
  return p;
}

/**
 * The spec env for a schedule. BOTH variables, always: schedule-aware gateways
 * read CVPN_PRICE_SCHEDULE, older images only know CVPN_PRICE_FLUX — which
 * must therefore carry the latest price so the two generations charge the same.
 */
export function priceEnv(entries) {
  return [
    `CVPN_PRICE_FLUX=${formatFlux(latestPrice(entries))}`,
    `CVPN_PRICE_SCHEDULE=${formatSchedule(entries)}`,
  ];
}

/** The same resolution rule as the gateway's config.ResolvePrice, over a spec's env list. */
export function scheduleFromEnv(envList) {
  const env = new Map();
  for (const kv of envList ?? []) {
    const i = kv.indexOf('=');
    if (i > 0 && !env.has(kv.slice(0, i))) env.set(kv.slice(0, i), kv.slice(i + 1));
  }
  if (env.get('CVPN_PRICE_SCHEDULE')?.trim()) return parseSchedule(env.get('CVPN_PRICE_SCHEDULE'));
  const flat = Number(env.get('CVPN_PRICE_FLUX'));
  if (!(flat > 0))
    throw new Error('spec has neither CVPN_PRICE_SCHEDULE nor a valid CVPN_PRICE_FLUX');
  return [{ from: 0, flux: flat }];
}

/**
 * The `price:` block of countries.yaml, validated. `schedule` is canonical and
 * append-only; the USD band is what price-watch.mjs enforces.
 */
export function readPriceConfig(manifest) {
  const p = manifest?.price;
  if (!p || p.schedule === undefined) throw new Error('countries.yaml: missing price.schedule');
  const entries = parseSchedule(String(p.schedule));
  const band = {
    floorUsd: Number(p.floorUsd),
    targetUsd: Number(p.targetUsd),
    ceilingUsd: Number(p.ceilingUsd),
  };
  if (!(band.floorUsd > 0 && band.floorUsd < band.targetUsd && band.targetUsd < band.ceilingUsd)) {
    throw new Error('countries.yaml: price needs 0 < floorUsd < targetUsd < ceilingUsd');
  }
  return { entries, ...band };
}

/**
 * The FLUX price to set so a month costs about `targetUsd`: a round number
 * (whole FLUX above 10, tenths above 1, hundredths below), nearest to target,
 * but never above `ceilingUsd` at the given rate.
 */
export function suggestPrice(fluxUsd, targetUsd, ceilingUsd) {
  const raw = targetUsd / fluxUsd;
  const step = raw >= 10 ? 1 : raw >= 1 ? 0.1 : 0.01;
  const decimals = step === 1 ? 0 : step === 0.1 ? 1 : 2;
  const fix = (n) => Number(n.toFixed(decimals));
  let flux = fix(Math.round(raw / step) * step);
  if (flux * fluxUsd > ceilingUsd) flux = fix(Math.floor(raw / step) * step);
  return Math.max(flux, step);
}

/**
 * FLUX/USD sources. Several independent venues so one stale or broken API
 * can neither trigger a false alarm nor hide a real one; USDT pairs are taken
 * at par, which is well inside the band's tolerance.
 */
const SOURCES = [
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=zelcash&vs_currencies=usd',
    pick: (j) => j?.zelcash?.usd,
  },
  {
    name: 'kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=FLUXUSD',
    pick: (j) => j?.result?.FLUXUSD?.c?.[0],
  },
  {
    name: 'kucoin',
    url: 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=FLUX-USDT',
    pick: (j) => j?.data?.price,
  },
  {
    name: 'gateio',
    url: 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=FLUX_USDT',
    pick: (j) => j?.[0]?.last,
  },
];

/**
 * Median FLUX/USD across the sources that answer. Throws below `minSources`:
 * a single venue is not enough to reprice the fleet or page anyone on.
 */
export async function fetchFluxUsd({ minSources = 2, fetchImpl = fetch } = {}) {
  const quotes = [];
  const failed = [];
  await Promise.all(
    SOURCES.map(async (s) => {
      try {
        const res = await fetchImpl(s.url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const v = Number(s.pick(await res.json()));
        if (!(v > 0) || !Number.isFinite(v)) throw new Error('no price in response');
        quotes.push({ source: s.name, usd: v });
      } catch (e) {
        failed.push(`${s.name}: ${e.message}`);
      }
    }),
  );
  if (quotes.length < minSources) {
    throw new Error(`only ${quotes.length} FLUX/USD source(s) answered (${failed.join('; ')})`);
  }
  const sorted = quotes.map((q) => q.usd).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const usd = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { usd, quotes, failed };
}
