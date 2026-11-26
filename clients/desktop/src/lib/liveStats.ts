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

/** Bytes with a binary unit, as the main window's stat cards show them. */
export function humanBytes(n: number): string {
  const v0 = Math.max(0, n);
  if (v0 < 1024) {
    return `${Math.round(v0)} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = v0 / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

/**
 * A throughput readout. The same unit everywhere — main window, menu and
 * popover — so the numbers never disagree between two views of one tunnel.
 */
export function formatRate(bytesPerSec: number): string {
  return `${humanBytes(bytesPerSec)}/s`;
}

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

/**
 * Round trip to each gateway in ms, measured natively the same way as
 * {@link probeLatency} (see `probe_gateways` in src-tauri/src/latency.rs), so
 * the location card and the live ping agree. `null` outside Tauri or if the
 * command is unavailable — the caller then falls back to timing `/v1/info`.
 */
export async function probeGateways(
  ips: readonly string[],
): Promise<Record<string, number> | null> {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invoke<Record<string, number>>('probe_gateways', { ips });
  } catch {
    return null;
  }
}

/**
 * The latency on the location card: the live ping through the tunnel while
 * connected (what the ping tile shows too), otherwise the discovery probe.
 */
export function cardLatency(
  connected: boolean,
  pingMs: number | null,
  probedMs: number | null | undefined,
): string | null {
  const ms = connected && pingMs !== null ? pingMs : probedMs;
  return ms != null ? `${ms} ms` : null;
}
