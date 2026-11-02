/** Provider-neutral contract for evaluating a server-authenticated payment result.
 * This function never performs a network request or updates a balance/ledger.
 */
export type PaymentVerificationContext = {
  merchantReference: string;
  amountPaise: bigint;
  currency: 'INR';
  merchantId: string;
};

export type ProviderPaymentObservation = {
  merchantReference: string;
  providerReference: string | null;
  amountPaise: bigint;
  currency: string;
  merchantId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REVERSED';
  authenticated: boolean;
};

export type PaymentVerificationResult =
  | { verified: true; providerReference: string }
  | { verified: false; reason: 'UNAUTHENTICATED' | 'PENDING' | 'FAILED' | 'CANCELLED' | 'REVERSED' | 'ORDER_MISMATCH' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH' | 'MERCHANT_MISMATCH' | 'MISSING_PROVIDER_REFERENCE' };

export function verifyProviderObservation(
  expected: PaymentVerificationContext,
  observed: ProviderPaymentObservation,
): PaymentVerificationResult {
  if (!observed.authenticated) return { verified: false, reason: 'UNAUTHENTICATED' };
  if (observed.status !== 'SUCCESS') return { verified: false, reason: observed.status };
  if (observed.merchantReference !== expected.merchantReference) return { verified: false, reason: 'ORDER_MISMATCH' };
  if (observed.amountPaise !== expected.amountPaise) return { verified: false, reason: 'AMOUNT_MISMATCH' };
  if (observed.currency !== expected.currency) return { verified: false, reason: 'CURRENCY_MISMATCH' };
  if (observed.merchantId !== expected.merchantId) return { verified: false, reason: 'MERCHANT_MISMATCH' };
  if (!observed.providerReference?.trim()) return { verified: false, reason: 'MISSING_PROVIDER_REFERENCE' };
  return { verified: true, providerReference: observed.providerReference };
}

/** Implemented by a provider adapter only after its live/sandbox contract is approved. */
export interface PaymentProviderAdapter {
  readonly provider: string;
  initiatePayment(input: { merchantReference: string; amountPaise: bigint; currency: 'INR' }): Promise<{ checkoutUrl: string; providerReference: string }>;
  queryPayment(providerReference: string): Promise<ProviderPaymentObservation>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<ProviderPaymentObservation>;
}
