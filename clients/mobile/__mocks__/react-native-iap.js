/**
 * Jest mock for react-native-iap (the real module needs the Nitro native
 * runtime). Tests drive purchases by calling `__firePurchase` /
 * `__fireError` and configure store state via the exposed jest.fn()s.
 */
const listeners = { purchase: new Set(), error: new Set() };

const initConnection = jest.fn(async () => true);
const fetchProducts = jest.fn(async () => []);
const requestPurchase = jest.fn(async () => null);
const finishTransaction = jest.fn(async () => undefined);
const getAvailablePurchases = jest.fn(async () => []);

const purchaseUpdatedListener = jest.fn((fn) => {
  listeners.purchase.add(fn);
  return { remove: () => listeners.purchase.delete(fn) };
});
const purchaseErrorListener = jest.fn((fn) => {
  listeners.error.add(fn);
  return { remove: () => listeners.error.delete(fn) };
});

const __firePurchase = (purchase) => {
  for (const fn of listeners.purchase) {
    fn(purchase);
  }
};
const __fireError = (error) => {
  for (const fn of listeners.error) {
    fn(error);
  }
};
const __reset = () => {
  listeners.purchase.clear();
  listeners.error.clear();
  for (const f of [
    initConnection,
    fetchProducts,
    requestPurchase,
    finishTransaction,
    getAvailablePurchases,
  ]) {
    f.mockClear();
  }
  fetchProducts.mockResolvedValue([]);
  getAvailablePurchases.mockResolvedValue([]);
};

module.exports = {
  __esModule: true,
  initConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
  __firePurchase,
  __fireError,
  __reset,
};
