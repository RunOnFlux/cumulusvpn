import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Desktop frontend tests run in jsdom. The Tauri bridge falls back to its
// in-memory mock tunnel when `isTauri()` is false, so session orchestration is
// fully exercisable without the native sidecar.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
