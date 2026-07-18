/**
 * Jest setup. Replaces the native AsyncStorage module with a tiny in-memory
 * implementation so `storage.ts` runs under Node without a device bridge.
 *
 * We inline the mock (rather than require the library's own) because its mock
 * subpath isn't a stable package export across versions — a self-contained fake
 * of the handful of methods `storage.ts` uses is simpler and version-proof.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key) => (key in store ? store[key] : null)),
      setItem: jest.fn(async (key, value) => {
        store[key] = value;
      }),
      removeItem: jest.fn(async (key) => {
        delete store[key];
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
      getAllKeys: jest.fn(async () => Object.keys(store)),
    },
  };
});
