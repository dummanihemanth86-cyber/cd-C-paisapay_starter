import { HttpError } from '../../lib/http.js';

export function assertIndependentFundingVerifier(makerUserId: string, verifierUserId: string) {
  if (makerUserId === verifierUserId) {
    throw new HttpError(403, 'REWARD_FUNDING_MAKER_CHECKER_REQUIRED', 'A different active SUPER_ADMIN must verify or reject this funding request.');
  }
}

export function assertP2pReviewerIsNotParty(reviewerUserId: string, buyerUserId: string, sellerUserId: string) {
  if (reviewerUserId === buyerUserId || reviewerUserId === sellerUserId) {
    throw new HttpError(403, 'P2P_REVIEW_CONFLICT_OF_INTEREST', 'A buyer or seller cannot review their own P2P order.');
  }
}

export type ReserveIntegritySummary = {
  configuredAccountId: string | undefined;
  sourceConfigured: boolean;
  accountStatus: 'UNMAPPED' | 'MISSING' | 'INVALID' | 'PROVISIONED';
  balancePaise: bigint;
  allCreditsPaise: bigint;
  allDebitsPaise: bigint;
  recordedFundingPaise: bigint;
  fundingJournalCreditPaise: bigint;
  rewardFundDebitPaise: bigint;
  rewardLiabilityCreditPaise: bigint;
  rewardWalletAvailablePaise: bigint;
  rewardLedgerAvailablePaise: bigint;
  rewardWalletPendingPaise: bigint;
  rewardLedgerPendingPaise: bigint;
  rewardWalletReservedPaise: bigint;
  rewardLedgerReservedPaise: bigint;
  fundingJournalMismatchCount: number;
  rewardJournalMismatchCount: number;
  reconciled: boolean;
  blockers: string[];
};

export function summarizeRewardReserve(input: Omit<ReserveIntegritySummary, 'reconciled' | 'blockers'>): ReserveIntegritySummary {
  const blockers: string[] = [];
  if (!input.configuredAccountId || !input.sourceConfigured) blockers.push('A dedicated reward reserve account mapping is required.');
  if (input.accountStatus !== 'PROVISIONED') blockers.push(`Reward reserve account is ${input.accountStatus.toLowerCase()}.`);
  const reconciled = input.accountStatus === 'PROVISIONED'
    && Boolean(input.configuredAccountId && input.sourceConfigured)
    && input.balancePaise === input.recordedFundingPaise - input.rewardFundDebitPaise
    && input.fundingJournalCreditPaise === input.recordedFundingPaise
    && input.allCreditsPaise === input.fundingJournalCreditPaise
    && input.allDebitsPaise === input.rewardFundDebitPaise
    && input.rewardLiabilityCreditPaise === input.rewardFundDebitPaise
    && input.rewardWalletAvailablePaise === input.rewardLedgerAvailablePaise
    && input.rewardWalletPendingPaise === input.rewardLedgerPendingPaise
    && input.rewardWalletReservedPaise === input.rewardLedgerReservedPaise
    && input.fundingJournalMismatchCount === 0
    && input.rewardJournalMismatchCount === 0;
  if (!reconciled) blockers.push('Reward reserve funding and allocation journals do not reconcile.');
  if (input.rewardWalletAvailablePaise !== input.rewardLedgerAvailablePaise
    || input.rewardWalletPendingPaise !== input.rewardLedgerPendingPaise
    || input.rewardWalletReservedPaise !== input.rewardLedgerReservedPaise) blockers.push('Reward Wallet balances do not reconcile to their wallet ledger.');
  if (input.balancePaise < 0n) blockers.push('Reward reserve balance is negative.');
  return { ...input, reconciled, blockers };
}
