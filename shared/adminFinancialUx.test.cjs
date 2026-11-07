const test = require('node:test');
const assert = require('node:assert/strict');
const { canViewFinancialAction, financialActionState } = require('./adminFinancialUx.cjs');

test('payment review is Finance/Admin/Super Admin only and follows the server gate', () => {
  for (const role of ['FINANCE', 'ADMIN', 'SUPER_ADMIN']) {
    assert.equal(canViewFinancialAction('paymentVerification', role), true);
    assert.equal(financialActionState('paymentVerification', role, false).enabled, false);
    assert.match(financialActionState('paymentVerification', role, false).reason, /safety gate is disabled/i);
    assert.equal(financialActionState('paymentVerification', role, true).enabled, true);
    assert.equal(financialActionState('paymentVerification', role, undefined).enabled, false);
    assert.match(financialActionState('paymentVerification', role, undefined).reason, /has not confirmed/i);
  }
  for (const role of ['OPERATIONS', 'SUPPORT', '']) {
    assert.equal(canViewFinancialAction('paymentVerification', role), false);
    assert.equal(financialActionState('paymentVerification', role, true).visible, false);
  }
});

test('Operations, Finance and Admin have consistent read-only Quick Deposit visibility', () => {
  for (const role of ['OPERATIONS', 'FINANCE', 'ADMIN', 'SUPER_ADMIN']) {
    const state = financialActionState('quickDeposit', role, true);
    assert.equal(state.visible, true);
    assert.equal(state.enabled, false);
    assert.match(state.reason, /read-only/i);
  }
  assert.equal(financialActionState('quickDeposit', 'SUPPORT', true).visible, false);
});

test('withdrawal verification, payout and direct wallet adjustments stay unavailable for authorized viewers', () => {
  for (const action of ['withdrawalVerification', 'payoutProcessing', 'walletAdjustment']) {
    for (const role of ['FINANCE', 'ADMIN', 'SUPER_ADMIN']) {
      const state = financialActionState(action, role, true);
      assert.equal(state.visible, true);
      assert.equal(state.enabled, false);
      assert.ok(state.reason.length > 0);
    }
  }
  assert.equal(financialActionState('payoutProcessing', 'OPERATIONS', true).visible, false);
});
