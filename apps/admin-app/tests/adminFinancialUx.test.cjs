const test = require('node:test');
const assert = require('node:assert/strict');
const { canViewFinancialAction, financialActionState } = require('../../../shared/adminFinancialUx.cjs');

test('native admin financial action visibility follows the same role policy', () => {
  for (const role of ['FINANCE', 'ADMIN', 'SUPER_ADMIN']) {
    assert.equal(canViewFinancialAction('paymentVerification', role), true);
    assert.equal(financialActionState('paymentVerification', role, false).enabled, false);
    assert.match(financialActionState('paymentVerification', role, false).reason, /safety gate is disabled/i);
  }
  assert.equal(canViewFinancialAction('paymentVerification', 'OPERATIONS'), false);
  assert.equal(canViewFinancialAction('quickDeposit', 'OPERATIONS'), true);
});

test('unavailable payout, withdrawal verification and wallet mutation stay non-actionable', () => {
  for (const action of ['withdrawalVerification', 'payoutProcessing', 'walletAdjustment']) {
    assert.equal(financialActionState(action, 'FINANCE', true).enabled, false);
  }
});
