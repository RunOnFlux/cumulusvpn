/**
 * IAP lifecycle hook — mounts the store machinery only when the remote
 * `iapPurchase` flag is on, walks one purchase through
 * purchasing → verifying → activating → done, and reconciles unfinished
 * transactions at start (crash-between-purchase-and-verify repair; also the
 * substance behind "Restore Purchases").
 *
 * "activating" = the bridge accepted the receipt and is settling it on the
 * Flux chain; we poll the bridge's payment status until the tx confirms.
 * The final `done` flip comes from the caller when `useVpn`'s tier polling
 * reports premium — the same chain-derived signal every surface trusts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Purchase } from 'react-native-iap';
import { paymentStatus, transferAvailableAt } from '@cumulusvpn/core';
import { startIapSession } from '../lib/iap';
import type { IapPlan, IapPrices, IapSession, ReconcileResult } from '../lib/iap';

export type IapPhase =
  'idle' | 'purchasing' | 'verifying' | 'pending_store' | 'activating' | 'done' | 'error';

export interface IapState {
  /** Store connection established and products loaded. */
  readonly ready: boolean;
  readonly prices: IapPrices;
  readonly phase: IapPhase;
  readonly error: string | null;
  /** The store account holds one of our subscriptions (gates "Manage subscription"). */
  readonly holdsSubscription: boolean;
  /** …and it will renew; false once cancelled (still held until the period ends). */
  readonly subscriptionRenews: boolean;
  /**
   * Restore found a subscription owned by another identity of this store
   * account (this device before a reinstall, or another phone): ask the user,
   * then `transfer()` it here or `dismissTransfer()`.
   */
  readonly transferOffer: boolean;
  readonly purchase: (plan: IapPlan) => void;
  readonly restore: () => void;
  readonly transfer: () => void;
  readonly dismissTransfer: () => void;
}

const STATUS_POLL_MS = 3_000;
/** Minimum gap between foreground re-checks of the store account. */
const FOREGROUND_RECHECK_MS = 30_000;

export function useIap(enabled: boolean, code: string | null, tierPremium: boolean): IapState {
  const [ready, setReady] = useState(false);
  const [prices, setPrices] = useState<IapPrices>({
    monthly: null,
    annual: null,
    annualSavingPct: null,
  });
  const [phase, setPhase] = useState<IapPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [holdsSubscription, setHoldsSubscription] = useState(false);
  const [subscriptionRenews, setSubscriptionRenews] = useState(false);
  const [transferOffer, setTransferOffer] = useState(false);
  const sessionRef = useRef<IapSession | null>(null);
  // Purchases the last reconcile found owned by another identity.
  const elsewhereRef = useRef<readonly Purchase[]>([]);

  /** Apply a reconcile pass. Returns whether anything was accepted for this device. */
  const applyReconcile = useCallback((r: ReconcileResult): boolean => {
    setHoldsSubscription(r.holdsSubscription);
    setSubscriptionRenews(r.autoRenewing);
    elsewhereRef.current = r.elsewhere;
    // Offered, never done automatically: two devices on one store account
    // (an iPad and an iPhone) would otherwise pull the subscription back and
    // forth. Moving it is always the user's tap.
    setTransferOffer(!r.any && r.elsewhere.length > 0);
    if (r.any) {
      setPhase('activating');
    }
    return r.any;
  }, []);

  // ---- store session ------------------------------------------------------
  useEffect(() => {
    if (!enabled || !code) {
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const session = await startIapSession(code, {
          onVerified: () => {
            if (alive) {
              setPhase('activating');
            }
          },
          onPending: () => {
            if (alive) {
              setPhase('pending_store');
            }
          },
          onCancelled: () => {
            if (alive) {
              // Back to choosing a plan — unless a purchase already moved on.
              setPhase((p) => (p === 'purchasing' || p === 'verifying' ? 'idle' : p));
            }
          },
          onError: (message) => {
            if (alive) {
              setError(message);
              setPhase('error');
            }
          },
        });
        if (!alive) {
          session.dispose();
          return;
        }
        sessionRef.current = session;
        setPrices(session.prices);
        setReady(true);
        // Repair pass: verify + finish anything the store still holds
        // (kill-mid-purchase, failed bridge call, Android ack window, an
        // offer/promo code redeemed outside the app).
        const r = await session.reconcile(code);
        if (alive) {
          applyReconcile(r);
        }
      } catch {
        // Store unreachable (no Play services, store outage): surface it —
        // a silent forever-spinner reads as a broken app.
        if (alive) {
          setError('Store unavailable right now. Please try again later.');
        }
      }
    })();
    return () => {
      alive = false;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [enabled, code, applyReconcile]);

  // ---- foreground re-check ------------------------------------------------
  // A Play promo code is redeemed in the browser, outside the app; coming back
  // is the moment to claim it, not the next cold start.
  useEffect(() => {
    if (!enabled || !code) {
      return;
    }
    let last = Date.now();
    const sub = AppState.addEventListener('change', (next) => {
      const session = sessionRef.current;
      if (next !== 'active' || !session || Date.now() - last < FOREGROUND_RECHECK_MS) {
        return;
      }
      last = Date.now();
      void session.reconcile(code).then(applyReconcile, () => {
        // Store unreachable — the next foreground or launch retries.
      });
    });
    return () => sub.remove();
  }, [enabled, code, applyReconcile]);

  // ---- chain-settlement progress ------------------------------------------
  useEffect(() => {
    if (phase !== 'activating' || !code) {
      return;
    }
    if (tierPremium) {
      setPhase('done');
      return;
    }
    let alive = true;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await paymentStatus(fetch, code);
          const latest = res.payments[0];
          // Confirmed on chain: gateways flip within ~1 min; keep "activating"
          // until the caller's tierPremium goes true (handled above on rerender).
          if (alive && latest?.status === 'failed') {
            setError(
              'Activation hit a snag — we retry automatically; premium will appear shortly.',
            );
          }
        } catch {
          // Bridge unreachable while settling — keep waiting silently.
        }
      })();
    }, STATUS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, code, tierPremium]);

  const purchase = useCallback(
    (plan: IapPlan): void => {
      const session = sessionRef.current;
      if (!session || !code) {
        return;
      }
      setError(null);
      setPhase('purchasing');
      void session.purchase(plan, code).then(
        () => setPhase((p) => (p === 'purchasing' ? 'verifying' : p)),
        () => setPhase((p) => (p === 'purchasing' ? 'idle' : p)),
      );
    },
    [code],
  );

  const restore = useCallback((): void => {
    const session = sessionRef.current;
    if (!session || !code) {
      return;
    }
    setError(null);
    void session.reconcile(code).then(
      (r) => {
        if (!applyReconcile(r) && r.elsewhere.length === 0) {
          setError('No subscription found in this store account.');
        }
      },
      () => setError('Store unavailable right now. Please try again later.'),
    );
  }, [code, applyReconcile]);

  const transfer = useCallback((): void => {
    const session = sessionRef.current;
    if (!session || !code || elsewhereRef.current.length === 0) {
      return;
    }
    setError(null);
    void session.transfer(elsewhereRef.current, code).then(
      (any) => {
        setTransferOffer(false);
        if (any) {
          elsewhereRef.current = [];
          setPhase('activating');
        } else {
          setError('The subscription could not be moved. Please try again later.');
        }
      },
      (e: unknown) => {
        const at = transferAvailableAt(e);
        setError(
          at
            ? `This subscription moved recently. It can move again on ${at.toISOString().slice(0, 10)}.`
            : e instanceof Error
              ? e.message
              : String(e),
        );
      },
    );
  }, [code]);

  const dismissTransfer = useCallback((): void => setTransferOffer(false), []);

  return {
    ready,
    prices,
    phase,
    error,
    holdsSubscription,
    subscriptionRenews,
    transferOffer,
    purchase,
    restore,
    transfer,
    dismissTransfer,
  };
}
