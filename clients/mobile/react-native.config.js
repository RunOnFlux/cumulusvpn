/**
 * React Native CLI config. The native tunnel lives in this app's own ios/ and
 * android/ sources (not a separate library), so no extra autolinking deps are
 * declared here yet. POC: extract CumulusTunnel into its own RN library package
 * for autolinking once it stabilises.
 */
module.exports = {
  project: {
    ios: {},
    android: {},
  },
};
