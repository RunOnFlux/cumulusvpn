/**
 * `@cumulusvpn/core` — the canonical CumulusVPN client logic shared by the web,
 * desktop and mobile apps: key generation, payment-code derivation,
 * proof-of-work, signed-response verification, gateway discovery, enrollment,
 * and WireGuard config generation. Implements `docs/10-api-contract.md`.
 *
 * @packageDocumentation
 */

export { generateKeypair, publicKeyFromPrivate } from './keys.js';
export { paymentCode, paymentMemo, walletDeepLink } from './paymentCode.js';
export { hasLeadingZeroBits, powHash, solvePoW, verifyPoW } from './pow.js';
export { verifySignedResponse } from './sign.js';
export { discoverGateways, directoryVerify } from './discovery.js';
export { enroll, status } from './enroll.js';
export { buildWgConfig } from './wgconfig.js';
export { selectHops, buildMultihopConfig } from './multihop.js';
export { gatewayQuality } from './quality.js';
export type { GatewayQuality, QualityTone } from './quality.js';
export type {
  RouteStyle,
  Hop,
  SelectHopsOptions,
  SelectedHops,
  MultihopConfig,
} from './multihop.js';
export { ApiError } from './http.js';
export type { SignedResult } from './http.js';

export { CONTROL_PORT, WG_PORT, POW_BITS, MEMO_PREFIX } from './types.js';
export type {
  Keypair,
  ApiEnvelope,
  ApiErrorData,
  InfoResponse,
  EnrollResponse,
  Tier,
  StatusResponse,
  GatewayInfo,
  SeedGateway,
  Directory,
  FetchImpl,
  DiscoverOptions,
  EnrollOptions,
  WgConfigParams,
} from './types.js';
