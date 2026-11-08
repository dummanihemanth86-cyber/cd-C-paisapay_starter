import { describe, expect, it } from 'vitest';
import { hashOtp } from '../lib/security.js';
import { adminPasswordResetRejectionReason, isActiveAdminResetAccount, type AdminPasswordResetChallenge } from '../modules/admin/passwordResetOtp.js';

const phoneE164 = '+919876543210';
const code = '248631';
const now = new Date('2026-11-08T10:00:00.000Z');
const validChallenge: AdminPasswordResetChallenge = {
  purpose: 'ADMIN_PASSWORD_RESET',
  phoneE164,
  consumedAt: null,
  expiresAt: new Date(now.getTime() + 60_000),
  deliveryStatus: 'ACCEPTED',
  attempts: 0,
  codeHash: hashOtp(phoneE164, code),
};

describe('Admin password reset OTP validation', () => {
  it('accepts only the matching active challenge, phone, provider state and HMAC', () => {
    expect(adminPasswordResetRejectionReason({ challenge: validChallenge, phoneE164, code, now, allowDemoChallenge: false })).toBeNull();
  });

  it('rejects a wrong OTP without exposing which validation failed to the client', () => {
    expect(adminPasswordResetRejectionReason({ challenge: validChallenge, phoneE164, code: '248632', now, allowDemoChallenge: false })).toBe('code_mismatch');
  });

  it('rejects an expired challenge', () => {
    expect(adminPasswordResetRejectionReason({ challenge: { ...validChallenge, expiresAt: new Date(now.getTime() - 1) }, phoneE164, code, now, allowDemoChallenge: false })).toBe('challenge_expired');
  });

  it('rejects a challenge submitted with a different phone number', () => {
    expect(adminPasswordResetRejectionReason({ challenge: validChallenge, phoneE164: '+919876543211', code, now, allowDemoChallenge: false })).toBe('phone_mismatch');
  });

  it('rejects missing, wrong-purpose, consumed, unaccepted and exhausted challenges', () => {
    const evaluate = (challenge: AdminPasswordResetChallenge | null) => adminPasswordResetRejectionReason({ challenge, phoneE164, code, now, allowDemoChallenge: false });
    expect(evaluate(null)).toBe('challenge_not_found');
    expect(evaluate({ ...validChallenge, purpose: 'LOGIN' })).toBe('purpose_mismatch');
    expect(evaluate({ ...validChallenge, consumedAt: now })).toBe('challenge_consumed');
    expect(evaluate({ ...validChallenge, deliveryStatus: 'UNKNOWN' })).toBe('provider_not_accepted');
    expect(evaluate({ ...validChallenge, attempts: 5 })).toBe('attempts_exceeded');
  });

  it('permits only an active user with an Admin role', () => {
    expect(isActiveAdminResetAccount({ status: 'ACTIVE', hasAdminRole: true })).toBe(true);
    expect(isActiveAdminResetAccount({ status: 'SUSPENDED', hasAdminRole: true })).toBe(false);
    expect(isActiveAdminResetAccount({ status: 'ACTIVE', hasAdminRole: false })).toBe(false);
    expect(isActiveAdminResetAccount(null)).toBe(false);
  });
});
