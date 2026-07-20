import { useMemo } from 'react';
import { paymentMemo, walletDeepLink } from '@cumulusvpn/core';
import type { Directory, Keypair } from '@cumulusvpn/core';
import { PRICE_USD_APPROX } from '../config';
import { CopyField } from '../components/CopyField';
import { Qr } from '../components/Qr';

interface UpgradePageProps {
  readonly keypair: Keypair;
  readonly directory: Directory | null;
  readonly onNavigateConnect: () => void;
}

export function UpgradePage({ keypair, directory, onNavigateConnect }: UpgradePageProps) {
  const memo = useMemo(() => {
    try {
      return paymentMemo(keypair.publicKey);
    } catch {
      return '';
    }
  }, [keypair.publicKey]);

  if (!directory) {
    return (
      <main className="page">
        <div className="wrap">
          <div className="loading">Loading payment details…</div>
        </div>
      </main>
    );
  }

  const { payment_address, price_flux } = directory;
  // QR: universal BIP21 `flux:` (any Flux wallet scans it; Zelcore too).
  // Click: Zelcore's `zel:` protocol, which is what Zelcore registers with the OS.
  const qrLink = walletDeepLink(payment_address, price_flux, memo, 'flux');
  const payLink = walletDeepLink(payment_address, price_flux, memo, 'zel');

  return (
    <main className="page">
      <div className="wrap narrow">
        <div className="page-head center">
          <span className="eyebrow">Upgrade · pay in FLUX</span>
          <h1>Upgrade to full speed</h1>
          <p className="lede">
            Send FLUX with the exact message below. Every gateway scans the chain and unlocks your
            key within ~1&nbsp;minute — on all servers at once, for 30 days. No account, no card, no
            company that can hand over what it never had.
          </p>
        </div>

        <section className="card pay-card">
          <div className="amount">
            <div className="big mono">{price_flux} FLUX</div>
            <div className="usd">≈ {PRICE_USD_APPROX} · per 30 days</div>
          </div>

          <div className="pay-qr">
            <Qr value={qrLink} size={176} />
            <span className="qr-cap mono">Scan with Zelcore / SSP Wallet</span>
          </div>

          <CopyField label="Pay to address" value={payment_address} />
          <CopyField label="Message (required)" value={memo} />

          <div className="btn-row">
            <a className="btn amber block" href={payLink}>
              Open in wallet
            </a>
          </div>

          <p className="pay-note">
            <strong>Prepay ahead:</strong> pay a multiple of the amount to add that many months at
            once — e.g. {price_flux * 3} FLUX = 3 months. Extra months stack (up to 24), so you can
            top up any time.
          </p>

          <p className="pay-note">
            Opens in Zelcore / SSP Wallet. Payment is verified on the Flux blockchain — we never see
            who you are. The message ties the payment to your key; sending without it means funds
            arrive but nothing unlocks.
          </p>
        </section>

        <p className="back-link">
          <a
            href="#/connect"
            onClick={(e) => {
              e.preventDefault();
              onNavigateConnect();
            }}
          >
            ← Back to Connect
          </a>
        </p>
      </div>
    </main>
  );
}
