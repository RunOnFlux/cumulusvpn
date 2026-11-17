import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { App } from './App.js';
import { Popover } from './components/Popover.js';
import { reconcileIdentity } from './lib/identityBackup.js';
import { installNativeFetch } from './lib/nativeFetch.js';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import flagFontUrl from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url';
import './styles.css';

// Windows ships no colour flag emoji, so every location rendered as two
// letters ("AU", "AT"). Where the platform can't draw flags this registers
// the Twemoji flag font for the regional-indicator range only; it is first in
// --sans / --mono (styles.css) and does nothing elsewhere. Self-hosted: the
// package's default is a CDN, which the CSP blocks and we wouldn't use anyway.
polyfillCountryFlagEmojis('Twemoji Country Flags', flagFontUrl);

// Before anything fetches: the fleet is only reachable from Rust (see nativeFetch).
installNativeFetch();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('CumulusVPN: #root element missing from index.html');
}

// The menu-bar popover is a view of the main window's state, not a second
// app: it must not run the identity reconcile or a connection controller.
const isPopover = isTauri() && getCurrentWindow().label === 'popover';

if (isPopover) {
  document.documentElement.classList.add('popover');
  createRoot(rootEl).render(
    <StrictMode>
      <Popover />
    </StrictMode>,
  );
} else {
  // Restore / back up the identity before anything reads it (lib/identityBackup).
  void reconcileIdentity().finally(() => {
    createRoot(rootEl).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
