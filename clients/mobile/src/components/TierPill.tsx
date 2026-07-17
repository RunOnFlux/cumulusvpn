/**
 * The tier pill from the mockup: a translucent "FREE · 100 KB/s" chip or the
 * solid amber "PREMIUM" chip.
 */
import { StyleSheet, Text, View } from 'react-native';
import type { Tier } from '@cumulusvpn/core';
import { color, radius, font } from '../theme/tokens';

interface Props {
  readonly tier: Tier;
}

export function TierPill({ tier }: Props): React.JSX.Element {
  const premium = tier === 'premium';
  return (
    <View style={[styles.pill, premium ? styles.premium : styles.free]}>
      <Text style={[styles.label, premium ? styles.premiumInk : styles.freeInk]}>
        {premium ? 'PREMIUM' : 'FREE · 100 KB/s'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  free: { backgroundColor: color.glassStrong },
  premium: { backgroundColor: color.premiumBg },
  label: {
    fontFamily: font.mono,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  freeInk: { color: '#CFE0EE' },
  premiumInk: { color: color.premiumInk },
});
