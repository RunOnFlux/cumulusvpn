import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { CountryOption } from '../lib/session.js';

interface Props {
  readonly countries: readonly CountryOption[];
  readonly selectedCode: string | null;
  readonly onPick: (code: string) => void;
  readonly onClose: () => void;
}

/** Map a 0..1 load into a latency-dot severity class. */
function pingClass(load: number): string {
  if (load < 0.4) {
    return 'ping';
  }
  if (load < 0.75) {
    return 'ping mid';
  }
  return 'ping far';
}

/** Full-window country sheet with search — map-flavoured picker per the mockup. */
export function CountryPicker({ countries, selectedCode, onPick, onClose }: Props): JSX.Element {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      return countries;
    }
    return countries.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle),
    );
  }, [countries, q]);

  return (
    <div className="sheet">
      <h2>Choose location</h2>
      <input
        className="searchbar"
        placeholder="Search country…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className="clist">
        {filtered.map((c) => (
          <button
            key={c.code}
            className={`crow ${c.code === selectedCode ? 'sel' : ''}`}
            onClick={() => {
              onPick(c.code);
              onClose();
            }}
          >
            <span className="flag">{c.flag}</span>
            <span className="cn">{c.name}</span>
            <span className={pingClass(c.load)} />
            <span className="lat">{Math.round(c.load * 100)}%</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="lat" style={{ padding: '12px 4px' }}>
            No matching locations.
          </div>
        )}
      </div>
      <button className="close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
