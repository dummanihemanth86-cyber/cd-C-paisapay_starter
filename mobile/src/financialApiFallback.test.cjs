const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FINANCIAL_OPERATIONS_DISABLED_CODE, MANUAL_UPI_OPERATIONS_DISABLED_CODE, financialOperationsEnabled, financialAvailability, loadFinancialResource, loadVersionedAvailability } = require('./financialApiFallback.cjs');

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

test('uses the same safe empty result when a manual UPI/P2P read is blocked by its separate gate', async () => {
  const result = await loadFinancialResource(async () => {
    throw Object.assign(new Error('Manual UPI and P2P operations are disabled on this server.'), {
      status: 503,
      code: MANUAL_UPI_OPERATIONS_DISABLED_CODE,
    });
  }, { offers: [] });
  assert.deepEqual(result, { value: { offers: [] }, disabled: true });
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
  assert.deepEqual(financialAvailability(enabled, readsAvailable, readsAvailable), {
    enabled: true,
    reason: '',
    capabilityReasons: {
      addMoney: '', withdraw: '', quickDeposit: '', p2pMatching: '',
      available: { addMoney: true, withdraw: true, quickDeposit: true, p2pMatching: true },
    },
  });

  const disabled = {
    financialOperations: {
      enabled: false,
      reason: 'Financial operations are disabled by the server safety gate.',
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: false }])),
    },
  };
  assert.deepEqual(financialAvailability(disabled, { disabled: true }, { disabled: true }), {
    enabled: false,
    reason: 'Financial actions are unavailable under the server safety settings.',
    capabilityReasons: {
      addMoney: 'Financial actions are unavailable under the server safety settings.',
      withdraw: 'Financial actions are unavailable under the server safety settings.',
      quickDeposit: 'Financial actions are unavailable under the server safety settings.',
      p2pMatching: 'Financial actions are unavailable under the server safety settings.',
      available: { addMoney: false, withdraw: false, quickDeposit: false, p2pMatching: false },
    },
  });
});

test('manual P2P stays available when the separate legacy marketplace orders read is gated', () => {
  const enabled = {
    financialOperations: {
      enabled: true,
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: true }])),
    },
  };
  const manualReadAvailable = { disabled: false };
  const legacyMarketplaceReadBlocked = { disabled: true };
  const result = financialAvailability(enabled, legacyMarketplaceReadBlocked, manualReadAvailable);

  assert.equal(result.enabled, true);
  assert.deepEqual(result.capabilityReasons.available, { addMoney: true, withdraw: true, quickDeposit: true, p2pMatching: true });
  assert.deepEqual(result.capabilityReasons, {
    addMoney: '', withdraw: '', quickDeposit: '', p2pMatching: '',
    available: { addMoney: true, withdraw: true, quickDeposit: true, p2pMatching: true },
  });
});

test('server-disabled manual P2P remains unavailable even if legacy orders can be read', () => {
  const disabled = {
    financialOperations: {
      enabled: false,
      reason: 'Manual UPI/P2P operations are disabled by the server safety gate.',
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: false, reason: 'Manual UPI/P2P operations are disabled by the server safety gate.' }])),
    },
  };
  const result = financialAvailability(disabled, { disabled: false }, { disabled: true });
  assert.equal(result.enabled, false);
  assert.deepEqual(result.capabilityReasons.available, { addMoney: false, withdraw: false, quickDeposit: false, p2pMatching: false });
  assert.match(result.capabilityReasons.quickDeposit, /disabled by the server safety gate/i);
});

test('manual UPI P2P can be available without a platform VPA or payment gateway', () => {
  const enabled = {
    livePaymentsEnabled: false,
    sandboxPaymentsEnabled: false,
    upiDeposit: { available: false, receiverVpa: null, message: 'No platform recipient is configured.' },
    financialOperations: {
      enabled: true,
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: true }])),
    },
  };
  const readsAvailable = { disabled: false };
  const result = financialAvailability(enabled, readsAvailable, readsAvailable);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.capabilityReasons, {
    addMoney: '', withdraw: '', quickDeposit: '', p2pMatching: '',
    available: { addMoney: true, withdraw: true, quickDeposit: true, p2pMatching: true },
  });
});

test('financial actions fail closed if server capabilities are missing or the server disables them', () => {
  const readsAvailable = { disabled: false };
  assert.equal(financialAvailability({}, readsAvailable, readsAvailable).enabled, false);
  const serverDisabled = {
    financialOperations: {
      enabled: false,
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: false }])),
    },
  };
  assert.equal(financialAvailability(serverDisabled, readsAvailable, readsAvailable).enabled, false);
  assert.match(financialAvailability(null, null, null).reason, /could not be confirmed/i);
});

test('explicit v2 capabilities are not hidden when a separate history read is blocked', () => {
  const enabled = {
    financialOperations: {
      enabled: true,
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: true }])),
    },
  };
  const readBlocked = { disabled: true };
  const result = financialAvailability(enabled, readBlocked, readBlocked);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.capabilityReasons.available, { addMoney: true, withdraw: true, quickDeposit: true, p2pMatching: true });
});

test('legacy payment config explains the version mismatch without enabling financial actions', () => {
  const result = financialAvailability({
    livePaymentsEnabled: false,
    sandboxPaymentsEnabled: false,
    upiDeposit: { receiverVpa: null },
    availabilityMessage: 'UPI deposits are unavailable because no recipient is configured. No approved, operational payment provider is configured.',
  }, { disabled: false }, { disabled: false });

  assert.equal(result.enabled, false);
  assert.match(result.reason, /legacy availability response/i);
  assert.match(result.reason, /live payments are disabled/i);
  assert.match(result.reason, /no recipient is configured/i);
  assert.match(result.reason, /no approved, operational payment provider/i);
  assert.match(result.reason, /UPI deposits are unavailable because no recipient is configured/i);
  assert.match(result.capabilityReasons.p2pMatching, /has not confirmed manual UPI\/P2P availability/i);
  assert.doesNotMatch(result.capabilityReasons.p2pMatching, /recipient|provider/i);
});

test('preserves the unavailable recipient blocker and clarifies disabled server gates', () => {
  const result = financialAvailability({
    financialOperations: {
      enabled: false,
      reason: 'Financial operations are disabled by the server safety gate. Standard UPI deposits are unavailable because no authorized platform recipient is configured.',
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: false, reason: 'Standard UPI deposits are unavailable because no authorized platform recipient is configured.' }])),
    },
  }, { disabled: true }, { disabled: true });
  assert.match(result.reason, /Financial actions are unavailable under the server safety settings/i);
  assert.match(result.reason, /Standard UPI deposits are unavailable because no authorized platform recipient is configured/i);

  const outage = financialAvailability({
    financialOperations: {
      enabled: false,
      reason: 'Database-backed payment configuration is unavailable.',
      capabilities: Object.fromEntries(['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].map((name) => [name, { available: false }])),
    },
  }, { disabled: true }, { disabled: true });
  assert.match(outage.reason, /payment configuration could not be loaded/i);
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

test('financial UI reflects server availability and keeps gated actions disabled', () => {
  const depositScreen = fs.readFileSync(path.resolve(__dirname, 'DepositScreen.js'), 'utf8');
  const homeScreen = fs.readFileSync(path.resolve(__dirname, 'UltraHome.js'), 'utf8');
  const withdrawalScreen = fs.readFileSync(path.resolve(__dirname, 'WithdrawalScreen.js'), 'utf8');
  assert.doesNotMatch(depositScreen, />LIVE</);
  assert.doesNotMatch(homeScreen, /LIVE VERIFIED PROGRESS/);
  assert.match(homeScreen, /SERVER-REPORTED PROGRESS/);
  assert.match(depositScreen, /financialActionsDisabled \? 'SETUP REQUIRED' : 'AVAILABLE'/);
  assert.doesNotMatch(depositScreen, /Quick Deposit is unavailable/);
  assert.doesNotMatch(homeScreen, /Some money actions are unavailable/);
  assert.match(depositScreen, /financialCapabilityReasons\?\.quickDeposit \|\| financialCapabilityReasons\?\.p2pMatching/);
  assert.match(depositScreen, /financialOperationsReason/);
  assert.match(depositScreen, /financialCapabilityReasons\?\.quickDeposit/);
  assert.match(depositScreen, /config\?\.message/);
  assert.match(depositScreen, /if \(financialActionsDisabled\) return note\?\.\('Payments unavailable'/);
  assert.match(depositScreen, /standardDepositDisabled \? <View accessibilityRole="alert"/);
  assert.match(depositScreen, /source=\{depositPromoBanner\}/);
  assert.doesNotMatch(depositScreen, /inactivePromoImage|QUICK MATCHING UNAVAILABLE/);
  assert.match(depositScreen, /No payment or balance change was made/);
  assert.match(depositScreen, /Matching setup required/);
  assert.match(depositScreen, /amountPaise \+ \(rewardProgramEnabled \? rewardEstimatePaise : 0\)/);
  assert.match(homeScreen, /onPress=\{\(\) => go\('Deposit'\)\}/);
  assert.doesNotMatch(homeScreen, /disabled=\{financialOperationsEnabled !== true\}/);
  assert.match(withdrawalScreen, /financialActionsDisabled/);
  assert.match(withdrawalScreen, /financialOperationsReason/);
  assert.match(withdrawalScreen, /financialCapabilityReasons\?\.withdraw/);
});
