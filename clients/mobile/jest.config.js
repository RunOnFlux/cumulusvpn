/**
 * Jest config for the standalone mobile app.
 *
 * Uses React Native's official preset (babel-jest via @react-native/babel-preset
 * + the RN resolver and test environment). The only project-specific tweak is
 * `transformIgnorePatterns`: the default preset transforms nothing under
 * node_modules except react-native itself, but `@cumulusvpn/core` and its
 * crypto deps (@noble/*, @scure/base) ship as pure ESM, so they must be run
 * through babel too or Jest's CommonJS runtime chokes on `import`/`export`.
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@cumulusvpn|@noble|@scure|react-native-get-random-values)/)',
  ],
  // `@cumulusvpn/core` ships an ESM-only `exports` map (an `import` condition
  // and nothing else). Jest's CommonJS resolver has no matching condition, so
  // point it straight at the built entry; babel-jest then transpiles its ESM.
  moduleNameMapper: {
    '^@cumulusvpn/core$': '<rootDir>/node_modules/@cumulusvpn/core/dist/index.js',
  },
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Mock the native AsyncStorage module (see jest.setup.js).
  setupFiles: ['<rootDir>/jest.setup.js'],
};
