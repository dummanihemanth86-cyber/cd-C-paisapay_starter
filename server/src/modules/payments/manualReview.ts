export type ManualReviewEvidence = {
  claimStatus: string;
  claimedTransactionReference: string | null;
  verifiedTransactionReference: string;
  expectedAmountPaise: bigint;
  verifiedAmountPaise: bigint;
  verifiedCurrency: string;
  receiverConfirmed: boolean;
};

/** Manual approval is valid only after a finance operator has independently
 * matched the merchant's own records to this exact claim and deposit. */
export function validateManualReviewEvidence(evidence: ManualReviewEvidence): string | null {
  if (evidence.claimStatus !== 'PENDING_REVIEW') return 'CLAIM_NOT_PENDING';
  if (evidence.claimedTransactionReference !== null
    && evidence.claimedTransactionReference.trim().toUpperCase() !== evidence.verifiedTransactionReference.trim().toUpperCase()) return 'TRANSACTION_REFERENCE_MISMATCH';
  if (evidence.verifiedAmountPaise !== evidence.expectedAmountPaise) return 'AMOUNT_MISMATCH';
  if (evidence.verifiedCurrency !== 'INR') return 'CURRENCY_MISMATCH';
  if (!evidence.receiverConfirmed) return 'RECEIVER_NOT_CONFIRMED';
  return null;
}
