// Inline the app version from package.json at BUILD time. Importing package.json
// from app code would bundle the ENTIRE dependency manifest (deps, devDeps,
// scripts) into the shipped Hermes bundle; this replaces the `__APP_VERSION__`
// identifier with just the version string literal, so nothing else leaks.
const APP_VERSION = require('./package.json').version;

// Screenshot mode (see src/lib/screenshot.ts). OFF unless the bundler was
// invoked with CVPN_SCREENSHOT=1, and inlined as a boolean LITERAL so the
// minifier strips every demo branch out of a normal build. Keeping this at
// build time — rather than behind a runtime/remote flag — is what makes it
// impossible for a store binary to contain the demo data at all.
const SCREENSHOT_MODE = process.env.CVPN_SCREENSHOT === '1';

module.exports = {
  presets: ['@react-native/babel-preset'],
  plugins: [
    ({ types: t }) => ({
      name: 'inline-build-constants',
      visitor: {
        Identifier(path) {
          if (path.node.name === '__SCREENSHOT_MODE__') {
            if (path.scope.hasBinding('__SCREENSHOT_MODE__')) return;
            if (path.parentPath.isMemberExpression({ property: path.node })) return;
            if (
              path.parentPath.isObjectProperty({ key: path.node }) &&
              !path.parentPath.node.computed
            ) {
              return;
            }
            path.replaceWith(t.booleanLiteral(SCREENSHOT_MODE));
            return;
          }
          if (path.node.name !== '__APP_VERSION__') return;
          // Only replace bare value references — not property names or a
          // (hypothetical) local binding of the same identifier.
          if (path.scope.hasBinding('__APP_VERSION__')) return;
          if (path.parentPath.isMemberExpression({ property: path.node })) return;
          if (
            path.parentPath.isObjectProperty({ key: path.node }) &&
            !path.parentPath.node.computed
          ) {
            return;
          }
          path.replaceWith(t.stringLiteral(APP_VERSION));
        },
      },
    }),
  ],
};
