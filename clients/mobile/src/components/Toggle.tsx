import { Pressable, StyleSheet, View } from 'react-native';
import { color } from '../theme/tokens';

/** A compact switch matching the app's glass/cyan aesthetic. */
export function Toggle({
  value,
  disabled = false,
  onValueChange,
}: {
  readonly value: boolean;
  readonly disabled?: boolean;
  readonly onValueChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={disabled ? undefined : () => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={[styles.track, value && styles.trackOn, disabled && styles.trackDisabled]}
    >
      <View style={[styles.thumb, value && styles.thumbOn]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: color.hairlineStrong,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: color.cyan },
  trackDisabled: { opacity: 0.6 },
  thumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  thumbOn: { alignSelf: 'flex-end' },
});
