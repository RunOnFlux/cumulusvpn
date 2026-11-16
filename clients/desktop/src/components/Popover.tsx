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
import type { TrayAction, TrayCountry, TrayMeters, TrayState } from '../lib/tray.js';

function send(action: TrayAction): void {
  void emit('tray-action', action);
}

/**
 * Four fixed cells. Every value sits in its own column with tabular digits,
 * so a changing number never reflows the line or moves anything below it.
 */
function Meters({ m }: { readonly m: TrayMeters }): JSX.Element {
  return (
    <div className="pop-meters">
      <div>
        <span className="k">↓ Down</span>
        <span className="v">{m.down}</span>
      </div>
      <div>
        <span className="k">↑ Up</span>
        <span className="v">{m.up}</span>
      </div>
      <div>
        <span className="k">Ping</span>
        <span className="v">{m.ping ?? '—'}</span>
      </div>
      <div>
        <span className="k">Time</span>
        <span className="v">{m.elapsed ?? '—'}</span>
      </div>
    </div>
  );
}

function Places({
  countries,
  selected,
  onPick,
  onBack,
}: {
  readonly countries: readonly TrayCountry[];
  readonly selected: string | null;
  readonly onPick: (code: string) => void;
  readonly onBack: () => void;
}): JSX.Element {
  const favorites = countries.filter((c) => c.favorite);
  const rest = countries.filter((c) => !c.favorite);
  const row = (c: TrayCountry): JSX.Element => (
    <button
      key={c.code}
      type="button"
      className={`pop-place ${c.code === selected ? 'on' : ''}`}
      onClick={() => onPick(c.code)}
    >
      <span>{c.label}</span>
      {c.code === selected && <span className="pop-check">✓</span>}
    </button>
  );
  return (
    <div className="pop">
      <button type="button" className="pop-back" onClick={onBack}>
        ‹ Choose location
      </button>
      <div className="pop-places">
        {favorites.length > 0 && (
          <>
            <div className="pop-group">Favorites</div>
            {favorites.map(row)}
            <div className="pop-group">All locations</div>
          </>
        )}
        {rest.map(row)}
      </div>
    </div>
  );
}

export function Popover(): JSX.Element {
  const [s, setS] = useState<TrayState | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    void invoke<TrayState | null>('popover_state').then((v) => {
      if (v) {
        setS(v);
      }
    });
    const un = listen<TrayState>('tray-state', ({ payload }) => setS(payload));
    // The popover hides on blur; open it on the main view next time.
    const reset = (): void => {
      if (document.visibilityState === 'hidden') {
        setPicking(false);
      }
    };
    document.addEventListener('visibilitychange', reset);
    return () => {
      void un.then((f) => f());
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);

  const phase = s?.phase ?? 'loading';
  const connected = phase === 'connected';
  const busy = phase === 'connecting';
  const blocked = s?.blocked === true;
  const tone = blocked ? 'blocked' : connected ? 'on' : busy ? 'busy' : 'off';
  const countries = s?.countries ?? [];
  const current = countries.find((c) => c.code === s?.selected) ?? null;

  if (picking) {
    return (
      <Places
        countries={countries}
        selected={s?.selected ?? null}
        onBack={() => setPicking(false)}
        onPick={(code) => {
          send({ kind: 'connectTo', code });
          setPicking(false);
        }}
      />
    );
  }

  return (
    <div className="pop">
      <div className="pop-head">
        <span className={`pop-dot ${tone}`} />
        <span className="pop-brand">CumulusVPN</span>
      </div>

      <div className="pop-status">
        <div className="pop-headline">{s?.headline ?? 'Starting…'}</div>
        <div className="pop-detail">{s?.detail ?? ' '}</div>
      </div>

      {connected && s?.meters && <Meters m={s.meters} />}

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
        <button
          type="button"
          className="pop-row pop-loc"
          disabled={busy}
          onClick={() => setPicking(true)}
        >
          <span>Location</span>
          <span className="pop-loc-value">
            <span className="pop-loc-name">{current?.label ?? 'Choose…'}</span>
            <span className="chev">›</span>
          </span>
        </button>
      )}

      <button
        type="button"
        className="pop-row pop-switch"
        role="switch"
        aria-checked={s?.killSwitch ?? false}
        disabled={busy}
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
