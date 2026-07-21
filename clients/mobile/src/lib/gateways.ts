/**
 * Thin presentation wrappers over core discovery.
 *
 * Core `discoverGateways` returns a flat, load-sorted `GatewayInfo[]`; the
 * Connect + CountryPicker screens want them grouped by country with a node
 * count, a representative city and a latency reading for the dot colour. This
 * module does that shaping and nothing else — all networking lives in core.
 */
import { Alert } from 'react-native';
import { discoverGateways, pingGateway } from '@cumulusvpn/core';
import type { GatewayInfo } from '@cumulusvpn/core';
import { bundledSpecs, seedNodeIps } from './directory';

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
  /** Best (lowest-load) gateway — the one we enroll at. */
  readonly best: GatewayInfo;
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
 * Group discovered gateways into country rows.
 *
 * Gateways arrive already sorted by (country, load) from core, so the first
 * gateway seen for a country is its least-loaded — the one we pick.
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
    const best = list[0];
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
    const best = list[0];
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
  // A 2-sample active ping (median RTT) — steadier than a single request, and
  // the same primitive the picker's on-demand re-test uses.
  const { rttMs } = await pingGateway(gw.controlUrl, { samples: 2 });
  return rttMs;
}

/**
 * TEMP iOS discovery diagnostic. Logs every discovery request's network outcome
 * (without reading the body, so it can't disturb the real read) so we can tell,
 * from the device console, whether the failure is the fetch itself (ATS /
 * reachability) or something after it. Tagged [CVPN-DISCOVERY]. Remove once iOS
 * discovery is confirmed working.
 */
const diagFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  try {
    const res = await fetch(input as Parameters<typeof fetch>[0], init);
    // eslint-disable-next-line no-console
    console.warn(`[CVPN-DISCOVERY] ${res.status} ${url}`);
    return res;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[CVPN-DISCOVERY] FETCH_ERR ${url} :: ${String((e as Error)?.message ?? e)}`);
    throw e;
  }
};

/**
 * TEMP: step-by-step discovery self-test that surfaces the result **on screen**
 * (Alert) so no console is needed. Walks the exact path discovery uses — Flux API
 * (HTTPS) → gateway /v1/info (cleartext) → body read via arrayBuffer (what
 * fetchSigned uses, fragile on RN iOS) vs text — and reports where it breaks.
 * Runs once per launch, independent of the real discovery reads.
 */
let diagShown = false;
async function diagArrayBufferSelfTest(): Promise<void> {
  if (diagShown) return;
  diagShown = true;
  const steps: string[] = [];
  try {
    const specs = bundledSpecs();
    steps.push(`specs=${specs.length}`);
    // Iterate specs until one returns an IP — many countries (AU, BR, …) aren't
    // deployed and return an empty list, so specs[0] alone tells us nothing.
    let ip: string | undefined;
    let lastStatus = 0;
    let tried = 0;
    for (const spec of specs) {
      tried += 1;
      try {
        const locRes = await fetch(`https://api.runonflux.io/apps/location/${spec}`);
        lastStatus = locRes.status;
        const loc = (await locRes.json()) as { data?: { ip?: string }[] };
        const found = loc.data?.[0]?.ip?.split(':')[0];
        if (found) {
          ip = found;
          steps.push(`fluxAPI ${spec}=${locRes.status} ip=${found} (after ${tried})`);
          break;
        }
      } catch (e) {
        steps.push(`fluxAPI ${spec}=FETCH_ERR ${String((e as Error)?.message ?? e)}`);
        break;
      }
    }
    if (!ip) {
      steps.push(`no ip from ${tried} specs (last status ${lastStatus})`);
    }
    if (ip) {
      const url = `http://${ip}:51821/v1/info`;
      try {
        const res = await fetch(url);
        steps.push(`gateway=${res.status}`);
        try {
          steps.push(`arrayBuffer=${(await res.clone().arrayBuffer()).byteLength}B`);
        } catch (e) {
          steps.push(`arrayBuffer=ERR ${String((e as Error)?.message ?? e)}`);
        }
        try {
          steps.push(`text=${(await res.text()).length}chars`);
        } catch (e) {
          steps.push(`text=ERR ${String((e as Error)?.message ?? e)}`);
        }
      } catch (e) {
        steps.push(`gateway=FETCH_ERR ${String((e as Error)?.message ?? e)}`);
      }
    }
  } catch (e) {
    steps.push(`selftest threw ${String((e as Error)?.message ?? e)}`);
  }
  const report = steps.join('\n');
  // eslint-disable-next-line no-console
  console.warn(`[CVPN-DISCOVERY]\n${report}`);
  Alert.alert('Discovery diagnostic', report);
}

/**
 * Resolve the live gateway fleet from the Flux network, using the bundled
 * signed snapshot for spec names + seed nodes. Networking is delegated to core.
 * POC: disk-cache tier of the discovery order is not implemented here.
 */
export async function discoverFleet(): Promise<GatewayInfo[]> {
  void diagArrayBufferSelfTest(); // TEMP: fire-and-forget iOS diagnostic
  return discoverGateways(bundledSpecs(), { nodes: [...seedNodeIps()], fetchImpl: diagFetch });
}
