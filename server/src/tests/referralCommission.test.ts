import { describe, expect, it } from 'vitest';
import { calculateReferralCommissionPaise, REFERRAL_COMMISSION_PERCENT_BPS } from '../modules/users/referralCommission.js';

describe('direct referral commission', () => {
  it('uses the configured 0.4 percent direct rule and integer paise arithmetic', () => {
    expect(REFERRAL_COMMISSION_PERCENT_BPS).toBe(40);
    expect(calculateReferralCommissionPaise(10_000n)).toBe(40n);
    expect(calculateReferralCommissionPaise(50_000n)).toBe(200n);
  });

  it('calculates the 0.1 percent indirect rate in whole paise', () => {
    expect(calculateReferralCommissionPaise(50_000n, 10)).toBe(50n);
  });

  it('rounds down to whole paise and never creates a negative commission', () => {
    expect(calculateReferralCommissionPaise(99n)).toBe(0n);
    expect(calculateReferralCommissionPaise(299n)).toBe(1n);
    expect(calculateReferralCommissionPaise(0n)).toBe(0n);
    expect(calculateReferralCommissionPaise(-10_000n)).toBe(0n);
  });
});
