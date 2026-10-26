// Registers @testing-library/jest-dom matchers with Vitest's expect, cleans
// up rendered React trees between tests so component tests stay isolated, and
// gives jsdom (which has no layout) a no-op Element.scrollIntoView.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

Element.prototype.scrollIntoView = function scrollIntoView(): void {};
