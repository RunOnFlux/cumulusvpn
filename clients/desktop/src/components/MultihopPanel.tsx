import { useEffect, useRef } from 'react';
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
  // Opening multi-hop or switching style reveals controls below the fold:
  // bring into view the one that matters — the Max privacy EXIT picker, which
  // Connect waits on, or else the route styles.
  const bodyRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const target = routeStyle === 'multihop-cross-jurisdiction' ? exitRef : bodyRef;
    target.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [multihop, routeStyle]);

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
        <div className="mh-body" ref={bodyRef}>
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

          {/* Balanced routes both hops WITHIN the entry country, so the exit is
              auto-chosen (a second gateway there) — showing an exit-country
              picker would be misleading since the pick is ignored. Only
              cross-jurisdiction lets the user choose where traffic emerges. */}
          {routeStyle === 'multihop-cross-jurisdiction' ? (
            <button
              ref={exitRef}
              className="loc-btn mh-exit"
              onClick={onOpenExit}
              disabled={locked}
            >
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
          ) : (
            <p className="mh-exit-note">
              Exit auto-selected — a second gateway in the entry country.
            </p>
          )}

          <p className="mh-tradeoff">
            Slower, worse ping — but no single server sees both who you are and where you go.
          </p>
          <p className="mh-caveat">
            The exit is reached only through the entry, on a key made for this session: it never
            learns your IP or your account key. The exit hop runs at the exit&apos;s free tier.
          </p>
        </div>
      )}
    </div>
  );
}
