/**
 * Staleness check for an ISSUED WireGuard config.
 *
 * A `.conf` handed to the stock WireGuard app pins three facts that belong to
 * one gateway: the endpoint IP, that gateway's server public key, and a peer
 * registration held in that gateway's memory. The stock client has no control
 * channel, so it can refresh none of them — and WireGuard's failure mode is
 * silent: the tunnel reports connected and simply never handshakes, which with
 * `AllowedIPs = 0.0.0.0/0` looks to the user like the internet broke.
 *
 * Whatever issued such a config (today the web client) can still check on the
 * user's behalf, because `/v1/info` is unauthenticated and signed. Comparing the
 * server public key the config was built against with the one that gateway
 * serves now catches the case no amount of gateway-side persistence can fix: a
 * Flux migration, where the app is re-placed on a different node that mints its
 * own key and starts with an empty peer table.
 */
import { fetchSigned } from './http.js';
import { CONTROL_PORT } from './types.js';
import type { FetchImpl, InfoResponse } from './types.js';

/** What an issued config pinned, enough to tell later whether it still holds. */
export interface IssuedConfigRef {
  /** Gateway IP the config's `Endpoint` points at. */
  readonly ip: string;
  /** `[Peer] PublicKey` baked into the config. */
  readonly serverPubKey: string;
}

/**
 * Verdict for an issued config.
 *
 * - `ok` — same gateway, same key. The config should still work.
 * - `replaced` — the gateway answered with a DIFFERENT server key. Definitive:
 *   the config cannot handshake and never will. This is the migration case (or
 *   a node that lost `/data`).
 * - `unreachable` — the gateway did not answer. Could be a migration, could be
 *   the user's own network or a transient blip, so it must be reported as
 *   uncertain rather than as breakage.
 * - `unknown` — no reference stored, so nothing to say.
 */
export type ConfHealth = 'ok' | 'replaced' | 'unreachable' | 'unknown';

/**
 * Check whether an issued config's gateway is still the one that issued it.
 *
 * Never throws: an unreachable gateway is a verdict, not an error.
 *
 * @param ref - What the config pinned, from {@link IssuedConfigRef}.
 * @param options - `fetchImpl` (defaults to global fetch, but the web client
 *   must pass its proxying fetch, since an https page cannot call a gateway's
 *   plain-http control API directly) and `timeoutMs`.
 */
export async function checkIssuedConfig(
  ref: IssuedConfigRef | null | undefined,
  options: { fetchImpl?: FetchImpl; timeoutMs?: number } = {},
): Promise<ConfHealth> {
  if (!ref || !ref.ip || !ref.serverPubKey) {
    return 'unknown';
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  try {
    const { data } = await fetchSigned<InfoResponse>(
      `http://${ref.ip}:${CONTROL_PORT}/v1/info`,
      fetchImpl,
      undefined,
      undefined,
      options.timeoutMs ?? 8_000,
    );
    // A gateway's signing key is derived from its WireGuard key, so a changed
    // server key means a different identity — there is no benign version of it.
    return data.server_pubkey === ref.serverPubKey ? 'ok' : 'replaced';
  } catch {
    return 'unreachable';
  }
}
