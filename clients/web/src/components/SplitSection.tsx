import { useState } from 'react';
import { normalizeSplitRule } from '@cumulusvpn/core';
import type { SplitMode, SplitPolicy } from '@cumulusvpn/core';
import { useI18n } from '../hooks/useLocale';
import { loadSplitPolicy, saveSplitPolicy } from '../lib/splitPolicy';

/**
 * Advanced, opt-in split tunneling editor (collapsed by default, premium).
 *
 * The web client hands a `.conf` to a stock WireGuard app, so the only lever
 * is `AllowedIPs` (docs/17 §4.6): CIDR rules and the LAN-bypass checkbox —
 * no app or domain rules. Rules are authored freely on any tier (§7.6); the
 * premium gate is applied by the `.conf` generator at generation time.
 *
 * The policy is device-local and sensitive (it fingerprints what the user
 * runs) — it is persisted in localStorage only and never transmitted.
 */
export function SplitSection() {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<SplitPolicy>(() => loadSplitPolicy());
  const [draft, setDraft] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const update = (next: SplitPolicy): void => {
    setPolicy(next);
    saveSplitPolicy(next);
  };

  const onMode = (mode: SplitMode): void => {
    update({ ...policy, mode });
  };

  const onAdd = (): void => {
    const value = draft.trim();
    if (value === '') {
      return;
    }
    try {
      const rule = normalizeSplitRule({ kind: 'cidr', value });
      if (policy.rules.some((r) => r.kind === 'cidr' && r.value === rule.value)) {
        setDraft('');
        return; // exact duplicate — treat as done
      }
      update({ ...policy, rules: [...policy.rules, rule] });
      setDraft('');
      setInputError(null);
    } catch (err) {
      setInputError(err instanceof Error ? err.message : t('split_input_invalid'));
    }
  };

  const onRemove = (value: string): void => {
    update({ ...policy, rules: policy.rules.filter((r) => r.value !== value) });
  };

  const cidrRules = policy.rules.filter((r) => r.kind === 'cidr');
  const active = policy.mode !== 'off' || policy.lanBypass;

  return (
    <section className="card mh">
      <details>
        <summary>
          <span className="mh-sum">
            <span className="mh-title">{t('split_summary_title')}</span>
            <span className="tier-pill premium">{t('split_tier_pill')}</span>
          </span>
          <span className="mh-caret" aria-hidden="true">
            ▾
          </span>
        </summary>

        <div className="mh-body">
          <p className="muted-text">{t('split_lede')}</p>

          <div className="st-modes" role="radiogroup" aria-label={t('split_mode_aria')}>
            {(
              [
                ['off', t('split_mode_off')],
                ['exclude', t('split_mode_exclude')],
                ['include', t('split_mode_include')],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={policy.mode === mode}
                className={`st-mode${policy.mode === mode ? ' on' : ''}`}
                onClick={() => onMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>

          {policy.mode === 'off' ? null : (
            <div className="banner warn">
              {policy.mode === 'exclude' ? t('split_warn_exclude') : t('split_warn_include')}
            </div>
          )}

          <label className="st-lan">
            <input
              type="checkbox"
              checked={policy.lanBypass}
              onChange={(e) => update({ ...policy, lanBypass: e.target.checked })}
            />
            <span>{t('split_lan_label')}</span>
          </label>

          {policy.mode === 'off' ? null : (
            <>
              <div className="st-add">
                <input
                  className="mh-select st-input mono"
                  type="text"
                  inputMode="text"
                  placeholder={t('split_cidr_placeholder')}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setInputError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onAdd();
                    }
                  }}
                  aria-label={t('split_cidr_aria')}
                />
                <button type="button" className="btn" onClick={onAdd} disabled={!draft.trim()}>
                  {t('split_add')}
                </button>
              </div>
              {inputError ? <div className="st-error mono">{inputError}</div> : null}

              {cidrRules.length === 0 ? (
                <p className="muted-text">{t('split_rules_empty')}</p>
              ) : (
                <ul className="st-rules">
                  {cidrRules.map((r) => (
                    <li key={r.value} className="st-rule">
                      <span className="mono">{r.value}</span>
                      <button
                        type="button"
                        className="st-remove"
                        onClick={() => onRemove(r.value)}
                        aria-label={t('split_remove_aria', { value: r.value })}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {active ? <p className="muted-text">{t('split_next_note')}</p> : null}
        </div>
      </details>
    </section>
  );
}
