/**
 * DNS choice (docs/03-gateway.md "DNS"): which resolver the tunnel's lookups go
 * to. The config's `DNS =` address is the whole mechanism — lookups travel
 * inside the tunnel to that address, and the gateway forwards them encrypted to
 * the same provider — so this is a pick from core `DNS_OPTIONS`, nothing more.
 *
 * The choice is read when a tunnel is BUILT (`useVpn.connect`), so a change
 * made while connected calls `onChange`, which reconnects to apply it now.
 * Device-local: it never leaves the phone.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DEFAULT_DNS, DNS_OPTIONS, type DnsChoice } from '@cumulusvpn/core';
import { loadDnsChoice, saveDnsChoice } from '../state/storage';
import { color, radius, space } from '../theme/tokens';

interface Props {
  /** True while a session exists — a change then reconnects. */
  readonly locked: boolean;
  /** Called once a new choice is saved (the screen reconnects when locked). */
  readonly onChange?: () => void;
}

export function DnsSection({ locked, onChange }: Props): React.JSX.Element {
  const [choice, setChoice] = useState<DnsChoice>(DEFAULT_DNS);
  // A tap that lands before the stored value loads must win over it.
  const touched = useRef(false);

  useEffect(() => {
    let alive = true;
    void loadDnsChoice().then((c) => {
      if (alive && !touched.current) {
        setChoice(c);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const select = (next: DnsChoice): void => {
    const changed = next !== choice;
    touched.current = true;
    setChoice(next);
    // Saved before onChange so the reconnect reads the new choice; re-tapping
    // the current option doesn't reconnect.
    void saveDnsChoice(next).then(() => {
      if (changed) {
        onChange?.();
      }
    });
  };

  return (
    <View style={styles.card}>
      <View style={styles.options} accessibilityRole="radiogroup">
        {DNS_OPTIONS.map((o) => {
          const on = choice === o.id;
          const isDefault = o.id === DEFAULT_DNS;
          return (
            <Pressable
              key={o.id}
              style={styles.option}
              onPress={() => select(o.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${o.provider}${isDefault ? ', default' : ''}. ${o.blurb}`}
            >
              <View style={[styles.radio, on && styles.radioOn]}>
                {on ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={styles.meta}>
                <Text style={styles.provider}>
                  {o.provider}
                  {isDefault ? <Text style={styles.default}> · Default</Text> : null}
                </Text>
                <Text style={styles.blurb}>{o.blurb}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.note}>
        Your DNS lookups go through the VPN to the provider you choose. It sees the VPN server's
        address, never yours.
      </Text>
      {locked && <Text style={styles.note}>Changing it reconnects the VPN.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.sm,
    gap: space.sm,
  },
  options: { gap: space.xs },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 6,
  },
  // Same radio as the multi-hop route-style rows on the connect screen.
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: color.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: color.amber },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.amber },
  meta: { flex: 1 },
  provider: { color: color.ink, fontSize: 14, fontWeight: '600' },
  default: { color: color.inkFaint, fontSize: 12, fontWeight: '400' },
  blurb: { color: color.inkDim, fontSize: 12, marginTop: 1 },
  note: { color: color.inkFaint, fontSize: 12, lineHeight: 17 },
});
