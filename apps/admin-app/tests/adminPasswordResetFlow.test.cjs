const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requestAdminPasswordResetOtp,
  submitAdminPasswordReset,
  adminPasswordResetActionState,
  adminPasswordResetErrorMessage,
} = require('../adminPasswordResetFlow.cjs');

test('reset request sends only the normalized registered Admin phone and returns unconfirmed delivery state', async () => {
  const calls = [];
  const request = async (...args) => {
    calls.push(args);
    return { challengeId: 'challenge-uuid', requestId: 'request-123', requestStatus: 'REQUEST_RECEIVED', deliveryStatus: 'UNCONFIRMED', expiresInSeconds: 300, resendAfterSeconds: 60 };
  };
  const result = await requestAdminPasswordResetOtp(request, '+91 6303302128', 1000);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['/api/v1/admin/auth/forgot-password/request-otp', { method: 'POST', token: '', body: { phoneE164: '+916303302128' } }]);
  assert.equal(result.phoneE164, '+916303302128');
  assert.equal(result.requestId, 'request-123');
  assert.equal(result.requestStatus, 'REQUEST_RECEIVED');
  assert.equal(result.deliveryStatus, 'UNCONFIRMED');
  assert.equal(result.expiresAt, 301000);
  assert.equal(result.resendAt, 61000);
  assert.match(result.message, /does not confirm SMS delivery/);
});

test('invalid Admin phone fails before making an API request', async () => {
  let called = false;
  await assert.rejects(requestAdminPasswordResetOtp(async () => { called = true; }, '123'), { code: 'ADMIN_PHONE_INVALID' });
  assert.equal(called, false);
});

test('provider rejection errors remain visible without exposing an untrusted response body', async () => {
  const safeError = Object.assign(new Error('Renflair rejected its credentials. Check the staging provider configuration.'), { code: 'SMS_GATEWAY_REJECTED', requestId: 'request-456' });
  assert.equal(adminPasswordResetErrorMessage(safeError), `${safeError.message} Support reference: request-456`);
  assert.equal(adminPasswordResetErrorMessage({}), 'Could not confirm the reset request. Check your connection and contact support if it continues.');
});

test('password reset binds the exact phone, challenge, OTP and password to the reset endpoint', async () => {
  let call;
  await submitAdminPasswordReset(async (...args) => { call = args; return { ok: true }; }, {
    phoneE164: '+916303302128', challengeId: 'challenge-uuid', code: '123456', newPassword: 'correct-horse-admin-password', expiresAt: 100_000,
  }, 99_000);
  assert.deepEqual(call, ['/api/v1/admin/auth/password/reset', {
    method: 'POST', token: '',
    body: { phoneE164: '+916303302128', challengeId: 'challenge-uuid', code: '123456', newPassword: 'correct-horse-admin-password' },
  }]);
});

test('expired or invalid reset codes never reach the API', async () => {
  let called = false;
  const request = async () => { called = true; };
  await assert.rejects(submitAdminPasswordReset(request, { phoneE164: '+916303302128', challengeId: 'challenge', code: '123456', newPassword: 'correct-horse-admin-password', expiresAt: 10 }, 10), { code: 'ADMIN_RESET_EXPIRED' });
  await assert.rejects(submitAdminPasswordReset(request, { phoneE164: '+916303302128', challengeId: 'challenge', code: '123', newPassword: 'short' }), { code: 'ADMIN_RESET_INPUT_INVALID' });
  assert.equal(called, false);
});

test('reset UI exposes request, loading, resend-cooldown and resend states', () => {
  assert.equal(adminPasswordResetActionState({ busy: true, challengeId: '', resendSeconds: 0 }), 'loading');
  assert.equal(adminPasswordResetActionState({ busy: false, challengeId: '', resendSeconds: 0 }), 'request');
  assert.equal(adminPasswordResetActionState({ busy: false, challengeId: 'challenge-uuid', resendSeconds: 38 }), 'cooldown');
  assert.equal(adminPasswordResetActionState({ busy: false, challengeId: 'challenge-uuid', resendSeconds: 0 }), 'resend');
});
