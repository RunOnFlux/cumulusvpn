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

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  // POC: watch the linked core package so edits hot-reload during development.
  watchFolders: [coreRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(coreRoot, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
