import { useEffect, useMemo, useState } from 'react';
import { discoverGateways } from '@cumulusvpn/core';
import type { Directory, GatewayInfo } from '@cumulusvpn/core';
import { resolveDirectory } from '../lib/directory';
import type { DirectorySource } from '../lib/directory';
import { buildCountryOptions, nearestOption } from '../lib/gateways';
import type { CountryOption } from '../lib/gateways';
import { probeTimes, timedProxiedFetch } from '../lib/gatewayFetch';
import { loadFleetCache, saveFleetCache } from '../lib/fleetCache';
import type { Locale } from '../i18n';

/** Stable notice codes; the UI maps them to catalog messages. */
export type DiscoveryNotice = 'no-live-gateway';

export interface DiscoveryState {
  readonly loading: boolean;
  readonly directory: Directory | null;
  readonly source: DirectorySource | null;
  readonly verified: boolean;
  readonly options: CountryOption[];
  readonly gateways: GatewayInfo[];
  /** The live location nearest the visitor (fastest probe), or null. */
  readonly nearest: CountryOption | null;
  /**
   * Showing the list from this browser's last visit while the network is
   * re-checked; false once live discovery has answered.
   */
  readonly refreshing: boolean;
  /** Non-null when no live gateway could be probed (browser sandbox / cold net). */
  readonly notice: DiscoveryNotice | null;
}

interface RawDiscovery {
  readonly loading: boolean;
  readonly directory: Directory | null;
  readonly source: DirectorySource | null;
  readonly verified: boolean;
  readonly gateways: GatewayInfo[];
  readonly notice: DiscoveryNotice | null;
  readonly refreshing: boolean;
  /** Probe time by gateway IP (ms), live or from the cache. */
  readonly times: ReadonlyMap<string, number>;
}

const INITIAL: RawDiscovery = {
  loading: true,
  directory: null,
  source: null,
  verified: false,
  gateways: [],
  notice: null,
  refreshing: false,
  times: new Map(),
};

/**
 * Resolve the signed directory, then discover live gateways from the Flux
 * network. The network work runs once on mount; the country options re-derive
 * whenever the UI locale changes (names and sort order are locale-aware).
 *
 * An https page can't call the plain-http gateways directly (mixed content), so
 * every probe goes through the site's Worker (`proxiedFetch`, clients/web/worker.js).
 * When none answers, the list falls back to the directory's spec countries as
 * `seed` rows.
 */
export function useDiscovery(locale: Locale): DiscoveryState {
  const [raw, setRaw] = useState<RawDiscovery>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { directory, source, verified } = await resolveDirectory();
      if (cancelled) {
        return;
      }

      // A returning visitor sees the list from their last visit at once;
      // discovering the whole fleet takes several seconds.
      const cached = loadFleetCache(Date.now());
      if (cached) {
        setRaw({
          loading: false,
          directory,
          source,
          verified,
          gateways: [...cached.gateways],
          notice: null,
          refreshing: true,
          times: new Map(Object.entries(cached.times)),
        });
      }

      let gateways: GatewayInfo[] = [];
      try {
        gateways = await discoverGateways(directory.specs, { fetchImpl: timedProxiedFetch });
      } catch {
        gateways = [];
      }
      if (cancelled) {
        return;
      }

      const times = new Map(probeTimes);
      if (gateways.length > 0) {
        saveFleetCache({ at: Date.now(), gateways, times: Object.fromEntries(times) });
      } else if (cached) {
        // Offline right now: keep showing the last good list.
        setRaw((r) => ({ ...r, refreshing: false }));
        return;
      }
      setRaw({
        loading: false,
        directory,
        source,
        verified,
        gateways,
        notice: gateways.length === 0 ? 'no-live-gateway' : null,
        refreshing: false,
        times,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () => (raw.directory ? buildCountryOptions(raw.directory.specs, raw.gateways, locale) : []),
    [raw.directory, raw.gateways, locale],
  );

  const nearest = useMemo(() => nearestOption(options, raw.times), [options, raw.times]);

  return {
    loading: raw.loading,
    directory: raw.directory,
    source: raw.source,
    verified: raw.verified,
    gateways: raw.gateways,
    notice: raw.notice,
    refreshing: raw.refreshing,
    options,
    nearest,
  };
}
