type AmountGroup = { _sum: { amountPaise: bigint | null }; _count?: number };
type UserAmountGroup = AmountGroup & { userId: string };
type SourceAmountGroup = AmountGroup & { sourceUserId: string | null };

export type ReferralMemberMetrics = {
  verifiedTopUpPaise: bigint;
  todayVerifiedTopUpPaise: bigint;
  verifiedDepositCount: number;
  todayVerifiedDepositCount: number;
  earningsGeneratedPaise: bigint;
  todayEarningsGeneratedPaise: bigint;
};

export type ReferralMemberMetricGroups = {
  deposits: readonly UserAmountGroup[];
  p2pDeposits: readonly UserAmountGroup[];
  todayDeposits: readonly UserAmountGroup[];
  todayP2pDeposits: readonly UserAmountGroup[];
  commissions: readonly SourceAmountGroup[];
  todayCommissions: readonly SourceAmountGroup[];
};

/** Start of the current India business day, expressed as a UTC instant. */
export function indiaDayStart(now = new Date()): Date {
  const indiaOffsetMs = 330 * 60 * 1000;
  const indiaNow = new Date(now.getTime() + indiaOffsetMs);
  return new Date(Date.UTC(indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate()) - indiaOffsetMs);
}

function sumById<T extends AmountGroup>(groups: readonly T[], idOf: (group: T) => string | null): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const group of groups) {
    const id = idOf(group);
    if (!id) continue;
    totals.set(id, (totals.get(id) ?? 0n) + (group._sum.amountPaise ?? 0n));
  }
  return totals;
}

function countById(groups: readonly UserAmountGroup[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) counts.set(group.userId, (counts.get(group.userId) ?? 0) + (group._count ?? 0));
  return counts;
}

/** Combine server-verified standard deposits, completed P2P deposits and this referrer's commission entries. */
export function buildReferralMemberMetrics(memberIds: readonly string[], groups: ReferralMemberMetricGroups): Map<string, ReferralMemberMetrics> {
  const standardDeposits = sumById(groups.deposits, (group) => group.userId);
  const p2pDeposits = sumById(groups.p2pDeposits, (group) => group.userId);
  const todayStandardDeposits = sumById(groups.todayDeposits, (group) => group.userId);
  const todayP2pDeposits = sumById(groups.todayP2pDeposits, (group) => group.userId);
  const commissions = sumById(groups.commissions, (group) => group.sourceUserId);
  const todayCommissions = sumById(groups.todayCommissions, (group) => group.sourceUserId);
  const standardDepositCounts = countById(groups.deposits);
  const p2pDepositCounts = countById(groups.p2pDeposits);
  const todayStandardDepositCounts = countById(groups.todayDeposits);
  const todayP2pDepositCounts = countById(groups.todayP2pDeposits);

  return new Map(memberIds.map((id) => [id, {
    verifiedTopUpPaise: (standardDeposits.get(id) ?? 0n) + (p2pDeposits.get(id) ?? 0n),
    todayVerifiedTopUpPaise: (todayStandardDeposits.get(id) ?? 0n) + (todayP2pDeposits.get(id) ?? 0n),
    verifiedDepositCount: (standardDepositCounts.get(id) ?? 0) + (p2pDepositCounts.get(id) ?? 0),
    todayVerifiedDepositCount: (todayStandardDepositCounts.get(id) ?? 0) + (todayP2pDepositCounts.get(id) ?? 0),
    earningsGeneratedPaise: commissions.get(id) ?? 0n,
    todayEarningsGeneratedPaise: todayCommissions.get(id) ?? 0n,
  }]));
}
