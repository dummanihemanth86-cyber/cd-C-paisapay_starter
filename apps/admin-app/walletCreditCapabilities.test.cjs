const test = require('node:test');
const assert = require('node:assert/strict');
const { canDecideWalletRequest, canRequestWalletCredit, canDirectWalletCredit } = require('./walletCreditCapabilities.cjs');

const ready = {
  role: 'SUPER_ADMIN',
  walletCreditRequestsEnabled: true,
  walletFundingRequestsEnabled: true,
};

test('credit request controls require the server enabled capability and SUPER_ADMIN role', () => {
  assert.equal(canRequestWalletCredit(ready), true);
  assert.equal(canRequestWalletCredit({ ...ready, walletCreditRequestsEnabled: false }), false);
  assert.equal(canRequestWalletCredit({ ...ready, role: 'ADMIN' }), false);
});

test('credit and funding decisions are disabled unless their matching server capability is enabled', () => {
  assert.equal(canDecideWalletRequest(ready, 'credit'), true);
  assert.equal(canDecideWalletRequest(ready, 'funding'), true);
  assert.equal(canDecideWalletRequest({ ...ready, walletCreditRequestsEnabled: false }, 'credit'), false);
  assert.equal(canDecideWalletRequest({ ...ready, walletFundingRequestsEnabled: false }, 'funding'), false);
  assert.equal(canDecideWalletRequest({ ...ready, role: 'FINANCE' }, 'credit'), false);
  assert.equal(canDecideWalletRequest(ready, 'unknown'), false);
});

test('direct wallet credit requires the staging-specific server capability and SUPER_ADMIN role', () => {
  assert.equal(canDirectWalletCredit({ ...ready, stagingDirectWalletCreditsEnabled: true }), true);
  assert.equal(canDirectWalletCredit(ready), false);
  assert.equal(canDirectWalletCredit({ ...ready, role: 'ADMIN', stagingDirectWalletCreditsEnabled: true }), false);
});
