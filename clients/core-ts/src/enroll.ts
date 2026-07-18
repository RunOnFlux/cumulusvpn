import { fetchSigned } from './http.js';
import { solvePoW } from './pow.js';
import { CONTROL_PORT, POW_BITS } from './types.js';
import type { EnrollOptions, EnrollResponse, StatusResponse } from './types.js';

/**
 * Enroll a WireGuard public key at a gateway and obtain tunnel parameters.
 *
 * Solves the anti-flood proof-of-work, `POST`s `/v1/enroll`, and verifies the
 * signed response. Re-enrolling the same pubkey is idempotent server-side
 * (returns the existing assignment). The returned {@link EnrollResponse}
 * carries everything {@link buildWgConfig} needs plus the payment address/memo.
 *
 * @param gatewayIp - Gateway public IP (no port).
 * @param publicKeyB64 - Base64 WireGuard public key to enroll.
 * @param options - Optional fetch impl, PoW difficulty, and pinned signing key.
 * @returns The verified enroll response.
 * @throws {ApiError} On a gateway error (`bad_pow`, `rate_limited`, …).
 */
export async function enroll(
  gatewayIp: string,
  publicKeyB64: string,
  options: EnrollOptions = {},
): Promise<EnrollResponse> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const bits = options.powBits ?? POW_BITS;
  const nonce = await solvePoW(publicKeyB64, bits);

  const { data } = await fetchSigned<EnrollResponse>(
    `http://${gatewayIp}:${CONTROL_PORT}/v1/enroll`,
    fetchImpl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: publicKeyB64, pow_nonce: nonce }),
    },
    options.signPubKey,
  );
  return data;
}

/**
 * Fetch a pubkey's current entitlement status from a gateway.
 *
 * @param gatewayIp - Gateway public IP (no port).
 * @param publicKeyB64 - Base64 WireGuard public key to query.
 * @param options - Optional fetch impl and pinned signing key.
 * @returns The verified status (tier, paid-until, bytes used).
 * @throws {ApiError} On a gateway error.
 */
export async function status(
  gatewayIp: string,
  publicKeyB64: string,
  options: EnrollOptions = {},
): Promise<StatusResponse> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const path = `http://${gatewayIp}:${CONTROL_PORT}/v1/status/${encodeURIComponent(publicKeyB64)}`;
  const { data } = await fetchSigned<StatusResponse>(
    path,
    fetchImpl,
    undefined,
    options.signPubKey,
  );
  return data;
}
