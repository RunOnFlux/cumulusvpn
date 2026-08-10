/**
 * `@cumulusvpn/core` — the canonical CumulusVPN client logic shared by the web,
 * desktop and mobile apps: key generation, payment-code derivation,
 * proof-of-work, signed-response verification, gateway discovery, enrollment,
 * and WireGuard config generation. Implements `docs/10-api-contract.md`.
 *
 * @packageDocumentation
 */

export { generateKeypair, publicKeyFromPrivate } from './keys.js';
export {
  paymentCode,
  paymentMemo,
  appAccountToken,
  walletDeepLink,
  walletDeepLinks,
  WALLET_SCHEMES,
} from './paymentCode.js';
export type { WalletScheme } from './paymentCode.js';
export {
  createStripeCheckout,
  verifyApplePurchase,
  verifyGooglePurchase,
  paymentStatus,
  redeemVoucher,
  DEFAULT_BRIDGE_URL,
} from './bridge.js';
export type {
  PaymentPlan,
  BridgePayment,
  BridgePaymentStatus,
  PaymentStatusResult,
  BridgeOptions,
  RedeemOutcome,
} from './bridge.js';
export { hasLeadingZeroBits, powHash, solvePoW, verifyPoW } from './pow.js';
export { verifySignedResponse } from './sign.js';
export { discoverGateways, directoryVerify } from './discovery.js';
export { enroll, status } from './enroll.js';
export { buildWgConfig } from './wgconfig.js';
export { selectHops, buildMultihopConfig } from './multihop.js';
export { gatewayQuality } from './quality.js';
export type { GatewayQuality, QualityTone } from './quality.js';
export { pingGateway } from './probe.js';
export type { PingResult } from './probe.js';
export { checkIssuedConfig } from './confhealth.js';
export type { ConfHealth, IssuedConfigRef } from './confhealth.js';
export type {
  RouteStyle,
  Hop,
  SelectHopsOptions,
  SelectedHops,
  MultihopConfig,
} from './multihop.js';
export {
  EMPTY_POLICY,
  LAN_BYPASS_CIDRS,
  compileSplitPolicy,
  complementRoutes,
  normalizeSplitRule,
  sanitizeSplitPolicy,
} from './split.js';
export type {
  CompiledSplit,
  CompileSplitContext,
  DomainMatcher,
  SplitMode,
  SplitPlatform,
  SplitPolicy,
  SplitRule,
  SplitRuleContext,
  SplitRuleKind,
} from './split.js';
export { ApiError } from './http.js';
export type { SignedResult } from './http.js';

export { CONTROL_PORT, WG_PORT, POW_BITS, MEMO_PREFIX } from './types.js';
export {
  selectTransport,
  requireTransport,
  transportFallbackChain,
  applyTransportToEndpoint,
  obfsForTransport,
  hasPremiumTransport,
  IMPLEMENTED_TRANSPORTS,
} from './transport.js';
export type { TransportMode } from './transport.js';
export type {
  Keypair,
  ApiEnvelope,
  ApiErrorData,
  Transport,
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
