/**
 * The coloured latency dot from the country picker (green / amber / red).
 */
import { StyleSheet, View } from 'react-native';
import { color } from '../theme/tokens';
import type { LatencyBand } from '../lib/gateways';

interface Props {
  readonly band: LatencyBand;
  readonly size?: number;
}

const BAND_COLOR: Readonly<Record<LatencyBand, string>> = {
  good: color.green,
  ok: color.amber,
  slow: color.red,
};

export function LatencyDot({ band, size = 7 }: Props): React.JSX.Element {
  return (
    <View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: BAND_COLOR[band] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { marginRight: 6 },
});
