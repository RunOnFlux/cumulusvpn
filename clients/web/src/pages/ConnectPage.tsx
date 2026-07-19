import { useMemo, useState } from 'react';
import { ApiError, buildWgConfig, enroll, paymentMemo } from '@cumulusvpn/core';
import type { EnrollResponse, Keypair } from '@cumulusvpn/core';
import type { CountryOption } from '../lib/gateways';
import type { DiscoveryState } from '../hooks/useDiscovery';
import { downloadText } from '../lib/download';
import { CountryPicker } from '../components/CountryPicker';
import { CopyField } from '../components/CopyField';
import { MultihopSection } from '../components/MultihopSection';
import { Qr } from '../components/Qr';

interface ConnectPageProps {
  readonly keypair: Keypair;
  readonly discovery: DiscoveryState;
  readonly onRegenerate: () => void;
  readonly onNavigateUpgrade: () => void;
}

interface ConfigResult {
  readonly enroll: EnrollResponse;
  readonly config: string;
  readonly cc: string;
}

export function ConnectPage({
  keypair,
  discovery,
  onRegenerate,
  onNavigateUpgrade,
}: ConnectPageProps) {
  const [picked, setPicked] = useState<CountryOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfigResult | null>(null);

  // The effective selection: the user's explicit pick, else the best (first)
  // discovered country. Derived rather than synced via an effect.
  const selected = picked ?? discovery.options[0] ?? null;

  const memo = useMemo(() => {
    try {
      return paymentMemo(keypair.publicKey);
    } catch {
      return '';
    }
  }, [keypair.publicKey]);

  const onSelect = (option: CountryOption): void => {
    setPicked(option);
    setResult(null);
    setError(null);
  };

  const onGenerate = async (): Promise<void> => {
    if (!selected) {
      return;
    }
    const gw = selected.bestGateway;
    if (!gw) {
      setError(
        `No live gateway reachable in ${selected.name} from the browser. Enrollment posts to a gateway’s control API (http :51821), which https pages can’t reach — this works from the desktop and mobile clients that share this core.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await enroll(gw.ip, keypair.publicKey, { signPubKey: gw.sign_pubkey });
      const config = buildWgConfig({
        privateKey: keypair.privateKey,
        assignedIp: data.assigned_ip,
        dns: data.dns,
        serverPubKey: data.server_pubkey,
        endpoint: data.endpoint,
      });
      setResult({ enroll: data, config, cc: selected.cc });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`Gateway rejected enrollment (${err.slug}): ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : 'Enrollment failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onDownload = (): void => {
    if (result) {
      downloadText(`cumulusvpn-${result.cc.toLowerCase()}.conf`, result.config, 'text/plain');
    }
  };

  return (
    <main className="page">
      <div className="wrap">
        <div className="page-head">
          <span className="eyebrow">Beta rail · WireGuard config</span>
          <h1>
            One key, <span className="glow">every gateway.</span>
          </h1>
          <p className="lede">
            Your WireGuard keypair is generated here, in your browser — the private key never leaves
            this tab. Pick a country, enroll at the nearest Flux gateway, and export a
            ready-to-import
            <span className="mono"> .conf</span> and QR. Free forever at 100&nbsp;KB/s;{' '}
            <a
              href="#/upgrade"
              onClick={(e) => {
                e.preventDefault();
                onNavigateUpgrade();
              }}
            >
              upgrade with FLUX
            </a>{' '}
            for full speed.
          </p>
        </div>

        {discovery.verified ? null : (
          <div className="banner warn">
            Directory signature could not be verified — endpoints are shown for information only.
          </div>
        )}
        {discovery.notice ? <div className="banner info">{discovery.notice}</div> : null}

        <div className="grid">
          <section className="card">
            <div className="card-head">
              <h2>Choose a location</h2>
              <span className="tier-pill free">FREE · 100 KB/s</span>
            </div>
            {discovery.loading ? (
              <div className="loading">Resolving the signed directory & discovering gateways…</div>
            ) : (
              <CountryPicker
                options={discovery.options}
                selectedId={selected?.id ?? null}
                onSelect={onSelect}
              />
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Your config</h2>
              {discovery.source ? (
                <span className="src-pill mono">{discovery.source} directory</span>
              ) : null}
            </div>

            {selected ? (
              <div className="loc-btn">
                <span className="flag">{selected.flag}</span>
                <div className="meta">
                  <div className="t">{selected.name}</div>
                  <div className="s">
                    {selected.status === 'live'
                      ? `${selected.city} · ${selected.nodeCount} live node${selected.nodeCount === 1 ? '' : 's'}`
                      : `${selected.city || 'directory'} · seed`}
                  </div>
                </div>
              </div>
            ) : (
              <div className="loc-btn muted">Select a country to continue</div>
            )}

            <button
              type="button"
              className="btn primary block"
              disabled={busy || !selected}
              onClick={() => void onGenerate()}
            >
              {busy ? 'Enrolling…' : 'Generate .conf'}
            </button>

            {error ? <div className="banner error">{error}</div> : null}

            {result ? (
              <div className="config-out">
                <div className="conf-row">
                  <div className="conf-wrap">
                    <div className="conf-bar">
                      <span className="dots">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="fname">cumulusvpn-{result.cc.toLowerCase()}.conf</span>
                    </div>
                    <pre className="conf mono">{result.config}</pre>
                  </div>
                  <div className="conf-qr">
                    <Qr value={result.config} size={168} />
                    <span className="qr-cap mono">Scan into the WireGuard app</span>
                  </div>
                </div>
                <div className="stat-row">
                  <div className="stat">
                    <div className="k">Assigned IP</div>
                    <div className="v mono">{result.enroll.assigned_ip}</div>
                  </div>
                  <div className="stat">
                    <div className="k">Endpoint</div>
                    <div className="v mono">{result.enroll.endpoint}</div>
                  </div>
                  <div className="stat">
                    <div className="k">DNS</div>
                    <div className="v mono">{result.enroll.dns}</div>
                  </div>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn primary" onClick={onDownload}>
                    Download .conf
                  </button>
                  <button type="button" className="btn amber" onClick={onNavigateUpgrade}>
                    Upgrade to full speed →
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <MultihopSection keypair={keypair} discovery={discovery} />

        <section className="card ident">
          <div className="card-head">
            <h2>This device’s identity</h2>
            <button type="button" className="btn ghost sm" onClick={onRegenerate}>
              Regenerate key
            </button>
          </div>
          <p className="muted-text">
            One keypair per device enrolls at many gateways; premium follows the key on all of them
            via the chain. The payment code below is what ties a FLUX payment to this key.
          </p>
          <CopyField label="WireGuard public key" value={keypair.publicKey} />
          {memo ? <CopyField label="Payment code (memo)" value={memo} /> : null}
        </section>
      </div>
    </main>
  );
}
