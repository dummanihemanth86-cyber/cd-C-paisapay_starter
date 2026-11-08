import { hashOtp, safeHashEqual } from '../../lib/security.js';

export type AdminPasswordResetChallenge = {
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
