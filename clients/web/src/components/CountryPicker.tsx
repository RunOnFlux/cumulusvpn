import { useMemo, useState } from 'react';
import { useI18n } from '../hooks/useLocale';
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

/** Searchable country list with latency dots and node counts (mockup `.clist`). */
export function CountryPicker({ options, selectedId, onSelect }: CountryPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  function metric(option: CountryOption): string {
    const health = healthOf(option);
    if (health === 'unknown' || !option.bestGateway) {
      return t('common_seed');
    }
    // POC: load stands in for round-trip latency (not measurable in-browser).
    return `${Math.round(option.bestGateway.load * 100)}%`;
  }

  function subline(option: CountryOption): string {
    if (option.status === 'live') {
      const nodes = t('countries_nodes', { n: option.nodeCount });
      return option.city ? `${nodes} · ${option.city}` : nodes;
    }
    return option.city
      ? `${option.city} · ${t('common_directory')}`
      : t('common_directory');
  }

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
        placeholder={t('countries_search_placeholder', { n: options.length })}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={t('countries_search_label')}
      />
      <div className="clist" role="listbox" aria-label={t('countries_list_label')}>
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
        {filtered.length === 0 ? (
          <div className="empty">{t('countries_no_match', { query })}</div>
        ) : null}
      </div>
    </div>
  );
}
