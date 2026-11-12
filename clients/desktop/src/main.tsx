import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { App } from './App.js';
import { Popover } from './components/Popover.js';
import { reconcileIdentity } from './lib/identityBackup.js';
import { installNativeFetch } from './lib/nativeFetch.js';
import './styles.css';

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
