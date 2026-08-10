/**
 * Upgrade — up to two purchase surfaces, each behind its own remote flag
 * (lib/flags.ts):
 *
 *  - `iapPurchase` → SubscribeSection: auto-renewable store subscriptions
 *    via Apple IAP / Google Play Billing. Store-compliant by construction;
 *    the ONLY surface iOS builds ever render. Verified server-side by the
 *    payments bridge, which settles the entitlement on the Flux chain
 *    (docs/18-payments-bridge.md).
 *  - `inAppUpgrade` → InAppPay: the FLUX crypto flow (QR + wallet hand-off)
 *    — direct-APK Android builds only, never iOS, a store violation if shown
 *    in store builds.
 *
 * With both flags off the app shows NO purchase UI anywhere — this screen is
 * unreachable (no upsell line, no tappable tier pill, no upgrade route).
 *
 * Entitlement is chain-based + device-key-scoped either way, so the phone
 * unlocks itself ~1 min after the chain tx confirms, regardless of rail.
 */
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useState } from 'react';
import { ApiError, redeemVoucher, walletDeepLink, walletDeepLinks } from '@cumulusvpn/core';
import type { Tier } from '@cumulusvpn/core';
import { openRedeemOfferCodeAndroid, presentCodeRedemptionSheetIOS } from 'react-native-iap';
import type { PaymentIdentity } from '../state/useVpn';
import type { IapState } from '../state/useIap';
import type { IapPlan } from '../lib/iap';
import { Qr } from '../components/Qr';
import { TierPill } from '../components/TierPill';
import { color, font, radius, space } from '../theme/tokens';

interface Props {
  readonly tier: Tier;
  /** RFC3339 timestamp premium is paid through, or null when free/unknown. */
  readonly paidUntil: string | null;
  readonly payment: PaymentIdentity | null;
  /** Crypto (FLUX) section visible — remote `inAppUpgrade` flag. */
  readonly cryptoEnabled: boolean;
  /** In-app voucher redeem box visible — remote `voucherRedeem` flag (never iOS). */
  readonly voucherEnabled: boolean;
  /** Store subscription section visible — remote `iapPurchase` flag. */
  readonly iap: IapState | null;
  readonly onClose: () => void;
}

/** OS subscription-management deep link (Apple requires this to be reachable). */
const MANAGE_URL =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
const PRIVACY_URL = 'https://cumulusvpn.com/privacy';
/** Apple's standard EULA for auto-renewable subscriptions. */
const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format an RFC3339 expiry into a short date + whole days remaining. Hand-rolled
 * (no `Intl`/`toLocaleDateString`) so it's identical across Hermes/JSC.
 */
export function formatExpiry(iso: string | null): { date: string; daysLeft: number } | null {
  if (!iso) {
    return null;
  }
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return null;
  }
  const d = new Date(t);
  const daysLeft = Math.max(0, Math.ceil((t - Date.now()) / 86_400_000));
  return { date: `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, daysLeft };
}

export function UpgradeScreen({
  tier,
  paidUntil,
  payment,
  cryptoEnabled,
  voucherEnabled,
  iap,
  onClose,
}: Props): React.JSX.Element {
  const premium = tier === 'premium';
  const expiry = formatExpiry(paidUntil);
  const showCrypto = cryptoEnabled && payment !== null;
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
          <>
            <Text style={styles.copy}>
              {showCrypto
                ? 'You’re on Premium — full speed on every gateway. Pay again any time to add more time; it stacks on top of your current expiry.'
                : 'You’re on Premium — full speed on every gateway.'}
            </Text>
            {expiry ? (
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Active until</Text>
                <Text style={styles.price}>
                  {expiry.date}{' '}
                  <Text style={styles.priceUnit}>
                    · {expiry.daysLeft} {expiry.daysLeft === 1 ? 'day' : 'days'} left
                  </Text>
                </Text>
              </View>
            ) : null}
            {iap ? (
              <Pressable
                onPress={() => void Linking.openURL(MANAGE_URL)}
                accessibilityRole="link"
                hitSlop={8}
              >
                <Text style={styles.link}>Manage subscription</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.copy}>
              {showCrypto
                ? 'Free is capped at 100 KB/s. Premium unlocks full speed on every gateway — no account, paid once with FLUX for 30 days.'
                : 'Free is capped at 100 KB/s. Premium unlocks full speed on every gateway — no account needed.'}
            </Text>
            {showCrypto ? (
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

      {iap && !premium ? <SubscribeSection iap={iap} /> : null}
      {voucherEnabled && payment ? <RedeemSection code={payment.code} /> : null}
      {iap ? <StoreOfferCodeRow /> : null}
      {showCrypto ? <InAppPay payment={payment} premium={premium} /> : null}
    </ScrollView>
  );
}

/**
 * Store-billing subscription section — the only purchase surface store
 * builds render. Prices come from the store (localized); the chain
 * settlement is invisible to the user beyond a brief "Activating…".
 */
function SubscribeSection({ iap }: { readonly iap: IapState }): React.JSX.Element {
  const [plan, setPlan] = useState<IapPlan>('monthly');
  const busy = iap.phase === 'purchasing' || iap.phase === 'verifying';

  if (iap.phase === 'done') {
    return (
      <View style={styles.card}>
        <Text style={styles.copy}>
          Subscribed — full speed is unlocked on every gateway. Manage or cancel any time in your
          store account.
        </Text>
      </View>
    );
  }

  return (
    <>
      <Text style={styles.section}>Subscribe</Text>
      {!iap.ready ? (
        <View style={[styles.card, styles.iapLoading]}>
          {iap.error ? (
            <Text style={styles.copy}>{iap.error}</Text>
          ) : (
            <>
              <ActivityIndicator color={color.cyan} />
              <Text style={styles.copy}>Loading plans…</Text>
            </>
          )}
        </View>
      ) : iap.phase === 'activating' ? (
        <View style={[styles.card, styles.iapLoading]}>
          <ActivityIndicator color={color.amber} />
          <Text style={styles.copy}>
            Activating on the decentralized network… full speed unlocks on every gateway within a
            minute. You can leave this screen.
          </Text>
        </View>
      ) : iap.phase === 'pending_store' ? (
        <View style={styles.card}>
          <Text style={styles.copy}>
            Waiting for your payment to be approved by the store. Premium activates automatically
            once it completes.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.planRow}>
            <PlanCard
              label="Monthly"
              price={iap.prices.monthly}
              unit="/ month"
              selected={plan === 'monthly'}
              onSelect={() => setPlan('monthly')}
            />
            <PlanCard
              label="Annual"
              price={iap.prices.annual}
              unit="/ year"
              selected={plan === 'annual'}
              onSelect={() => setPlan('annual')}
            />
          </View>

          <Pressable
            onPress={() => iap.purchase(plan)}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.payBtn, (pressed || busy) && styles.payBtnPressed]}
          >
            <Text style={styles.payBtnLabel}>{busy ? 'Opening store…' : 'Subscribe'}</Text>
          </Pressable>
          {iap.error ? <Text style={styles.walletError}>{iap.error}</Text> : null}

          <Text style={styles.note}>
            Auto-renews until cancelled; cancel any time in your store account. Payment is handled
            by the store — we never see your card. Premium is activated on the Flux blockchain, tied
            only to this device’s anonymous key.
          </Text>
          <View style={styles.legalRow}>
            <Pressable onPress={() => iap.restore()} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.link}>Restore Purchases</Text>
            </Pressable>
            <Pressable
              onPress={() => void Linking.openURL(MANAGE_URL)}
              accessibilityRole="link"
              hitSlop={8}
            >
              <Text style={styles.link}>Manage Subscription</Text>
            </Pressable>
            <Pressable
              onPress={() => void Linking.openURL(PRIVACY_URL)}
              accessibilityRole="link"
              hitSlop={8}
            >
              <Text style={styles.link}>Privacy Policy</Text>
            </Pressable>
            <Pressable
              onPress={() => void Linking.openURL(TERMS_URL)}
              accessibilityRole="link"
              hitSlop={8}
            >
              <Text style={styles.link}>Terms of Use</Text>
            </Pressable>
          </View>
        </>
      )}
    </>
  );
}

function PlanCard({
  label,
  price,
  unit,
  selected,
  onSelect,
}: {
  readonly label: string;
  readonly price: string | null;
  readonly unit: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.planCard, selected && styles.planCardSelected]}
    >
      <Text style={styles.planLabel}>{label}</Text>
      <Text style={styles.planPrice}>{price ?? '—'}</Text>
      <Text style={styles.planUnit}>{unit}</Text>
    </Pressable>
  );
}

/**
 * In-app redeem box for OUR voucher codes — direct-APK Android only (the
 * `voucherRedeem` flag can never be true on iOS; Apple 3.1.1 prohibits
 * custom unlock codes). A granted code settles on-chain; the app's normal
 * tier polling flips premium within ~1 min of confirmation.
 */
function RedeemSection({ code }: { readonly code: string }): React.JSX.Element {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<number | null>(null);

  const redeem = async (): Promise<void> => {
    if (busy || input.trim() === '') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await redeemVoucher(fetch, { code, voucher: input.trim() });
      if (outcome.type === 'grant_days') {
        setGranted(outcome.days);
      } else {
        setError('This is a card-discount code — apply it at checkout on cumulusvpn.com.');
      }
    } catch (e) {
      const slug = e instanceof ApiError ? e.slug : '';
      setError(
        slug === 'expired'
          ? 'This code has expired.'
          : slug === 'exhausted'
            ? 'This code has already been fully used.'
            : slug === 'already_redeemed'
              ? 'This device has already redeemed this code.'
              : slug === 'temporarily_unavailable' || slug === 'rate_limited'
                ? 'Redemption is briefly unavailable — try again in a few minutes.'
                : 'That code isn’t valid. Check for typos and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (granted !== null) {
    return (
      <>
        <Text style={styles.section}>Redeem a code</Text>
        <View style={[styles.card, styles.iapLoading]}>
          <ActivityIndicator color={color.amber} />
          <Text style={styles.copy}>
            {granted} day{granted === 1 ? '' : 's'} of Premium is activating on the decentralized
            network — it unlocks on every gateway within a minute.
          </Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Text style={styles.section}>Redeem a code</Text>
      <TextInput
        style={styles.redeemInput}
        value={input}
        onChangeText={(v) => {
          setInput(v);
          setError(null);
        }}
        placeholder="CVPN-XXXXX-XXXXX"
        placeholderTextColor={color.inkFaint}
        autoCapitalize="characters"
        autoCorrect={false}
        onSubmitEditing={() => void redeem()}
      />
      <Pressable
        onPress={() => void redeem()}
        disabled={busy || input.trim() === ''}
        accessibilityRole="button"
        style={({ pressed }) => [styles.payBtn, (pressed || busy) && styles.payBtnPressed]}
      >
        <Text style={styles.payBtnLabel}>{busy ? 'Checking…' : 'Redeem'}</Text>
      </Pressable>
      {error ? <Text style={styles.walletError}>{error}</Text> : null}
    </>
  );
}

/**
 * Store-sanctioned offer/promo code sheets — Apple's and Play's OWN code
 * systems (configured in the consoles), not our voucher codes. Always legal
 * to show alongside IAP; redemptions surface as ordinary store transactions
 * through the existing purchase listener + reconcile path.
 */
function StoreOfferCodeRow(): React.JSX.Element {
  const open = async (): Promise<void> => {
    try {
      if (Platform.OS === 'ios') {
        await presentCodeRedemptionSheetIOS();
      } else {
        await openRedeemOfferCodeAndroid();
      }
    } catch {
      // Sheet unavailable (old OS, no store session) — nothing to surface.
    }
  };
  return (
    <Pressable onPress={() => void open()} accessibilityRole="button" hitSlop={8}>
      <Text style={[styles.link, styles.offerCodeRow]}>
        {Platform.OS === 'ios' ? 'Redeem an offer code' : 'Redeem a Play promo code'}
      </Text>
    </Pressable>
  );
}

/** Full in-app pay flow: QR + wallet hand-off + prefilled details. */
function InAppPay({
  payment,
  premium,
}: {
  readonly payment: PaymentIdentity;
  readonly premium: boolean;
}): React.JSX.Element {
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
      <Text style={styles.section}>{premium ? 'Add more time' : 'Pay with FLUX'}</Text>
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
          text={
            premium
              ? 'Another 30 days is added on top of your current expiry within ~1 minute, on every gateway at once.'
              : 'This device unlocks automatically within ~1 minute, on every gateway at once.'
          }
        />
      </View>

      <View style={styles.tip}>
        <Text style={styles.tipText}>
          <Text style={styles.tipLead}>Prepay ahead: </Text>
          send a multiple of the amount to add that many months at once — e.g.{' '}
          {payment.priceFlux * 3} FLUX = 3 months. Extra months stack (up to 24), so you can top up
          any time.
        </Text>
      </View>

      <Text style={styles.note}>
        Payment is verified on the Flux blockchain and tied to this device’s key — we never see who
        you are, and there’s no account to create. Tap-and-hold any field to copy it.
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
  tip: {
    marginTop: space.lg,
    backgroundColor: color.orbCoreOn,
    borderRadius: radius.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  tipText: { color: color.inkMuted, fontSize: 13, lineHeight: 19 },
  tipLead: { color: color.amber, fontWeight: '700' },
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
  iapLoading: { alignItems: 'center', gap: space.md },
  planRow: { flexDirection: 'row', gap: space.md },
  planCard: {
    flex: 1,
    backgroundColor: color.glass,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    alignItems: 'center',
    gap: 4,
  },
  planCardSelected: { borderColor: color.amber, backgroundColor: color.orbCoreOn },
  planLabel: { color: color.inkDim, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  planPrice: { color: color.ink, fontSize: 20, fontWeight: '700' },
  planUnit: { color: color.inkFaint, fontSize: 12 },
  link: { color: color.cyan, fontSize: 13, fontWeight: '600' },
  legalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
    marginTop: space.lg,
    justifyContent: 'center',
  },
  redeemInput: {
    backgroundColor: color.orbCoreOn,
    borderColor: color.hairline,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: color.ink,
    fontFamily: font.mono,
    fontSize: 15,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  offerCodeRow: { textAlign: 'center', marginTop: space.lg },
});
