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
import { appAccountToken, verifyApplePurchase, verifyGooglePurchase } from '@cumulusvpn/core';

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
}

export interface VerifyResult {
  readonly ok: boolean;
  /** True when the purchase completed but is awaiting external approval (Android PENDING). */
  readonly pending: boolean;
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
  readonly reconcile: (code: string) => Promise<boolean>;
  readonly dispose: () => void;
}

export interface IapCallbacks {
  /** A purchase reached the bridge and was accepted (grant queued/duplicate). */
  readonly onVerified: () => void;
  /** Android PENDING purchase — awaiting external payment approval. */
  readonly onPending: () => void;
  readonly onError: (message: string) => void;
}

/**
 * Verify one store purchase against the bridge; finish/acknowledge it only
 * on acceptance. Returns whether the bridge accepted it.
 */
export async function verifyAndFinish(purchase: Purchase, code: string): Promise<VerifyResult> {
  if (purchase.purchaseState === 'pending') {
    return { ok: false, pending: true };
  }
  const token = purchase.purchaseToken;
  if (!token) {
    return { ok: false, pending: false };
  }
  const verify =
    Platform.OS === 'ios'
      ? verifyApplePurchase(fetch, { code, signedTransaction: token })
      : verifyGooglePurchase(fetch, { code, purchaseToken: token });
  const res = await verify;
  if (!res.accepted) {
    return { ok: false, pending: false };
  }
  await finishTransaction({ purchase, isConsumable: false });
  return { ok: true, pending: false };
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
    // User cancellation is not an error worth surfacing.
    if (e.code !== 'user-cancelled' && e.code !== 'user-error') {
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
    reconcile: async (payCode: string): Promise<boolean> => {
      const held = await getAvailablePurchases();
      let any = false;
      for (const p of Array.isArray(held) ? held : []) {
        try {
          const res = await verifyAndFinish(p as Purchase, payCode);
          any = any || res.ok;
        } catch {
          // Keep going; a later launch retries the rest.
        }
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
  const price = (basePlanId: string): string | null => {
    const offer = offers?.find((o) => o.basePlanIdAndroid === basePlanId);
    return offer?.pricingPhasesAndroid?.pricingPhaseList.at(-1)?.formattedPrice ?? null;
  };
  return { monthly: price(ANDROID_BASE_PLAN_MONTHLY), annual: price(ANDROID_BASE_PLAN_ANNUAL) };
}
