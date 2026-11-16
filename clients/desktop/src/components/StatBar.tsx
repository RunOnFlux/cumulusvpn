import type { JSX } from 'react';
import { humanBytes } from '../lib/liveStats.js';
import type { Speed } from '../lib/liveStats.js';
import type { TunnelStatus } from '../lib/tauri.js';

export { humanBytes };

interface Props {
  readonly tunnel: TunnelStatus;
  readonly speed: Speed;
  readonly pingMs: number | null;
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
