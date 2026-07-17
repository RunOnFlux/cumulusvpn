// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.) with
// Vitest's expect and augments its types, and unmounts React trees + clears
// storage between tests so component tests stay isolated.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
