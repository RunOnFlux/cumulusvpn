/**
 * Node quality rating — turns a gateway's live signals (measured round-trip
 * latency + reported load) into a single human-facing quality so the clients can
 * show "which node is healthy, fast, and not crowded" at a glance.
 *
 * Load is weighted a little more than latency: on a shared exit node the load is
 * what determines the bandwidth you actually get, while latency mostly affects
 * responsiveness. A node reporting near-full load is always surfaced as "Busy"
 * regardless of latency.
 */

/** Coarse quality bucket, for colour + label. */
export type QualityTone = 'excellent' | 'good' | 'fair' | 'busy';

/** A gateway's connection quality, derived from latency + load. */
export interface GatewayQuality {
  /** Coarse tone for colour + label. */
  readonly tone: QualityTone;
  /** Human label, e.g. `"Excellent"`. */
  readonly label: string;
  /** Load as a 0..100 percentage (how full the node is). */
  readonly loadPct: number;
  /** 0..100 composite score (higher is better); good for ranking ties. */
  readonly score: number;
}

const LABELS: Record<QualityTone, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  busy: 'Busy',
};

/**
 * Rate a gateway from its measured round-trip latency (ms, or `null` if not yet
 * measured) and its reported `load` (0..1 utilisation from `/v1/info`).
 *
 * @param latencyMs - Measured RTT in ms, or `null` when unknown (scored neutral).
 * @param load - Reported utilisation, 0 (idle) .. 1 (full). Clamped.
 * @returns A {@link GatewayQuality} with tone, label, load %, and a 0..100 score.
 */
export function gatewayQuality(latencyMs: number | null, load: number): GatewayQuality {
  const l = Math.min(1, Math.max(0, load));
  const loadPct = Math.round(l * 100);

  // Sub-scores in 0..1 (1 = best). Latency: <=60ms is ideal, >=400ms is poor.
  const loadScore = 1 - l;
  const latScore =
    latencyMs == null
      ? 0.5
      : latencyMs <= 60
        ? 1
        : latencyMs >= 400
          ? 0
          : 1 - (latencyMs - 60) / 340;

  const score = Math.round((0.6 * loadScore + 0.4 * latScore) * 100);

  let tone: QualityTone;
  if (l >= 0.85) {
    tone = 'busy';
  } else if (score >= 78) {
    tone = 'excellent';
  } else if (score >= 55) {
    tone = 'good';
  } else {
    tone = 'fair';
  }

  return { tone, label: LABELS[tone], loadPct, score };
}
