/**
 * Country picker (mockup shot #2) — the live fleet grouped by country with a
 * latency dot, node count and city per row. Pulled from the Flux network via
 * core discovery; tap a row to select and return to Connect.
 */
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Country } from '../lib/gateways';
import { latencyBand } from '../lib/gateways';
import { LatencyDot } from '../components/LatencyDot';
import { color, font, radius, space } from '../theme/tokens';

interface Props {
  readonly countries: readonly Country[];
  readonly selectedCode: string | null;
  readonly onSelect: (code: string) => void;
  readonly onClose: () => void;
}

export function CountryPickerScreen({
  countries,
  selectedCode,
  onSelect,
  onClose,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('');

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
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
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
        renderItem={({ item }) => (
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
            <View style={styles.ping}>
              <LatencyDot band={latencyBand(item.latencyMs)} />
              <Text style={styles.pingText}>
                {item.latencyMs === null ? '—' : `${item.latencyMs} ms`}
              </Text>
            </View>
          </Pressable>
        )}
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
  ping: { flexDirection: 'row', alignItems: 'center' },
  pingText: { fontFamily: font.mono, fontSize: 12, color: color.inkMuted },
  empty: { color: color.inkDim, textAlign: 'center', marginTop: 40, fontSize: 14 },
});
