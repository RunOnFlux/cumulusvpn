/**
 * Thin typed wrapper over react-native-iap (OpenIAP / Nitro) for the two
 * auto-renewable subscriptions. Owns the store-side mechanics; the
 * server-side truth lives in the payments bridge (docs/18-payments-bridge.md).
 *
 * The load-bearing rule: `finishTransaction` (which ACKNOWLEDGES on Android
 * — Play refunds unacknowledged purchases after 3 days) is called ONLY after
 * the bridge accepted the receipt. Anything unfinished is retried by
 * `reconcile()` on the next app start, so a crash between purchase and
 * verify can't strand a paid user.
 */
import { Platform } from 'react-native';
import {
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
} from 'react-native-iap';
import type {
  Product,
  ProductSubscriptionAndroid,
  Purchase,
  PurchaseError,
  SubscriptionOffer,
} from 'react-native-iap';
import {
  ApiError,
  appAccountToken,
  claimApplePurchase,
  claimGooglePurchase,
} from '@cumulusvpn/core';

/** Store product ids (App Store Connect) — Android uses one subscription
 *  product with base plans, selected via offer tokens. */
export const IOS_SKU_MONTHLY = 'cvpn.premium.monthly';
export const IOS_SKU_ANNUAL = 'cvpn.premium.annual';
/** Play subscription product id; plans are base plans under it. */
export const ANDROID_SKU = 'premium';
export const ANDROID_BASE_PLAN_MONTHLY = 'premium-monthly';
export const ANDROID_BASE_PLAN_ANNUAL = 'premium-annual';

export type IapPlan = 'monthly' | 'annual';

export interface IapPrices {
  /** Store-localized display price, e.g. "$1.99" / "1,99 €". Never hardcode. */
  readonly monthly: string | null;
  readonly annual: string | null;
  /**
   * Whole-percent saving of the annual plan against twelve monthly payments,
   * from the store's own numeric prices in the user's currency — null when
   * either price is missing or the annual plan saves nothing.
   */
  readonly annualSavingPct: number | null;
}

/** Saving of `annual` vs 12 × `monthly`, in whole percent; null when not a real saving. */
export function annualSaving(monthly: number | null, annual: number | null): number | null {
  if (monthly === null || annual === null || !(monthly > 0) || !(annual > 0)) {
    return null;
  }
  const pct = Math.round((1 - annual / (12 * monthly)) * 100);
  return pct > 0 ? pct : null;
}

export interface VerifyResult {
  readonly ok: boolean;
  /** True when the purchase completed but is awaiting external approval (Android PENDING). */
  readonly pending: boolean;
  /**
   * The subscription belongs to another identity of this store account — this
   * device before a reinstall, or another phone. Only a deliberate transfer
   * moves it here (docs/18 "Claims and transfers").
   */
  readonly elsewhere?: boolean;
}

/** What a reconcile pass found in the store account. */
export interface ReconcileResult {
  /** At least one purchase was accepted for this device. */
  readonly any: boolean;
  /** Purchases owned by another identity — offer to move them here. */
  readonly elsewhere: readonly Purchase[];
  /** The store account holds one of our subscriptions at all (for "Manage subscription"). */
  readonly holdsSubscription: boolean;
  /**
   * That subscription will renew. False after the user cancels: the store keeps
   * listing it until the paid period ends, so holding it ≠ renewing it.
   */
  readonly autoRenewing: boolean;
}

const iosSkus = [IOS_SKU_MONTHLY, IOS_SKU_ANNUAL];

function skusForPlatform(): string[] {
  return Platform.OS === 'ios' ? iosSkus : [ANDROID_SKU];
}

/** Android: the standardized offers list off the fetched subscription product. */
function androidOffers(product: Product | undefined): SubscriptionOffer[] | undefined {
  return (product as ProductSubscriptionAndroid | undefined)?.subscriptionOffers ?? undefined;
}

/** Android: find the offer token for a base plan on the fetched product. */
function androidOfferToken(product: Product | undefined, basePlanId: string): string | null {
  return (
    androidOffers(product)?.find((o) => o.basePlanIdAndroid === basePlanId)?.offerTokenAndroid ??
    null
  );
}

export interface IapSession {
  readonly prices: IapPrices;
  /** Kick off the platform purchase sheet. Resolution arrives via the listener. */
  readonly purchase: (plan: IapPlan, code: string) => Promise<void>;
  /** Re-verify + finish everything the store still holds (restore & repair). */
  readonly reconcile: (code: string) => Promise<ReconcileResult>;
  /**
   * Move subscriptions owned by another identity to `code` — the user said
   * yes. Rejects with the bridge's reason (e.g. `transfer_too_soon`).
   */
  readonly transfer: (purchases: readonly Purchase[], code: string) => Promise<boolean>;
  readonly dispose: () => void;
}

export interface IapCallbacks {
  /** A purchase reached the bridge and was accepted (grant queued/duplicate). */
  readonly onVerified: () => void;
  /** Android PENDING purchase — awaiting external payment approval. */
  readonly onPending: () => void;
  /** The user closed the store sheet without buying — not an error, but the UI must reset. */
  readonly onCancelled: () => void;
  readonly onError: (message: string) => void;
}

/**
 * Verify one store purchase against the bridge; finish/acknowledge it only
 * on acceptance. Returns whether the bridge accepted it.
 *
 * Goes through the bridge's CLAIM endpoint, not the older strict verify: a
 * claim also accepts a purchase no identity owns yet — an Apple offer code or
 * Play promo code redeemed outside the purchase sheet carries no payment code
 * — while a purchase owned by another identity comes back `elsewhere`, never
 * credited here unless `transfer` says the user chose to move it.
 */
export async function verifyAndFinish(
  purchase: Purchase,
  code: string,
  transfer = false,
): Promise<VerifyResult> {
  if (purchase.purchaseState === 'pending') {
    return { ok: false, pending: true };
  }
  const token = purchase.purchaseToken;
  if (!token) {
    return { ok: false, pending: false };
  }
  try {
    const res =
      Platform.OS === 'ios'
        ? await claimApplePurchase(fetch, { code, signedTransaction: token, transfer })
        : await claimGooglePurchase(fetch, { code, purchaseToken: token, transfer });
    if (!res.accepted) {
      return { ok: false, pending: false };
    }
  } catch (e) {
    if (e instanceof ApiError && e.slug === 'owned_by_other_device') {
      return { ok: false, pending: false, elsewhere: true };
    }
    throw e;
  }
  await finishTransaction({ purchase, isConsumable: false });
  return { ok: true, pending: false };
}

/** Our subscription products, on either store. */
function isOurSubscription(p: Purchase): boolean {
  return p.productId === ANDROID_SKU || iosSkus.includes(p.productId);
}

/**
 * Connect to the store, load products, and wire purchase listeners. Call
 * `dispose()` on unmount; the module survives repeated init (idempotent in
 * the underlying library).
 */
export async function startIapSession(code: string, cb: IapCallbacks): Promise<IapSession> {
  await initConnection();
  const products = await fetchProducts({ skus: skusForPlatform(), type: 'subs' });
  const list: Product[] = Array.isArray(products) ? (products as Product[]) : [];

  const byId = new Map(list.map((p) => [p.id, p]));
  const androidProduct = byId.get(ANDROID_SKU);
  const prices: IapPrices =
    Platform.OS === 'ios'
      ? {
          monthly: byId.get(IOS_SKU_MONTHLY)?.displayPrice ?? null,
          annual: byId.get(IOS_SKU_ANNUAL)?.displayPrice ?? null,
          annualSavingPct: annualSaving(
            byId.get(IOS_SKU_MONTHLY)?.price ?? null,
            byId.get(IOS_SKU_ANNUAL)?.price ?? null,
          ),
        }
      : resolveAndroidPrices(androidProduct);

  const updateSub = purchaseUpdatedListener((purchase: Purchase) => {
    void (async () => {
      try {
        const res = await verifyAndFinish(purchase, code);
        if (res.pending) {
          cb.onPending();
        } else if (res.ok) {
          cb.onVerified();
        } else if (res.elsewhere) {
          // Another identity's subscription (e.g. a renewal StoreKit replays
          // for the Apple ID). Not an error: Restore Purchases offers the move.
        } else {
          cb.onError('Purchase could not be verified. It will be retried automatically.');
        }
      } catch {
        // Bridge unreachable: leave the transaction unfinished — reconcile()
        // retries on next launch, and the store keeps prompting us.
        cb.onError('Could not reach the activation service. Your purchase is safe; we will retry.');
      }
    })();
  });

  const errorSub = purchaseErrorListener((e: PurchaseError) => {
    // Cancelling is not an error worth surfacing — but it must still be
    // reported: requestPurchase resolves as soon as the sheet OPENS, so
    // without this the button would sit on "Opening store…" forever.
    if (e.code === 'user-cancelled' || e.code === 'user-error') {
      cb.onCancelled();
    } else {
      cb.onError(e.message);
    }
  });

  return {
    prices,
    purchase: async (plan: IapPlan, payCode: string): Promise<void> => {
      if (Platform.OS === 'ios') {
        await requestPurchase({
          type: 'subs',
          request: {
            apple: {
              sku: plan === 'annual' ? IOS_SKU_ANNUAL : IOS_SKU_MONTHLY,
              appAccountToken: appAccountToken(payCode),
            },
          },
        });
      } else {
        const basePlan = plan === 'annual' ? ANDROID_BASE_PLAN_ANNUAL : ANDROID_BASE_PLAN_MONTHLY;
        const offerToken = androidOfferToken(androidProduct, basePlan);
        if (!offerToken) {
          // Without the offer token the billing layer may auto-select a
          // DIFFERENT base plan than the user chose (annual<->monthly).
          // Refuse rather than subscribe them to the wrong plan; the caller
          // surfaces this as a failed purchase start.
          throw new Error(`no Play offer available for base plan ${basePlan}`);
        }
        await requestPurchase({
          type: 'subs',
          request: {
            google: {
              skus: [ANDROID_SKU],
              obfuscatedAccountId: payCode,
              subscriptionOffers: [{ sku: ANDROID_SKU, offerToken }],
            },
          },
        });
      }
    },
    reconcile: async (payCode: string): Promise<ReconcileResult> => {
      const held = await getAvailablePurchases();
      const list = (Array.isArray(held) ? held : []) as Purchase[];
      let any = false;
      const elsewhere: Purchase[] = [];
      for (const p of list) {
        try {
          const res = await verifyAndFinish(p, payCode);
          any = any || res.ok;
          if (res.elsewhere) {
            elsewhere.push(p);
          }
        } catch {
          // Keep going; a later launch retries the rest.
        }
      }
      const ours = list.filter(isOurSubscription);
      return {
        any,
        elsewhere,
        holdsSubscription: ours.length > 0,
        autoRenewing: ours.some((p) => p.isAutoRenewing),
      };
    },
    transfer: async (purchases: readonly Purchase[], payCode: string): Promise<boolean> => {
      let any = false;
      for (const p of purchases) {
        // Errors (transfer_too_soon, bridge down) propagate: the user asked
        // for this, so they get told why it didn't happen.
        const res = await verifyAndFinish(p, payCode, true);
        any = any || res.ok;
      }
      return any;
    },
    dispose: (): void => {
      updateSub.remove();
      errorSub.remove();
    },
  };
}

/**
 * Android base-plan prices live in per-offer pricing phases. The last phase
 * is the recurring (non-intro) price.
 */
function resolveAndroidPrices(product: Product | undefined): IapPrices {
  const offers = androidOffers(product);
  // The LAST pricing phase is the recurring price (earlier ones are trials/intro offers).
  const phase = (basePlanId: string) =>
    offers
      ?.find((o) => o.basePlanIdAndroid === basePlanId)
      ?.pricingPhasesAndroid?.pricingPhaseList.at(-1);
  const amount = (basePlanId: string): number | null => {
    const micros = Number(phase(basePlanId)?.priceAmountMicros);
    return Number.isFinite(micros) && micros > 0 ? micros / 1e6 : null;
  };
  return {
    monthly: phase(ANDROID_BASE_PLAN_MONTHLY)?.formattedPrice ?? null,
    annual: phase(ANDROID_BASE_PLAN_ANNUAL)?.formattedPrice ?? null,
    annualSavingPct: annualSaving(
      amount(ANDROID_BASE_PLAN_MONTHLY),
      amount(ANDROID_BASE_PLAN_ANNUAL),
    ),
  };
}
