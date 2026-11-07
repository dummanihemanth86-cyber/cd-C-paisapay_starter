const test = require('node:test');
const assert = require('node:assert/strict');
const { adminPhoneInputDigits, normalizeAdminPhone, canSubmitAdminPasswordReset } = require('../adminPasswordResetUi.cjs');

test('admin reset accepts only an Indian 10-digit phone number', () => {
  assert.equal(normalizeAdminPhone('630-330-2128'), '+916303302128');
  assert.equal(normalizeAdminPhone('+91 6303302128'), '+916303302128');
  assert.equal(normalizeAdminPhone('916303302128'), '+916303302128');
  assert.equal(adminPhoneInputDigits('+91 6303302128'), '6303302128');
  assert.equal(adminPhoneInputDigits('6303302128'), '6303302128');
  assert.equal(normalizeAdminPhone('+1 6303302128'), '');
  assert.equal(adminPhoneInputDigits('+1 6303302128'), '');
  assert.equal(normalizeAdminPhone('123'), '');
});

test('admin reset requires a real challenge, six-digit OTP and strong new password', () => {
  const base = { challengeId: 'challenge-id', code: '123456', newPassword: 'new-admin-password' };
  assert.equal(canSubmitAdminPasswordReset(base), true);
  assert.equal(canSubmitAdminPasswordReset({ ...base, code: '2321' }), false);
  assert.equal(canSubmitAdminPasswordReset({ ...base, newPassword: 'short' }), false);
  assert.equal(canSubmitAdminPasswordReset({ ...base, challengeId: '' }), false);
});
