const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FINANCIAL_OPERATIONS_DISABLED_CODE, financialOperationsEnabled, financialAvailability, loadFinancialResource, loadVersionedAvailability } = require('./financialApiFallback.cjs');

test('accepts only the explicit v2 availability contract', async () => {
  const response = {
    apiVersion: '2.0.0', schemaVersion: 2,
    financialOperations: {
      enabled: false,
      capabilities: { addMoney: { available: false }, withdraw: { available: false }, quickDeposit: { available: false }, p2pMatching: { available: false } },
    },
  };
  assert.equal(await loadVersionedAvailability(async () => response), response);
  assert.equal(await loadVersionedAvailability(async () => ({ ...response, schemaVersion: 1 })), null);
  assert.equal(await loadVersionedAvailability(async () => { throw Object.assign(new Error('not found'), { status: 404 }); }), null);
});

test('uses a safe empty result when a financial read is blocked by the server gate', async () => {
  const result = await loadFinancialResource(async () => {
    throw Object.assign(new Error('Financial operations are disabled on this server.'), {
      status: 503,
      code: FINANCIAL_OPERATIONS_DISABLED_CODE,
    });
  }, { orders: [] });

  assert.deepEqual(result, { value: { orders: [] }, disabled: true });
});

test('keeps successful financial read data and reports the feature as available', async () => {
  const value = { orders: [{ id: 'server-order' }] };
  const result = await loadFinancialResource(async () => value, { orders: [] });

  assert.deepEqual(result, { value, disabled: false });
});

test('does not hide authentication, network, or unrelated server errors', async () => {
  for (const error of [
    Object.assign(new Error('expired'), { status: 401, code: 'AUTH_REQUIRED' }),
    Object.assign(new Error('server unavailable'), { status: 503, code: 'DATABASE_UNAVAILABLE' }),
    new Error('network unavailable'),
  ]) {
    await assert.rejects(loadFinancialResource(async () => { throw error; }, []), (actual) => actual === error);
  }
});

test('financial actions stay disabled until both server reads confirm availability', () => {
  assert.equal(financialOperationsEnabled(null, null), false);
  assert.equal(financialOperationsEnabled({ disabled: false }, null), false);
  assert.equal(financialOperationsEnabled({ disabled: false }, { disabled: true }), false);
  assert.equal(financialOperationsEnabled({ disabled: false }, { disabled: false }), true);
});

test('server capability response controls Add Money, Withdraw, Quick Deposit, and P2P availability', () => {
  const enabled = {
    financialOperations: {
      enabled: true,
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: true }])),
    },
  };
  const readsAvailable = { disabled: false };
  assert.deepEqual(financialAvailability(enabled, readsAvailable, readsAvailable), { enabled: true, reason: '' });

  const disabled = {
    financialOperations: {
      enabled: false,
      reason: 'Financial operations are disabled by the server safety gate.',
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: false }])),
    },
  };
  assert.deepEqual(financialAvailability(disabled, { disabled: true }, { disabled: true }), {
    enabled: false,
    reason: 'Financial operations are disabled by the server safety gate.',
  });
});

test('financial actions fail closed if server capabilities are missing, contradictory, or unreadable', () => {
  const readsAvailable = { disabled: false };
  assert.equal(financialAvailability({}, readsAvailable, readsAvailable).enabled, false);
  const inconsistent = {
    financialOperations: {
      enabled: true,
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: true }])),
    },
  };
  assert.equal(financialAvailability(inconsistent, { disabled: true }, readsAvailable).enabled, false);
  assert.match(financialAvailability(null, null, null).reason, /could not be confirmed/i);
});

test('mobile fallback code matches the server gate and is applied only to gated order reads', () => {
  const serverGate = fs.readFileSync(path.resolve(__dirname, '../../server/src/middleware/financialOperations.ts'), 'utf8');
  const appSource = fs.readFileSync(path.resolve(__dirname, '../App.js'), 'utf8');
  assert.match(appSource, /_slicedToArray\.default\)\(_yield\$Promise\$all, 13\)/);
  assert.match(appSource, /financialAvailability\(versionedAvailability \|\| methodConfig/);

  assert.match(serverGate, new RegExp(`FINANCIAL_OPERATIONS_DISABLED_CODE\\s*=\\s*'${FINANCIAL_OPERATIONS_DISABLED_CODE}'`));
  assert.ok(appSource.includes("loadFinancialResource)(() => (0, _srcApi.apiGet)('/api/v1/orders')"));
  assert.ok(appSource.includes("loadFinancialResource)(() => (0, _srcApi.apiGet)('/api/v1/withdrawals')"));
});

test('financial UI reflects server availability and keeps unavailable actions disabled', () => {
  const depositScreen = fs.readFileSync(path.resolve(__dirname, 'DepositScreen.js'), 'utf8');
  const homeScreen = fs.readFileSync(path.resolve(__dirname, 'UltraHome.js'), 'utf8');
  const withdrawalScreen = fs.readFileSync(path.resolve(__dirname, 'WithdrawalScreen.js'), 'utf8');
  assert.doesNotMatch(depositScreen, />LIVE</);
  assert.match(depositScreen, /financialActionsDisabled \? 'UNAVAILABLE' : 'AVAILABLE'/);
  assert.match(depositScreen, /financialOperationsReason/);
  assert.match(depositScreen, /disabled=\{loading \|\| working \|\| financialActionsDisabled\}/);
  assert.match(depositScreen, /disabled=\{working \|\| !config\?\.receiverVpa \|\| financialActionsDisabled\}/);
  assert.match(homeScreen, /disabled=\{financialOperationsEnabled !== true\}/);
  assert.match(withdrawalScreen, /financialActionsDisabled/);
  assert.match(withdrawalScreen, /financialOperationsReason/);
});
