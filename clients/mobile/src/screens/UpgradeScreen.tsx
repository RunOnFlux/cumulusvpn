/**
 * Upgrade — MANAGE-ON-WEB (docs/05 option 1, the store-compliant path).
 *
 * STORE COMPLIANCE (read before touching this file):
 *  - The FLUX payment unlocks *app functionality* (premium speed), so it falls
 *    under Apple 3.1.1(a) / Google Play Payments. A live "send FLUX to unlock"
 *    screen inside the store build would be rejected.
 *  - So this screen is INFORMATIONAL: it explains exactly how to upgrade and
 *    shows this device's reference so the user can match it on the web, but it
 *    renders NO pay-to-address, NO QR, NO "Buy" button, and does NOT open an
 *    external purchase link (the URL is inert, selectable text). The actual
 *    prefilled pay-to-address flow lives on the web app (vpn.cumulusvpn.com).
 *  - Entitlement is chain-based and keyed to the WG pubkey, so once paid on the
 *    web the phone unlocks automatically within ~1 minute — nothing to enter.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Tier } from '@cumulusvpn/core';
import type { PaymentIdentity } from '../state/useVpn';
import { TierPill } from '../components/TierPill';
import { color, font, radius, space } from '../theme/tokens';

interface Props {
  readonly tier: Tier;
  readonly payment: PaymentIdentity | null;
  readonly onClose: () => void;
}

/** Where the prefilled pay-to-address upgrade flow lives (the web app). */
const UPGRADE_URL = 'vpn.cumulusvpn.com';

export function UpgradeScreen({ tier, payment, onClose }: Props): React.JSX.Element {
  const premium = tier === 'premium';
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{premium ? 'Your plan' : 'Upgrade to Premium'}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.tierRow}>
          <Text style={styles.tierLabel}>Current tier</Text>
          <TierPill tier={tier} />
        </View>

        {premium ? (
          <Text style={styles.body}>
            You’re on Premium — full speed on every gateway. Nothing to do here.
          </Text>
        ) : (
          <>
            <Text style={styles.body}>
              Free is capped at 100 KB/s. Premium unlocks full speed on every gateway — no account,
              paid once with FLUX for 30 days.
            </Text>

            {payment ? (
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Premium</Text>
                <Text style={styles.price}>
                  {payment.priceFlux} FLUX <Text style={styles.priceUnit}>/ 30 days</Text>
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      {!premium ? (
        <>
          <Text style={styles.section}>How to upgrade</Text>
          <View style={styles.steps}>
            <Step
              n={1}
              text={`Open ${UPGRADE_URL} in any browser — on this phone or a computer.`}
            />
            <Step
              n={2}
              text="Open Upgrade. The gateway, exact FLUX amount and pay-to address are prefilled there (with a QR)."
            />
            <Step n={3} text="Pay with FLUX from any wallet — scan the QR or copy the address." />
            <Step
              n={4}
              text="This device unlocks automatically within ~1 minute. Nothing to enter here."
            />
          </View>

          {payment ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                This device’s reference · press &amp; hold to copy
              </Text>
              <Text style={[styles.fieldValue, styles.mono]} selectable>
                {payment.memo}
              </Text>
              <Text style={styles.fieldHint}>
                Matches this phone to your payment on the site — no personal info.
              </Text>
            </View>
          ) : null}

          <Text style={styles.note}>
            Payment is verified on the Flux blockchain and tied to this device’s key — we never see
            who you are, and there’s no account to create.
          </Text>
        </>
      ) : null}
    </View>
  );
}

/** One numbered step in the how-to list. */
function Step({ n, text }: { readonly n: number; readonly text: string }): React.JSX.Element {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
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
    marginBottom: space.lg,
  },
  title: { color: color.ink, fontWeight: '700', fontSize: 17 },
  done: { color: color.cyan, fontWeight: '600', fontSize: 15 },
  card: {
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
  },
  tierRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierLabel: { color: color.inkDim, fontSize: 13 },
  body: { color: color.inkMuted, fontSize: 14, lineHeight: 20 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopColor: color.hairline,
    borderTopWidth: 1,
    paddingTop: space.md,
  },
  priceLabel: { color: color.inkDim, fontSize: 13 },
  price: { color: color.amber, fontSize: 18, fontWeight: '700' },
  priceUnit: { color: color.inkFaint, fontSize: 12, fontWeight: '500' },
  section: {
    color: color.inkFaint,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  steps: { gap: space.md },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: color.cyan, fontSize: 12, fontWeight: '700' },
  stepText: { flex: 1, color: color.inkMuted, fontSize: 14, lineHeight: 20 },
  field: {
    backgroundColor: color.orbCoreOn,
    borderRadius: radius.sm,
    padding: space.md,
    gap: 4,
    marginTop: space.lg,
  },
  fieldLabel: {
    fontSize: 10.5,
    color: color.inkFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldValue: { color: color.amber, fontSize: 15, fontWeight: '600' },
  fieldHint: { color: color.inkFaint, fontSize: 11.5, lineHeight: 16 },
  mono: { fontFamily: font.mono, fontSize: 13 },
  note: { color: color.inkFaint, fontSize: 12, lineHeight: 17, marginTop: space.lg },
});
