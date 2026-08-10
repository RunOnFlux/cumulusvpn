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
import { paymentStatus } from '@cumulusvpn/core';
import { startIapSession } from '../lib/iap';
import type { IapPlan, IapPrices, IapSession } from '../lib/iap';

export type IapPhase =
  'idle' | 'purchasing' | 'verifying' | 'pending_store' | 'activating' | 'done' | 'error';

export interface IapState {
  /** Store connection established and products loaded. */
  readonly ready: boolean;
  readonly prices: IapPrices;
  readonly phase: IapPhase;
  readonly error: string | null;
  readonly purchase: (plan: IapPlan) => void;
  readonly restore: () => void;
}

const STATUS_POLL_MS = 3_000;

export function useIap(enabled: boolean, code: string | null, tierPremium: boolean): IapState {
  const [ready, setReady] = useState(false);
  const [prices, setPrices] = useState<IapPrices>({ monthly: null, annual: null });
  const [phase, setPhase] = useState<IapPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<IapSession | null>(null);

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
        // (kill-mid-purchase, failed bridge call, Android ack window).
        if (await session.reconcile(code)) {
          if (alive) {
            setPhase('activating');
          }
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
  }, [enabled, code]);

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
    void session.reconcile(code).then((any) => {
      if (any) {
        setPhase('activating');
      } else {
        setError('No previous purchases found for this device.');
      }
    });
  }, [code]);

  return { ready, prices, phase, error, purchase, restore };
}
