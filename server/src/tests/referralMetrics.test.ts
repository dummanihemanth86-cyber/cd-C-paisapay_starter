import { describe, expect, it } from 'vitest';
import { buildReferralMemberMetrics, indiaDayStart } from '../modules/users/referralMetrics.js';

describe('referral member activity metrics', () => {
  it('uses India midnight for today filters even when the server runs in UTC', () => {
    expect(indiaDayStart(new Date('2026-11-15T00:10:00.000Z')).toISOString()).toBe('2026-11-14T18:30:00.000Z');
    expect(indiaDayStart(new Date('2026-11-15T20:00:00.000Z')).toISOString()).toBe('2026-11-15T18:30:00.000Z');
  });

  it('combines verified deposits and completed P2P orders with per-member accrued commissions', () => {
    const metrics = buildReferralMemberMetrics(['direct-user', 'indirect-user'], {
      deposits: [{ userId: 'direct-user', _sum: { amountPaise: 10_000n }, _count: 1 }],
      p2pDeposits: [{ userId: 'direct-user', _sum: { amountPaise: 20_000n }, _count: 2 }],
      todayDeposits: [{ userId: 'direct-user', _sum: { amountPaise: 3_000n }, _count: 1 }],
      todayP2pDeposits: [{ userId: 'direct-user', _sum: { amountPaise: 5_000n }, _count: 1 }],
      commissions: [
        { sourceUserId: 'direct-user', _sum: { amountPaise: 400n } },
        { sourceUserId: 'indirect-user', _sum: { amountPaise: 100n } },
        { sourceUserId: null, _sum: { amountPaise: 9_999n } },
      ],
      todayCommissions: [{ sourceUserId: 'direct-user', _sum: { amountPaise: 150n } }],
    });

    expect(metrics.get('direct-user')).toEqual({
      verifiedTopUpPaise: 30_000n,
      todayVerifiedTopUpPaise: 8_000n,
      verifiedDepositCount: 3,
      todayVerifiedDepositCount: 2,
      earningsGeneratedPaise: 400n,
      todayEarningsGeneratedPaise: 150n,
    });
    expect(metrics.get('indirect-user')).toEqual({
      verifiedTopUpPaise: 0n,
      todayVerifiedTopUpPaise: 0n,
      verifiedDepositCount: 0,
      todayVerifiedDepositCount: 0,
      earningsGeneratedPaise: 100n,
      todayEarningsGeneratedPaise: 0n,
    });
  });
});
