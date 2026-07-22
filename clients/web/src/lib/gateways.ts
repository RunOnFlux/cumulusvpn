import type { GatewayInfo } from '@cumulusvpn/core';
import { cityOf, flagOf, nameOf, specToCountryCode } from './countries';
import type { Locale } from '../i18n';

/** A pickable location row: directory-derived, enriched with live discovery. */
export interface CountryOption {
  /**
   * Stable row id: the country code for a country-level (seed / single-city)
   * row, or `"<cc>:<city>"` when a country's live gateways span several cities,
   * so each city is a distinct, selectable row.
   */
  readonly id: string;
  readonly cc: string;
  readonly spec: string;
  readonly name: string;
  readonly flag: string;
  readonly city: string;
  /** Reachable, signature-verified gateways discovered in this country. */
  readonly nodeCount: number;
  /** Least-loaded discovered gateway, used for enrollment; null if none live. */
  readonly bestGateway: GatewayInfo | null;
  /** Whether at least one live gateway was discovered, or only the seed exists. */
  readonly status: 'live' | 'seed';
}

/** Traffic-light health from a 0..1 load, mirroring the mockup's latency dots. */
export type Health = 'good' | 'fair' | 'busy' | 'unknown';

export function healthOf(option: CountryOption): Health {
  if (!option.bestGateway) {
    return 'unknown';
  }
  const load = option.bestGateway.load;
  if (load < 0.34) {
    return 'good';
  }
  if (load < 0.67) {
    return 'fair';
  }
  return 'busy';
}

/**
 * Build the country list shown in the picker: one row per directory spec,
 * overlaid with live discovery results grouped by ISO country code. Countries
 * with reachable gateways sort first, then alphabetically by name.
 *
 * POC: real per-node round-trip latency is not measured in-browser (mixed
 * content blocks probing http gateways from an https page), so `load` from the
 * signed `/v1/info` is the health proxy — same tiebreak core discovery uses.
 */
export function buildCountryOptions(
  specs: readonly string[],
  gateways: readonly GatewayInfo[],
  locale: Locale,
): CountryOption[] {
  const byCountry = new Map<string, GatewayInfo[]>();
  for (const gw of gateways) {
    const cc = gw.country.toUpperCase();
    const list = byCountry.get(cc) ?? [];
    list.push(gw);
    byCountry.set(cc, list);
  }

  const options: CountryOption[] = [];
  for (const spec of specs) {
    const cc = specToCountryCode(spec);
    const live = (byCountry.get(cc) ?? []).slice().sort((a, b) => a.load - b.load);

    if (live.length === 0) {
      // No live gateway discovered — a single seed row from the directory.
      options.push({
        id: cc,
        cc,
        spec,
        name: nameOf(cc, locale),
        flag: flagOf(cc),
        city: cityOf(cc),
        nodeCount: 0,
        bestGateway: null,
        status: 'seed',
      });
      continue;
    }

    // Split the country's live gateways by locality so a spread fleet (e.g.
    // US-East New York vs US-West California) shows one selectable row per city.
    // Gateways with no reported city collapse to a single row via the fallback.
    const byCity = new Map<string, GatewayInfo[]>();
    for (const gw of live) {
      const city = (gw.city || cityOf(cc)).trim();
      const key = city || cc;
      const bucket = byCity.get(key);
      if (bucket) {
        bucket.push(gw);
      } else {
        byCity.set(key, [gw]);
      }
    }
    for (const bucket of byCity.values()) {
      const best = bucket[0]; // least-loaded in this city (live is load-sorted)
      if (!best) {
        continue;
      }
      const city = best.city || cityOf(cc);
      options.push({
        id: city ? `${cc}:${city}` : cc,
        cc,
        spec,
        name: nameOf(cc, locale),
        flag: flagOf(cc),
        city,
        nodeCount: bucket.length,
        bestGateway: best,
        status: 'live',
      });
    }
  }

  options.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'live' ? -1 : 1;
    }
    if (a.name !== b.name) {
      return a.name.localeCompare(b.name, locale);
    }
    return a.city.localeCompare(b.city, locale);
  });

  return options;
}
