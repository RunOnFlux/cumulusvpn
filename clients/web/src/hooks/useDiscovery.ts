import { useEffect, useState } from 'react';
import { discoverGateways } from '@cumulusvpn/core';
import type { Directory, GatewayInfo } from '@cumulusvpn/core';
import { resolveDirectory } from '../lib/directory';
import type { DirectorySource } from '../lib/directory';
import { buildCountryOptions } from '../lib/gateways';
import type { CountryOption } from '../lib/gateways';
import { proxiedFetch } from '../lib/gatewayFetch';

export interface DiscoveryState {
  readonly loading: boolean;
  readonly directory: Directory | null;
  readonly source: DirectorySource | null;
  readonly verified: boolean;
  readonly options: CountryOption[];
  readonly gateways: GatewayInfo[];
  /** Non-null when no live gateway could be probed (browser sandbox / cold net). */
  readonly notice: string | null;
}

const INITIAL: DiscoveryState = {
  loading: true,
  directory: null,
  source: null,
  verified: false,
  options: [],
  gateways: [],
  notice: null,
};

/**
 * Resolve the signed directory, then discover live gateways from the Flux
 * network and fold them into a country list. Runs once on mount.
 *
 * POC: browsers block probing plain-http gateways from an https page (mixed
 * content) and most Flux endpoints send no CORS headers, so live discovery
 * usually returns nothing here — the list then reflects the directory's spec
 * countries as `seed` rows. The desktop/mobile clients (same core) probe freely.
 */
export function useDiscovery(): DiscoveryState {
  const [state, setState] = useState<DiscoveryState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { directory, source, verified } = await resolveDirectory();
      if (cancelled) {
        return;
      }

      let gateways: GatewayInfo[] = [];
      try {
        gateways = await discoverGateways(directory.specs, { fetchImpl: proxiedFetch });
      } catch {
        gateways = [];
      }
      if (cancelled) {
        return;
      }

      const options = buildCountryOptions(directory.specs, gateways);
      setState({
        loading: false,
        directory,
        source,
        verified,
        options,
        gateways,
        notice:
          gateways.length === 0
            ? 'No live gateway reachable from the browser. Showing the signed directory’s countries — configs enroll against a live gateway when one is reachable.'
            : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
