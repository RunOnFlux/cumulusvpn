/**
 * Picker rows from the discovered fleet — the desktop port of mobile's
 * `groupByCountry` / `groupByLocation` (clients/mobile/src/lib/gateways.ts).
 *
 * Two levels, like mobile:
 *  - **country rows** (id = `DE`): the best gateway anywhere in the country;
 *  - **city rows** (id = `DE:Frankfurt`): the best gateway in that city.
 * "Best" is core's `gatewayQuality` score over measured latency + load, so the
 * picker, Automatic and the connect path all agree on what "best" means.
 *
 * **Automatic** is not a row: it resolves to the single best location overall
 * at connect time ({@link bestLocation}), so it keeps tracking the fleet as
 * nodes come and go.
 */
import { gatewayQuality } from '@cumulusvpn/core';
import type { GatewayInfo } from '@cumulusvpn/core';
import { countryMeta } from './directory.js';
import type { CountryOption } from './session.js';

/** Measured round-trip time per gateway IP, in ms (absent = not measured). */
export type LatencyByIp = Readonly<Record<string, number>>;

/** Stable row id: `DE` for a whole country, `DE:Frankfurt` for a city. */
export function optionId(o: CountryOption): string {
  return o.id ?? o.code;
}

/** `DE:Frankfurt` → `DE`; a bare code is returned as is. */
export function countryOfId(id: string): string {
  const i = id.indexOf(':');
  return i === -1 ? id : id.slice(0, i);
}

/** A city id has a locality part (`DE:Frankfurt`). */
export function isCityId(id: string): boolean {
  return id.includes(':');
}

function scoreOf(g: GatewayInfo, latency: LatencyByIp): number {
  return gatewayQuality(latency[g.ip] ?? null, g.load).score;
}

/**
 * The best gateway in `list`. Measured gateways are preferred over unmeasured
 * ones (an unreachable node is never "nearest"), as on mobile.
 */
export function bestOf(
  list: readonly GatewayInfo[],
  latency: LatencyByIp,
): GatewayInfo | undefined {
  const measured = list.filter((g) => latency[g.ip] !== undefined);
  let best: GatewayInfo | undefined;
  let bestScore = -Infinity;
  for (const g of measured.length > 0 ? measured : list) {
    const s = scoreOf(g, latency);
    if (s > bestScore) {
      best = g;
      bestScore = s;
    }
  }
  return best;
}

function toOption(
  g: GatewayInfo,
  id: string,
  nodeCount: number,
  latency: LatencyByIp,
): CountryOption {
  const meta = countryMeta(g.country);
  return {
    id,
    code: g.country,
    name: meta.name,
    flag: meta.flag,
    gatewayIp: g.ip,
    city: g.city.trim(),
    load: g.load,
    signPubKey: g.sign_pubkey,
    nodeCount,
    latencyMs: latency[g.ip] ?? null,
    ...(g.transports ? { transports: g.transports } : {}),
  };
}

function groupBy(
  gateways: readonly GatewayInfo[],
  keyOf: (g: GatewayInfo) => string,
  latency: LatencyByIp,
): CountryOption[] {
  const groups = new Map<string, GatewayInfo[]>();
  for (const g of gateways) {
    const key = keyOf(g);
    const list = groups.get(key);
    if (list) {
      list.push(g);
    } else {
      groups.set(key, [g]);
    }
  }
  const rows: CountryOption[] = [];
  for (const [id, list] of groups) {
    const best = bestOf(list, latency);
    if (best) {
      rows.push(toOption(best, id, list.length, latency));
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.city.localeCompare(b.city));
}

/** One row per country, A–Z. */
export function toCountryRows(
  gateways: readonly GatewayInfo[],
  latency: LatencyByIp = {},
): CountryOption[] {
  return groupBy(gateways, (g) => g.country, latency);
}

/** One row per city (a gateway with no city counts as the country itself). */
export function toCityRows(
  gateways: readonly GatewayInfo[],
  latency: LatencyByIp = {},
): CountryOption[] {
  return groupBy(
    gateways,
    (g) => (g.city.trim() ? `${g.country}:${g.city.trim()}` : g.country),
    latency,
  );
}

/** The cities of `code`, A–Z. */
export function citiesOf(locations: readonly CountryOption[], code: string): CountryOption[] {
  return locations
    .filter((l) => l.code === code && isCityId(optionId(l)))
    .sort((a, b) => a.city.localeCompare(b.city));
}

/** The location Automatic would connect to right now: the best overall. */
export function bestLocation(countries: readonly CountryOption[]): CountryOption | null {
  let best: CountryOption | null = null;
  let bestScore = -Infinity;
  const measured = countries.filter((c) => c.latencyMs !== null && c.latencyMs !== undefined);
  for (const c of measured.length > 0 ? measured : countries) {
    const s = gatewayQuality(c.latencyMs ?? null, c.load).score;
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Resolve a stored selection: `null` = Automatic (best overall); a city id
 * that has gone away falls back to its country; an unknown country to
 * Automatic.
 */
export function resolveSelection(
  id: string | null,
  countries: readonly CountryOption[],
  locations: readonly CountryOption[],
): CountryOption | null {
  if (id !== null) {
    const exact =
      locations.find((l) => optionId(l) === id) ?? countries.find((c) => optionId(c) === id);
    if (exact) {
      return exact;
    }
    const country = countries.find((c) => c.code === countryOfId(id));
    if (country) {
      return country;
    }
  }
  return bestLocation(countries);
}
