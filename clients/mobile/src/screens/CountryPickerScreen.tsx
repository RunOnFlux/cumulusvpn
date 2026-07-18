/**
 * Country picker (mockup shot #2) — the live fleet grouped by country with a
 * latency dot, node count and city per row. Pulled from the Flux network via
 * core discovery; tap a row to select and return to Connect.
 */
import { useMemo, useState } from 'react';
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
  readonly countries: readonly Country[];
  readonly selectedCode: string | null;
  readonly onSelect: (code: string) => void;
  readonly onClose: () => void;
  /** Re-run discovery + an active latency re-test of the fleet. */
  readonly onRefresh: () => Promise<void>;
}

export function CountryPickerScreen({
  countries,
  selectedCode,
  onSelect,
  onClose,
  onRefresh,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('');
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
    const q = query.trim().toLowerCase();
    if (!q) {
      return countries;
    }
    return countries.filter(
      (c) => c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q),
    );
  }, [countries, query]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose location</Text>
        <View style={styles.headerRight}>
          <Pressable
            onPress={refreshing ? undefined : () => void doRefresh()}
            accessibilityRole="button"
            hitSlop={10}
          >
            {refreshing ? (
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
        keyExtractor={(c) => c.code}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.empty}>No gateways reachable — pull to refresh.</Text>
        }
        renderItem={({ item }) => {
          const q = gatewayQuality(item.latencyMs, item.best.load);
          return (
            <Pressable
              style={[styles.row, item.code === selectedCode && styles.rowSelected]}
              onPress={() => {
                onSelect(item.code);
                onClose();
              }}
              accessibilityRole="button"
            >
              <Text style={styles.flag}>{item.flag}</Text>
              <View style={styles.meta}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.sub}>
                  {item.nodeCount} {item.nodeCount === 1 ? 'node' : 'nodes'} · {item.city}
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
  flag: { fontSize: 24 },
  meta: { flex: 1 },
  name: { color: color.ink, fontSize: 15, fontWeight: '600' },
  sub: { color: color.inkDim, fontSize: 12, marginTop: 2 },
  qual: { alignItems: 'flex-end' },
  qualTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  qualDot: { width: 7, height: 7, borderRadius: 4 },
  qualLabel: { fontSize: 12.5, fontWeight: '600' },
  qualSub: { fontFamily: font.mono, fontSize: 10.5, color: color.inkFaint, marginTop: 2 },
  empty: { color: color.inkDim, textAlign: 'center', marginTop: 40, fontSize: 14 },
});
