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
  const deepLink = walletDeepLink(payment_address, price_flux, memo);

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
            <div className="usd">≈ {PRICE_USD_APPROX} · 30 days · stacks if you prepay</div>
          </div>

          <div className="pay-qr">
            <Qr value={deepLink} size={176} />
            <span className="qr-cap mono">Scan with Zelcore / SSP Wallet</span>
          </div>

          <CopyField label="Pay to address" value={payment_address} />
          <CopyField label="Message (required)" value={memo} />

          <div className="btn-row">
            <a className="btn amber block" href={deepLink}>
              Open in wallet
            </a>
          </div>

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
