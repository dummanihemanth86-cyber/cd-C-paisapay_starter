import { hashOtp, safeHashEqual } from '../../lib/security.js';
import type { Prisma } from '../../generated/prisma/client.js';

export type AdminPasswordResetChallenge = {
  id: string;
  purpose: string;
  phoneE164: string;
  consumedAt: Date | null;
  expiresAt: Date;
  deliveryStatus: string | null;
  attempts: number;
  codeHash: string;
};

export type AdminPasswordResetRejectionReason =
  | 'challenge_not_found'
  | 'purpose_mismatch'
  | 'phone_mismatch'
  | 'challenge_consumed'
  | 'challenge_expired'
  | 'provider_not_accepted'
  | 'attempts_exceeded'
  | 'code_mismatch';

export function adminPasswordResetRejectionReason(input: {
  challenge: AdminPasswordResetChallenge | null;
  phoneE164: string;
  code: string;
  now: Date;
  allowDemoChallenge: boolean;
}): AdminPasswordResetRejectionReason | null {
  const { challenge, phoneE164, code, now, allowDemoChallenge } = input;
  if (!challenge) return 'challenge_not_found';
  if (challenge.purpose !== 'ADMIN_PASSWORD_RESET') return 'purpose_mismatch';
  if (challenge.phoneE164 !== phoneE164) return 'phone_mismatch';
  if (challenge.consumedAt) return 'challenge_consumed';
  if (challenge.expiresAt <= now) return 'challenge_expired';
  if (!(allowDemoChallenge && challenge.deliveryStatus === 'DEMO')
    && !['ACCEPTED', 'SENT', 'DELIVERED'].includes(challenge.deliveryStatus ?? '')) {
    return 'provider_not_accepted';
  }
  if (challenge.attempts >= 5) return 'attempts_exceeded';
  if (!safeHashEqual(challenge.codeHash, hashOtp(phoneE164, code))) return 'code_mismatch';
  return null;
}

export function isActiveAdminResetAccount(account: { status: string; hasAdminRole: boolean } | null): boolean {
  return Boolean(account && account.status === 'ACTIVE' && account.hasAdminRole);
}

export async function createAdminPasswordResetChallenge(input: {
  phoneE164: string;
  findAccount: (phoneE164: string) => Promise<{ status: string; hasAdminRole: boolean } | null>;
  dispatchOtp: (phoneE164: string) => Promise<{ challengeId: string; expiresInSeconds?: number; resendAfterSeconds?: number }>;
  newChallengeId: () => string;
}) {
  const account = await input.findAccount(input.phoneE164);
  if (!isActiveAdminResetAccount(account)) {
    return { challenge: { challengeId: input.newChallengeId() }, eligibleAdmin: false, providerAttempted: false };
  }
  return {
    challenge: await input.dispatchOtp(input.phoneE164),
    eligibleAdmin: true,
    providerAttempted: true,
  };
}

export async function commitAdminPasswordReset(tx: Prisma.TransactionClient, input: {
  phoneE164: string;
  challengeId: string;
  code: string;
  newPasswordHash: string;
  now: Date;
  requestId?: string;
  allowDemoChallenge: boolean;
}): Promise<{ ok: true } | { ok: false; reason: AdminPasswordResetRejectionReason | 'admin_account_unavailable' }> {
  await tx.$queryRaw`SELECT id FROM otp_challenges WHERE id = ${input.challengeId}::uuid FOR UPDATE`;
  const challenge = await tx.otpChallenge.findUnique({ where: { id: input.challengeId } });
  const rejectionReason = adminPasswordResetRejectionReason({
    challenge,
    phoneE164: input.phoneE164,
    code: input.code,
    now: input.now,
    allowDemoChallenge: input.allowDemoChallenge,
  });
  if (rejectionReason) {
    if (rejectionReason === 'code_mismatch' && challenge) {
      await tx.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    }
    return { ok: false, reason: rejectionReason };
  }

  const admin = await tx.user.findUnique({ where: { phoneE164: input.phoneE164 }, select: { id: true, status: true, adminRole: { select: { id: true } } } });
  if (!admin || !isActiveAdminResetAccount({ status: admin.status, hasAdminRole: Boolean(admin.adminRole) })) {
    return { ok: false, reason: 'admin_account_unavailable' };
  }

  await tx.user.update({ where: { id: admin.id }, data: { passwordHash: input.newPasswordHash, loginFailedAttempts: 0, loginLockedUntil: null } });
  await tx.otpChallenge.updateMany({ where: { phoneE164: input.phoneE164, purpose: 'ADMIN_PASSWORD_RESET', consumedAt: null }, data: { consumedAt: input.now } });
  await tx.session.updateMany({ where: { userId: admin.id, revokedAt: null }, data: { revokedAt: input.now } });
  await tx.auditLog.create({ data: { actorId: admin.id, action: 'ADMIN_PASSWORD_RESET', target: `ADMIN_USER:${admin.id}`, reason: 'Admin password reset using a verified one-time code.', metadata: { requestId: input.requestId || null } } });
  return { ok: true };
}
