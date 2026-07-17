/**
 * Upgrade — MANAGE-ON-WEB (docs/05 option 1, the store-compliant path).
 *
 * STORE COMPLIANCE (read before touching this file):
 *  - The FLUX payment unlocks *app functionality* (premium speed), so it falls
 *    under Apple 3.1.1(a) / Google Play Payments. A live "send FLUX to unlock"
 *    screen inside the store build would be rejected.
 *  - Therefore this screen is CONNECT-ONLY informational: it shows the current
 *    tier (a neutral fact from `/v1/status`) and, when free, a single plain
 *    line — "Upgrade at cumulusvpn.com".
 *  - On iOS there is NO tappable external link and NO purchase/"Buy" UI. The
 *    URL is shown as inert, selectable text. The user pays on the web/desktop;
 *    because entitlement is chain-based and keyed to the WG pubkey, the phone
 *    unlocks automatically within ~1 minute.
 *  - The payment CODE/MEMO is shown as a neutral reference so the user can find
 *    their key on the website. It is NOT a call to action here.
 *  - Never render this as a payment form in an iOS/Android store build. The
 *    beautiful pay-to-address screen lives on web + desktop only.
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Tier } from '@cumulusvpn/core';
import type { PaymentIdentity } from '../state/useVpn';
import { TierPill } from '../components/TierPill';
import { color, font, radius, space } from '../theme/tokens';

interface Props {
  readonly tier: Tier;
  readonly payment: PaymentIdentity | null;
  readonly onClose: () => void;
}

const MANAGE_URL = 'cumulusvpn.com';

export function UpgradeScreen({ tier, payment, onClose }: Props): React.JSX.Element {
  const premium = tier === 'premium';
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Your plan</Text>
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
              You’re on the free tier (100 KB/s). To unlock full speed, upgrade on the web with FLUX
              — no account needed. Your device unlocks automatically within about a minute.
            </Text>

            {/*
              Inert, selectable URL — NOT a tappable link (iOS store compliance).
              The user types it into a browser; we never call Linking.openURL on
              iOS for a purchase destination.
            */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Upgrade at</Text>
              <Text style={styles.fieldValue} selectable>
                {MANAGE_URL}
              </Text>
            </View>

            {payment ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Your key reference (find it on the site)</Text>
                <Text style={[styles.fieldValue, styles.mono]} selectable>
                  {payment.memo}
                </Text>
              </View>
            ) : null}

            <Text style={styles.note}>
              Payment is verified on the Flux blockchain and tied to your device key — we never see
              who you are.
            </Text>
          </>
        )}
      </View>

      {/*
        POC / fast-follow: Apple IAP + Google Play Billing (docs/05 option 2) as
        an in-app fiat rail. Would gate behind Platform checks and StoreKit /
        BillingClient bridges — deliberately absent at launch.
      */}
      {Platform.OS === 'android' ? (
        <Text style={styles.androidHint}>
          {/* Android allows an external-offer link under the External Offers
              program, but commission still applies — kept inert for launch. */}
        </Text>
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
  field: {
    backgroundColor: color.orbCoreOn,
    borderRadius: radius.sm,
    padding: space.md,
    gap: 4,
  },
  fieldLabel: {
    fontSize: 10.5,
    color: color.inkFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldValue: { color: color.amber, fontSize: 15, fontWeight: '600' },
  mono: { fontFamily: font.mono, fontSize: 13 },
  note: { color: color.inkFaint, fontSize: 12, lineHeight: 17 },
  androidHint: { height: 0 },
});
