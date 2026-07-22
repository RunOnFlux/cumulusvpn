/**
 * Pre-connection data disclosure — App Store Guideline 5.4.
 *
 * 5.4 requires a VPN app to declare "what user data will be collected and how
 * it will be used on an app screen prior to any user action to purchase or
 * otherwise use the service". A linked privacy policy is explicitly NOT
 * sufficient, so this renders as a first-run gate in front of the whole app
 * (see App.tsx) and stays re-openable from Settings.
 *
 * Everything stated here must stay true to store/privacy-policy.md and the
 * published policy at cumulusvpn.com/privacy — the App Privacy label, the
 * privacy manifest and this screen are checked against each other in review.
 * If the substance changes, bump DISCLOSURE_VERSION so users see it again.
 */
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, radius, space } from '../theme/tokens';

const PRIVACY_URL = 'https://cumulusvpn.com/privacy';

interface Props {
  /** Acknowledge the disclosure and enter the app (first-run gate). */
  readonly onAccept?: () => void;
  /** Dismiss without re-acknowledging (opened from Settings to re-read). */
  readonly onClose?: () => void;
}

/** One titled group of plain-language disclosure bullets. */
function Group({
  title,
  points,
}: {
  readonly title: string;
  readonly points: readonly string[];
}): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {points.map((p) => (
        <View key={p} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{p}</Text>
        </View>
      ))}
    </View>
  );
}

export function DisclosureScreen({ onAccept, onClose }: Props): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Before you connect</Text>
        {onClose ? (
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lede}>
          CumulusVPN is a decentralized VPN. Here is exactly what is collected and how it is
          used — in full, before you use the service.
        </Text>

        <Group
          title="What we collect"
          points={[
            'No activity, traffic, DNS or connection logs. Ever.',
            'No account, email address or phone number is required — your identity is just a key.',
            'No third-party analytics, advertising or tracking SDKs are bundled in this app.',
          ]}
        />

        <Group
          title="What stays on this device"
          points={[
            'Your WireGuard keypair is generated on this device; the private key never leaves it.',
            'Your preferences, favourite countries and a cached gateway list are stored locally only.',
          ]}
        />

        <Group
          title="What a gateway necessarily sees"
          points={[
            'Your IP address and encrypted packets — this is unavoidable, it is how traffic is routed to you.',
            'It is used only to carry your session and is not retained after the session ends.',
            'Gateways are run by independent Flux node operators, not by us.',
          ]}
        />

        <Group
          title="Premium"
          points={[
            'Premium is purchased on the web with FLUX cryptocurrency, not inside this app.',
            'Entitlement is checked using your public key alone — no personal or payment details are stored.',
          ]}
        />

        <Pressable
          style={styles.linkRow}
          onPress={() => void Linking.openURL(PRIVACY_URL)}
          accessibilityRole="link"
          accessibilityLabel="Read the full privacy policy"
        >
          <Text style={styles.linkText}>Read the full privacy policy</Text>
          <Text style={styles.chev}>›</Text>
        </Pressable>
      </ScrollView>

      {onAccept ? (
        <View style={styles.footer}>
          <Pressable
            style={styles.cta}
            onPress={onAccept}
            accessibilityRole="button"
            accessibilityLabel="Continue to CumulusVPN"
          >
            <Text style={styles.ctaText}>Continue</Text>
          </Pressable>
        </View>
      ) : null}
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
  title: { color: color.ink, fontWeight: '700', fontSize: 20 },
  done: { color: color.cyan, fontWeight: '600', fontSize: 15 },
  body: { paddingBottom: space.xxl },
  lede: {
    color: color.inkMuted,
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: space.lg,
  },
  card: {
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.sm,
  },
  cardTitle: {
    color: color.ink,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: space.sm,
  },
  bulletRow: { flexDirection: 'row', marginTop: space.xs },
  bulletDot: {
    color: color.cyan,
    fontSize: 13,
    lineHeight: 19,
    width: 14,
  },
  bulletText: {
    color: color.inkDim,
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 14,
    marginTop: space.sm,
  },
  linkText: { color: color.cyan, fontSize: 15, fontWeight: '600' },
  chev: { color: color.inkDim, fontSize: 20 },
  footer: { paddingVertical: space.md },
  cta: {
    backgroundColor: color.cyan,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaText: { color: color.sky1, fontSize: 16, fontWeight: '700' },
});
