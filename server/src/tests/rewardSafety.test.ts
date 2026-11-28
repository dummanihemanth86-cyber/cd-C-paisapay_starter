import { describe, expect, it } from 'vitest';
import { HttpError } from '../lib/http.js';
import { assertIndependentFundingVerifier, assertP2pReviewerIsNotParty, summarizeRewardReserve } from '../modules/payments/rewardSafety.js';

describe('Reward Funding and P2P reviewer safety', () => {
  it('rejects a funding maker attempting to verify or reject their own request', () => {
    let error: unknown;
    try { assertIndependentFundingVerifier('maker', 'maker'); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ code: 'REWARD_FUNDING_MAKER_CHECKER_REQUIRED' });
  });

  it('allows a distinct verifier after service authorization has succeeded', () => {
    expect(() => assertIndependentFundingVerifier('maker', 'different-super-admin')).not.toThrow();
  });

  it.each(['buyer', 'seller'])('rejects the %s from reviewing their P2P order', (party) => {
    let error: unknown;
    try { assertP2pReviewerIsNotParty(party, 'buyer', 'seller'); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'P2P_REVIEW_CONFLICT_OF_INTEREST' });
  });

  it('allows an unrelated reviewer and only reconciles an exactly mapped balanced reserve', () => {
    expect(() => assertP2pReviewerIsNotParty('finance-reviewer', 'buyer', 'seller')).not.toThrow();
    const healthy = summarizeRewardReserve({
      configuredAccountId: 'reserve-id', sourceConfigured: true, accountStatus: 'PROVISIONED',
      balancePaise: 99_380n, allCreditsPaise: 100_000n, allDebitsPaise: 620n,
      recordedFundingPaise: 100_000n, fundingJournalCreditPaise: 100_000n,
      rewardFundDebitPaise: 620n, rewardLiabilityCreditPaise: 620n,
      rewardWalletAvailablePaise: 620n, rewardLedgerAvailablePaise: 620n,
      rewardWalletPendingPaise: 0n, rewardLedgerPendingPaise: 0n,
      rewardWalletReservedPaise: 0n, rewardLedgerReservedPaise: 0n,
      fundingJournalMismatchCount: 0, rewardJournalMismatchCount: 0,
    });
    expect(healthy.reconciled).toBe(true);
    const drifted = summarizeRewardReserve({ ...healthy, balancePaise: 99_381n });
    expect(drifted.reconciled).toBe(false);
    expect(drifted.blockers).toContain('Reward reserve funding and allocation journals do not reconcile.');
    const walletDrifted = summarizeRewardReserve({ ...healthy, rewardWalletPendingPaise: 1n });
    expect(walletDrifted.reconciled).toBe(false);
    expect(walletDrifted.blockers).toContain('Reward Wallet balances do not reconcile to their wallet ledger.');
  });
});
