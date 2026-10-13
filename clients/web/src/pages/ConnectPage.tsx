import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  buildWgConfig,
  checkIssuedConfig,
  compileSplitPolicy,
  dnsServersFor,
  enroll,
  status,
} from '@cumulusvpn/core';
import type {
  CompiledSplit,
  ConfHealth,
  DnsChoice,
  EnrollResponse,
  Keypair,
} from '@cumulusvpn/core';
import type { CountryOption } from '../lib/gateways';
import type { DiscoveryState } from '../hooks/useDiscovery';
import { useI18n } from '../hooks/useLocale';
import { loadDnsChoice, saveDnsChoice } from '../lib/dnsChoice';
import { downloadText } from '../lib/download';
import { proxiedFetch } from '../lib/gatewayFetch';
import { loadIssuedConfig, saveIssuedConfig } from '../lib/issuedConfig';
import { loadSplitPolicy } from '../lib/splitPolicy';
import { CountryPicker } from '../components/CountryPicker';
import { DnsSection } from '../components/DnsSection';
import { IdentityPanel } from '../components/IdentityPanel';
import { MultihopSection } from '../components/MultihopSection';
import { Qr } from '../components/Qr';
import { SplitSection } from '../components/SplitSection';

interface ConnectPageProps {
  readonly keypair: Keypair;
  readonly discovery: DiscoveryState;
  /** True right after this identity was restored from a recovery key. */
  readonly identityRestored: boolean;
  readonly onRegenerate: () => void;
  readonly onRestore: (keypair: Keypair) => void;
  readonly onNavigateUpgrade: () => void;
}

interface ConfigResult {
  readonly enroll: EnrollResponse;
  readonly cc: string;
  /** The compiled split policy baked into this config, when it applied. */
  readonly compiledSplit: CompiledSplit | null;
  /** Whether the stored split policy made it into this config, and if not, why. */
  readonly split: 'none' | 'applied' | 'premium-required';
}

type ConnectError =
  | { kind: 'no-gateway'; country: string }
  | { kind: 'rejected'; slug: string; message: string }
  | { kind: 'failed'; message: string | null };

/** "13 Nov 2026" in the reader's locale; the raw value if it does not parse. */
function formatDay(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function ConnectPage({
  keypair,
  discovery,
  identityRestored,
  onRegenerate,
  onRestore,
  onNavigateUpgrade,
}: ConnectPageProps) {
  const { t, rich, locale } = useI18n();
  const [picked, setPicked] = useState<CountryOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConnectError | null>(null);
  const [result, setResult] = useState<ConfigResult | null>(null);
  // Shared by the single-hop and multi-hop generators; device-local.
  const [dns, setDns] = useState<DnsChoice>(() => loadDnsChoice());
  // Health of the config issued on a PREVIOUS visit. A .conf is consumed by the
  // stock WireGuard app, which has no control channel — so when its gateway is
  // replaced (a Flux migration re-places the app on a node that mints its own
  // key), the tunnel keeps reporting "connected" and silently passes nothing.
  // This page is the only thing that can notice on the user's behalf.
  const prior = useMemo(() => loadIssuedConfig(), []);
  // One state object, seeded during the first render rather than by an effect —
  // matching useDiscovery, and avoiding a synchronous setState on mount.
  const [priorCheck, setPriorCheck] = useState<{
    readonly checking: boolean;
    readonly health: ConfHealth;
  }>(() => ({ checking: prior !== null, health: 'unknown' }));

  // The effective selection: the user's explicit pick, else the best (first)
  // discovered country. Derived rather than synced via an effect.
  const selected = picked ?? discovery.options[0] ?? null;

  // This key's real tier. Entitlement is read from the chain, so any live
  // gateway answers the same; the pill stays hidden until one does — a
  // hard-coded FREE pill told paying users their payment had not landed.
  const tierGateway = discovery.options[0]?.bestGateway ?? null;
  const [tier, setTier] = useState<{
    readonly premium: boolean;
    readonly paidUntil: string;
  } | null>(null);
  useEffect(() => {
    if (!tierGateway) {
      return;
    }
    let cancelled = false;
    void status(tierGateway.ip, keypair.publicKey, {
      signPubKey: tierGateway.sign_pubkey,
      fetchImpl: proxiedFetch,
    })
      .then((s) => {
        if (!cancelled) {
          setTier({ premium: s.tier === 'premium', paidUntil: s.paid_until });
        }
      })
      .catch(() => {
        // Unknown stays hidden rather than guessing "free".
      });
    return () => {
      cancelled = true;
    };
  }, [tierGateway, keypair.publicKey]);

  useEffect(() => {
    if (!prior) {
      return;
    }
    let cancelled = false;

    void (async () => {
      const health = await checkIssuedConfig(prior, { fetchImpl: proxiedFetch });
      if (cancelled) {
        return;
      }
      setPriorCheck({ checking: false, health });
    })();

    return () => {
      cancelled = true;
    };
  }, [prior]);

  // The config is rebuilt from the enroll answer rather than kept as text, so a
  // DNS change re-renders the .conf and QR on screen at once: only the `DNS =`
  // line differs, and the gateway needs no new enrollment for it.
  const config = useMemo(
    () =>
      result
        ? buildWgConfig({
            privateKey: keypair.privateKey,
            assignedIp: result.enroll.assigned_ip,
            dns: dnsServersFor(dns, result.enroll.dns),
            serverPubKey: result.enroll.server_pubkey,
            endpoint: result.enroll.endpoint,
            ...(result.compiledSplit ? { split: result.compiledSplit } : {}),
          })
        : null,
    [result, dns, keypair.privateKey],
  );

  const onDnsChange = (choice: DnsChoice): void => {
    setDns(choice);
    saveDnsChoice(choice);
  };

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
    // Deliberately NOT clearing `result` here. On a reissue the config on screen
    // may be the only copy the user has — if this enroll fails (gateway down,
    // offline, at capacity) wiping it first would destroy the very thing they
    // came to replace. It is overwritten below only once a new one exists.
    try {
      const data = await enroll(gw.ip, keypair.publicKey, {
        signPubKey: gw.sign_pubkey,
        fetchImpl: proxiedFetch,
      });
      // Split tunneling (docs/17 §4.6): a .conf can only express inclusion, so
      // compile with the complement pre-computed. Recompiled per generation
      // against THIS gateway's IP so a rule containing it is dropped (§7.4).
      // Premium-only (§7.6): the gate is checked against the issuing gateway;
      // unreachable status or free tier → full tunnel (toward protection).
      const compiled = compileSplitPolicy(loadSplitPolicy(), {
        platform: 'linux', // irrelevant on web: a .conf carries no app rules
        supportsExcludeRoute: false,
        endpointIps: [gw.ip],
      });
      let split: CompiledSplit | undefined;
      let splitState: ConfigResult['split'] = 'none';
      if (!compiled.isNoop) {
        const tier = await status(gw.ip, keypair.publicKey, {
          signPubKey: gw.sign_pubkey,
          fetchImpl: proxiedFetch,
        })
          .then((s) => s.tier)
          .catch(() => 'free' as const);
        if (tier === 'premium') {
          split = compiled;
          splitState = 'applied';
        } else {
          splitState = 'premium-required';
        }
      }
      setResult({
        enroll: data,
        cc: selected.cc,
        compiledSplit: split ?? null,
        split: splitState,
      });
      // Remember which gateway issued this, so a later visit can check it.
      saveIssuedConfig({
        ip: gw.ip,
        serverPubKey: data.server_pubkey,
        cc: selected.cc,
        issuedAt: new Date().toISOString(),
      });
      // The freshly issued config supersedes whatever we were warning about.
      setPriorCheck({ checking: false, health: 'ok' });
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
    if (result && config) {
      downloadText(`cumulusvpn-${result.cc.toLowerCase()}.conf`, config, 'text/plain');
    }
  };

  return (
    <main className="page">
      <div className="wrap">
        <div className="page-head">
          <span className="eyebrow">{t('connect_eyebrow')}</span>
          <h1>
            {rich('connect_title', { glow: (label) => <span className="glow">{label}</span> })}
          </h1>
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

        {/* `verified` is false until the directory resolves; only a finished check can fail. */}
        {discovery.loading || discovery.verified ? null : (
          <div className="banner warn">{t('connect_verify_warn')}</div>
        )}
        {discovery.notice === 'no-live-gateway' ? (
          <div className="banner info">{t('connect_notice_no_live_gateway')}</div>
        ) : null}

        {/* Verdict on the config issued last visit. Placed above everything else
            because a user whose tunnel silently stopped passing traffic has no
            other way to learn why — and the two verdicts are deliberately
            different in tone: `replaced` is proven dead (the gateway answered
            with a different key), `unreachable` is merely unconfirmed and could
            just as easily be the user's own connection, so it must not assert
            breakage. Suppressed once a fresh config exists on screen. */}
        {!result && prior && priorCheck.checking ? (
          <div className="banner info">{t('connect_conf_checking')}</div>
        ) : null}
        {!result && prior && priorCheck.health === 'replaced' ? (
          <div className="banner error">
            {t('connect_conf_stale', { country: prior.cc.toUpperCase() })}
          </div>
        ) : null}
        {!result && prior && priorCheck.health === 'unreachable' ? (
          <div className="banner warn">
            {t('connect_conf_unsure', { country: prior.cc.toUpperCase() })}
          </div>
        ) : null}

        <div className="grid">
          <section className="card">
            <div className="card-head">
              <h2>{t('connect_choose_location')}</h2>
              {tier?.premium ? (
                <span className="tier-pill premium">
                  {t('connect_tier_premium', { date: formatDay(tier.paidUntil, locale) })}
                </span>
              ) : tier ? (
                <span className="tier-pill free">{t('connect_tier_free')}</span>
              ) : null}
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

            {result && config ? (
              <div className="config-out">
                {result.split === 'premium-required' ? (
                  <div className="banner warn">{t('split_premium_required')}</div>
                ) : null}
                {result.split === 'applied' ? (
                  <div className="banner info">{t('split_applied')}</div>
                ) : null}
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
                    <pre className="conf mono">{config}</pre>
                  </div>
                  <div className="conf-qr">
                    <Qr value={config} size={224} />
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
                    <div className="v mono">{dnsServersFor(dns, result.enroll.dns)}</div>
                  </div>
                </div>
                {/* A .conf is a SNAPSHOT of one gateway: endpoint IP, that node's
                    server pubkey, and a peer registration held by that node. Any
                    of the three can change under the user — a Flux app update
                    redeploys every container — and WireGuard's failure mode is
                    silent, so the app keeps saying "connected" while nothing
                    handshakes. The apps re-enroll automatically; a static file
                    handed to the stock WireGuard client cannot. So say it plainly
                    and put the fix (re-enroll on the same keypair) right here,
                    where someone whose config just stopped working will look. */}
                <p className="muted-text">{t('connect_conf_note')}</p>
                <div className="btn-row">
                  <button type="button" className="btn primary" onClick={onDownload}>
                    {t('connect_download_conf')}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void onGenerate()}
                  >
                    {busy ? t('connect_enrolling') : t('connect_conf_regenerate')}
                  </button>
                  <button type="button" className="btn amber" onClick={onNavigateUpgrade}>
                    {t('connect_upgrade_cta')}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <DnsSection value={dns} onChange={onDnsChange} />

        <SplitSection />

        <MultihopSection keypair={keypair} discovery={discovery} dns={dns} />

        <IdentityPanel
          keypair={keypair}
          restored={identityRestored}
          onRegenerate={onRegenerate}
          onRestore={onRestore}
        />
      </div>
    </main>
  );
}
