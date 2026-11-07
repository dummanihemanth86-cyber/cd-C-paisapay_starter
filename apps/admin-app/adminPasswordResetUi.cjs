function adminPhoneInputDigits(raw) {
  const value = String(raw || '').trim();
  const digits = value.replace(/\D/g, '');
  let national;

  if (/^\+91/.test(value) || (digits.length === 12 && digits.startsWith('91'))) {
    national = digits.slice(2);
  } else if (/^0091/.test(value) || (digits.length === 14 && digits.startsWith('0091'))) {
    national = digits.slice(4);
  } else if (!value.startsWith('+') && !value.startsWith('00') && digits.length <= 10) {
    national = digits;
  } else {
    return '';
  }

  return /^\d{0,10}$/.test(national) ? national : '';
}

function normalizeAdminPhone(raw) {
  const national = adminPhoneInputDigits(raw);
  return national.length === 10 ? `+91${national}` : '';
}

function canSubmitAdminPasswordReset({ challengeId, code, newPassword }) {
  return typeof challengeId === 'string'
    && challengeId.length > 0
    && /^\d{6}$/.test(String(code || ''))
    && String(newPassword || '').length >= 12
    && String(newPassword || '').length <= 128;
}

module.exports = { adminPhoneInputDigits, normalizeAdminPhone, canSubmitAdminPasswordReset };
