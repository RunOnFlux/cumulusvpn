import { useEffect, useState } from 'react';

/** The two pages of the beta rail, selected via the URL hash. */
export type Route = 'connect' | 'upgrade';

function parse(hash: string): Route {
  return hash.replace(/^#\/?/, '') === 'upgrade' ? 'upgrade' : 'connect';
}

/** Minimal hash router — no dependency, deep-linkable (`#/upgrade`). */
export function useRoute(): readonly [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onHash = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (next: Route): void => {
    window.location.hash = next === 'upgrade' ? '/upgrade' : '/connect';
  };

  return [route, navigate] as const;
}
