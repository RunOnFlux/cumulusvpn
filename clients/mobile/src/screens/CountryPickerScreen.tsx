/**
 * Location picker — two levels:
 *   1. a SORTED (A–Z, favourites first) list of countries, each showing how many
 *      cities / nodes it has;
 *   2. tap a multi-city country to drill into its cities and pick one.
 *
 * A single-city country selects directly (no pointless drill). Multi-hop
 * entry/exit reuse this at the country level only (no `locations` → flat).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { gatewayQuality } from '@cumulusvpn/core';
import type { QualityTone } from '@cumulusvpn/core';
import type { Country } from '../lib/gateways';
import { color, font, radius, space } from '../theme/tokens';

/** Quality-tone → accent colour (green best … red busiest). */
const TONE_COLOR: Record<QualityTone, string> = {
  excellent: color.green,
  good: color.cyan,
  fair: color.amber,
  busy: color.red,
};

interface Props {
  /** Country-level rows (level 1). */
  readonly countries: readonly Country[];
  /**
   * City-level rows (level 2). When provided, multi-city countries drill into
   * their cities. Absent → flat country selection (multi-hop entry/exit).
   */
  readonly locations?: readonly Country[];
  /** Currently-selected id (a city id for single-hop, a country code otherwise). */
  readonly selectedCode: string | null;
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
  /** Re-run discovery + an active latency re-test of the fleet. */
  readonly onRefresh: () => Promise<void>;
  /** True while an automatic background discovery is in flight. */
  readonly discovering?: boolean;
  /** Choose "Automatic" (nearest). When set, an Auto row shows; null = active. */
  readonly onSelectAuto?: () => void;
  /** Favorited country codes (surfaced first). */
  readonly favorites: readonly string[];
  /** Pin/unpin a country. */
  readonly onToggleFavorite: (code: string) => void;
}

export function CountryPickerScreen({
  countries,
  locations,
  selectedCode,
  onSelect,
  onClose,
  onRefresh,
  discovering = false,
  onSelectAuto,
  favorites,
  onToggleFavorite,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [openCc, setOpenCc] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const busy = refreshing || discovering;

  const twoLevel = !!locations && locations.length > 0;
  const citiesFor = useCallback(
    (cc: string): Country[] => (locations ?? []).filter((l) => l.code === cc),
    [locations],
  );

  const doRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  /** A country row counts as selected if it — or one of its cities — is chosen. */
  const countrySelected = (cc: string): boolean =>
    selectedCode === cc || (selectedCode?.startsWith(`${cc}:`) ?? false);

  const select = (id: string): void => {
    onSelect(id);
    onClose();
  };

  const tapCountry = (country: Country): void => {
    if (twoLevel) {
      const cities = citiesFor(country.code);
      if (cities.length > 1) {
        setOpenCc(country.code);
        return;
      }
      if (cities[0]) {
        select(cities[0].id);
        return;
      }
    }
    select(country.id);
  };

  // Level 1 list: countries filtered by the search, sorted A–Z, favourites
  // first. Declared before the level-2 early return so hook order is stable.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? countries.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.city.toLowerCase().includes(q) ||
            citiesFor(c.code).some((l) => l.city.toLowerCase().includes(q)),
        )
      : countries;
    const sorted = [...matched].sort((a, b) => a.name.localeCompare(b.name));
    const fav = sorted.filter((c) => favorites.includes(c.code));
    const rest = sorted.filter((c) => !favorites.includes(c.code));
    return [...fav, ...rest];
  }, [countries, query, favorites, citiesFor]);

  // ---- Level 2: cities of a country -------------------------------------
  if (openCc && twoLevel) {
    const country = countries.find((c) => c.code === openCc);
    const cities = [...citiesFor(openCc)].sort((a, b) =>
      (a.city || a.name).localeCompare(b.city || b.name),
    );
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable
            onPress={() => setOpenCc(null)}
            accessibilityRole="button"
            hitSlop={12}
            style={styles.backBtn}
          >
            <Text style={styles.back}>‹</Text>
            <Text style={styles.title}>
              {country?.flag} {country?.name ?? openCc}
            </Text>
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionLabel}>
          {cities.length} {cities.length === 1 ? 'city' : 'cities'}
        </Text>
        <FlatList
          data={cities}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const q = gatewayQuality(item.latencyMs, item.best.load);
            return (
              <Pressable
                style={[styles.row, item.id === selectedCode && styles.rowSelected]}
                onPress={() => select(item.id)}
                accessibilityRole="button"
              >
                <View style={styles.cityDot} />
                <View style={styles.meta}>
                  <Text style={styles.name}>{item.city || item.name}</Text>
                  <Text style={styles.sub}>
                    {item.nodeCount} {item.nodeCount === 1 ? 'node' : 'nodes'}
                  </Text>
                </View>
                <View style={styles.qual}>
                  <View style={styles.qualTop}>
                    <View style={[styles.qualDot, { backgroundColor: TONE_COLOR[q.tone] }]} />
                    <Text style={[styles.qualLabel, { color: TONE_COLOR[q.tone] }]}>{q.label}</Text>
                  </View>
                  <Text style={styles.qualSub}>
                    {item.latencyMs === null ? '— ms' : `${item.latencyMs} ms`} · {q.loadPct}% load
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose location</Text>
        <View style={styles.headerRight}>
          <Pressable
            onPress={busy ? undefined : () => void doRefresh()}
            accessibilityRole="button"
            hitSlop={10}
          >
            {busy ? (
              <ActivityIndicator size="small" color={color.cyan} />
            ) : (
              <Text style={styles.retest}>↻ Re-test</Text>
            )}
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
      </View>

      <TextInput
        style={styles.search}
        placeholder={`Search ${countries.length} countries…`}
        placeholderTextColor={color.inkFaint}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
      />

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          onSelectAuto && query.trim() === '' ? (
            <Pressable
              style={[styles.row, styles.autoRow, selectedCode === null && styles.rowSelected]}
              onPress={() => {
                onSelectAuto();
                onClose();
              }}
              accessibilityRole="button"
            >
              <Text style={styles.flag}>⚡</Text>
              <View style={styles.meta}>
                <Text style={styles.name}>Automatic</Text>
                <Text style={styles.sub}>Pick the nearest, least-busy node for me</Text>
              </View>
              {selectedCode === null ? <Text style={styles.autoCheck}>✓</Text> : null}
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No gateways reachable — pull to refresh.</Text>
        }
        renderItem={({ item }) => {
          const cityCount = twoLevel ? citiesFor(item.code).length : 0;
          const drillable = cityCount > 1;
          const q = gatewayQuality(item.latencyMs, item.best.load);
          const pinned = favorites.includes(item.code);
          return (
            <Pressable
              style={[styles.row, countrySelected(item.code) && styles.rowSelected]}
              onPress={() => tapCountry(item)}
              accessibilityRole="button"
            >
              <Pressable
                onPress={() => onToggleFavorite(item.code)}
                accessibilityRole="button"
                accessibilityLabel={pinned ? 'Unpin' : 'Pin'}
                hitSlop={8}
              >
                <Text style={[styles.star, pinned && styles.starOn]}>{pinned ? '★' : '☆'}</Text>
              </Pressable>
              <Text style={styles.flag}>{item.flag}</Text>
              <View style={styles.meta}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.sub}>
                  {drillable
                    ? `${cityCount} cities · ${item.nodeCount} ${item.nodeCount === 1 ? 'node' : 'nodes'}`
                    : `${item.nodeCount} ${item.nodeCount === 1 ? 'node' : 'nodes'} · ${item.city}`}
                </Text>
              </View>
              {drillable ? (
                <Text style={styles.chevron}>›</Text>
              ) : (
                <View style={styles.qual}>
                  <View style={styles.qualTop}>
                    <View style={[styles.qualDot, { backgroundColor: TONE_COLOR[q.tone] }]} />
                    <Text style={[styles.qualLabel, { color: TONE_COLOR[q.tone] }]}>{q.label}</Text>
                  </View>
                  <Text style={styles.qualSub}>
                    {item.latencyMs === null ? '— ms' : `${item.latencyMs} ms`} · {q.loadPct}% load
                  </Text>
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.xl, paddingTop: space.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
    marginBottom: space.md,
  },
  title: { color: color.ink, fontWeight: '700', fontSize: 17 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  back: { color: color.cyan, fontSize: 28, fontWeight: '400', marginTop: -2 },
  sectionLabel: {
    color: color.inkFaint,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: space.sm,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  retest: { color: color.inkMuted, fontWeight: '600', fontSize: 13 },
  done: { color: color.cyan, fontWeight: '600', fontSize: 15 },
  search: {
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    color: color.ink,
    fontSize: 14,
    marginBottom: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    gap: space.md,
  },
  rowSelected: {
    backgroundColor: color.glass,
    borderColor: 'rgba(52,228,218,0.4)',
    borderWidth: 1,
  },
  autoRow: { marginBottom: space.xs },
  autoCheck: { color: color.cyan, fontSize: 16, fontWeight: '700' },
  star: { fontSize: 17, color: color.inkFaint },
  starOn: { color: color.amber },
  flag: { fontSize: 24 },
  cityDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.cyan, marginLeft: 8 },
  meta: { flex: 1 },
  name: { color: color.ink, fontSize: 15, fontWeight: '600' },
  sub: { color: color.inkDim, fontSize: 12, marginTop: 2 },
  chevron: { color: color.inkFaint, fontSize: 22, fontWeight: '400', paddingHorizontal: 4 },
  qual: { alignItems: 'flex-end' },
  qualTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  qualDot: { width: 7, height: 7, borderRadius: 4 },
  qualLabel: { fontSize: 12.5, fontWeight: '600' },
  qualSub: { fontFamily: font.mono, fontSize: 10.5, color: color.inkFaint, marginTop: 2 },
  empty: { color: color.inkDim, textAlign: 'center', marginTop: 40, fontSize: 14 },
});
