import { describe, expect, it } from 'vitest';
import { verifyProviderObservation, type ProviderPaymentObservation } from '../integrations/payments/verification.js';

const expected = { merchantReference: 'PP-ORDER-100', amountPaise: 10000n, currency: 'INR' as const, merchantId: 'PAISAPAY-MERCHANT' };
const successful: ProviderPaymentObservation = {
  merchantReference: 'PP-ORDER-100', providerReference: 'PROVIDER-TXN-1', amountPaise: 10000n,
  currency: 'INR', merchantId: 'PAISAPAY-MERCHANT', status: 'SUCCESS', authenticated: true,
};

describe('provider-neutral payment verification contract (mock observations)', () => {
  it('accepts only authenticated success matching order, amount, INR, merchant, and provider reference', () => {
    expect(verifyProviderObservation(expected, successful)).toEqual({ verified: true, providerReference: 'PROVIDER-TXN-1' });
  });

  it('never treats pending, failed, cancelled, or reversed as success', () => {
    for (const status of ['PENDING', 'FAILED', 'CANCELLED', 'REVERSED'] as const) {
      expect(verifyProviderObservation(expected, { ...successful, status })).toEqual({ verified: false, reason: status });
    }
  });

  it('rejects unauthenticated callbacks and mismatched order, amount, currency, merchant, or missing transaction ID', () => {
    expect(verifyProviderObservation(expected, { ...successful, authenticated: false })).toEqual({ verified: false, reason: 'UNAUTHENTICATED' });
    expect(verifyProviderObservation(expected, { ...successful, merchantReference: 'OTHER' })).toEqual({ verified: false, reason: 'ORDER_MISMATCH' });
    expect(verifyProviderObservation(expected, { ...successful, amountPaise: 9999n })).toEqual({ verified: false, reason: 'AMOUNT_MISMATCH' });
    expect(verifyProviderObservation(expected, { ...successful, currency: 'USD' })).toEqual({ verified: false, reason: 'CURRENCY_MISMATCH' });
    expect(verifyProviderObservation(expected, { ...successful, merchantId: 'OTHER-MERCHANT' })).toEqual({ verified: false, reason: 'MERCHANT_MISMATCH' });
    expect(verifyProviderObservation(expected, { ...successful, providerReference: null })).toEqual({ verified: false, reason: 'MISSING_PROVIDER_REFERENCE' });
  });
});
