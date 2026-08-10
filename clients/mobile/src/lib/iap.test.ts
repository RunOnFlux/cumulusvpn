/**
 * The wrapper's load-bearing contract: finishTransaction (= Android ack)
 * happens ONLY after the bridge accepts a receipt, pending purchases are
 * neither verified nor finished, and reconcile() repairs unfinished
 * transactions on a later launch.
 */
import { Platform } from 'react-native';
import * as iapLib from 'react-native-iap';
import { startIapSession, verifyAndFinish } from './iap';

const mock = iapLib as unknown as {
  __firePurchase: (p: object) => void;
  __fireError: (e: object) => void;
  __reset: () => void;
  fetchProducts: jest.Mock;
  finishTransaction: jest.Mock;
  getAvailablePurchases: jest.Mock;
  requestPurchase: jest.Mock;
};

const CODE = '2RkUfDC55GMndKreXqK7Jruu8Snx';

const purchase = (over: object = {}): object => ({
  productId: 'premium',
  purchaseState: 'purchased',
  purchaseToken: 'tok-1',
  isAutoRenewing: true,
  transactionDate: 1,
  ...over,
});

/** Bridge accept/reject via global fetch. */
function mockBridge(accepted: boolean): jest.Mock {
  const f = jest.fn(async () => ({
    json: async () => ({
      status: 'success',
      data: { accepted, months: 1, state: 'pending', test: false },
    }),
  }));
  (globalThis as { fetch?: unknown }).fetch = f;
  return f;
}

// Drain the macrotask queue twice — the listener path chains several awaits
// (fetch → json → finishTransaction) before the callback fires.
const flush = async (): Promise<void> => {
  await new Promise<void>((r) => setTimeout(() => r(), 0));
  await new Promise<void>((r) => setTimeout(() => r(), 0));
};

beforeEach(() => {
  mock.__reset();
  Platform.OS = 'android';
});

describe('verifyAndFinish', () => {
  it('finishes (acknowledges) ONLY after the bridge accepted', async () => {
    const f = mockBridge(true);
    const res = await verifyAndFinish(purchase() as never, CODE);
    expect(res).toEqual({ ok: true, pending: false });
    expect(f).toHaveBeenCalledTimes(1);
    expect(mock.finishTransaction).toHaveBeenCalledTimes(1);
    // Ordering: verify hit the network before finish touched the store.
    expect(f.mock.invocationCallOrder[0]!).toBeLessThan(
      mock.finishTransaction.mock.invocationCallOrder[0]!,
    );
  });

  it('does NOT finish when the bridge rejects', async () => {
    mockBridge(false);
    const res = await verifyAndFinish(purchase() as never, CODE);
    expect(res.ok).toBe(false);
    expect(mock.finishTransaction).not.toHaveBeenCalled();
  });

  it('leaves PENDING purchases untouched (no verify, no ack)', async () => {
    const f = mockBridge(true);
    const res = await verifyAndFinish(purchase({ purchaseState: 'pending' }) as never, CODE);
    expect(res).toEqual({ ok: false, pending: true });
    expect(f).not.toHaveBeenCalled();
    expect(mock.finishTransaction).not.toHaveBeenCalled();
  });

  it('propagates bridge outages without finishing (retry later)', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => {
      throw new Error('offline');
    });
    await expect(verifyAndFinish(purchase() as never, CODE)).rejects.toThrow('offline');
    expect(mock.finishTransaction).not.toHaveBeenCalled();
  });
});

describe('startIapSession', () => {
  it('routes listener purchases through verify-then-finish and reports up', async () => {
    mockBridge(true);
    const verified = jest.fn();
    const session = await startIapSession(CODE, {
      onVerified: verified,
      onPending: jest.fn(),
      onError: jest.fn(),
    });
    mock.__firePurchase(purchase());
    await flush();
    expect(verified).toHaveBeenCalledTimes(1);
    expect(mock.finishTransaction).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it('reports pending purchases without verifying', async () => {
    const f = mockBridge(true);
    const pending = jest.fn();
    const session = await startIapSession(CODE, {
      onVerified: jest.fn(),
      onPending: pending,
      onError: jest.fn(),
    });
    mock.__firePurchase(purchase({ purchaseState: 'pending' }));
    await flush();
    expect(pending).toHaveBeenCalledTimes(1);
    expect(f).not.toHaveBeenCalled();
    session.dispose();
  });

  it('reconcile() re-verifies and finishes what the store still holds', async () => {
    mockBridge(true);
    mock.getAvailablePurchases.mockResolvedValue([
      purchase({ purchaseToken: 'held-1' }),
      purchase({ purchaseToken: 'held-2' }),
    ]);
    const session = await startIapSession(CODE, {
      onVerified: jest.fn(),
      onPending: jest.fn(),
      onError: jest.fn(),
    });
    expect(await session.reconcile(CODE)).toBe(true);
    expect(mock.finishTransaction).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('reconcile() returns false when the store holds nothing', async () => {
    mockBridge(true);
    const session = await startIapSession(CODE, {
      onVerified: jest.fn(),
      onPending: jest.fn(),
      onError: jest.fn(),
    });
    expect(await session.reconcile(CODE)).toBe(false);
    session.dispose();
  });

  /** Real v16 Android product shape: subscriptionOffers with *Android-suffixed fields. */
  const androidProduct = {
    id: 'premium',
    platform: 'android',
    type: 'subs',
    subscriptionOffers: [
      {
        basePlanIdAndroid: 'premium-monthly',
        offerTokenAndroid: 'offer-tok-monthly',
        pricingPhasesAndroid: { pricingPhaseList: [{ formattedPrice: '$1.99' }] },
      },
      {
        basePlanIdAndroid: 'premium-annual',
        offerTokenAndroid: 'offer-tok-annual',
        pricingPhasesAndroid: { pricingPhaseList: [{ formattedPrice: '$14.99' }] },
      },
    ],
  };

  it('sends the payment code + the selected base plan offer token on Android', async () => {
    mockBridge(true);
    mock.fetchProducts.mockResolvedValue([androidProduct]);
    const session = await startIapSession(CODE, {
      onVerified: jest.fn(),
      onPending: jest.fn(),
      onError: jest.fn(),
    });
    await session.purchase('monthly', CODE);
    const arg = mock.requestPurchase.mock.calls[0]![0] as {
      type: string;
      request: {
        google: {
          obfuscatedAccountId: string;
          skus: string[];
          subscriptionOffers?: { sku: string; offerToken: string }[];
        };
      };
    };
    expect(arg.type).toBe('subs');
    expect(arg.request.google.obfuscatedAccountId).toBe(CODE);
    expect(arg.request.google.skus).toEqual(['premium']);
    // The base-plan choice MUST reach Play Billing as an offer token —
    // without it the user's monthly/annual selection is ignored.
    expect(arg.request.google.subscriptionOffers).toEqual([
      { sku: 'premium', offerToken: 'offer-tok-monthly' },
    ]);
    session.dispose();
  });

  it('refuses an Android purchase when no offer matches the chosen base plan', async () => {
    // Auto-selection by the billing layer could subscribe the user to the
    // WRONG plan — failing the purchase start is the safe behavior.
    mockBridge(true);
    mock.fetchProducts.mockResolvedValue([{ ...androidProduct, subscriptionOffers: [] }]);
    const session = await startIapSession(CODE, {
      onVerified: jest.fn(),
      onPending: jest.fn(),
      onError: jest.fn(),
    });
    await expect(session.purchase('annual', CODE)).rejects.toThrow('no Play offer');
    expect(mock.requestPurchase).not.toHaveBeenCalled();
    session.dispose();
  });

  it('resolves store-localized Android prices from subscriptionOffers pricing phases', async () => {
    mockBridge(true);
    mock.fetchProducts.mockResolvedValue([androidProduct]);
    const session = await startIapSession(CODE, {
      onVerified: jest.fn(),
      onPending: jest.fn(),
      onError: jest.fn(),
    });
    expect(session.prices).toEqual({ monthly: '$1.99', annual: '$14.99' });
    session.dispose();
  });

  it('stamps the derived appAccountToken on iOS purchases', async () => {
    Platform.OS = 'ios';
    mockBridge(true);
    const session = await startIapSession(CODE, {
      onVerified: jest.fn(),
      onPending: jest.fn(),
      onError: jest.fn(),
    });
    await session.purchase('annual', CODE);
    const arg = mock.requestPurchase.mock.calls[0]![0] as {
      request: { apple: { sku: string; appAccountToken: string } };
    };
    expect(arg.request.apple.sku).toBe('cvpn.premium.annual');
    // Shared cross-package vector (see core-ts paymentCode.test.ts).
    expect(arg.request.apple.appAccountToken).toBe('d47c7e4b-c0f7-421c-a429-72ad6e9ecaf3');
    session.dispose();
  });
});
