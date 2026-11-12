/**
 * Live throughput from the tunnel's cumulative byte counters — the desktop
 * counterpart of mobile's Download / Upload speed stats.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface Sample {
  readonly rx: number;
  readonly tx: number;
  /** ms timestamp. */
  readonly at: number;
}

export interface Speed {
  /** Bytes per second. */
  readonly down: number;
  readonly up: number;
}

export const ZERO_SPEED: Speed = { down: 0, up: 0 };

/**
 * Bytes/s between two samples. A counter that went backwards (the tunnel was
 * rebuilt, so the counters restarted) or a zero interval reads as zero, never
 * as a negative or infinite speed.
 */
export function speedBetween(prev: Sample | null, next: Sample): Speed {
  if (!prev) {
    return ZERO_SPEED;
  }
  const secs = (next.at - prev.at) / 1000;
  if (secs <= 0 || next.rx < prev.rx || next.tx < prev.tx) {
    return ZERO_SPEED;
  }
  return { down: (next.rx - prev.rx) / secs, up: (next.tx - prev.tx) / secs };
}

/** Effective latency through the tunnel, in ms (see src-tauri/src/latency.rs). */
export async function probeLatency(): Promise<number | null> {
  if (!isTauri()) {
    return null;
  }
  try {
    return (await invoke<number | null>('probe_latency')) ?? null;
  } catch {
    return null;
  }
}
