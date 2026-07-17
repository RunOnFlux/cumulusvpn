import type { JSX } from 'react';
import type { CountryOption } from '../lib/session.js';
import type { MultihopStyle } from '../hooks/useConnection.js';

interface Props {
  /** Whether multi-hop ("ultimate privacy") mode is engaged. */
  readonly multihop: boolean;
  /** Toggle multi-hop on/off (disabled while a tunnel is up/connecting). */
  readonly onToggle: (on: boolean) => void;
  /** Chosen route style — only shown while `multihop` is true. */
  readonly routeStyle: MultihopStyle;
  /** Pick the route style. */
  readonly onRouteStyle: (style: MultihopStyle) => void;
  /** The chosen EXIT hop (entry is the main location button in `App`). */
  readonly exit: CountryOption | null;
  /** Open the country picker for the EXIT hop. */
  readonly onOpenExit: () => void;
  /** Locked while a session is up or connecting (route can't change live). */
  readonly locked: boolean;
}

/** Map a 0..1 load into a latency-dot severity class (shared with the picker). */
function pingClass(load: number): string {
  if (load < 0.4) {
    return 'ping';
  }
  if (load < 0.75) {
    return 'ping mid';
  }
  return 'ping far';
}

/**
 * Opt-in multi-hop controls (`docs/11-multihop.md`), rendered under the main
 * location (entry) tile. A Fast/Multi-hop toggle — OFF by default — and, when
 * on, a route-style selector, the EXIT picker, and the honest tradeoff + v1
 * same-key caveat copy. Multi-hop is a premium feature, so its active accents
 * use the amber (premium) token; single/fast stays cyan.
 */
export function MultihopPanel({
  multihop,
  onToggle,
  routeStyle,
  onRouteStyle,
  exit,
  onOpenExit,
  locked,
}: Props): JSX.Element {
  return (
    <div className="mh">
      <div className="mh-toggle" role="group" aria-label="Tunnel mode">
        <button
          className={`seg ${multihop ? '' : 'on'}`}
          onClick={() => onToggle(false)}
          disabled={locked}
          aria-pressed={!multihop}
        >
          Fast
        </button>
        <button
          className={`seg amber ${multihop ? 'on' : ''}`}
          onClick={() => onToggle(true)}
          disabled={locked}
          aria-pressed={multihop}
        >
          Multi-hop
        </button>
      </div>

      {multihop && (
        <div className="mh-body">
          <div className="mh-styles" role="group" aria-label="Route style">
            <button
              className={`rstyle ${routeStyle === 'multihop-same-country' ? 'on' : ''}`}
              onClick={() => onRouteStyle('multihop-same-country')}
              disabled={locked}
              aria-pressed={routeStyle === 'multihop-same-country'}
            >
              <span className="rt">Balanced</span>
              <span className="rs">same country</span>
            </button>
            <button
              className={`rstyle ${routeStyle === 'multihop-cross-jurisdiction' ? 'on' : ''}`}
              onClick={() => onRouteStyle('multihop-cross-jurisdiction')}
              disabled={locked}
              aria-pressed={routeStyle === 'multihop-cross-jurisdiction'}
            >
              <span className="rt">Max privacy</span>
              <span className="rs">cross-jurisdiction</span>
            </button>
          </div>

          <button className="loc-btn mh-exit" onClick={onOpenExit} disabled={locked}>
            <span className="hop-tag">EXIT</span>
            <span className="flag">{exit?.flag ?? '🌐'}</span>
            <span className="meta">
              <span className="n">{exit?.name ?? 'Choose exit'}</span>
              <span className="s">
                {exit ? `${exit.city || exit.code} · ${exit.gatewayIp}` : 'where traffic emerges'}
              </span>
            </span>
            {exit && <span className={pingClass(exit.load)} />}
            <span className="chev">›</span>
          </button>

          <p className="mh-tradeoff">
            Slower, worse ping — but no single server sees both who you are and where you go.
          </p>
          <p className="mh-caveat">
            v1: both hops use the same key. Defeats any single operator; an adversary controlling{' '}
            <em>both</em> your hops could still correlate. Distinct-key-per-hop lands in v1.5.
          </p>
        </div>
      )}
    </div>
  );
}
