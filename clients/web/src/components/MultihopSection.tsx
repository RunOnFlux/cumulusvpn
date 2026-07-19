import { useMemo, useState } from 'react';
import { ApiError, buildMultihopConfig, enroll, selectHops } from '@cumulusvpn/core';
import type { Keypair, MultihopConfig, RouteStyle } from '@cumulusvpn/core';
import type { DiscoveryState } from '../hooks/useDiscovery';
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
  const choices = useMemo(() => hopChoices(discovery), [discovery]);
  const [entryCc, setEntryCc] = useState<string>('');
  const [exitCc, setExitCc] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        setError('Multi-hop needs a distinct exit gateway; none was resolved.');
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
        setError(`Gateway rejected enrollment (${err.slug}): ${err.message}`);
      } else if (
        discovery.gateways.length === 0 &&
        err instanceof Error &&
        err.message.startsWith('selectHops:')
      ) {
        setError(
          'No live gateways reachable from the browser, so no route could be resolved. ' +
            'Multi-hop nesting is really an our-apps feature — the desktop and mobile ' +
            'clients (same core) probe gateways directly and run the two tunnels for you.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Multi-hop generation failed.');
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
            <span className="mh-title">Advanced: multi-hop (two configs)</span>
            <span className="tier-pill premium">PREMIUM · OPT-IN</span>
          </span>
          <span className="mh-caret" aria-hidden="true">
            ▾
          </span>
        </summary>

        <div className="mh-body">
          <p className="muted-text">
            Route through two gateways so{' '}
            <strong>no single server sees both who you are and where you go</strong>. It is slower
            and adds latency — expect roughly <strong>2× ping</strong> versus single-hop, and lower
            peak throughput from the double encryption. Multi-hop is premium, but one{' '}
            <span className="mono">$0.99</span> payment covers both hops (the same key K is premium
            at entry and exit automatically). Off by default — the single-hop flow above stays
            primary.
          </p>

          <div className="mh-pick">
            <label className="mh-field">
              <span className="mh-k">Entry country (sees your IP)</span>
              <select
                className="mh-select"
                value={entry}
                onChange={(e) => {
                  setEntryCc(e.target.value);
                  reset();
                }}
                aria-label="Entry country"
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
              <span className="mh-k">Exit country (sees your destination)</span>
              <select
                className="mh-select"
                value={exit}
                onChange={(e) => {
                  setExitCc(e.target.value);
                  reset();
                }}
                aria-label="Exit country"
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
            Route style:{' '}
            {style === 'multihop-same-country'
              ? 'balanced — same country (one jurisdiction)'
              : 'max privacy — cross-jurisdiction (two operators, two countries)'}
          </div>

          <button
            type="button"
            className="btn amber block"
            disabled={busy || !entry || !exit}
            onClick={() => void onGenerate()}
          >
            {busy ? 'Enrolling both hops…' : 'Generate two configs'}
          </button>

          {error ? <div className="banner error">{error}</div> : null}

          {result ? (
            <div className="config-out">
              <div className="mh-route mono">
                <span>{result.entryLabel}</span>
                <span className="mh-route-arrow">→</span>
                <span>{result.exitLabel}</span>
                <span className="mh-route-arrow">→</span>
                <span>internet</span>
              </div>

              <div className="mh-confs">
                <div className="mh-conf">
                  <div className="mh-conf-head">
                    <span className="mh-conf-name mono">wg-entry.conf</span>
                    <span className="mh-conf-tag mono">outer · MTU 1420</span>
                  </div>
                  <pre className="conf mono">{result.config.outer}</pre>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => downloadText('wg-entry.conf', result.config.outer, 'text/plain')}
                  >
                    Download wg-entry.conf
                  </button>
                </div>

                <div className="mh-conf">
                  <div className="mh-conf-head">
                    <span className="mh-conf-name mono">wg-exit.conf</span>
                    <span className="mh-conf-tag mono">inner · MTU {result.config.innerMtu}</span>
                  </div>
                  <pre className="conf mono">{result.config.inner}</pre>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => downloadText('wg-exit.conf', result.config.inner, 'text/plain')}
                  >
                    Download wg-exit.conf
                  </button>
                </div>
              </div>

              <div className="banner info mh-note">
                <strong>How to route these (honest note).</strong> True nesting with the stock
                WireGuard app is awkward — it runs one tunnel at a time — so multi-hop is really an{' '}
                <strong>our-apps feature</strong> (desktop/mobile chain the two tunnels for you).
                For a manual setup you must bring up <span className="mono">wg-entry.conf</span>{' '}
                first, then route only the exit&rsquo;s address{' '}
                <span className="mono">{result.exitIp}/32</span> via that entry tunnel and send the
                rest through <span className="mono">wg-exit.conf</span> (inner MTU{' '}
                {result.config.innerMtu}, so two WireGuard headers fit). Exit endpoint:{' '}
                <span className="mono">{result.config.exitEndpoint}</span>.
                <br />
                <strong>v1 caveat:</strong> both hops use the same key K, which defeats any{' '}
                <em>single</em> operator but means an adversary controlling <em>both</em> your hops
                could correlate via that shared key. Distinct keys per hop land in v1.5.
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}
