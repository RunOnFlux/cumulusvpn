import { useState } from 'react';
import type { JSX } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

/**
 * Settings → Quit CumulusVPN. Closing the window only hides it (lib.rs
 * `CloseRequested`: the tunnel must not die with a window), and the other Quit
 * lives in the tray — which Fedora's stock GNOME, without the AppIndicator
 * extension, doesn't show at all. Same command as the tray popover's Quit:
 * `app.exit` runs `shutdown`, so the tunnel and kill switch come down first.
 *
 * While a tunnel is up (or coming up) a slip here leaves the machine
 * unprotected, so it asks first, inline. Disconnected, there is nothing to
 * lose and it quits at once. The tray's Quit stays one click: a native menu
 * can't hold a confirmation.
 */
export function QuitRow({ connected }: { readonly connected: boolean }): JSX.Element | null {
  const [confirming, setConfirming] = useState(false);
  if (!isTauri()) {
    return null;
  }
  const quit = (): void => void invoke('popover_quit');

  if (confirming && connected) {
    return (
      <div className="setrow quitrow confirming" role="alert">
        <div className="setlabel">Disconnect and quit?</div>
        <div className="setsub">
          The VPN disconnects and stays off until you open CumulusVPN again.
        </div>
        <div className="id-btns">
          <button type="button" className="st-addbtn id-primary" onClick={quit}>
            Quit
          </button>
          <button type="button" className="st-addbtn" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="setrow quitrow"
      onClick={() => (connected ? setConfirming(true) : quit())}
    >
      <span className="setmeta">
        <span className="setlabel">Quit CumulusVPN</span>
        <span className="setsub">Disconnects and closes the app</span>
      </span>
    </button>
  );
}
