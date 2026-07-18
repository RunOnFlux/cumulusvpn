/**
 * "Powered by Flux" attribution — the app runs on the Flux decentralized cloud.
 * Tapping it opens runonflux.com. Shown on the boot screen and in Settings.
 *
 * A lightweight text mark (no SVG dependency): a small lightning glyph + label,
 * styled to sit quietly at the bottom of a screen.
 */
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { color } from '../theme/tokens';

const FLUX_URL = 'https://runonflux.com';

export function PoweredByFlux({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Powered by Flux — opens runonflux.com"
      hitSlop={8}
      onPress={() => void Linking.openURL(FLUX_URL).catch(() => undefined)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={[styles.text, compact && styles.compact]}>
        Powered by <Text style={styles.brand}>⚡ Flux</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  pressed: { opacity: 0.6 },
  text: { color: color.inkFaint, fontSize: 12, letterSpacing: 0.3 },
  compact: { fontSize: 11 },
  brand: { color: color.cyan, fontWeight: '600' },
});
