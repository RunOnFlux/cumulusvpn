/**
 * Upgrade — pay in FLUX. Two modes, chosen by the remote `inAppUpgrade` flag
 * (per platform, see lib/flags.ts):
 *
 *  - inAppUpgrade ON  → the full in-app flow: QR of the BIP21 `flux:` payment
 *    URI, an "Open in wallet" hand-off that tries each registered wallet scheme
 *    (`zel:` Zelcore → `flux:` → `ssp:` SSP) until one opens prefilled, and
 *    copyable pay-to details. Used where a crypto-pay flow is acceptable (Android).
 *  - inAppUpgrade OFF → the store-compliant "manage on the web" copy: no QR, no
 *    pay-to address, no tappable purchase link — just this device's reference +
 *    steps pointing to vpn.cumulusvpn.com. The safe default (also used whenever
 *    the flags can't be fetched), so App Store review sees no IAP circumvention.
 *
 * Entitlement is chain-based + device-key-scoped, so the phone unlocks itself
 * ~1 min after the transfer confirms, regardless of where it was paid.
 */
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { walletDeepLink, walletDeepLinks } from '@cumulusvpn/core';
import type { Tier } from '@cumulusvpn/core';
import type { PaymentIdentity } from '../state/useVpn';
import { Qr } from '../components/Qr';
import { TierPill } from '../components/TierPill';
import { color, font, radius, space } from '../theme/tokens';

interface Props {
  readonly tier: Tier;
  readonly payment: PaymentIdentity | null;
  /** Remote flag: when true, show the in-app pay flow; else "manage on web". */
  readonly inAppUpgrade: boolean;
  readonly onClose: () => void;
}

/** Where the prefilled pay-to-address upgrade flow lives on the web. */
const UPGRADE_URL = 'vpn.cumulusvpn.com';

export function UpgradeScreen({ tier, payment, inAppUpgrade, onClose }: Props): React.JSX.Element {
  const premium = tier === 'premium';
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.body}
      showsVerticalScrollIndicator={false}
    >
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
          <Text style={styles.copy}>
            You’re on Premium — full speed on every gateway. Nothing to do here.
          </Text>
        ) : (
          <>
            <Text style={styles.copy}>
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

      {premium || !payment ? null : inAppUpgrade ? (
        <InAppPay payment={payment} />
      ) : (
        <ManageOnWeb payment={payment} />
      )}
    </ScrollView>
  );
}

/** Full in-app pay flow: QR + wallet hand-off + prefilled details. */
function InAppPay({ payment }: { readonly payment: PaymentIdentity }): React.JSX.Element {
  const [walletError, setWalletError] = useState<string | null>(null);
  // The QR carries the BIP21 `flux:` payload — that's what a wallet's in-app
  // scanner (Zelcore / SSP) parses to a prefilled send.
  const qrLink = walletDeepLink(payment.address, payment.priceFlux, payment.memo, 'flux');
  // Tapping hands off via the OS. Wallets only open a scheme they registered as
  // an intent filter — Zelcore registers `zel:`, SSP `ssp:` — so try each in
  // preference order until one has a handler (openURL rejects when none does).
  const links = walletDeepLinks(payment.address, payment.priceFlux, payment.memo);

  const openWallet = async (): Promise<void> => {
    setWalletError(null);
    for (const { uri } of links) {
      try {
        await Linking.openURL(uri);
        return;
      } catch {
        // No app registered this scheme — fall through to the next.
      }
    }
    setWalletError(
      'No FLUX wallet found. Install Zelcore or SSP Wallet, or scan the QR / copy the details below.',
    );
  };

  return (
    <>
      <View style={styles.qrWrap}>
        <Qr value={qrLink} size={196} />
        <Text style={styles.qrCap}>Scan with Zelcore / SSP Wallet</Text>
      </View>

      <Pressable
        onPress={() => void openWallet()}
        accessibilityRole="button"
        style={({ pressed }) => [styles.payBtn, pressed && styles.payBtnPressed]}
      >
        <Text style={styles.payBtnLabel}>Open in wallet →</Text>
      </Pressable>
      {walletError ? <Text style={styles.walletError}>{walletError}</Text> : null}

      <Field label="Amount" value={`${payment.priceFlux} FLUX`} />
      <Field label="Pay-to address" value={payment.address} mono />
      <Field label="Message (required)" value={payment.memo} mono />

      <Text style={styles.section}>How it works</Text>
      <View style={styles.steps}>
        <Step
          n={1}
          text="Tap “Open in wallet” (or scan the QR) — your FLUX wallet opens with the amount, address and message prefilled."
        />
        <Step
          n={2}
          text="Send the transfer. The message is what ties it to this device — don’t remove it."
        />
        <Step
          n={3}
          text="This device unlocks automatically within ~1 minute, on every gateway at once."
        />
      </View>

      <Text style={styles.note}>
        Payment is verified on the Flux blockchain and tied to this device’s key — we never see who
        you are, and there’s no account to create. Tap-and-hold any field to copy it.
      </Text>
    </>
  );
}

/** Store-compliant "manage on the web" copy: no QR / address / purchase link. */
function ManageOnWeb({ payment }: { readonly payment: PaymentIdentity }): React.JSX.Element {
  return (
    <>
      <Text style={styles.section}>How to upgrade</Text>
      <View style={styles.steps}>
        <Step n={1} text={`Open ${UPGRADE_URL} in any browser — on this phone or a computer.`} />
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

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>This device’s reference · tap &amp; hold to copy</Text>
        <Text style={[styles.fieldValue, styles.fieldMono]} selectable>
          {payment.memo}
        </Text>
        <Text style={styles.fieldHint}>Matches this phone to your payment on the site.</Text>
      </View>

      <Text style={styles.note}>
        Payment is verified on the Flux blockchain and tied to this device’s key — we never see who
        you are, and there’s no account to create.
      </Text>
    </>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, mono && styles.fieldMono]} selectable>
        {value}
      </Text>
    </View>
  );
}

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
  root: { flex: 1, paddingHorizontal: space.xl },
  body: { paddingTop: space.sm, paddingBottom: space.xxl },
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
  copy: { color: color.inkMuted, fontSize: 14, lineHeight: 20 },
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
  qrWrap: { alignItems: 'center', gap: 8, marginTop: space.xl },
  qrCap: { color: color.inkFaint, fontSize: 11.5, fontFamily: font.mono },
  payBtn: {
    backgroundColor: color.amber,
    borderRadius: radius.sm,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: space.lg,
  },
  payBtnPressed: { opacity: 0.85 },
  payBtnLabel: { color: '#3A2606', fontSize: 15, fontWeight: '700' },
  walletError: { color: color.red, fontSize: 12.5, lineHeight: 17, marginTop: space.sm },
  field: {
    backgroundColor: color.orbCoreOn,
    borderRadius: radius.sm,
    padding: space.md,
    gap: 4,
    marginTop: space.sm,
  },
  fieldLabel: {
    fontSize: 10.5,
    color: color.inkFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldValue: { color: color.ink, fontSize: 14, fontWeight: '600' },
  fieldMono: { fontFamily: font.mono, fontSize: 12.5, fontWeight: '400' },
  fieldHint: { color: color.inkFaint, fontSize: 11.5, lineHeight: 16 },
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
  stepNumText: { color: color.amber, fontSize: 12, fontWeight: '700' },
  stepText: { flex: 1, color: color.inkMuted, fontSize: 14, lineHeight: 20 },
  note: { color: color.inkFaint, fontSize: 12, lineHeight: 17, marginTop: space.lg },
});
