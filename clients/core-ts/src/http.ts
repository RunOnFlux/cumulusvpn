import { verifySignedResponse } from './sign.js';
import type { ApiEnvelope, ApiErrorData, FetchImpl } from './types.js';

const decoder = new TextDecoder();

/** Error thrown when a CumulusVPN API returns an `{status:'error'}` envelope. */
export class ApiError extends Error {
  /** HTTP status as a string, e.g. `"429"`. */
  readonly code: string;
  /** Error name, fixed to `"ApiError"`. */
  override readonly name = 'ApiError';
  /** Slug from the error body (duplicate of the wire `name`). */
  readonly slug: string;

  constructor(data: ApiErrorData) {
    super(data.message);
    this.code = data.code;
    this.slug = data.name;
  }
}

/** A verified control-API result: the parsed data plus signature provenance. */
export interface SignedResult<T> {
  /** Parsed `data` from a success envelope. */
  readonly data: T;
  /** The gateway signing pubkey advertised in `X-CVPN-Sign-PubKey`, if any. */
  readonly signPubKey: string | null;
  /** Whether the Ed25519 body signature verified. */
  readonly verified: boolean;
}

/**
 * Fetch a signed CumulusVPN control-API endpoint, verifying the Ed25519
 * signature over the exact response bytes.
 *
 * Success bodies are verified; error bodies (which the gateway does not sign)
 * are surfaced as an {@link ApiError}. When `pinnedSignPubKey` is provided the
 * signature must verify against it; otherwise the header-advertised key is used
 * (trust-on-first-use).
 *
 * @throws {ApiError} If the envelope status is `error`.
 * @throws {Error} If a success body fails signature verification.
 */
export async function fetchSigned<T>(
  url: string,
  fetchImpl: FetchImpl,
  init?: RequestInit,
  pinnedSignPubKey?: string,
): Promise<SignedResult<T>> {
  const res = await fetchImpl(url, init);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const parsed = JSON.parse(decoder.decode(bytes)) as ApiEnvelope<T>;

  if (parsed.status === 'error') {
    throw new ApiError(parsed.data);
  }

  const headerPub = res.headers.get('X-CVPN-Sign-PubKey');
  const signature = res.headers.get('X-CVPN-Signature');
  const signPubKey = pinnedSignPubKey ?? headerPub;

  let verified = false;
  if (signature && signPubKey) {
    verified = verifySignedResponse(bytes, signature, signPubKey);
  }
  if (!verified) {
    throw new Error(`fetchSigned: unverified signed response from ${url}`);
  }

  return { data: parsed.data, signPubKey, verified };
}
