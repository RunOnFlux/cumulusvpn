import type { JSX } from 'react';
import type { TunnelStatus } from '../lib/tauri.js';

interface Props {
  readonly tunnel: TunnelStatus;
}

function humanBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
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

function handshakeAgo(unix: number | null): string {
  if (unix === null) {
    return '—';
  }
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (secs < 60) {
    return `${secs}s ago`;
  }
  return `${Math.floor(secs / 60)}m ago`;
}

/** Compact live tunnel readouts — mono figures, mockup's two-stat strip. */
export function StatBar({ tunnel }: Props): JSX.Element {
  return (
    <div className="stats">
      <div className="stat">
        <div className="k">Downloaded</div>
        <div className="v">{humanBytes(tunnel.rxBytes)}</div>
      </div>
      <div className="stat">
        <div className="k">Uploaded</div>
        <div className="v">{humanBytes(tunnel.txBytes)}</div>
      </div>
      <div className="stat">
        <div className="k">Handshake</div>
        <div className="v">{handshakeAgo(tunnel.lastHandshake)}</div>
      </div>
    </div>
  );
}
