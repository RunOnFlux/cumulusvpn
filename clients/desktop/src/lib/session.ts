/**
 * Session orchestration: turns `@cumulusvpn/core` primitives (discovery,
 * enrollment, WG config) plus the native tunnel bridge into the two operations
 * the UI needs — enumerate countries, and connect/disconnect.
 *
 * Discovery order matches the contract: live Flux discovery first, bundled
 * signed snapshot as the cold-start fallback (`docs/10-api-contract.md`).
 */
import {
  applyTransportToEndpoint,
  buildMultihopConfig,
  buildWgConfig,
  discoverGateways,
  enroll,
  obfsForTransport,
  requireTransport,
  selectHops,
  status as entitlementStatus,
} from '@cumulusvpn/core';
import type {
  EnrollResponse,
  GatewayInfo,
  Keypair,
  RouteStyle,
  StatusResponse,
  Transport,
  TransportMode,
} from '@cumulusvpn/core';
import { isTauri } from '@tauri-apps/api/core';
import { BUNDLED_DIRECTORY, countryMeta } from './directory.js';
import * as tunnel from './tauri.js';
import type { TunnelStatus } from './tauri.js';

/**
 * Transport slugs the desktop tunnel can dial. The wireguard-go sidecar is the
 * amneziawg-go build (a superset — vanilla with no params), so it can do `awg`.
 * `wg-tls` awaits the Rust TLS bridge. Passed to core `selectTransport`.
 */
const IMPLEMENTED_TRANSPORTS: ReadonlySet<string> = new Set(['wg', 'awg']);

/**
 * Enroll at a gateway — or, when running outside Tauri (a plain browser: dev,
 * Storybook, the headless UI render), return a mock enrollment. The gateway
 * fetch isn't reachable/CORS-allowed from a browser, so this keeps the *whole*
 * flow (through the connected state) demoable, mirroring the mock tunnel in
 * `tauri.js`. No effect in the shipped desktop app (`isTauri()` is true there).
 */
async function enrollOrMock(
  gatewayIp: string,
  publicKey: string,
  options: ReturnType<typeof enrollOptsFor>,
): Promise<EnrollResponse> {
  if (isTauri()) {
    return enroll(gatewayIp, publicKey, options);
  }
  return {
    server_pubkey: '2YOz4coIWsUlxKe3TNGFZqri7gX0nDJECrJ8olPG/AA=',
    endpoint: `${gatewayIp}:51820`,
    assigned_ip: '10.8.0.2',
    dns: '1.1.1.1',
    payment_address: BUNDLED_DIRECTORY.payment_address,
    payment_memo: 'CVPN1:demo',
    price_flux: BUNDLED_DIRECTORY.price_flux,
  };
}

/** A pickable location in the UI, backed by the least-loaded gateway there. */
export interface CountryOption {
  readonly code: string;
  readonly name: string;
  readonly flag: string;
  /** The chosen gateway IP for this country (least-loaded). */
  readonly gatewayIp: string;
  /** City the gateway reports, for the subtitle line. */
  readonly city: string;
  /** 0..1 utilisation, for the latency-dot colour proxy. */
  readonly load: number;
  /** Gateway signing pubkey (base64) learned from `/v1/info`, for pinning. */
  readonly signPubKey: string;
  /** Transports this gateway advertises (DPI-resistance negotiation); absent for
   *  a 0.1.0 gateway or the offline seed fallback. */
  readonly transports?: readonly Transport[];
}

/** Result of bringing a tunnel up: the gateway's enroll reply + native status. */
export interface EstablishResult {
  readonly gatewayIp: string;
  readonly enroll: EnrollResponse;
  readonly tunnel: TunnelStatus;
}

/**
 * Result of bringing a **multi-hop** tunnel up. Both hops enroll the *same* key
 * `K` (one payment covers both — entitlement follows the key on every gateway).
 * The `exit` gateway is the one that meters egress traffic, so entitlement is
 * polled there.
 */
export interface MultihopResult {
  readonly entryGatewayIp: string;
  readonly exitGatewayIp: string;
  /**
   * The ACTUAL exit gateway's signing pubkey, for entitlement polling. This is
   * `hops.exit.sign_pubkey`, not the user-picked exit CountryOption's key — for a
   * same-country route the exit is auto-chosen within the entry country, so the
   * picked country's key would fail signature verification against the real exit.
   */
  readonly exitSignPubKey: string;
  readonly entryEnroll: EnrollResponse;
  readonly exitEnroll: EnrollResponse;
  readonly tunnel: TunnelStatus;
}

/** Least-loaded gateway per country → a stable, de-duplicated country list. */
function toCountryOptions(gateways: readonly GatewayInfo[]): CountryOption[] {
  const best = new Map<string, GatewayInfo>();
  for (const g of gateways) {
    const current = best.get(g.country);
    if (!current || g.load < current.load) {
      best.set(g.country, g);
    }
  }
  return [...best.values()]
    .map((g): CountryOption => {
      const meta = countryMeta(g.country);
      return {
        code: g.country,
        name: meta.name,
        flag: meta.flag,
        gatewayIp: g.ip,
        city: g.city,
        load: g.load,
        signPubKey: g.sign_pubkey,
        ...(g.transports ? { transports: g.transports } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Discovery result: the collapsed picker rows plus the full underlying fleet. */
export interface FleetDiscovery {
  /** One least-loaded row per country, for the picker. */
  readonly countries: CountryOption[];
  /**
   * Every discovered gateway (several per country). Multi-hop hop selection
   * needs this — the collapsed one-per-country `countries` can't supply a second
   * distinct gateway for a same-country ("Balanced") route. Empty for the
   * browser-demo / offline-seed fallbacks (no live fleet).
   */
  readonly fleet: readonly GatewayInfo[];
}

/**
 * Discover the fleet: the full gateway list AND the collapsed per-country picker
 * rows, in a single discovery pass. Tries live Flux discovery across the bundled
 * spec names; if nothing is reachable, falls back to the bundled directory's
 * seed gateways so the picker is never empty offline.
 *
 * // POC: the offline fallback yields countries with no live `/v1/info` metrics
 * (load defaults to 0, city empty); a real client also reads a TTL disk cache
 * ahead of live discovery.
 */
export async function discoverFleetAndCountries(fetchImpl?: typeof fetch): Promise<FleetDiscovery> {
  const options = fetchImpl ? { fetchImpl } : {};
  const gateways = await discoverGateways(BUNDLED_DIRECTORY.specs, options);
  if (gateways.length > 0) {
    return { countries: toCountryOptions(gateways), fleet: gateways };
  }
  // Browser demo (dev / Storybook / headless render): the Flux discovery API
  // isn't reachable from a plain browser, so synthesize the fleet's countries
  // from the signed directory specs. No effect in the shipped app.
  if (!isTauri()) {
    const countries = BUNDLED_DIRECTORY.specs
      .map((spec): CountryOption => {
        const code = spec.replace(/^cumulusvpn/, '').toUpperCase();
        const meta = countryMeta(code);
        return {
          code,
          name: meta.name,
          flag: meta.flag,
          gatewayIp: '10.0.0.1',
          city: 'demo',
          load: 0.2,
          signPubKey: '',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { countries, fleet: [] };
  }
  // Offline cold-start: synthesize options from the signed seed list. Skip the
  // 0.0.0.0 placeholder seeds (live discovery resolves real IPs), matching the
  // mobile client — better to show nothing than an unconnectable gateway.
  const countries = BUNDLED_DIRECTORY.seed_gateways
    .filter((seed) => seed.ip !== '0.0.0.0')
    .map((seed): CountryOption => {
      const meta = countryMeta(seed.country);
      return {
        code: seed.country,
        name: meta.name,
        flag: meta.flag,
        gatewayIp: seed.ip,
        city: '',
        load: 0,
        signPubKey: seed.sign_pubkey,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { countries, fleet: [] };
}

/** Enumerate connectable countries (the collapsed picker rows). */
export async function discoverCountries(fetchImpl?: typeof fetch): Promise<CountryOption[]> {
  return (await discoverFleetAndCountries(fetchImpl)).countries;
}

/** Per-gateway enroll options: attach the pinned sign key + any fetch override. */
function enrollOptsFor(country: CountryOption, fetchImpl?: typeof fetch) {
  return {
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(country.signPubKey ? { signPubKey: country.signPubKey } : {}),
  };
}

/** Enroll options from a live {@link GatewayInfo} (multi-hop hops come from the fleet). */
function enrollOptsForGateway(g: GatewayInfo, fetchImpl?: typeof fetch) {
  return {
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(g.sign_pubkey ? { signPubKey: g.sign_pubkey } : {}),
  };
}

/**
 * Reconstruct a minimal {@link GatewayInfo} from a picked {@link CountryOption}
 * so `selectHops` can validate + order the route. `selectHops` reads only
 * `ip`, `country`, and `load`; the remaining `/v1/info` fields are filled from
 * what the picker carries (the sign key it pinned) with POC defaults for the
 * rest — the collapsed picker surfaces one gateway per country.
 */
function toGatewayInfo(country: CountryOption): GatewayInfo {
  return {
    ip: country.gatewayIp,
    controlUrl: `http://${country.gatewayIp}:51821`,
    country: country.code,
    region: '',
    city: country.city,
    load: country.load,
    capacity: 0,
    version: '',
    min_client_version: '',
    server_pubkey: '',
    sign_pubkey: country.signPubKey,
  };
}

/**
 * Enroll the device key at the country's gateway, render the WireGuard config
 * with the core contract builder, and hand it to the native sidecar to bring
 * the tunnel up.
 */
export async function establish(
  country: CountryOption,
  keypair: Keypair,
  killSwitch: boolean,
  transportMode: TransportMode = 'auto',
  fetchImpl?: typeof fetch,
): Promise<EstablishResult> {
  // Transport negotiation (docs/15): pick the transport for the mode this
  // gateway advertises BEFORE enrolling, so a Stealth request against a
  // vanilla-only location fails fast without spending an enrollment.
  // `requireTransport` THROWS rather than falling back to vanilla, so Stealth
  // never silently downgrades to fingerprintable plain WG (Auto still resolves
  // to :51820 — vanilla is its floor). `obfs` is set only for `awg`.
  const transport = requireTransport(country.transports, transportMode, IMPLEMENTED_TRANSPORTS);

  const enrollOpts = enrollOptsFor(country, fetchImpl);
  const reply = await enrollOrMock(country.gatewayIp, keypair.publicKey, enrollOpts);

  const endpoint = applyTransportToEndpoint(reply.endpoint, transport);
  const obfs = obfsForTransport(transport);

  const wgConfig = buildWgConfig({
    privateKey: keypair.privateKey,
    assignedIp: reply.assigned_ip,
    dns: reply.dns,
    serverPubKey: reply.server_pubkey,
    endpoint,
    ...(obfs ? { obfs } : {}),
  });

  // Hand the tunnel the CHOSEN transport endpoint (not the vanilla reply), so the
  // kill switch and endpoint bypass allow the port the sidecar actually dials
  // (e.g. awg on :51821). Passing reply.endpoint (:51820) would make the kill
  // switch drop the awg handshake.
  const tunnelStatus = await tunnel.connect({
    country: country.code,
    wgConfig,
    endpoint,
    assignedIp: reply.assigned_ip,
    killSwitch,
  });

  return { gatewayIp: country.gatewayIp, enroll: reply, tunnel: tunnelStatus };
}

/**
 * Bring up an opt-in **multi-hop** tunnel (`docs/11-multihop.md`).
 *
 * Uses the core contract end to end: `selectHops` orders + validates the pair
 * for the chosen {@link RouteStyle} (rejects entry == exit; enforces
 * cross-jurisdiction when asked), then the *same* key `K` is enrolled at BOTH
 * the entry and exit gateways — one payment covers both, since entitlement
 * follows the key on every gateway, so no gateway protocol change is needed.
 * `buildMultihopConfig` renders the two nested WireGuard interfaces (outer to
 * ENTRY, `AllowedIPs = <exitIp>/32`, MTU 1420; inner to EXIT, default route,
 * MTU 1340, exit DNS), which the native `connectMultihop` command runs as two
 * stacked wireguard-go devices.
 *
 * @param fleet - The full discovered fleet (from {@link discoverFleetAndCountries});
 *   hop selection needs several gateways per country. Falls back to the two
 *   picked rows only when the live fleet is unavailable (offline/browser-demo).
 * @param entryCountry - The user's chosen ENTRY (sees real IP, not destination).
 * @param exitCountry - The user's chosen EXIT (sees destination, not real IP).
 * @param style - `'multihop-same-country'` or `'multihop-cross-jurisdiction'`.
 * @throws {Error} If `selectHops` can't satisfy the style (e.g. no distinct
 *   exit, or same country when cross-jurisdiction was asked).
 */
export async function establishMultihop(
  fleet: readonly GatewayInfo[],
  entryCountry: CountryOption,
  exitCountry: CountryOption,
  style: RouteStyle,
  keypair: Keypair,
  killSwitch: boolean,
  transportMode: TransportMode = 'auto',
  fetchImpl?: typeof fetch,
): Promise<MultihopResult> {
  // Stealth over multi-hop isn't wired end-to-end yet (the obfuscated entry hop
  // needs obfs params threaded through buildMultihopConfig + the native chained
  // sidecars). Until it is, refuse rather than silently run the entry hop as
  // plain WireGuard — Stealth must never downgrade.
  if (transportMode !== 'auto') {
    throw new Error(
      'Stealth mode isn’t available with multi-hop yet. Turn off multi-hop, or switch to Auto.',
    );
  }
  // Hop selection needs the FULL fleet (several gateways per country); the
  // collapsed one-per-country picker rows can't supply a distinct second gateway
  // for a same-country route. Fall back to the two picked rows only offline.
  const candidates: readonly GatewayInfo[] =
    fleet.length > 0 ? fleet : [toGatewayInfo(entryCountry), toGatewayInfo(exitCountry)];

  // Same-country ("Balanced"): let selectHops choose the second hop WITHIN the
  // entry's country — don't pin the exit to a different picked country, which
  // would be unsatisfiable. Cross-jurisdiction: honor both country picks.
  const hopOpts =
    style === 'multihop-same-country'
      ? { entryCountry: entryCountry.code }
      : { entryCountry: entryCountry.code, exitCountry: exitCountry.code };
  const hops = selectHops(candidates, style, hopOpts);
  if (!hops.exit) {
    throw new Error('multi-hop requires a distinct exit hop');
  }

  // Enroll the SAME key K at both gateways — one payment, premium follows K.
  const entryReply = await enrollOrMock(
    hops.entry.ip,
    keypair.publicKey,
    enrollOptsForGateway(hops.entry, fetchImpl),
  );
  const exitReply = await enrollOrMock(
    hops.exit.ip,
    keypair.publicKey,
    enrollOptsForGateway(hops.exit, fetchImpl),
  );

  const cfg = buildMultihopConfig({
    privateKey: keypair.privateKey,
    entry: entryReply,
    exit: exitReply,
  });

  const tunnelStatus = await tunnel.connectMultihop({
    entryCountry: hops.entry.country,
    exitCountry: hops.exit.country,
    outer: cfg.outer,
    inner: cfg.inner,
    entryEndpoint: entryReply.endpoint,
    exitEndpoint: cfg.exitEndpoint,
    innerMtu: cfg.innerMtu,
    assignedIp: exitReply.assigned_ip,
    killSwitch,
  });

  return {
    entryGatewayIp: hops.entry.ip,
    exitGatewayIp: hops.exit.ip,
    exitSignPubKey: hops.exit.sign_pubkey,
    entryEnroll: entryReply,
    exitEnroll: exitReply,
    tunnel: tunnelStatus,
  };
}

/** Tear down the tunnel and remove kill-switch rules. */
export async function teardown(): Promise<TunnelStatus> {
  return tunnel.disconnect();
}

/**
 * Fetch the device's chain-derived entitlement (tier / paid-until / bytes) from
 * the gateway. Neutral status fact — safe to poll from any client.
 */
export async function fetchEntitlement(
  gatewayIp: string,
  publicKeyB64: string,
  signPubKey: string,
  fetchImpl?: typeof fetch,
): Promise<StatusResponse> {
  const opts = {
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(signPubKey ? { signPubKey } : {}),
  };
  return entitlementStatus(gatewayIp, publicKeyB64, opts);
}
