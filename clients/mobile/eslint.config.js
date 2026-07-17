// Flat ESLint config for the standalone mobile app.
//
// Mirrors the repo-wide approach used by @cumulusvpn/core (typescript-eslint
// flat config) rather than the legacy `@react-native/eslint-config`, which is
// eslintrc-style and peer-caps at ESLint 9 — this repo standardises on ESLint
// 10 flat config across every package.
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'ios/**',
      'android/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'metro.config.js',
      'babel.config.js',
      'react-native.config.js',
      'jest.config.js',
      'jest.setup.js',
      'eslint.config.js',
      'index.js',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Test files run under Jest globals and use react-test-renderer's `act`.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
  },
);
