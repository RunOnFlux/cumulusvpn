/**
 * Shared wire + domain types for `@cumulusvpn/core`.
 *
 * Field names on wire types (e.g. {@link InfoResponse}, {@link EnrollResponse})
 * are `snake_case` to match the gateway control API byte-for-byte
 * (see `docs/10-api-contract.md`). Do not rename them — they are parsed
 * directly from JSON and any divergence silently breaks interop.
 */

/** Fixed control-API port (HTTP, signed bodies). */
export const CONTROL_PORT = 51821;

/** Fixed WireGuard listen port (UDP, TCP auto). */
export const WG_PORT = 51820;

/** Default proof-of-work difficulty in leading zero bits. */
export const POW_BITS = 20;

/** Memo prefix that tags a CumulusVPN premium payment. */
export const MEMO_PREFIX = 'CVPN1:';

/** A WireGuard Curve25519 keypair, standard-base64 encoded (with padding). */
export interface Keypair {
  /** X25519 public key, 32 bytes, `base64.StdEncoding`. */
  readonly publicKey: string;
  /** X25519 private key (clamped scalar), 32 bytes, `base64.StdEncoding`. */
  readonly privateKey: string;
}

/** Discriminated success/error envelope every CumulusVPN API returns. */
export type ApiEnvelope<T> =
  | { readonly status: 'success'; readonly data: T }
  | { readonly status: 'error'; readonly data: ApiErrorData };

/** Body of an error envelope. */
export interface ApiErrorData {
  /** HTTP status as a string, e.g. `"429"`. */
  readonly code: string;
  /** Machine-readable slug, e.g. `"rate_limited"`. */
  readonly name: string;
  /** Human-readable message. */
  readonly message: string;
}

/**
 * One dialable transport a gateway advertises for DPI-resistance negotiation.
 * `type` is a stable slug (`"wg"` = vanilla WireGuard; `"awg"` = AmneziaWG;
 * `"wg-tls"` = WireGuard-over-TLS); `port` is where it listens; `params` carries
 * transport-specific knobs (e.g. AmneziaWG obfuscation values), absent for `wg`.
 * Clients ignore types they do not implement. Field names are snake-case-free
 * here because they are nested inside the snake_case wire body verbatim.
 */
export interface Transport {
  readonly type: string;
  readonly port: number;
  readonly params?: Readonly<Record<string, string>>;
}

/** `GET /v1/info` response `data`. */
export interface InfoResponse {
  readonly country: string;
  readonly region: string;
  readonly city: string;
  /** 0..1 utilisation estimate. */
  readonly load: number;
  /** Remaining peer slots. */
  readonly capacity: number;
  readonly version: string;
  readonly min_client_version: string;
  /** Short git commit the gateway image was built from (ldflags). Optional —
   *  older gateway images may omit it. */
  readonly build_commit?: string;
  /** Gateway WireGuard public key, base64. */
  readonly server_pubkey: string;
  /** Gateway Ed25519 signing public key, base64. */
  readonly sign_pubkey: string;
  /** Transports this gateway can serve (DPI-resistance negotiation). ABSENT on
   *  a pre-negotiation (0.1.0) gateway — the client then assumes vanilla WG on
   *  {@link WG_PORT}. See `transport.ts`. */
  readonly transports?: readonly Transport[];
}

/** `POST /v1/enroll` response `data`. */
export interface EnrollResponse {
  readonly server_pubkey: string;
  /** `<nodeIP>:51820`. */
  readonly endpoint: string;
  /** `10.8.x.y`. */
  readonly assigned_ip: string;
  readonly dns: string;
  readonly payment_address: string;
  /** `CVPN1:<code>`. */
  readonly payment_memo: string;
  readonly price_flux: number;
}

/** Subscription tier. */
export type Tier = 'free' | 'premium';

/** `GET /v1/status/{pubkey}` response `data`. */
export interface StatusResponse {
  readonly tier: Tier;
  /** RFC3339 timestamp premium is paid through. */
  readonly paid_until: string;
  readonly bytes_used: number;
}

/** A reachable, signature-verified gateway discovered on the Flux network. */
export interface GatewayInfo extends InfoResponse {
  /** Public IP of the gateway (port stripped). */
  readonly ip: string;
  /** `http://<ip>:51821` control-API base URL. */
  readonly controlUrl: string;
}

/** A last-known gateway baked into the signed directory snapshot. */
export interface SeedGateway {
  readonly ip: string;
  readonly country: string;
  readonly sign_pubkey: string;
}

/** Signed `directory.json` published at cumulusvpn.com and bundled in clients. */
export interface Directory {
  readonly version: number;
  readonly updated: string;
  readonly payment_address: string;
  readonly price_flux: number;
  readonly specs: readonly string[];
  readonly seed_gateways: readonly SeedGateway[];
  /** base64 Ed25519 over the canonical JSON of every field except `sig`. */
  readonly sig: string;
}

/**
 * A `fetch`-compatible function. Defaults to the global `fetch`; inject a mock
 * in tests or a platform shim (React Native, Tauri) at runtime.
 */
export type FetchImpl = typeof fetch;

/** Options for {@link discoverGateways}. */
export interface DiscoverOptions {
  /** Extra Flux node IPs to query directly at `:16127` for redundancy. */
  readonly nodes?: readonly string[];
  /** Override the fetch implementation. */
  readonly fetchImpl?: FetchImpl;
}

/** Options for {@link enroll} and {@link status}. */
export interface EnrollOptions {
  /** Override the fetch implementation. */
  readonly fetchImpl?: FetchImpl;
  /** Proof-of-work difficulty; defaults to {@link POW_BITS}. */
  readonly powBits?: number;
  /**
   * Override the proof-of-work solver. The default JS solver runs ~1M SHA-256
   * hashes on the calling thread — seconds on a phone's Hermes engine, which
   * both stalls the connect and janks the UI. Native clients pass a solver that
   * loops in Kotlin/Swift (millions of hashes/sec, off the JS thread), so a
   * 20-bit solve finishes in well under a second. Must satisfy the same
   * contract as core `solvePoW` (return a decimal-string nonce whose
   * `sha256(pubkey||nonce)` has `bits` leading zero bits).
   */
  readonly powSolver?: (publicKeyB64: string, bits: number) => Promise<string>;
  /**
   * Pinned gateway signing pubkey (base64). When set, the response signature
   * must verify against it; otherwise the pubkey advertised in the response
   * header is trusted on first use.
   */
  readonly signPubKey?: string;
}

/** Inputs for {@link buildWgConfig}. */
export interface WgConfigParams {
  /** Client WireGuard private key, base64. */
  readonly privateKey: string;
  /** Tunnel address assigned by the gateway, e.g. `10.8.0.2`. */
  readonly assignedIp: string;
  /** DNS server the client should use inside the tunnel. */
  readonly dns: string;
  /** Gateway WireGuard public key, base64. */
  readonly serverPubKey: string;
  /** `<nodeIP>:51820`. */
  readonly endpoint: string;
  /**
   * AmneziaWG obfuscation params for an `awg` transport (the lowercase
   * `jc`/`jmin`/…/`h4` map from `/v1/info` transports[].params). When present,
   * {@link buildWgConfig} emits the matching `[Interface]` lines; absent for the
   * vanilla and `wg-tls` transports. Use {@link obfsForTransport} to derive it.
   */
  readonly obfs?: Readonly<Record<string, string>>;
}
