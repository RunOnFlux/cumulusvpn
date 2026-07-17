// Registers @testing-library/jest-dom matchers with Vitest's expect and cleans
// up rendered React trees between tests so component tests stay isolated.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
