/**
 * "Powered by Flux" attribution — the app runs on the Flux decentralized cloud.
 * Tapping it opens runonflux.com. Shown on the boot screen and in Settings.
 *
 * Uses the official Flux "Powered by" lockup (logo mark + wordmark in the brand
 * font), converted from the canonical SVG to bundled PNGs (@1x/2x/3x). The
 * light-art variant is used because the app renders on the dark "sky" gradient.
 */
import { Image, Linking, Pressable, StyleSheet } from 'react-native';
import LOGO from '../assets/powered_by_flux.png';

const FLUX_URL = 'https://runonflux.com';
// Intrinsic aspect ratio of the lockup PNG (130 × 18).
const ASPECT = 130 / 18;

export function PoweredByFlux({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const height = compact ? 15 : 18;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Powered by Flux — opens runonflux.com"
      hitSlop={8}
      onPress={() => void Linking.openURL(FLUX_URL).catch(() => undefined)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Image
        source={LOGO}
        style={{ height, width: height * ASPECT }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  pressed: { opacity: 0.6 },
});
