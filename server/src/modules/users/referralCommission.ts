import type { Prisma } from '../../generated/prisma/client.js';

// Rates are in basis points. 40 bps = 0.4%; 10 bps = 0.1%.
export const REFERRAL_COMMISSION_PERCENT_BPS = 40;
export const INDIRECT_REFERRAL_COMMISSION_PERCENT_BPS = 10;

export function calculateReferralCommissionPaise(amountPaise: bigint, rateBps = REFERRAL_COMMISSION_PERCENT_BPS): bigint {
  if (amountPaise <= 0n || rateBps <= 0) return 0n;
  return amountPaise * BigInt(rateBps) / 10_000n;
}

/**
 * Persist referral commission accruals after a Finance-verified transaction.
 * These entries remain PENDING until a real funded payout policy exists; this
 * function deliberately does not credit a wallet or spend the dev reward pool.
 */
export async function grantVerifiedReferralCommission(
  tx: Prisma.TransactionClient,
  input: { orderId: string; buyerUserId: string; actorUserId: string; amountPaise: bigint },
): Promise<{ amountPaise: bigint; status: 'PENDING' | 'NONE' }> {
  return recordVerifiedReferralCommission(tx, {
    sourceReference: `P2P_ORDER:${input.orderId}`,
    sourceUserId: input.buyerUserId,
    actorUserId: input.actorUserId,
    amountPaise: input.amountPaise,
  });
}

export async function recordVerifiedReferralCommission(
  tx: Prisma.TransactionClient,
  input: { sourceReference: string; sourceUserId: string; actorUserId: string; amountPaise: bigint },
): Promise<{ amountPaise: bigint; status: 'PENDING' | 'NONE' }> {
  if (input.amountPaise <= 0n) return { amountPaise: 0n, status: 'NONE' };
  const source = await tx.user.findUnique({ where: { id: input.sourceUserId }, select: { referredById: true } });
  if (!source?.referredById || source.referredById === input.sourceUserId) return { amountPaise: 0n, status: 'NONE' };

  const [program, directReferrer] = await Promise.all([
    tx.referralProgramConfig.upsert({ where: { id: 1 }, create: { id: 1, directRateBps: 40, indirectRateBps: 10 }, update: {} }),
    tx.user.findUnique({ where: { id: source.referredById }, select: { id: true, referredById: true } }),
  ]);
  const ancestors = [
    { userId: source.referredById, level: 1, bps: program.directRateBps, kind: 'DIRECT_COMMISSION' },
    ...(directReferrer?.referredById && directReferrer.referredById !== input.sourceUserId
      ? [{ userId: directReferrer.referredById, level: 2, bps: program.indirectRateBps, kind: 'INDIRECT_COMMISSION' }]
      : []),
  ];
  let totalPaise = 0n;
  for (const ancestor of ancestors) {
    const amountPaise = calculateReferralCommissionPaise(input.amountPaise, ancestor.bps);
    if (amountPaise <= 0n) continue;
    const qualifyingReference = ancestor.level === 1 && input.sourceReference.startsWith('P2P_ORDER:')
      ? `REFERRAL:${input.sourceReference}`
      : `REFERRAL:${input.sourceReference}:L${ancestor.level}`;
    const existing = await tx.commissionEntry.findUnique({ where: { qualifyingReference }, select: { amountPaise: true } });
    if (existing) { totalPaise += existing.amountPaise; continue; }
    await tx.commissionEntry.create({ data: {
      userId: ancestor.userId,
      qualifyingReference,
      amountPaise,
      fundingReference: 'PENDING_APPROVED_FUNDED_PROGRAM',
      status: 'PENDING',
      kind: ancestor.kind,
      level: ancestor.level,
      sourceUserId: input.sourceUserId,
      qualifyingAmountPaise: input.amountPaise,
    } });
    totalPaise += amountPaise;
  }
  if (input.sourceReference.startsWith('DEPOSIT:')) {
    await updateReferralMilestones(tx, { referrerId: source.referredById, actorUserId: input.actorUserId });
  }
  return { amountPaise: totalPaise, status: totalPaise > 0n ? 'PENDING' : 'NONE' };
}

/** Record a milestone once eligible direct invitees each reach its verified top-up threshold. */
export async function updateReferralMilestones(
  tx: Prisma.TransactionClient,
  input: { referrerId: string; actorUserId: string },
): Promise<void> {
  const [rules, directMembers] = await Promise.all([
    tx.referralMilestoneRule.findMany({ where: { enabled: true }, orderBy: { requiredReferrals: 'asc' } }),
    tx.user.findMany({ where: { referredById: input.referrerId }, select: { id: true } }),
  ]);
  if (!rules.length || !directMembers.length) return;
  const deposits = await tx.deposit.groupBy({
    by: ['userId'],
    where: { userId: { in: directMembers.map((member) => member.id) }, status: { in: ['PAYMENT_VERIFIED', 'COMPLETED'] }, currency: 'INR' },
    _sum: { amountPaise: true },
  });
  const qualifyingAmounts = new Map(deposits.map((row) => [row.userId, row._sum.amountPaise ?? 0n]));
  for (const rule of rules) {
    // A null threshold means an administrator has not supplied the tier-20 rule yet.
    if (!rule.qualifyingTopUpPaise) continue;
    const qualifiedCount = directMembers.filter((member) => (qualifyingAmounts.get(member.id) ?? 0n) >= rule.qualifyingTopUpPaise!).length;
    if (qualifiedCount < rule.requiredReferrals) continue;
    const qualifyingReference = `REFERRAL:MILESTONE:${input.referrerId}:${rule.key}`;
    if (await tx.commissionEntry.findUnique({ where: { qualifyingReference }, select: { id: true } })) continue;
    await tx.commissionEntry.create({ data: {
      userId: input.referrerId,
      qualifyingReference,
      amountPaise: rule.rewardAmountPaise,
      fundingReference: 'PENDING_ADMIN_REVIEW_AND_FUNDED_PROGRAM',
      status: 'PENDING',
      kind: 'MILESTONE_REWARD',
      level: 1,
      qualifyingAmountPaise: rule.qualifyingTopUpPaise * BigInt(rule.requiredReferrals),
    } });
    await tx.auditLog.create({ data: {
      actorId: input.actorUserId,
      action: 'REFERRAL_MILESTONE_ELIGIBILITY_RECORDED',
      target: `USER:${input.referrerId}`,
      reason: 'Milestone requirements were met from verified INR deposits; reward remains pending until an authorized funded payout program is configured.',
      metadata: { milestoneKey: rule.key, rewardAmountPaise: rule.rewardAmountPaise.toString(), qualifyingReferrals: qualifiedCount, requiredReferrals: rule.requiredReferrals },
    } });
  }
}
