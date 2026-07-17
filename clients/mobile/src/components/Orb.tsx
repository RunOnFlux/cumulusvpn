/**
 * The connect orb — the emotional centre of the app (mockup `.orb`).
 *
 * Off: faint ring, "Tap to connect". On: cyan glow ring, "Connected". A subtle
 * pulse animation runs while connecting so the state change feels alive
 * (docs/05: "motion on the connect state").
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font } from '../theme/tokens';
import type { TunnelState } from '../native/CumulusTunnel';

interface Props {
  readonly state: TunnelState;
  readonly onPress: () => void;
}

function label(state: TunnelState): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'reasserting':
      return 'Reconnecting…';
    case 'disconnecting':
      return 'Disconnecting…';
    case 'error':
      return 'Tap to retry';
    default:
      return 'Tap to connect';
  }
}

export function Orb({ state, onPress }: Props): React.JSX.Element {
  const on = state === 'connected';
  const busy = state === 'connecting' || state === 'reasserting' || state === 'disconnecting';
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!busy) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const glowColor = on ? color.cyan : color.hairlineStrong;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label(state)}>
      <Animated.View style={[styles.orb, { transform: [{ scale }] }]}>
        <View style={[styles.ring, { borderColor: glowColor }, on && styles.ringOn]} />
        <View style={[styles.core, on ? styles.coreOn : styles.coreOff]}>
          <PowerGlyph color={on ? color.cyan : '#9FB2C4'} />
          <Text style={[styles.state, { color: on ? color.cyan : '#9FB2C4' }]}>{label(state)}</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The power glyph (mockup SVG). POC: drawn with plain Views to avoid pulling in
 * react-native-svg; swap for an <Svg> path for a crisp vector.
 */
function PowerGlyph({ color: c }: { readonly color: string }): React.JSX.Element {
  return (
    <View style={styles.glyph}>
      <View style={[styles.glyphArc, { borderColor: c }]} />
      <View style={[styles.glyphStem, { backgroundColor: c }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  orb: {
    width: 168,
    height: 168,
    borderRadius: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 84,
    borderWidth: 2,
  },
  ringOn: {
    shadowColor: color.cyan,
    shadowOpacity: 0.6,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    // Android glow approximation.
    elevation: 12,
  },
  core: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: 1,
  },
  coreOn: { backgroundColor: color.orbCoreOn, borderColor: 'rgba(52,228,218,0.4)' },
  coreOff: { backgroundColor: color.orbCoreOff, borderColor: color.hairlineStrong },
  state: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  glyph: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  glyphArc: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2.2,
    borderTopColor: 'transparent',
    position: 'absolute',
    top: 6,
  },
  glyphStem: { width: 2.2, height: 11, borderRadius: 2, position: 'absolute', top: 2 },
});
