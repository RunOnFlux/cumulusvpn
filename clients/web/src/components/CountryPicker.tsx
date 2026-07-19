import { useMemo, useState } from 'react';
import type { CountryOption, Health } from '../lib/gateways';
import { healthOf } from '../lib/gateways';

interface CountryPickerProps {
  readonly options: readonly CountryOption[];
  readonly selectedId: string | null;
  readonly onSelect: (option: CountryOption) => void;
}

const DOT_CLASS: Record<Health, string> = {
  good: 'g',
  fair: 'y',
  busy: 'r',
  unknown: 'u',
};

function metric(option: CountryOption): string {
  const health = healthOf(option);
  if (health === 'unknown' || !option.bestGateway) {
    return 'seed';
  }
  // POC: load stands in for round-trip latency (not measurable in-browser).
  return `${Math.round(option.bestGateway.load * 100)}%`;
}

function subline(option: CountryOption): string {
  if (option.status === 'live') {
    const noun = option.nodeCount === 1 ? 'node' : 'nodes';
    return `${option.nodeCount} ${noun}${option.city ? ` · ${option.city}` : ''}`;
  }
  return option.city ? `${option.city} · directory` : 'directory';
}

/** Searchable country list with latency dots and node counts (mockup `.clist`). */
export function CountryPicker({ options, selectedId, onSelect }: CountryPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return options;
    }
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.cc.toLowerCase().includes(q) ||
        o.city.toLowerCase().includes(q),
    );
  }, [options, query]);

  return (
    <div className="picker">
      <input
        className="searchbar"
        type="search"
        placeholder={`🔎  Search ${options.length} countries…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search countries"
      />
      <div className="clist" role="listbox" aria-label="Countries">
        {filtered.map((option) => {
          const selected = option.id === selectedId;
          return (
            <button
              type="button"
              key={option.id}
              className={`crow${selected ? ' sel' : ''}`}
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(option)}
            >
              <span className="flag">{option.flag}</span>
              <span className="nm">
                {option.name} <span className="sub">{subline(option)}</span>
              </span>
              <span className="ping">
                <span className={`dot ${DOT_CLASS[healthOf(option)]}`} />
                {metric(option)}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 ? <div className="empty">No countries match “{query}”.</div> : null}
      </div>
    </div>
  );
}
