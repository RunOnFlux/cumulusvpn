/**
 * The menu-bar popover (window label `popover`, see src-tauri/src/popover.rs):
 * status, one-click Connect / Disconnect, location, kill switch — without
 * opening the main window.
 *
 * A view only. The main window owns the connection; this renders the
 * `TrayState` it publishes and sends the same `tray-action` events the tray
 * menu does, so there is exactly one connection controller.
 */
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { TrayAction, TrayState } from '../lib/tray.js';

function send(action: TrayAction): void {
  void emit('tray-action', action);
}

export function Popover(): JSX.Element {
  const [s, setS] = useState<TrayState | null>(null);

  useEffect(() => {
    void invoke<TrayState | null>('popover_state').then((v) => {
      if (v) {
        setS(v);
      }
    });
    const un = listen<TrayState>('tray-state', ({ payload }) => setS(payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const phase = s?.phase ?? 'loading';
  const connected = phase === 'connected';
  const busy = phase === 'connecting';
  const blocked = s?.blocked === true;
  const tone = blocked ? 'blocked' : connected ? 'on' : busy ? 'busy' : 'off';
  const countries = s?.countries ?? [];
  const favorites = countries.filter((c) => c.favorite);
  const rest = countries.filter((c) => !c.favorite);

  return (
    <div className="pop">
      <div className="pop-head">
        <span className={`pop-dot ${tone}`} />
        <span className="pop-brand">CumulusVPN</span>
      </div>

      <div className="pop-status">
        <div className="pop-headline">{s?.headline ?? 'Starting…'}</div>
        {s?.detail && <div className="pop-detail">{s.detail}</div>}
        {s?.stats && <div className="pop-stats">{s.stats}</div>}
      </div>

      {connected || busy || blocked ? (
        <button type="button" className="btn-disc" onClick={() => send({ kind: 'disconnect' })}>
          {busy ? 'Cancel' : 'Disconnect'}
        </button>
      ) : (
        <button
          type="button"
          className="btn-primary"
          disabled={phase === 'loading' || !s?.selected}
          onClick={() => send({ kind: 'connect' })}
        >
          Connect
        </button>
      )}

      {countries.length > 0 && (
        <label className="pop-row">
          <span>Location</span>
          <select
            className="pop-select"
            value={s?.selected ?? ''}
            disabled={busy}
            onChange={(e) => send({ kind: 'connectTo', code: e.target.value })}
          >
            {favorites.length > 0 && (
              <optgroup label="Favorites">
                {favorites.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            )}
            {rest.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        className="pop-row pop-switch"
        role="switch"
        aria-checked={s?.killSwitch ?? false}
        onClick={() => send({ kind: 'toggleKillSwitch' })}
      >
        <span>Kill switch</span>
        <span className={`ks-track ${s?.killSwitch ? 'on' : ''}`}>
          <span className="ks-thumb" />
        </span>
      </button>

      <div className="pop-foot">
        <button type="button" onClick={() => void invoke('popover_open_main')}>
          Open CumulusVPN
        </button>
        <button type="button" onClick={() => void invoke('popover_quit')}>
          Quit
        </button>
      </div>
    </div>
  );
}
