const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminSessionStorage } = require('./adminSessionStorage.cjs');

test('web admin session uses tab-scoped browser storage', async () => {
  const values = new Map();
  const webStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const store = createAdminSessionStorage({ platform: 'web', getWebStorage: () => webStorage });
  await store.setItemAsync('access', 'opaque-access-token');
  assert.equal(await store.getItemAsync('access'), 'opaque-access-token');
  await store.deleteItemAsync('access');
  assert.equal(await store.getItemAsync('access'), null);
});

test('native Admin continues to use the existing SecureStore unchanged', () => {
  const secureStore = { getItemAsync() {}, setItemAsync() {}, deleteItemAsync() {} };
  assert.equal(createAdminSessionStorage({ platform: 'android', secureStore }), secureStore);
});

test('web storage failure is explicit and does not fall back to persistent local storage', async () => {
  const store = createAdminSessionStorage({ platform: 'web', getWebStorage: () => null });
  await assert.rejects(store.getItemAsync('access'), /Browser session storage is unavailable/);
});
