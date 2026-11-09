const { normalizeAdminPhone, canSubmitAdminPasswordReset } = require('./adminPasswordResetUi.cjs');

const REQUEST_OTP_PATH = '/api/v1/admin/auth/forgot-password/request-otp';
const RESET_PASSWORD_PATH = '/api/v1/admin/auth/password/reset';
const DEFAULT_EXPIRES_SECONDS = 300;
const DEFAULT_RESEND_SECONDS = 60;
const GENERIC_REQUEST_MESSAGE = 'Request received. If this number belongs to an active Admin, enter the code if it arrives. Renflair does not confirm SMS delivery.';

function secondsOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 && value <= 900 ? value : fallback;
}

async function requestAdminPasswordResetOtp(request, rawPhone, now = Date.now()) {
  const phoneE164 = normalizeAdminPhone(rawPhone);
  if (!phoneE164) throw Object.assign(new Error('Enter the registered 10-digit Indian Admin mobile number.'), { code: 'ADMIN_PHONE_INVALID' });

  const response = await request(REQUEST_OTP_PATH, {
    method: 'POST',
    token: '',
    body: { phoneE164 },
  });
  if (typeof response?.challengeId !== 'string' || !response.challengeId) {
    throw Object.assign(new Error('The reset request did not return a valid reference. Contact support before retrying.'), { code: 'ADMIN_RESET_INVALID_RESPONSE' });
  }
  const expiresInSeconds = secondsOrDefault(response.expiresInSeconds, DEFAULT_EXPIRES_SECONDS);
  const resendAfterSeconds = secondsOrDefault(response.resendAfterSeconds, DEFAULT_RESEND_SECONDS);
  return {
    phoneE164,
    challengeId: response.challengeId,
    requestId: typeof response.requestId === 'string' ? response.requestId : '',
    expiresAt: now + expiresInSeconds * 1000,
    resendAt: now + resendAfterSeconds * 1000,
    requestStatus: response.requestStatus === 'REQUEST_RECEIVED' ? response.requestStatus : 'REQUEST_RECEIVED',
    deliveryStatus: 'UNCONFIRMED',
    message: typeof response.message === 'string' && response.message ? response.message : GENERIC_REQUEST_MESSAGE,
  };
}

async function submitAdminPasswordReset(request, input, now = Date.now()) {
  const phoneE164 = normalizeAdminPhone(input?.phoneE164);
  if (!phoneE164) throw Object.assign(new Error('Enter the registered 10-digit Indian Admin mobile number.'), { code: 'ADMIN_PHONE_INVALID' });
  if (input?.expiresAt && input.expiresAt <= now) {
    throw Object.assign(new Error('This reset code has expired. Request a new code.'), { code: 'ADMIN_RESET_EXPIRED' });
  }
  if (!canSubmitAdminPasswordReset(input || {})) {
    throw Object.assign(new Error('Enter the six-digit SMS code and a new password of at least 12 characters.'), { code: 'ADMIN_RESET_INPUT_INVALID' });
  }
  return request(RESET_PASSWORD_PATH, {
    method: 'POST',
    token: '',
    body: { phoneE164, challengeId: input.challengeId, code: String(input.code), newPassword: input.newPassword },
  });
}

function adminPasswordResetActionState({ busy, challengeId, resendSeconds }) {
  if (busy) return 'loading';
  if (challengeId && resendSeconds > 0) return 'cooldown';
  return challengeId ? 'resend' : 'request';
}

function adminPasswordResetErrorMessage(error) {
  const message = error && typeof error.message === 'string' && error.message.trim()
    ? error.message
    : 'Could not confirm the reset request. Check your connection and contact support if it continues.';
  return error && typeof error.requestId === 'string' && error.requestId
    ? `${message} Support reference: ${error.requestId}`
    : message;
}

module.exports = {
  REQUEST_OTP_PATH,
  RESET_PASSWORD_PATH,
  GENERIC_REQUEST_MESSAGE,
  requestAdminPasswordResetOtp,
  submitAdminPasswordReset,
  adminPasswordResetActionState,
  adminPasswordResetErrorMessage,
};
