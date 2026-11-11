import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { gatewayQuality } from '@cumulusvpn/core';
import type { QualityTone } from '@cumulusvpn/core';
import type { CountryOption } from '../lib/session.js';
import { bestLocation, citiesOf, countryOfId, optionId } from '../lib/locations.js';
import { useEscape } from '../hooks/useEscape.js';

interface Props {
  /** Country rows (level 1). */
  readonly countries: readonly CountryOption[];
  /**
   * City rows (level 2). When given, a country with several cities opens its
   * city list; absent → flat country selection (multi-hop exit).
   */
  readonly locations?: readonly CountryOption[];
  /** Picked id (`DE`, `DE:Frankfurt`), or null when Automatic is picked. */
  readonly selectedId: string | null;
  readonly onPick: (id: string) => void;
  /** Offer the Automatic row (single-hop / entry only). */
  readonly onPickAutomatic?: () => void;
  readonly onClose: () => void;
  /** Re-discover the fleet (re-test latency and load). */
  readonly onRefresh: () => Promise<void>;
  /** Favorited country codes (surfaced first). */
  readonly favorites: readonly string[];
  /** Pin/unpin a country. */
  readonly onToggleFavorite: (code: string) => void;
}

/** Quality-tone → CSS colour var (green best … red busiest). */
const TONE_VAR: Record<QualityTone, string> = {
  excellent: 'var(--green)',
  good: 'var(--cyan)',
  fair: 'var(--amber)',
  busy: 'var(--red)',
};

/** Right-hand column, same width on every row: rating + dot, latency under it. */
function Quality({ row }: { readonly row: CountryOption }): JSX.Element {
  const latency = row.latencyMs ?? null;
  const q = gatewayQuality(latency, row.load);
  return (
    <span className="qcol">
      <span className="qtop">
        <span className="qlabel" style={{ color: TONE_VAR[q.tone] }}>
          {latency === null && row.latencyMs !== undefined ? 'Untested' : q.label}
        </span>
        <span className="qdot" style={{ background: TONE_VAR[q.tone] }} />
      </span>
      <span className="lat">{latency !== null ? `${latency} ms` : `${q.loadPct}% load`}</span>
    </span>
  );
}

/** Always present so rows line up whether or not they open a city list. */
function Chevron({ show }: { readonly show: boolean }): JSX.Element {
  return (
    <span className="chev" aria-hidden="true">
      {show ? '›' : ''}
    </span>
  );
}

function nodesLabel(row: CountryOption, cities: number): string {
  const nodes = row.nodeCount ?? 1;
  const n = nodes === 1 ? '1 node' : `${nodes} nodes`;
  return cities > 1 ? `${cities} cities · ${n}` : n;
}

/** Full-window location sheet: Automatic, countries, and each country's cities. */
export function CountryPicker({
  countries,
  locations,
  selectedId,
  onPick,
  onPickAutomatic,
  onClose,
  onRefresh,
  favorites,
  onToggleFavorite,
}: Props): JSX.Element {
  const [q, setQ] = useState('');
  const [openCc, setOpenCc] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Escape backs out of a city list first, then closes.
  useEscape(() => (openCc ? setOpenCc(null) : onClose()));

  const doRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  const pick = (id: string): void => {
    onPick(id);
    onClose();
  };

  const cityCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of countries) {
      m.set(c.code, locations ? citiesOf(locations, c.code).length : 0);
    }
    return m;
  }, [countries, locations]);

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    const matches = (c: CountryOption): boolean =>
      !needle ||
      c.name.toLowerCase().includes(needle) ||
      c.code.toLowerCase().includes(needle) ||
      (locations ?? []).some((l) => l.code === c.code && l.city.toLowerCase().includes(needle));
    const matched = countries.filter(matches);
    const fav = matched.filter((c) => favorites.includes(c.code));
    const rest = matched.filter((c) => !favorites.includes(c.code));
    return [...fav, ...rest];
  }, [countries, locations, needle, favorites]);

  const openCountry = openCc ? countries.find((c) => c.code === openCc) : undefined;
  const openCities = openCc && locations ? citiesOf(locations, openCc) : [];
  const best = bestLocation(countries);
  const selectedCountry = selectedId ? countryOfId(selectedId) : null;

  const onCountry = (c: CountryOption): void => {
    if ((cityCount.get(c.code) ?? 0) > 1) {
      setOpenCc(c.code);
      setQ('');
      return;
    }
    // One city (or none known): the whole country is the only choice.
    pick(c.code);
  };

  if (openCountry) {
    return (
      <div className="sheet">
        <div className="sheet-inner">
          <div className="sheethead">
            <button
              type="button"
              className="backbtn"
              onClick={() => setOpenCc(null)}
              aria-label="Back to countries"
              title="Back to countries"
            >
              ‹
            </button>
            <div className="headtext">
              <h2>
                {openCountry.flag} {openCountry.name}
              </h2>
              <span className="headsub">Choose a city</span>
            </div>
          </div>
          <div className="clist scroll-y">
            <button
              className={`crow ${selectedId === openCountry.code ? 'sel' : ''}`}
              onClick={() => pick(openCountry.code)}
            >
              <span className="flag">🎯</span>
              <span className="cn">
                Any city
                <span className="csub">Best node anywhere in {openCountry.name}</span>
              </span>
              <Quality row={openCountry} />
              <Chevron show={false} />
            </button>
            {openCities.map((l) => (
              <button
                key={optionId(l)}
                className={`crow ${selectedId === optionId(l) ? 'sel' : ''}`}
                onClick={() => pick(optionId(l))}
              >
                <span className="flag">{l.flag}</span>
                <span className="cn">
                  {l.city}
                  <span className="csub">{nodesLabel(l, 0)}</span>
                </span>
                <Quality row={l} />
                <Chevron show={false} />
              </button>
            ))}
          </div>
          <button className="close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sheet">
      <div className="sheet-inner">
        <div className="sheethead">
          <h2>Choose location</h2>
          <button className="retest" disabled={refreshing} onClick={() => void doRefresh()}>
            {refreshing ? 'Testing…' : '↻ Re-test'}
          </button>
        </div>
        <input
          className="searchbar"
          placeholder="Search country or city…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <div className="clist scroll-y">
          {onPickAutomatic && !needle && (
            <button
              className={`crow ${selectedId === null ? 'sel' : ''}`}
              onClick={() => {
                onPickAutomatic();
                onClose();
              }}
            >
              <span className="star" aria-hidden="true" />
              <span className="flag">⚡</span>
              <span className="cn">
                Automatic
                <span className="csub">
                  {best ? `Fastest now: ${best.flag} ${best.name}` : 'Fastest available'}
                </span>
              </span>
              {best && <Quality row={best} />}
              <Chevron show={false} />
            </button>
          )}
          {filtered.map((c) => {
            const cities = cityCount.get(c.code) ?? 0;
            const fav = favorites.includes(c.code);
            return (
              <button
                key={c.code}
                className={`crow ${selectedCountry === c.code ? 'sel' : ''}`}
                onClick={() => onCountry(c)}
              >
                <span
                  className={`star ${fav ? 'on' : ''}`}
                  role="button"
                  aria-label={fav ? 'Unpin' : 'Pin'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(c.code);
                  }}
                >
                  {fav ? '★' : '☆'}
                </span>
                <span className="flag">{c.flag}</span>
                <span className="cn">
                  {c.name}
                  <span className="csub">{nodesLabel(c, cities)}</span>
                </span>
                <Quality row={c} />
                <Chevron show={cities > 1} />
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
    </div>
  );
}
