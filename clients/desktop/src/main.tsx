import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installNativeFetch } from './lib/nativeFetch.js';
import './styles.css';

// Before anything fetches: the fleet is only reachable from Rust (see nativeFetch).
installNativeFetch();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('CumulusVPN: #root element missing from index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
