/**
 * In-app Upgrade — the desktop port of mobile's UpgradeScreen.
 *
 * Three ways to pay, all keyed to THIS device (no account):
 *  - **Card** — the web checkout (Stripe), opened in the browser with this
 *    device's code prefilled. Card entry stays in the browser on purpose: the
 *    app never handles card details.
 *  - **FLUX** — QR + "Open in wallet" (Zelcore `zel:` / SSP `ssp:`) + the
 *    pay-to details to copy, for any wallet.
 *  - **A code** — vouchers from the payments bridge.
 *
 * Entitlement is settled on the Flux chain; while this sheet is open the tier
 * is re-checked every 20 s, so it flips to Premium by itself ~1 min after a
 * payment confirms.
 */
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import qrcode from 'qrcode-generator';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ApiError, redeemVoucher, walletDeepLink, walletDeepLinks } from '@cumulusvpn/core';
import type { Entitlement } from '../hooks/useConnection.js';
import { useEscape } from '../hooks/useEscape.js';
import { copyText } from '../lib/identity.js';
import { upgradeUrl } from '../lib/directory.js';
import { openExternal } from '../lib/opener.js';
import { formatExpiry, voucherErrorText } from '../lib/payment.js';
import type { PaymentIdentity } from '../lib/payment.js';

const TERMS_URL = 'https://cumulusvpn.com/terms';
const PRIVACY_URL = 'https://cumulusvpn.com/privacy';
const PERKS = ['Full speed — no 100 KB/s cap', 'Every server and Stealth', 'Split tunneling'];
const POLL_MS = 20_000;

interface Props {
  readonly entitlement: Entitlement | null;
  readonly payment: PaymentIdentity;
  readonly refreshTier: () => Promise<void>;
  readonly onClose: () => void;
}

export function Upgrade({ entitlement, payment, refreshTier, onClose }: Props): JSX.Element {
  useEscape(onClose);
  const premium = entitlement?.tier === 'premium';
  const expiry = premium ? formatExpiry(entitlement?.paidUntil) : null;

  // Unlock by itself: re-check the tier while the sheet is open.
  useEffect(() => {
    void refreshTier();
    const id = setInterval(() => void refreshTier(), POLL_MS);
    return () => clearInterval(id);
  }, [refreshTier]);

  return (
    <div className="sheet">
      <div className="sheet-inner">
        <div className="sheethead">
          <h2>{premium ? 'Premium' : 'Go Premium'}</h2>
        </div>
        <div className="sheet-body scroll-y">
          <div className={`plan-card ${premium ? 'premium' : ''}`}>
            {premium ? (
              <>
                <div className="plan-title">Premium is active</div>
                <div className="plan-sub">
                  {expiry
                    ? `Paid until ${expiry.date} · ${expiry.daysLeft} day${expiry.daysLeft === 1 ? '' : 's'} left`
                    : 'Paid'}
                </div>
                <div className="plan-sub">Add time below — it stacks on top of your expiry.</div>
              </>
            ) : (
              <>
                <div className="plan-title">
                  Premium <span className="plan-price">$0.99/month</span>
                </div>
                <ul className="perks">
                  {PERKS.map((p) => (
                    <li key={p}>✓ {p}</li>
                  ))}
                </ul>
                <div className="plan-sub">
                  Free stays free, capped at 100 KB/s. No account, no subscription to cancel — each
                  payment adds 30 days.
                </div>
              </>
            )}
          </div>

          <div className="setsec">Pay by card</div>
          <button
            type="button"
            className="pay-btn"
            onClick={() => void openExternal(upgradeUrl(payment.code))}
          >
            Continue to secure checkout →
          </button>
          <p className="pay-note">
            Opens cumulusvpn.com in your browser with this device’s code already filled in. Card
            details never touch this app.
          </p>

          <FluxPay payment={payment} premium={premium} />

          <Redeem code={payment.code} onGranted={() => void refreshTier()} />

          <p className="pay-note">
            Payments are verified on the Flux blockchain and tied to this device’s key — we never
            see who you are. Premium unlocks on every gateway within about a minute, and this screen
            updates by itself.
          </p>
          <div className="pay-links">
            <button type="button" onClick={() => void openExternal(TERMS_URL)}>
              Terms of Service
            </button>
            <span>·</span>
            <button type="button" onClick={() => void openExternal(PRIVACY_URL)}>
              Privacy Policy
            </button>
          </div>
        </div>
        <button className="close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function Qr({ value }: { readonly value: string }): JSX.Element {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [value]);
  // Generated locally from our own payment details — no user input reaches it.
  return <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function FluxPay({
  payment,
  premium,
}: {
  readonly payment: PaymentIdentity;
  readonly premium: boolean;
}): JSX.Element {
  const [walletError, setWalletError] = useState<string | null>(null);
  // The QR carries the BIP21 `flux:` payload — what a wallet's scanner parses.
  const qrLink = walletDeepLink(payment.address, payment.priceFlux, payment.memo, 'flux');
  const links = walletDeepLinks(payment.address, payment.priceFlux, payment.memo);

  const openWallet = async (): Promise<void> => {
    setWalletError(null);
    if (isTauri()) {
      // Zelcore registers `zel:`, SSP `ssp:`; opening a scheme nobody
      // registered fails, so try each in preference order.
      for (const { uri } of links) {
        try {
          await openUrl(uri);
          return;
        } catch {
          /* no handler for this scheme — try the next */
        }
      }
    }
    setWalletError(
      'No FLUX wallet app found. Install Zelcore or SSP Wallet, or scan the QR with your phone, or copy the details below.',
    );
  };

  return (
    <>
      <div className="setsec">{premium ? 'Add time with FLUX' : 'Pay with FLUX'}</div>
      <div className="flux-pay">
        <div className="qr-wrap">
          <Qr value={qrLink} />
          <span className="qr-cap">Scan with Zelcore / SSP Wallet</span>
        </div>
        <div className="flux-fields">
          <button type="button" className="pay-btn" onClick={() => void openWallet()}>
            Open in wallet →
          </button>
          {walletError && <div className="err">{walletError}</div>}
          <CopyField
            label="Amount"
            value={`${payment.priceFlux} FLUX`}
            copy={String(payment.priceFlux)}
          />
          <CopyField label="Pay-to address" value={payment.address} />
          <CopyField label="Message (required)" value={payment.memo} />
        </div>
      </div>
      <p className="pay-note">
        The message ties the payment to this device — don’t remove it. Send a multiple of the amount
        to add that many months at once (e.g. {payment.priceFlux * 3} FLUX = 3 months; up to 24
        stack).
      </p>
    </>
  );
}

function CopyField({
  label,
  value,
  copy,
}: {
  readonly label: string;
  readonly value: string;
  readonly copy?: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-field"
      title="Copy"
      onClick={() => {
        void copyText(copy ?? value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <span className="cf-label">{label}</span>
      <span className="cf-value">{copied ? 'Copied' : value}</span>
    </button>
  );
}

function Redeem({
  code,
  onGranted,
}: {
  readonly code: string;
  readonly onGranted: () => void;
}): JSX.Element {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<number | null>(null);

  const redeem = async (): Promise<void> => {
    const voucher = input.trim();
    if (busy || voucher === '') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await redeemVoucher(fetch, { code, voucher });
      if (outcome.type === 'grant_days') {
        setGranted(outcome.days);
        onGranted();
      } else {
        setError('This is a card-discount code — apply it at checkout on cumulusvpn.com.');
      }
    } catch (e) {
      setError(voucherErrorText(e instanceof ApiError ? e.slug : ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="setsec">Redeem a code</div>
      {granted !== null ? (
        <p className="pay-note">
          {granted} day{granted === 1 ? '' : 's'} of Premium is activating on the decentralized
          network — it unlocks on every gateway within a minute.
        </p>
      ) : (
        <div className="redeem">
          <input
            className="searchbar"
            value={input}
            placeholder="CVPN-XXXXX-XXXXX"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void redeem();
              }
            }}
          />
          <button
            type="button"
            className="pay-btn"
            disabled={busy || input.trim() === ''}
            onClick={() => void redeem()}
          >
            {busy ? 'Checking…' : 'Redeem'}
          </button>
        </div>
      )}
      {error && <div className="err">{error}</div>}
    </>
  );
}
