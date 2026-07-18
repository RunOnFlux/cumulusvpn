/**
 * Thin presentation wrappers over core discovery.
 *
 * Core `discoverGateways` returns a flat, load-sorted `GatewayInfo[]`; the
 * Connect + CountryPicker screens want them grouped by country with a node
 * count, a representative city and a latency reading for the dot colour. This
 * module does that shaping and nothing else — all networking lives in core.
 */
import { discoverGateways, pingGateway } from '@cumulusvpn/core';
import type { GatewayInfo } from '@cumulusvpn/core';
import { bundledSpecs, seedNodeIps } from './directory';

/** Latency band that drives the coloured dot in the picker (mockup g/y/r). */
export type LatencyBand = 'good' | 'ok' | 'slow';

/** One country row in the picker, aggregated from all its gateways. */
export interface Country {
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

/** Minimal ISO code → display name map for the launch fleet (docs/deploy specs). */
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  DE: 'Germany',
  US: 'United States',
  NL: 'Netherlands',
  GB: 'United Kingdom',
  FR: 'France',
  JP: 'Japan',
  CA: 'Canada',
  BR: 'Brazil',
  AU: 'Australia',
  CZ: 'Czechia',
  PL: 'Poland',
  SG: 'Singapore',
};

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
}

/** Build a {@link RouteEndpoint} (country + IP) from a concrete gateway. */
export function routeEndpoint(gw: GatewayInfo): RouteEndpoint {
  return {
    code: gw.country,
    flag: flagEmoji(gw.country),
    name: COUNTRY_NAMES[gw.country] ?? gw.country,
    city: gw.city,
    ip: gw.ip,
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
      code,
      flag: flagEmoji(code),
      name: COUNTRY_NAMES[code] ?? code,
      city: best.city,
      nodeCount: list.length,
      best,
      latencyMs: latency ?? null,
    });
  }

  // Sort by measured latency (unmeasured last), then name — nearest first.
  countries.sort((a, b) => {
    const la = a.latencyMs ?? Number.POSITIVE_INFINITY;
    const lb = b.latencyMs ?? Number.POSITIVE_INFINITY;
    if (la !== lb) {
      return la - lb;
    }
    return a.name < b.name ? -1 : 1;
  });
  return countries;
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
 * Resolve the live gateway fleet from the Flux network, using the bundled
 * signed snapshot for spec names + seed nodes. Networking is delegated to core.
 * POC: disk-cache tier of the discovery order is not implemented here.
 */
export async function discoverFleet(): Promise<GatewayInfo[]> {
  return discoverGateways(bundledSpecs(), { nodes: [...seedNodeIps()] });
}
