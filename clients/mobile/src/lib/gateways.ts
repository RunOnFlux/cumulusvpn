/**
 * Thin presentation wrappers over core discovery.
 *
 * Core `discoverGateways` returns a flat, load-sorted `GatewayInfo[]`; the
 * Connect + CountryPicker screens want them grouped by country with a node
 * count, a representative city and a latency reading for the dot colour. This
 * module does that shaping and nothing else — all networking lives in core.
 */
import { discoverGateways, gatewayQuality, pingGateway } from '@cumulusvpn/core';
import type { GatewayInfo } from '@cumulusvpn/core';
import { bundledSpecs, seedNodeIps } from './directory';
import { SCREENSHOT_MODE, demoLatency } from './screenshot';

/** Latency band that drives the coloured dot in the picker (mockup g/y/r). */
export type LatencyBand = 'good' | 'ok' | 'slow';

/** One row in a picker, aggregated from its gateways. */
export interface Country {
  /**
   * Stable row id. {@link groupByCountry} sets it to {@link code} (country-level
   * rows for multi-hop entry/exit). {@link groupByLocation} sets it to
   * `"<cc>:<city>"` (or just `<cc>` when no locality is known), so two cities in
   * the same country are distinct, selectable single-hop rows.
   */
  readonly id: string;
  /** ISO-3166 alpha-2, e.g. `"DE"`. */
  readonly code: string;
  /** Flag emoji derived from `code`. */
  readonly flag: string;
  /** Human name, e.g. `"Germany"`. */
  readonly name: string;
  /** Representative city (from the least-loaded gateway). */
  readonly city: string;
  /** Number of reachable gateways in this country. */
  readonly nodeCount: number;
  /** Best gateway in this row (see `bestOf`) — the one we enroll at. */
  readonly best: GatewayInfo;
  /**
   * Every gateway IP this row covers. Multi-hop passes these to core's
   * `selectHops` as `entryIps`/`exitIps`, so picking a CITY pins that hop to
   * the city's nodes instead of letting load ordering choose anywhere in the
   * country (docs/11).
   */
  readonly ips: readonly string[];
  /** Round-trip latency in ms to `best`, or null if not yet measured. */
  readonly latencyMs: number | null;
}

/**
 * ISO code → display name for the whole planned fleet (beta + GA, per
 * deploy/countries.yaml). Any `cumulusvpn<cc>` spec is auto-discovered, so this
 * only needs the display name; an unknown code falls back to the raw code.
 */
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  // Beta
  US: 'United States',
  CA: 'Canada',
  DE: 'Germany',
  NL: 'Netherlands',
  FR: 'France',
  GB: 'United Kingdom',
  CZ: 'Czechia',
  PL: 'Poland',
  SG: 'Singapore',
  JP: 'Japan',
  AU: 'Australia',
  BR: 'Brazil',
  // GA additions
  ES: 'Spain',
  IT: 'Italy',
  SE: 'Sweden',
  CH: 'Switzerland',
  AT: 'Austria',
  FI: 'Finland',
  MX: 'Mexico',
  KR: 'South Korea',
  IN: 'India',
  ZA: 'South Africa',
  // Scale additions
  RU: 'Russia',
  MY: 'Malaysia',
  HK: 'Hong Kong',
  AE: 'United Arab Emirates',
};

/**
 * Representative datacenter city per country — a cosmetic fallback for when a
 * gateway hasn't reported its own locality yet. The live gateway's `/v1/info`
 * (now its FluxOS region, e.g. a US state) wins whenever present.
 */
const COUNTRY_CITIES: Readonly<Record<string, string>> = {
  US: 'Multiple cities',
  CA: 'Toronto',
  DE: 'Frankfurt',
  NL: 'Amsterdam',
  FR: 'Paris',
  GB: 'London',
  CZ: 'Prague',
  PL: 'Warsaw',
  SG: 'Singapore',
  JP: 'Tokyo',
  AU: 'Sydney',
  BR: 'São Paulo',
  ES: 'Madrid',
  IT: 'Milan',
  SE: 'Stockholm',
  CH: 'Zürich',
  AT: 'Vienna',
  FI: 'Helsinki',
  MX: 'Mexico City',
  KR: 'Seoul',
  IN: 'Mumbai',
  ZA: 'Johannesburg',
  RU: 'Moscow',
  MY: 'Kuala Lumpur',
  HK: 'Hong Kong',
  AE: 'Dubai',
};

/** Best locality label for a gateway: its reported city/region, else a fallback. */
export function localityOf(cityFromGateway: string, code: string): string {
  const c = cityFromGateway.trim();
  return c || COUNTRY_CITIES[code] || '';
}

/** A resolved end of the active route (one hop), for the connected display. */
export interface RouteEndpoint {
  /** ISO alpha-2 country code. */
  readonly code: string;
  /** Flag emoji for `code`. */
  readonly flag: string;
  /** Human country name. */
  readonly name: string;
  /** Representative city. */
  readonly city: string;
  /** Gateway public IP — for the exit hop this is the egress the world sees. */
  readonly ip: string;
  /** `http://<ip>:51821` control URL — used to live-ping this hop. */
  readonly controlUrl: string;
}

/** Build a {@link RouteEndpoint} (country + IP) from a concrete gateway. */
export function routeEndpoint(gw: GatewayInfo): RouteEndpoint {
  return {
    code: gw.country,
    flag: flagEmoji(gw.country),
    name: COUNTRY_NAMES[gw.country] ?? gw.country,
    city: localityOf(gw.city, gw.country),
    ip: gw.ip,
    controlUrl: gw.controlUrl,
  };
}

/** Turn an ISO alpha-2 code into its flag emoji (regional-indicator pair). */
export function flagEmoji(code: string): string {
  const cc = code.trim().toUpperCase();
  if (cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) {
    return '🏳️';
  }
  const base = 0x1f1e6;
  return (
    String.fromCodePoint(base + (cc.charCodeAt(0) - 65)) +
    String.fromCodePoint(base + (cc.charCodeAt(1) - 65))
  );
}

/** Classify a latency reading into the mockup's dot bands. */
export function latencyBand(ms: number | null): LatencyBand {
  if (ms === null || ms >= 180) {
    return 'slow';
  }
  return ms < 60 ? 'good' : 'ok';
}

/**
 * The best gateway in a group, by the same quality score the UI renders
 * (`gatewayQuality`: load weighted a little over measured latency).
 *
 * Core hands us gateways sorted by LOAD only, so taking the first would show a
 * country's least-busy node even when a sibling city answers in a third of the
 * time — a US row could advertise 210 ms while a New York node sat at 70 ms.
 * Picking the best-scoring node means a country row reports the best ping,
 * load and quality actually available there, which is what a user choosing
 * between countries needs. It is also the node we enroll at, so the row is a
 * promise the connection keeps rather than a label.
 *
 * Ties fall back to list order (load-sorted), keeping selection deterministic.
 */
function bestOf(
  list: readonly GatewayInfo[],
  latencyByIp: Readonly<Record<string, number>>,
): GatewayInfo | undefined {
  let best: GatewayInfo | undefined;
  let bestScore = -1;
  for (const gw of list) {
    const { score } = gatewayQuality(latencyByIp[gw.ip] ?? null, gw.load);
    if (score > bestScore) {
      best = gw;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Group discovered gateways into country rows, each reporting the BEST node in
 * that country (see {@link bestOf}) so a multi-city country still shows one
 * honest ping / load / quality instead of an arbitrary city's.
 */
export function groupByCountry(
  gateways: readonly GatewayInfo[],
  latencyByIp: Readonly<Record<string, number>> = {},
): Country[] {
  const byCode = new Map<string, GatewayInfo[]>();
  for (const gw of gateways) {
    const list = byCode.get(gw.country);
    if (list) {
      list.push(gw);
    } else {
      byCode.set(gw.country, [gw]);
    }
  }

  const countries: Country[] = [];
  for (const [code, list] of byCode) {
    const best = bestOf(list, latencyByIp);
    if (!best) {
      continue;
    }
    const latency = latencyByIp[best.ip];
    countries.push({
      id: code,
      code,
      flag: flagEmoji(code),
      name: COUNTRY_NAMES[code] ?? code,
      city: localityOf(best.city, code),
      nodeCount: list.length,
      best,
      ips: list.map((g) => g.ip),
      latencyMs: latency ?? null,
    });
  }

  return sortByNearest(countries);
}

/**
 * Group discovered gateways into per-CITY rows (single-hop picker): one row per
 * (country, locality), so a multi-city country like the US shows "New York" and
 * "California" as separate, selectable locations. Locality comes from the
 * gateway's reported region/city (see {@link localityOf}); a country whose
 * gateways report no locality collapses to a single country-level row.
 */
export function groupByLocation(
  gateways: readonly GatewayInfo[],
  latencyByIp: Readonly<Record<string, number>> = {},
): Country[] {
  const byLoc = new Map<string, GatewayInfo[]>();
  for (const gw of gateways) {
    const city = localityOf(gw.city, gw.country);
    const key = city ? `${gw.country}:${city}` : gw.country;
    const list = byLoc.get(key);
    if (list) {
      list.push(gw);
    } else {
      byLoc.set(key, [gw]);
    }
  }

  const rows: Country[] = [];
  for (const [id, list] of byLoc) {
    const best = bestOf(list, latencyByIp);
    if (!best) {
      continue;
    }
    const code = best.country;
    rows.push({
      id,
      code,
      flag: flagEmoji(code),
      name: COUNTRY_NAMES[code] ?? code,
      city: localityOf(best.city, code),
      nodeCount: list.length,
      best,
      ips: list.map((g) => g.ip),
      latencyMs: latencyByIp[best.ip] ?? null,
    });
  }

  return sortByNearest(rows);
}

/** Sort rows by measured latency (unmeasured last), then name — nearest first. */
function sortByNearest(rows: Country[]): Country[] {
  rows.sort((a, b) => {
    const la = a.latencyMs ?? Number.POSITIVE_INFINITY;
    const lb = b.latencyMs ?? Number.POSITIVE_INFINITY;
    if (la !== lb) {
      return la - lb;
    }
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    return a.city < b.city ? -1 : 1;
  });
  return rows;
}

/**
 * Measure a rough round-trip to a gateway's `/v1/info` (used for the dot).
 * POC: a single timed fetch, not a proper ICMP/UDP RTT; good enough to colour
 * the dot and order the list.
 */
export async function measureLatency(gw: GatewayInfo): Promise<number | null> {
  // Store-capture builds only (CVPN_SCREENSHOT=1): report the latency a client
  // near this node would measure, so the ratings don't depend on where the
  // capture machine sits. Compiled out of every normal build — see
  // ./screenshot.ts for the constraints this data has to satisfy.
  if (SCREENSHOT_MODE) {
    return demoLatency(gw);
  }
  // A 2-sample active ping (median RTT) — steadier than a single request, and
  // the same primitive the picker's on-demand re-test uses.
  const { rttMs } = await pingGateway(gw.controlUrl, { samples: 2 });
  return rttMs;
}

/**
 * Resolve the live gateway fleet from the Flux network, using the bundled
 * signed snapshot for spec names + seed nodes. Networking is delegated to core.
 * POC: disk-cache tier of the discovery order is not implemented here.
 */
export async function discoverFleet(): Promise<GatewayInfo[]> {
  return discoverGateways(bundledSpecs(), { nodes: [...seedNodeIps()] });
}
