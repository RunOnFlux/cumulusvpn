import type { GatewayInfo } from '@cumulusvpn/core';
import { cityOf, flagOf, nameOf, specToCountryCode } from './countries';

/** A pickable country row: directory-derived, enriched with live discovery. */
export interface CountryOption {
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
): CountryOption[] {
  const byCountry = new Map<string, GatewayInfo[]>();
  for (const gw of gateways) {
    const cc = gw.country.toUpperCase();
    const list = byCountry.get(cc) ?? [];
    list.push(gw);
    byCountry.set(cc, list);
  }

  const options: CountryOption[] = specs.map((spec) => {
    const cc = specToCountryCode(spec);
    const live = (byCountry.get(cc) ?? []).slice().sort((a, b) => a.load - b.load);
    const best = live[0] ?? null;
    return {
      cc,
      spec,
      name: nameOf(cc),
      flag: flagOf(cc),
      city: best?.city ?? cityOf(cc),
      nodeCount: live.length,
      bestGateway: best,
      status: best ? 'live' : 'seed',
    };
  });

  options.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'live' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return options;
}
