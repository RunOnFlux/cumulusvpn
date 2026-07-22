import { useMemo, useState } from 'react';
import { ApiError, buildMultihopConfig, enroll, selectHops } from '@cumulusvpn/core';
import type { Keypair, MultihopConfig, RouteStyle } from '@cumulusvpn/core';
import type { DiscoveryState } from '../hooks/useDiscovery';
import { useI18n } from '../hooks/useLocale';
import { downloadText } from '../lib/download';
import { proxiedFetch } from '../lib/gatewayFetch';

interface MultihopSectionProps {
  readonly keypair: Keypair;
  readonly discovery: DiscoveryState;
}

interface MultihopResult {
  readonly config: MultihopConfig;
  readonly entryLabel: string;
  readonly exitLabel: string;
  readonly exitIp: string;
}

type MultihopError =
  | { kind: 'no-exit' }
  | { kind: 'rejected'; slug: string; message: string }
  | { kind: 'no-gateways' }
  | { kind: 'failed'; message: string | null };

/**
 * Country code + display name pairs available as hop picks. Multi-hop is a
 * COUNTRY-level choice (jurisdiction), so dedupe the per-city single-hop options
 * back to one entry per country.
 */
function hopChoices(discovery: DiscoveryState): { cc: string; name: string; flag: string }[] {
  const seen = new Set<string>();
  const out: { cc: string; name: string; flag: string }[] = [];
  for (const o of discovery.options) {
    if (seen.has(o.cc)) {
      continue;
    }
    seen.add(o.cc);
    out.push({ cc: o.cc, name: o.name, flag: o.flag });
  }
  return out;
}

/**
 * Advanced, opt-in multi-hop config export (collapsed by default). The web app
 * can't tunnel, but for advanced users it generates the two nested WireGuard
 * configs (`docs/11-multihop.md`): enroll the *same* key K at an entry and an
 * exit gateway, then {@link buildMultihopConfig} produces `wg-entry.conf`
 * (outer, `AllowedIPs = <exitIp>/32`, MTU 1420) and `wg-exit.conf` (inner,
 * `0.0.0.0/0`, MTU 1340, exit DNS). Multi-hop is premium — one payment on key K
 * covers both hops — and OFF by default. Amber accents (premium token).
 */
export function MultihopSection({ keypair, discovery }: MultihopSectionProps) {
  const { t, rich } = useI18n();
  const choices = useMemo(() => hopChoices(discovery), [discovery]);
  const [entryCc, setEntryCc] = useState<string>('');
  const [exitCc, setExitCc] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MultihopError | null>(null);
  const [result, setResult] = useState<MultihopResult | null>(null);

  // Effective picks: explicit choice, else derive sensible defaults (first
  // country for entry, a different one for exit) so the invariant entry≠exit
  // holds without forcing the user to touch both dropdowns.
  const entry = entryCc || choices[0]?.cc || '';
  const exit = exitCc || choices.find((c) => c.cc !== entry)?.cc || '';

  // Same country → keep it in one jurisdiction; different → cross-jurisdiction.
  const style: RouteStyle =
    entry && exit && entry === exit ? 'multihop-same-country' : 'multihop-cross-jurisdiction';

  const reset = (): void => {
    setResult(null);
    setError(null);
  };

  const onGenerate = async (): Promise<void> => {
    if (!entry || !exit) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Resolve the ordered hops from discovered gateways per the core contract:
      // enforces entry≠exit and the jurisdiction rule for the chosen style.
      const hops = selectHops(discovery.gateways, style, {
        entryCountry: entry,
        exitCountry: exit,
      });
      const exitGw = hops.exit;
      if (!exitGw) {
        setError({ kind: 'no-exit' });
        return;
      }

      // Enroll the SAME key K at both gateways — entitlement follows the key on
      // every gateway, so one payment covers both hops (no gateway change).
      const [entryEnroll, exitEnroll] = await Promise.all([
        enroll(hops.entry.ip, keypair.publicKey, {
          signPubKey: hops.entry.sign_pubkey,
          fetchImpl: proxiedFetch,
        }),
        enroll(exitGw.ip, keypair.publicKey, {
          signPubKey: exitGw.sign_pubkey,
          fetchImpl: proxiedFetch,
        }),
      ]);

      const config = buildMultihopConfig({
        privateKey: keypair.privateKey,
        entry: entryEnroll,
        exit: exitEnroll,
      });

      const exitIp = config.exitEndpoint.slice(0, config.exitEndpoint.lastIndexOf(':'));
      setResult({
        config,
        entryLabel: `${hops.entry.country.toUpperCase()} · ${hops.entry.ip}`,
        exitLabel: `${exitGw.country.toUpperCase()} · ${exitGw.ip}`,
        exitIp,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ kind: 'rejected', slug: err.slug, message: err.message });
      } else if (
        discovery.gateways.length === 0 &&
        err instanceof Error &&
        err.message.startsWith('selectHops:')
      ) {
        setError({ kind: 'no-gateways' });
      } else {
        setError({ kind: 'failed', message: err instanceof Error ? err.message : null });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card mh">
      <details>
        <summary>
          <span className="mh-sum">
            <span className="mh-title">{t('multihop_summary_title')}</span>
            <span className="tier-pill premium">{t('multihop_tier_pill')}</span>
          </span>
          <span className="mh-caret" aria-hidden="true">
            ▾
          </span>
        </summary>

        <div className="mh-body">
          <p className="muted-text">
            {rich('multihop_lede', {
              strong: (label) => <strong>{label}</strong>,
              mono: (label) => <span className="mono">{label}</span>,
            })}
          </p>

          <div className="mh-pick">
            <label className="mh-field">
              <span className="mh-k">{t('multihop_entry_label')}</span>
              <select
                className="mh-select"
                value={entry}
                onChange={(e) => {
                  setEntryCc(e.target.value);
                  reset();
                }}
                aria-label={t('multihop_entry_aria')}
              >
                {choices.map((c) => (
                  <option key={c.cc} value={c.cc}>
                    {c.flag} {c.name}
                  </option>
                ))}
              </select>
            </label>

            <span className="mh-arrow" aria-hidden="true">
              →
            </span>

            <label className="mh-field">
              <span className="mh-k">{t('multihop_exit_label')}</span>
              <select
                className="mh-select"
                value={exit}
                onChange={(e) => {
                  setExitCc(e.target.value);
                  reset();
                }}
                aria-label={t('multihop_exit_aria')}
              >
                {choices.map((c) => (
                  <option key={c.cc} value={c.cc}>
                    {c.flag} {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mh-style mono">
            {style === 'multihop-same-country' ? t('multihop_style_same') : t('multihop_style_cross')}
          </div>

          <button
            type="button"
            className="btn amber block"
            disabled={busy || !entry || !exit}
            onClick={() => void onGenerate()}
          >
            {busy ? t('multihop_enrolling') : t('multihop_generate')}
          </button>

          {error ? (
            <div className="banner error">
              {error.kind === 'no-exit'
                ? t('multihop_error_no_exit')
                : error.kind === 'rejected'
                  ? t('error_gateway_rejected', { slug: error.slug, message: error.message })
                  : error.kind === 'no-gateways'
                    ? t('multihop_error_no_gateways')
                    : (error.message ?? t('multihop_error_failed'))}
            </div>
          ) : null}

          {result ? (
            <div className="config-out">
              <div className="mh-route mono">
                <span>{result.entryLabel}</span>
                <span className="mh-route-arrow">→</span>
                <span>{result.exitLabel}</span>
                <span className="mh-route-arrow">→</span>
                <span>{t('multihop_internet')}</span>
              </div>

              <div className="mh-confs">
                <div className="mh-conf">
                  <div className="mh-conf-head">
                    <span className="mh-conf-name mono">wg-entry.conf</span>
                    <span className="mh-conf-tag mono">{t('multihop_conf_outer_tag')}</span>
                  </div>
                  <pre className="conf mono">{result.config.outer}</pre>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => downloadText('wg-entry.conf', result.config.outer, 'text/plain')}
                  >
                    {t('multihop_download_entry')}
                  </button>
                </div>

                <div className="mh-conf">
                  <div className="mh-conf-head">
                    <span className="mh-conf-name mono">wg-exit.conf</span>
                    <span className="mh-conf-tag mono">
                      {t('multihop_conf_inner_tag', { mtu: result.config.innerMtu })}
                    </span>
                  </div>
                  <pre className="conf mono">{result.config.inner}</pre>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => downloadText('wg-exit.conf', result.config.inner, 'text/plain')}
                  >
                    {t('multihop_download_exit')}
                  </button>
                </div>
              </div>

              <div className="banner info mh-note">
                {rich(
                  'multihop_note',
                  {
                    strong: (label) => <strong>{label}</strong>,
                    em: (label) => <em>{label}</em>,
                    mono: (label) => <span className="mono">{label}</span>,
                    br: () => <br />,
                  },
                  {
                    exitIp: result.exitIp,
                    mtu: result.config.innerMtu,
                    endpoint: result.config.exitEndpoint,
                  },
                )}
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}
