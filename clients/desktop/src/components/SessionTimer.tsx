import { useEffect, useState } from 'react';
import type { JSX } from 'react';

/** Compact elapsed duration: "45s", "12m 03s", "2h 09m". */
function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  if (m > 0) {
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }
  return `${sec}s`;
}

/** Live "Connected · <elapsed>" line, ticking once a second. */
export function SessionTimer({ since }: { readonly since: number }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <div className="session-timer">Connected · {fmt(now - since)}</div>;
}
