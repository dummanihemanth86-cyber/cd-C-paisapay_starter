const assert = require('node:assert/strict');
const test = require('node:test');
const { parseRupeesToPaise, walletAdjustmentUiState, newIdempotencyKey } = require('../../../shared/walletAdjustmentUi.cjs');

test('wallet adjustment UI is visible only to the specifically authorized ADMIN and stays disabled until backend approval', () => {
  assert.deepEqual(walletAdjustmentUiState('ADMIN', true, false), {
    visible: true, enabled: false,
    reason: 'Wallet adjustments are disabled until production financial controls and the adjustment funding account are approved.',
  });
  assert.equal(walletAdjustmentUiState('SUPER_ADMIN', true, true).visible, false);
  assert.equal(walletAdjustmentUiState('ADMIN', false, true).visible, false);
  assert.equal(walletAdjustmentUiState('ADMIN', true, true).enabled, true);
});

test('rupees convert to exact integer paise and enforce the server amount cap', () => {
  assert.equal(parseRupeesToPaise('10'), 1000);
  assert.equal(parseRupeesToPaise('10.5'), 1050);
  assert.equal(parseRupeesToPaise('0.01'), 1);
  for (const value of ['', '0', '-1', '1.234', '10000.01', '1e2']) assert.equal(parseRupeesToPaise(value), null);
});

test('each adjustment submission gets a UUID idempotency key', () => {
  assert.match(newIdempotencyKey(() => 0.5), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
