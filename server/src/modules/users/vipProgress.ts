import { VIP_LEVEL_CONFIGURATION } from './vipConfig.js';

export type VipProgressConfiguration = {
  levelNumber: number;
  displayName: string;
  enabled: boolean;
  eligibility: unknown;
  benefits: unknown;
};

export function buildVipProgress(input: {
  configuredLevels: VipProgressConfiguration[];
  settledWithdrawalPaise: bigint;
  verifiedOrderPaise: bigint;
  creditedRewards: Map<number, string>;
}) {
  const configByLevel = new Map(input.configuredLevels.map((item) => [item.levelNumber, item]));
  const levels = VIP_LEVEL_CONFIGURATION.map((fallback) => {
    const row = configByLevel.get(fallback.levelNumber);
    const eligibility = row?.eligibility as { metric?: string; targetPaise?: string | number } | undefined;
    const benefits = row?.benefits as { rewardPaise?: string | number } | undefined;
    const targetValue = Number(eligibility?.targetPaise ?? fallback.targetPaise);
    const rewardValue = Number(benefits?.rewardPaise ?? fallback.rewardPaise);
    const targetPaise = Number.isSafeInteger(targetValue) && targetValue > 0 ? targetValue : fallback.targetPaise;
    const rewardPaise = Number.isSafeInteger(rewardValue) && rewardValue >= 0 ? rewardValue : fallback.rewardPaise;
    const metric = eligibility?.metric === 'SETTLED_WITHDRAWAL_PAISE' ? 'SETTLED_WITHDRAWAL_PAISE' : fallback.metric;
    const current = metric === 'SETTLED_WITHDRAWAL_PAISE' ? input.settledWithdrawalPaise : input.verifiedOrderPaise;
    const achieved = Boolean(row?.enabled) && current >= BigInt(targetPaise);
    const creditedPaise = Number(input.creditedRewards.get(fallback.levelNumber) ?? 0);
    return {
      levelNumber: fallback.levelNumber,
      displayName: row?.displayName ?? fallback.displayName,
      metric,
      targetPaise,
      currentPaise: Number(current),
      rewardPaise,
      progressPercent: Number((current * 10_000n / BigInt(targetPaise)) / 100n) > 100
        ? 100
        : Number((current * 10_000n / BigInt(targetPaise)) / 100n),
      achieved,
      rewardStatus: creditedPaise > 0 ? 'CREDITED' : achieved ? 'PENDING_FUNDED_PROGRAM' : 'LOCKED',
      creditedPaise,
    };
  });
  const activeLevels = levels.filter((level) => level.achieved).length;
  const currentLevel = Math.max(0, ...levels.filter((level) => level.achieved).map((level) => level.levelNumber));
  return { levels, activeLevels, currentLevel };
}
