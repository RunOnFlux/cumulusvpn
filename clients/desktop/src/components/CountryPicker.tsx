import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { gatewayQuality } from '@cumulusvpn/core';
import type { QualityTone } from '@cumulusvpn/core';
import type { CountryOption } from '../lib/session.js';

interface Props {
  readonly countries: readonly CountryOption[];
  readonly selectedCode: string | null;
  readonly onPick: (code: string) => void;
  readonly onClose: () => void;
  /** Re-discover the fleet (re-test node load/quality). */
  readonly onRefresh: () => Promise<void>;
}

/** Quality-tone → CSS colour var (green best … red busiest). */
const TONE_VAR: Record<QualityTone, string> = {
  excellent: 'var(--green)',
  good: 'var(--cyan)',
  fair: 'var(--amber)',
  busy: 'var(--red)',
};

/** Full-window country sheet with search — map-flavoured picker per the mockup. */
export function CountryPicker({
  countries,
  selectedCode,
  onPick,
  onClose,
  onRefresh,
}: Props): JSX.Element {
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
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
      <div className="sheethead">
        <h2>Choose location</h2>
        <button className="retest" disabled={refreshing} onClick={() => void doRefresh()}>
          {refreshing ? 'Testing…' : '↻ Re-test'}
        </button>
      </div>
      <input
        className="searchbar"
        placeholder="Search country…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className="clist">
        {filtered.map((c) => {
          const q = gatewayQuality(null, c.load);
          return (
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
              <span className="qlabel" style={{ color: TONE_VAR[q.tone] }}>
                {q.label}
              </span>
              <span className="qdot" style={{ background: TONE_VAR[q.tone] }} />
              <span className="lat">{q.loadPct}%</span>
            </button>
          );
        })}
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
