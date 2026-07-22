// Inline the app version from package.json at BUILD time. Importing package.json
// from app code would bundle the ENTIRE dependency manifest (deps, devDeps,
// scripts) into the shipped Hermes bundle; this replaces the `__APP_VERSION__`
// identifier with just the version string literal, so nothing else leaks.
const APP_VERSION = require('./package.json').version;

module.exports = {
  presets: ['@react-native/babel-preset'],
  plugins: [
    ({ types: t }) => ({
      name: 'inline-app-version',
      visitor: {
        Identifier(path) {
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
