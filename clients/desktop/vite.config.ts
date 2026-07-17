import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed dev port and its own env prefix. `TAURI_*` vars are
// injected by the CLI during `tauri dev` / `tauri build`; the web build itself
// is a plain static bundle in `dist/`.
// https://tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // wireguard-go ships its own TLS-free control plane; keep the bundle lean
    // and target the OS webviews Tauri embeds (modern Chromium / WebKit).
    target: ['es2022', 'chrome110', 'safari16'],
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
