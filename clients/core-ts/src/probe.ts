/**
 * Active node probe — an on-demand "test this node" that measures real
 * round-trip latency and jitter to a gateway's control API by sending a few
 * timed requests. Complements the passive {@link gatewayQuality} rating (which
 * uses the load the gateway self-reports): this is what the user actually
 * experiences right now, sampled live.
 */
import type { FetchImpl } from './types.js';

/** Result of an active latency probe. */
export interface PingResult {
  /** Median RTT in ms across successful samples, or `null` if all failed. */
  readonly rttMs: number | null;
  /** Jitter: mean absolute deviation of RTT (ms), or `null`. */
  readonly jitterMs: number | null;
  /** Fraction of samples that failed, 0..1 (1 = unreachable). */
  readonly loss: number;
}

/**
 * Ping a gateway's control API a few times and summarise the latency.
 *
 * @param controlUrl - The gateway control base URL, e.g. `http://<ip>:51821`.
 * @param options - `samples` (default 4), `timeoutMs` per sample (default 4000),
 *   and an optional `fetchImpl`.
 * @returns Median RTT, jitter, and loss over the samples.
 */
export async function pingGateway(
  controlUrl: string,
  options: { samples?: number; timeoutMs?: number; fetchImpl?: FetchImpl } = {},
): Promise<PingResult> {
  const samples = Math.max(1, options.samples ?? 4);
  const timeoutMs = options.timeoutMs ?? 4000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const rtts: number[] = [];
  let failures = 0;

  for (let i = 0; i < samples; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetchImpl(`${controlUrl}/v1/info`, {
        method: 'GET',
        signal: controller.signal,
      });
      // Drain the body so the socket can be reused/closed on all runtimes.
      await res.arrayBuffer().catch(() => undefined);
      if (res.ok) {
        rtts.push(Date.now() - started);
      } else {
        failures += 1;
      }
    } catch {
      failures += 1;
    } finally {
      clearTimeout(timer);
    }
  }

  const loss = failures / samples;
  if (rtts.length === 0) {
    return { rttMs: null, jitterMs: null, loss };
  }
  const sorted = [...rtts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? sorted[0]!;
  const mean = rtts.reduce((a, b) => a + b, 0) / rtts.length;
  const jitter = rtts.reduce((a, b) => a + Math.abs(b - mean), 0) / rtts.length;
  return { rttMs: median, jitterMs: Math.round(jitter), loss };
}
