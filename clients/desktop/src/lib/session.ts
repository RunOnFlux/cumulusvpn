/**
 * Session orchestration: turns `@cumulusvpn/core` primitives (discovery,
 * enrollment, WG config) plus the native tunnel bridge into the two operations
 * the UI needs — enumerate countries, and connect/disconnect.
 *
 * Discovery order matches the contract: live Flux discovery first, bundled
 * signed snapshot as the cold-start fallback (`docs/10-api-contract.md`).
 */
import {
  buildMultihopConfig,
  buildWgConfig,
  discoverGateways,
  enroll,
  selectHops,
  status as entitlementStatus,
} from '@cumulusvpn/core';
import type {
  EnrollResponse,
  GatewayInfo,
  Keypair,
  RouteStyle,
  StatusResponse,
} from '@cumulusvpn/core';
import { BUNDLED_DIRECTORY, countryMeta } from './directory.js';
import * as tunnel from './tauri.js';
import type { TunnelStatus } from './tauri.js';

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
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Enumerate connectable countries. Tries live Flux discovery across the bundled
 * spec names; if nothing is reachable, falls back to the bundled directory's
 * seed gateways so the picker is never empty offline.
 *
 * // POC: the offline fallback yields countries with no live `/v1/info` metrics
 * (load defaults to 0, city empty); a real client also reads a TTL disk cache
 * ahead of live discovery.
 */
export async function discoverCountries(fetchImpl?: typeof fetch): Promise<CountryOption[]> {
  const options = fetchImpl ? { fetchImpl } : {};
  const gateways = await discoverGateways(BUNDLED_DIRECTORY.specs, options);
  if (gateways.length > 0) {
    return toCountryOptions(gateways);
  }
  // Offline cold-start: synthesize options from the signed seed list. Skip the
  // 0.0.0.0 placeholder seeds (live discovery resolves real IPs), matching the
  // mobile client — better to show nothing than an unconnectable gateway.
  return BUNDLED_DIRECTORY.seed_gateways
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
}

/** Per-gateway enroll options: attach the pinned sign key + any fetch override. */
function enrollOptsFor(country: CountryOption, fetchImpl?: typeof fetch) {
  return {
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(country.signPubKey ? { signPubKey: country.signPubKey } : {}),
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
  fetchImpl?: typeof fetch,
): Promise<EstablishResult> {
  const enrollOpts = enrollOptsFor(country, fetchImpl);
  const reply = await enroll(country.gatewayIp, keypair.publicKey, enrollOpts);

  const wgConfig = buildWgConfig({
    privateKey: keypair.privateKey,
    assignedIp: reply.assigned_ip,
    dns: reply.dns,
    serverPubKey: reply.server_pubkey,
    endpoint: reply.endpoint,
  });

  const tunnelStatus = await tunnel.connect({
    country: country.code,
    wgConfig,
    endpoint: reply.endpoint,
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
 * @param entryCountry - The user's chosen ENTRY (sees real IP, not destination).
 * @param exitCountry - The user's chosen EXIT (sees destination, not real IP).
 * @param style - `'multihop-same-country'` or `'multihop-cross-jurisdiction'`.
 * @throws {Error} If `selectHops` can't satisfy the style (e.g. no distinct
 *   exit, or same country when cross-jurisdiction was asked).
 */
export async function establishMultihop(
  entryCountry: CountryOption,
  exitCountry: CountryOption,
  style: RouteStyle,
  keypair: Keypair,
  killSwitch: boolean,
  fetchImpl?: typeof fetch,
): Promise<MultihopResult> {
  // Let the core contract pick + validate the ordered hops from the two picks.
  const hops = selectHops([toGatewayInfo(entryCountry), toGatewayInfo(exitCountry)], style, {
    entryCountry: entryCountry.code,
    exitCountry: exitCountry.code,
  });
  if (!hops.exit) {
    throw new Error('multi-hop requires a distinct exit hop');
  }

  // Enroll the SAME key K at both gateways — one payment, premium follows K.
  const entryReply = await enroll(
    hops.entry.ip,
    keypair.publicKey,
    enrollOptsFor(entryCountry, fetchImpl),
  );
  const exitReply = await enroll(
    hops.exit.ip,
    keypair.publicKey,
    enrollOptsFor(exitCountry, fetchImpl),
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
