import { useMemo, useState } from 'react';
import { ApiError, buildWgConfig, enroll, paymentMemo } from '@cumulusvpn/core';
import type { EnrollResponse, Keypair } from '@cumulusvpn/core';
import type { CountryOption } from '../lib/gateways';
import type { DiscoveryState } from '../hooks/useDiscovery';
import { useI18n } from '../hooks/useLocale';
import { downloadText } from '../lib/download';
import { proxiedFetch } from '../lib/gatewayFetch';
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

type ConnectError =
  | { kind: 'no-gateway'; country: string }
  | { kind: 'rejected'; slug: string; message: string }
  | { kind: 'failed'; message: string | null };

export function ConnectPage({
  keypair,
  discovery,
  onRegenerate,
  onNavigateUpgrade,
}: ConnectPageProps) {
  const { t, rich } = useI18n();
  const [picked, setPicked] = useState<CountryOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConnectError | null>(null);
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
      setError({ kind: 'no-gateway', country: selected.name });
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await enroll(gw.ip, keypair.publicKey, {
        signPubKey: gw.sign_pubkey,
        fetchImpl: proxiedFetch,
      });
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
        setError({ kind: 'rejected', slug: err.slug, message: err.message });
      } else {
        setError({ kind: 'failed', message: err instanceof Error ? err.message : null });
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
          <span className="eyebrow">{t('connect_eyebrow')}</span>
          <h1>{rich('connect_title', { glow: (label) => <span className="glow">{label}</span> })}</h1>
          <p className="lede">
            {rich('connect_lede', {
              mono: (label) => <span className="mono">{label}</span>,
              upgrade: (label) => (
                <a
                  href="#/upgrade"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigateUpgrade();
                  }}
                >
                  {label}
                </a>
              ),
            })}
          </p>
        </div>

        {discovery.verified ? null : (
          <div className="banner warn">{t('connect_verify_warn')}</div>
        )}
        {discovery.notice === 'no-live-gateway' ? (
          <div className="banner info">{t('connect_notice_no_live_gateway')}</div>
        ) : null}

        <div className="grid">
          <section className="card">
            <div className="card-head">
              <h2>{t('connect_choose_location')}</h2>
              <span className="tier-pill free">{t('connect_tier_free')}</span>
            </div>
            {discovery.loading ? (
              <div className="loading">{t('connect_loading_directory')}</div>
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
              <h2>{t('connect_your_config')}</h2>
              {discovery.source ? (
                <span className="src-pill mono">
                  {t('connect_source_directory', { source: discovery.source })}
                </span>
              ) : null}
            </div>

            {selected ? (
              <div className="loc-btn">
                <span className="flag">{selected.flag}</span>
                <div className="meta">
                  <div className="t">{selected.name}</div>
                  <div className="s">
                    {selected.status === 'live'
                      ? `${selected.city} · ${t('connect_live_nodes', { n: selected.nodeCount })}`
                      : `${selected.city || t('common_directory')} · ${t('common_seed')}`}
                  </div>
                </div>
              </div>
            ) : (
              <div className="loc-btn muted">{t('connect_select_country')}</div>
            )}

            <button
              type="button"
              className="btn primary block"
              disabled={busy || !selected}
              onClick={() => void onGenerate()}
            >
              {busy ? t('connect_enrolling') : t('connect_generate')}
            </button>

            {error ? (
              <div className="banner error">
                {error.kind === 'no-gateway'
                  ? t('connect_no_gateway_in_country', { country: error.country })
                  : error.kind === 'rejected'
                    ? t('error_gateway_rejected', { slug: error.slug, message: error.message })
                    : (error.message ?? t('connect_error_enroll_failed'))}
              </div>
            ) : null}

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
                    <span className="qr-cap mono">{t('connect_qr_caption')}</span>
                  </div>
                </div>
                <div className="stat-row">
                  <div className="stat">
                    <div className="k">{t('connect_stat_assigned_ip')}</div>
                    <div className="v mono">{result.enroll.assigned_ip}</div>
                  </div>
                  <div className="stat">
                    <div className="k">{t('connect_stat_endpoint')}</div>
                    <div className="v mono">{result.enroll.endpoint}</div>
                  </div>
                  <div className="stat">
                    <div className="k">{t('connect_stat_dns')}</div>
                    <div className="v mono">{result.enroll.dns}</div>
                  </div>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn primary" onClick={onDownload}>
                    {t('connect_download_conf')}
                  </button>
                  <button type="button" className="btn amber" onClick={onNavigateUpgrade}>
                    {t('connect_upgrade_cta')}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <MultihopSection keypair={keypair} discovery={discovery} />

        <section className="card ident">
          <div className="card-head">
            <h2>{t('connect_identity_title')}</h2>
            <button type="button" className="btn ghost sm" onClick={onRegenerate}>
              {t('connect_regenerate')}
            </button>
          </div>
          <p className="muted-text">{t('connect_identity_note')}</p>
          <CopyField label={t('connect_field_public_key')} value={keypair.publicKey} />
          {memo ? <CopyField label={t('connect_field_payment_code')} value={memo} /> : null}
        </section>
      </div>
    </main>
  );
}
