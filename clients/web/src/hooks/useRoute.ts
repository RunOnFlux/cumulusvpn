import { useEffect, useState } from 'react';

/** The two pages of the beta rail, selected via the URL hash. */
export type Route = 'connect' | 'upgrade';

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  return path === 'upgrade' ? 'upgrade' : 'connect';
}

/**
 * Query params carried inside the hash (`#/upgrade?code=…&session=…`) —
 * inside, because a plain `?` query would be dropped by the SPA fallback and
 * would bust the asset cache. Used by the desktop hand-off (`code`) and the
 * Stripe Checkout return (`session`).
 */
function parseParams(hash: string): URLSearchParams {
  const q = hash.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : hash.slice(q + 1));
}

/** Minimal hash router — no dependency, deep-linkable (`#/upgrade`). */
export function useRoute(): readonly [Route, (route: Route) => void, URLSearchParams] {
  const [state, setState] = useState(() => ({
    route: parseRoute(window.location.hash),
    params: parseParams(window.location.hash),
  }));

  useEffect(() => {
    const onHash = (): void =>
      setState({
        route: parseRoute(window.location.hash),
        params: parseParams(window.location.hash),
      });
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (next: Route): void => {
    // Navigating away also clears any hash query params.
    window.location.hash = next === 'upgrade' ? '/upgrade' : '/connect';
  };

  return [state.route, navigate, state.params] as const;
}
