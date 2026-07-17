import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CumulusVPN web onboarding — static SPA served from vpn.cumulusvpn.com.
// The signed directory.json lives in public/ so it is served verbatim at /directory.json.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
