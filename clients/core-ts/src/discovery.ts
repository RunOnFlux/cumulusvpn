import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import { fetchSigned } from './http.js';
import { CONTROL_PORT } from './types.js';
import type { Directory, DiscoverOptions, FetchImpl, GatewayInfo, InfoResponse } from './types.js';

/**
 * Derive the ISO-3166-1 alpha-2 country code from a Flux app-spec name.
 * Spec names are `cumulusvpn<cc>` (e.g. `cumulusvpnde` -> `DE`).
 */
export function specToCountryCode(spec: string): string {
  return spec.replace(/^cumulusvpn/, '').toUpperCase();
}

/** Public Flux app-location index. */
const FLUX_API = 'https://api.runonflux.io';
/** Port a Flux node exposes its own app-location index on. */
const FLUX_NODE_PORT = 16127;

const encoder = new TextEncoder();

/** Shape of the Flux `/apps/location/<spec>` payload we consume. */
interface FluxLocationEntry {
  readonly ip: string;
}

/**
 * Strip a `:port` suffix from a Flux `ip` field. The value may be `"1.2.3.4"`
 * or `"1.2.3.4:16127"`; IPv6 forms are returned unchanged.
 */
function stripPort(ip: string): string {
  const trimmed = ip.trim();
  // Leave IPv6 (multiple colons) alone; only strip a single trailing :port.
  if (trimmed.includes(':') && trimmed.split(':').length === 2) {
    return trimmed.slice(0, trimmed.indexOf(':'));
  }
  return trimmed;
}

/** Fetch and normalise one `/apps/location/<spec>` index; never throws. */
async function fetchLocation(url: string, fetchImpl: FetchImpl): Promise<string[]> {
  try {
    const res = await fetchImpl(url);
    const body = (await res.json()) as { data?: readonly FluxLocationEntry[] };
    if (!body.data) {
      return [];
    }
    return body.data.map((e) => stripPort(e.ip)).filter((ip) => ip.length > 0);
  } catch {
    return [];
  }
}

/** Probe a candidate's `/v1/info`, verifying its signed body; null if unusable. */
async function probe(ip: string, fetchImpl: FetchImpl): Promise<GatewayInfo | null> {
  const controlUrl = `http://${ip}:${CONTROL_PORT}`;
  try {
    const { data } = await fetchSigned<InfoResponse>(`${controlUrl}/v1/info`, fetchImpl);
    return { ...data, ip, controlUrl };
  } catch {
    return null;
  }
}

/**
 * Discover reachable CumulusVPN gateways from the Flux network.
 *
 * For every spec name the fleet is resolved from `api.runonflux.io` and, for
 * redundancy, from any extra Flux `nodes` (queried directly at `:16127`). The
 * union of candidate IPs is de-duplicated, each is probed at `/v1/info`, and
 * only signature-verified, reachable gateways are kept. Results are grouped by
 * country and sorted by load (ascending) so the caller can pick the least-busy
 * gateway in a given country.
 *
 * @param specNames - Flux app-spec names, e.g. `["cumulusvpnde", "cumulusvpnus"]`.
 * @param options - Optional extra Flux nodes and a custom fetch implementation.
 * @returns Verified gateways, grouped by country and sorted by load.
 */
export async function discoverGateways(
  specNames: readonly string[],
  options: DiscoverOptions = {},
): Promise<GatewayInfo[]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const nodes = options.nodes ?? [];

  // Map each candidate gateway IP to the country of the spec it was discovered
  // under (cumulusvpn<cc> -> CC). This is the AUTHORITATIVE country: Flux places
  // each spec only on nodes in its `geolocation` (acEU_DE, …), whereas the
  // gateway's own /v1/info carries no geo (hostinfo is unavailable inside the
  // Flux container), so it reports an empty country. Keeping the spec→country
  // link here is what lets the clients group gateways under a country at all.
  const ipCountry = new Map<string, string>();
  await Promise.all(
    specNames.map(async (spec) => {
      const cc = specToCountryCode(spec);
      const urls = [`${FLUX_API}/apps/location/${spec}`];
      for (const node of nodes) {
        urls.push(`http://${node}:${FLUX_NODE_PORT}/apps/location/${spec}`);
      }
      const lists = await Promise.all(urls.map((url) => fetchLocation(url, fetchImpl)));
      for (const list of lists) {
        for (const ip of list) {
          if (!ipCountry.has(ip)) {
            ipCountry.set(ip, cc);
          }
        }
      }
    }),
  );

  const probed = await Promise.all([...ipCountry.keys()].map((ip) => probe(ip, fetchImpl)));
  const gateways = probed
    .filter((g): g is GatewayInfo => g !== null)
    .map((g) => ({ ...g, country: ipCountry.get(g.ip) || g.country }));

  // Group by country, then order least-loaded first (latency tiebreak is a
  // POC: probe timing is not yet captured; load is a good enough proxy).
  gateways.sort((a, b) => {
    if (a.country !== b.country) {
      return a.country < b.country ? -1 : 1;
    }
    return a.load - b.load;
  });

  return gateways;
}

/**
 * Serialize a value to canonical JSON with recursively sorted object keys and
 * no insignificant whitespace, so a signer and verifier agree on the bytes.
 *
 * POC: this is a pragmatic canonicalizer (sorted keys, `JSON`-compatible number
 * formatting) — not full RFC 8785 JCS. It is sufficient for the directory
 * schema, whose values are strings, small integers and arrays of strings.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * Verify a signed `directory.json` against the directory Ed25519 public key.
 *
 * The signature covers the canonical JSON of every field except `sig`. Clients
 * ship `CVPN_DIRECTORY_PUBKEY` and reject any directory that does not verify,
 * so the disk cache and bundled snapshot cannot be tampered with.
 *
 * @param directory - The directory object, including its `sig` field.
 * @param publicKeyB64 - Base64 Ed25519 directory public key.
 * @returns `true` if the signature is valid.
 */
export function directoryVerify(directory: Directory, publicKeyB64: string): boolean {
  try {
    // Verify over every field EXCEPT the signature envelope (`sig`, `sign_pubkey`)
    // and `//` JSON-comment keys — this MUST match the signer,
    // deploy/directory/make-directory.mjs. `sign_pubkey` is metadata: the client
    // trusts its PINNED key (publicKeyB64), not this field, so it is deliberately
    // excluded from the signed payload. (Stripping only `sig` — the old behaviour —
    // included sign_pubkey and made every real, signed directory fail to verify.)
    const unsigned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(directory)) {
      if (k === 'sig' || k === 'sign_pubkey' || k.startsWith('//')) continue;
      unsigned[k] = v;
    }
    const message = encoder.encode(canonicalJson(unsigned));
    return ed25519.verify(base64.decode(directory.sig), message, base64.decode(publicKeyB64));
  } catch {
    return false;
  }
}
