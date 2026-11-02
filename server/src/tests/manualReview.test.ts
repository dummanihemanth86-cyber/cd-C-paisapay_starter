import { describe, expect, it } from 'vitest';
import { validateManualReviewEvidence } from '../modules/payments/manualReview.js';

const good = {
  claimStatus: 'PENDING_REVIEW',
  claimedTransactionReference: 'UPI-TXN-100',
  verifiedTransactionReference: 'UPI-TXN-100',
  expectedAmountPaise: 10000n,
  verifiedAmountPaise: 10000n,
  verifiedCurrency: 'INR',
  receiverConfirmed: true,
};

describe('manual payment review evidence', () => {
  it('accepts only an exact pending claim match', () => {
    expect(validateManualReviewEvidence(good)).toBeNull();
  });
  it('allows image-only claims when Finance independently supplies the verified transaction reference', () => {
    expect(validateManualReviewEvidence({ ...good, claimedTransactionReference: null })).toBeNull();
  });
  it('rejects an already reviewed claim', () => {
    expect(validateManualReviewEvidence({ ...good, claimStatus: 'APPROVED' })).toBe('CLAIM_NOT_PENDING');
  });
  it('rejects a transaction reference mismatch', () => {
    expect(validateManualReviewEvidence({ ...good, verifiedTransactionReference: 'OTHER' })).toBe('TRANSACTION_REFERENCE_MISMATCH');
  });
  it('rejects amount or currency mismatch', () => {
    expect(validateManualReviewEvidence({ ...good, verifiedAmountPaise: 9999n })).toBe('AMOUNT_MISMATCH');
    expect(validateManualReviewEvidence({ ...good, verifiedCurrency: 'USD' })).toBe('CURRENCY_MISMATCH');
  });
  it('rejects unless merchant receiver receipt was independently confirmed', () => {
    expect(validateManualReviewEvidence({ ...good, receiverConfirmed: false })).toBe('RECEIVER_NOT_CONFIRMED');
  });
});
