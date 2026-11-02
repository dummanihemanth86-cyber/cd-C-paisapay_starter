import { describe, expect, it } from 'vitest';
import { VIP_LEVEL_CONFIGURATION } from '../modules/users/vipConfig.js';
import { buildVipProgress, type VipProgressConfiguration } from '../modules/users/vipProgress.js';

const configuredLevels: VipProgressConfiguration[] = VIP_LEVEL_CONFIGURATION.map((level) => ({
  levelNumber: level.levelNumber,
  displayName: level.displayName,
  enabled: true,
  eligibility: { metric: level.metric, targetPaise: String(level.targetPaise) },
  benefits: { rewardPaise: String(level.rewardPaise) },
}));

describe('VIP progress', () => {
  it('uses settled withdrawal totals for levels 1 and 2 and verified orders for levels 3–5', () => {
    const result = buildVipProgress({
      configuredLevels,
      settledWithdrawalPaise: 500_000n,
      verifiedOrderPaise: 1_000_000n,
      creditedRewards: new Map(),
    });
    expect(result.levels.map((level) => level.achieved)).toEqual([true, true, true, true, false]);
    expect(result.currentLevel).toBe(4);
    expect(result.activeLevels).toBe(4);
  });

  it('does not unlock levels without enabled server configuration', () => {
    const result = buildVipProgress({ configuredLevels: [], settledWithdrawalPaise: 5_000_000n, verifiedOrderPaise: 5_000_000n, creditedRewards: new Map() });
    expect(result.activeLevels).toBe(0);
    expect(result.levels.every((level) => !level.achieved)).toBe(true);
  });

  it('marks milestones reached while accurately keeping their reward pending until funded credit exists', () => {
    const result = buildVipProgress({ configuredLevels, settledWithdrawalPaise: 100_000n, verifiedOrderPaise: 0n, creditedRewards: new Map() });
    expect(result.levels[0]).toMatchObject({ achieved: true, rewardPaise: 10_000, rewardStatus: 'PENDING_FUNDED_PROGRAM', creditedPaise: 0 });
  });

  it('shows a VIP bonus as credited only when a matching ledger amount is supplied', () => {
    const result = buildVipProgress({ configuredLevels, settledWithdrawalPaise: 100_000n, verifiedOrderPaise: 0n, creditedRewards: new Map([[1, '10000']]) });
    expect(result.levels[0]).toMatchObject({ rewardStatus: 'CREDITED', creditedPaise: 10_000 });
  });
});
