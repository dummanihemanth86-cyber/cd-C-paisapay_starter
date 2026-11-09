import { describe, expect, it, vi } from 'vitest';
import { hashOtp } from '../lib/security.js';
import { adminPasswordResetRejectionReason, commitAdminPasswordReset, createAdminPasswordResetChallenge, isActiveAdminResetAccount, type AdminPasswordResetChallenge } from '../modules/admin/passwordResetOtp.js';

const phoneE164 = '+919876543210';
const code = '248631';
const now = new Date('2026-11-08T10:00:00.000Z');
const validChallenge: AdminPasswordResetChallenge = {
  id: 'challenge-uuid',
  purpose: 'ADMIN_PASSWORD_RESET',
  phoneE164,
  consumedAt: null,
  expiresAt: new Date(now.getTime() + 60_000),
  deliveryStatus: 'ACCEPTED',
  attempts: 0,
  codeHash: hashOtp(phoneE164, code),
};

function resetTransaction(challenge: AdminPasswordResetChallenge | null = validChallenge, admin: { id: string; status: string; adminRole: { id: string } | null } | null = { id: 'admin-user-id', status: 'ACTIVE', adminRole: { id: 'admin-role-id' } }) {
  return {
    $queryRaw: vi.fn(async () => []),
    otpChallenge: {
      findUnique: vi.fn(async () => challenge),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    user: {
      findUnique: vi.fn(async () => admin),
      update: vi.fn(async () => ({})),
    },
    session: { updateMany: vi.fn(async () => ({ count: 2 })) },
    auditLog: { create: vi.fn(async () => ({})) },
  } as any;
}

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

  it('dispatches only to the exact registered active Admin phone', async () => {
    const dispatchOtp = vi.fn(async (phone: string) => ({ challengeId: 'real-challenge', expiresInSeconds: 300, resendAfterSeconds: 60 }));
    const created = await createAdminPasswordResetChallenge({
      phoneE164,
      findAccount: async (phone) => phone === phoneE164 ? { status: 'ACTIVE', hasAdminRole: true } : null,
      dispatchOtp,
      newChallengeId: () => 'decoy-challenge',
    });
    expect(created).toMatchObject({ eligibleAdmin: true, providerAttempted: true, challenge: { challengeId: 'real-challenge' } });
    expect(dispatchOtp).toHaveBeenCalledExactlyOnceWith(phoneE164);
  });

  it('does not send SMS for unknown, inactive, or non-Admin accounts', async () => {
    const dispatchOtp = vi.fn(async () => ({ challengeId: 'should-not-send' }));
    const ineligibleAccounts = [
      null,
      { status: 'SUSPENDED', hasAdminRole: true },
      { status: 'ACTIVE', hasAdminRole: false },
    ];
    for (const account of ineligibleAccounts) {
      const created = await createAdminPasswordResetChallenge({ phoneE164, findAccount: async () => account, dispatchOtp, newChallengeId: () => 'decoy-challenge' });
      expect(created).toMatchObject({ eligibleAdmin: false, providerAttempted: false, challenge: { challengeId: 'decoy-challenge' } });
    }
    expect(dispatchOtp).not.toHaveBeenCalled();
  });

  it('does not convert provider rejection into an accepted OTP challenge', async () => {
    const providerError = new Error('safe provider rejection');
    await expect(createAdminPasswordResetChallenge({
      phoneE164,
      findAccount: async () => ({ status: 'ACTIVE', hasAdminRole: true }),
      dispatchOtp: async () => { throw providerError; },
      newChallengeId: () => 'unused-decoy',
    })).rejects.toBe(providerError);
  });

  it('hash-verifies a current code, consumes reset challenges, and revokes every active Admin session transactionally', async () => {
    const tx = resetTransaction();
    const result = await commitAdminPasswordReset(tx, {
      phoneE164, challengeId: 'challenge-uuid', code, newPasswordHash: 'scrypt$hashed', now,
      requestId: 'request-123', allowDemoChallenge: false,
    });
    expect(result).toEqual({ ok: true });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'admin-user-id' }, data: { passwordHash: 'scrypt$hashed', loginFailedAttempts: 0, loginLockedUntil: null } });
    expect(tx.otpChallenge.updateMany).toHaveBeenCalledWith({ where: { phoneE164, purpose: 'ADMIN_PASSWORD_RESET', consumedAt: null }, data: { consumedAt: now } });
    expect(tx.session.updateMany).toHaveBeenCalledWith({ where: { userId: 'admin-user-id', revokedAt: null }, data: { revokedAt: now } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ADMIN_PASSWORD_RESET', metadata: { requestId: 'request-123' } }) }));
  });

  it('increments wrong-code attempts but leaves password and sessions unchanged', async () => {
    const tx = resetTransaction();
    const result = await commitAdminPasswordReset(tx, {
      phoneE164, challengeId: 'challenge-uuid', code: '000000', newPasswordHash: 'scrypt$hashed', now,
      allowDemoChallenge: false,
    });
    expect(result).toEqual({ ok: false, reason: 'code_mismatch' });
    expect(tx.otpChallenge.update).toHaveBeenCalledWith({ where: { id: 'challenge-uuid' }, data: { attempts: { increment: 1 } } });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
  });

  it('blocks expired, reused, wrong-purpose, wrong-phone and non-Admin challenges before mutations', async () => {
    const invalidChallenges: Array<[AdminPasswordResetChallenge | null, string]> = [
      [{ ...validChallenge, expiresAt: new Date(now.getTime() - 1) }, phoneE164],
      [{ ...validChallenge, consumedAt: now }, phoneE164],
      [{ ...validChallenge, purpose: 'LOGIN' }, phoneE164],
      [validChallenge, '+919876543211'],
    ];
    for (const [challenge, submittedPhone] of invalidChallenges) {
      const tx = resetTransaction(challenge);
      const result = await commitAdminPasswordReset(tx, { phoneE164: submittedPhone, challengeId: 'challenge-uuid', code, newPasswordHash: 'scrypt$hashed', now, allowDemoChallenge: false });
      expect(result.ok).toBe(false);
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.session.updateMany).not.toHaveBeenCalled();
    }
    const nonAdminTx = resetTransaction(validChallenge, { id: 'disabled-admin', status: 'SUSPENDED', adminRole: { id: 'role' } });
    const nonAdmin = await commitAdminPasswordReset(nonAdminTx, { phoneE164, challengeId: 'challenge-uuid', code, newPasswordHash: 'scrypt$hashed', now, allowDemoChallenge: false });
    expect(nonAdmin).toEqual({ ok: false, reason: 'admin_account_unavailable' });
    expect(nonAdminTx.user.update).not.toHaveBeenCalled();
    expect(nonAdminTx.session.updateMany).not.toHaveBeenCalled();
  });
});
