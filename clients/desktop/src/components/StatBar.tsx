import type { JSX } from 'react';
import type { Speed } from '../lib/liveStats.js';
import type { TunnelStatus } from '../lib/tauri.js';

interface Props {
  readonly tunnel: TunnelStatus;
  readonly speed: Speed;
  readonly pingMs: number | null;
}

export function humanBytes(n: number): string {
  if (n < 1024) {
    return `${Math.round(n)} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

/**
 * Live tunnel readouts, as on mobile: download and upload speed (with the
 * session totals under them) and the latency through the tunnel.
 */
export function StatBar({ tunnel, speed, pingMs }: Props): JSX.Element {
  return (
    <div className="stats">
      <div className="stat">
        <div className="k">Download</div>
        <div className="v">{humanBytes(speed.down)}/s</div>
        <div className="sub">{humanBytes(tunnel.rxBytes)} total</div>
      </div>
      <div className="stat">
        <div className="k">Upload</div>
        <div className="v">{humanBytes(speed.up)}/s</div>
        <div className="sub">{humanBytes(tunnel.txBytes)} total</div>
      </div>
      <div className="stat">
        <div className="k">Ping</div>
        <div className="v">{pingMs === null ? '—' : `${pingMs} ms`}</div>
      </div>
    </div>
  );
}
