const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldShowPromotionalBanner, vipProgressStatusLabel } = require('./homeFinancialUx.cjs');

test('hides earnings promotions unless the server confirms financial operations are enabled', () => {
  assert.equal(shouldShowPromotionalBanner(false), false);
  assert.equal(shouldShowPromotionalBanner(undefined), false);
  assert.equal(shouldShowPromotionalBanner(true), true);
});

test('reports VIP setup state without claiming that the server is still connecting', () => {
  assert.equal(vipProgressStatusLabel({ programStatus: 'SETUP_REQUIRED' }), 'SETUP REQUIRED');
  assert.equal(vipProgressStatusLabel({ programStatus: 'ACTIVE', currentLevel: 2 }), 'VIP 2 ACTIVE');
  assert.equal(vipProgressStatusLabel(null), 'STATUS UNAVAILABLE');
  assert.equal(vipProgressStatusLabel({ programStatus: 'UNKNOWN' }), 'STATUS UNAVAILABLE');
});
