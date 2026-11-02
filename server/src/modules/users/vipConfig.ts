export type VipMetric = 'SETTLED_WITHDRAWAL_PAISE' | 'VERIFIED_ORDER_VOLUME_PAISE';

export const VIP_LEVEL_CONFIGURATION = [
  { levelNumber: 1, displayName: 'VIP 1', metric: 'SETTLED_WITHDRAWAL_PAISE' as const, targetPaise: 100_000, rewardPaise: 10_000 },
  { levelNumber: 2, displayName: 'VIP 2', metric: 'SETTLED_WITHDRAWAL_PAISE' as const, targetPaise: 500_000, rewardPaise: 10_000 },
  { levelNumber: 3, displayName: 'VIP 3', metric: 'VERIFIED_ORDER_VOLUME_PAISE' as const, targetPaise: 550_000, rewardPaise: 10_000 },
  { levelNumber: 4, displayName: 'VIP 4', metric: 'VERIFIED_ORDER_VOLUME_PAISE' as const, targetPaise: 1_000_000, rewardPaise: 10_000 },
  { levelNumber: 5, displayName: 'VIP 5', metric: 'VERIFIED_ORDER_VOLUME_PAISE' as const, targetPaise: 1_500_000, rewardPaise: 50_000 },
] as const;

