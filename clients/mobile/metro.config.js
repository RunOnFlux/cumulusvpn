const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro config for the standalone mobile app.
 *
 * `@cumulusvpn/core` is linked via `file:../core-ts`, which lives OUTSIDE this
 * project root, so Metro must be told to watch it and to resolve its imported
 * dependencies (@noble/*, @scure/base) from this app's node_modules.
 */
const projectRoot = __dirname;
const coreRoot = path.resolve(projectRoot, '..', 'core-ts');

/**
 * Screenshot mode (see src/lib/screenshot.ts). Unless the bundler was invoked
 * with CVPN_SCREENSHOT=1, every import of `./screenshot` resolves to
 * `./screenshot.stub` instead, so the demo latency table and demo session never
 * enter the dependency graph.
 *
 * This substitution — not the `__SCREENSHOT_MODE__` babel constant — is what
 * guarantees a store binary contains no demo data. The constant makes the
 * BRANCHES dead, but an imported module's top-level values are still bundled;
 * that leak was observed before this was added, so do not remove it and rely on
 * the constant alone. `yarn verify:no-demo-data` asserts the property.
 */
const SCREENSHOT_MODE = process.env.CVPN_SCREENSHOT === '1';
const screenshotStub = path.resolve(projectRoot, 'src', 'lib', 'screenshot.stub.ts');

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  // POC: watch the linked core package so edits hot-reload during development.
  watchFolders: [coreRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(coreRoot, 'node_modules'),
    ],
    resolveRequest: (context, moduleName, platform) => {
      if (!SCREENSHOT_MODE && /(^|\/)screenshot$/.test(moduleName)) {
        return { type: 'sourceFile', filePath: screenshotStub };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
