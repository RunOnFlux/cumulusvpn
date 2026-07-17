import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Web unit/component tests run in jsdom so DOM APIs (localStorage, document)
// and React rendering via @testing-library work without a browser.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
