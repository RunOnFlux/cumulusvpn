import { useEffect, useMemo, useState } from 'react';
import { discoverGateways } from '@cumulusvpn/core';
import type { Directory, GatewayInfo } from '@cumulusvpn/core';
import { resolveDirectory } from '../lib/directory';
import type { DirectorySource } from '../lib/directory';
import { buildCountryOptions } from '../lib/gateways';
import type { CountryOption } from '../lib/gateways';
import { proxiedFetch } from '../lib/gatewayFetch';
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
}

const INITIAL: RawDiscovery = {
  loading: true,
  directory: null,
  source: null,
  verified: false,
  gateways: [],
  notice: null,
};

/**
 * Resolve the signed directory, then discover live gateways from the Flux
 * network. The network work runs once on mount; the country options re-derive
 * whenever the UI locale changes (names and sort order are locale-aware).
 *
 * POC: browsers block probing plain-http gateways from an https page (mixed
 * content) and most Flux endpoints send no CORS headers, so live discovery
 * usually returns nothing here — the list then reflects the directory's spec
 * countries as `seed` rows. The desktop/mobile clients (same core) probe freely.
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

      let gateways: GatewayInfo[] = [];
      try {
        gateways = await discoverGateways(directory.specs, { fetchImpl: proxiedFetch });
      } catch {
        gateways = [];
      }
      if (cancelled) {
        return;
      }

      setRaw({
        loading: false,
        directory,
        source,
        verified,
        gateways,
        notice: gateways.length === 0 ? 'no-live-gateway' : null,
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

  return { ...raw, options };
}
