import { describe, expect, it } from 'vitest';
import { validateP2pEvidence } from '../modules/p2p/service.js';

const evidence = {
  claimedReference: 'UTR-123456',
  verifiedReference: 'UTR-123456',
  expectedAmountPaise: 50_000n,
  verifiedAmountPaise: 50_000n,
  currency: 'INR',
  receiverConfirmed: true,
};

describe('P2P payment evidence', () => {
  it('accepts exact independently verified INR receipt evidence', () => expect(validateP2pEvidence(evidence)).toBeNull());
  it('rejects mismatched transaction references, amounts, currencies, and missing recipient confirmation', () => {
    expect(validateP2pEvidence({ ...evidence, verifiedReference: 'UTR-OTHER' })).toBe('TRANSACTION_REFERENCE_MISMATCH');
    expect(validateP2pEvidence({ ...evidence, verifiedAmountPaise: 49_999n })).toBe('AMOUNT_MISMATCH');
    expect(validateP2pEvidence({ ...evidence, currency: 'USD' })).toBe('CURRENCY_MISMATCH');
    expect(validateP2pEvidence({ ...evidence, receiverConfirmed: false })).toBe('RECEIVER_NOT_CONFIRMED');
  });
});
