import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { grantVerifiedDepositReward } from '../modules/payments/depositReward.js';

const rewardFundId = '00000000-0000-4000-8000-000000000103';
const userId = '00000000-0000-4000-8000-000000000201';
const actorId = '00000000-0000-4000-8000-000000000202';
const oldEnv = {
  financialOperationsEnabled: env.financialOperationsEnabled,
  manualUpiOperationsEnabled: env.manualUpiOperationsEnabled,
  p2pOrderRewardEnabled: env.p2pOrderRewardEnabled,
  p2pOrderRewardFundAccountId: env.p2pOrderRewardFundAccountId,
  p2pOrderRewardFundingSource: env.p2pOrderRewardFundingSource,
};

afterEach(() => {
  Object.assign(env, oldEnv);
});

function rewardTx(balancePaise: bigint, options: { fundExists?: boolean; availableExists?: boolean } = {}) {
  const ledgerCreate = vi.fn(async () => ({ id: 'reward-ledger-id' }));
  const auditCreate = vi.fn(async () => ({ id: 'audit-id' }));
  let balanceQuerySeen = false;
  const tx = {
    ledgerTransaction: { findUnique: vi.fn(async () => null), create: ledgerCreate },
    ledgerAccount: { findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return options.fundExists === false ? null : { id: rewardFundId, type: 'REWARD_FUND', currency: 'INR' };
      return options.availableExists === false ? null : { id: 'available-account-id' };
    }) },
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
      if (parts.join('').includes('SELECT COALESCE(SUM(credit_paise - debit_paise)')) {
        balanceQuerySeen = true;
        return [{ balance: balancePaise }];
      }
      return [];
    }),
    auditLog: { create: auditCreate },
  } as unknown as Prisma.TransactionClient;
  return { tx, ledgerCreate, auditCreate, get balanceQuerySeen() { return balanceQuerySeen; } };
}

describe('verified deposit reward', () => {
  it('calculates 6.2% in paise and posts one balanced reward after reserve lock', async () => {
    Object.assign(env, { financialOperationsEnabled: false, manualUpiOperationsEnabled: true, p2pOrderRewardEnabled: true, p2pOrderRewardFundAccountId: rewardFundId, p2pOrderRewardFundingSource: 'DEDICATED_REWARD_FUND' });
    const fixture = rewardTx(10_000n);
    const rewardPaise = await grantVerifiedDepositReward(fixture.tx, { source: 'UPI_DEPOSIT', referenceId: 'deposit-1', userId, actorUserId: actorId, amountPaise: 10_000n });

    expect(rewardPaise).toBe(620n);
    expect(fixture.balanceQuerySeen).toBe(true);
    expect(fixture.ledgerCreate).toHaveBeenCalledOnce();
    const journal = fixture.ledgerCreate.mock.calls[0][0] as any;
    expect(journal.data).toMatchObject({ eventType: 'UPI_DEPOSIT_REWARD', idempotencyKey: 'UPI_DEPOSIT_REWARD:deposit-1' });
    expect(journal.data.entries.create).toEqual([
      { accountId: rewardFundId, debitPaise: 620n },
      { accountId: 'available-account-id', creditPaise: 620n },
    ]);
    expect(fixture.auditCreate).toHaveBeenCalledOnce();
  });

  it('does not spend a disabled reserve and refuses approval when an enabled reserve is insufficient', async () => {
    Object.assign(env, { financialOperationsEnabled: false, manualUpiOperationsEnabled: true, p2pOrderRewardEnabled: false, p2pOrderRewardFundAccountId: rewardFundId, p2pOrderRewardFundingSource: 'DEDICATED_REWARD_FUND' });
    const disabled = rewardTx(10_000n);
    await expect(grantVerifiedDepositReward(disabled.tx, { source: 'UPI_DEPOSIT', referenceId: 'deposit-disabled', userId, actorUserId: actorId, amountPaise: 10_000n })).resolves.toBe(0n);
    expect(disabled.ledgerCreate).not.toHaveBeenCalled();

    env.p2pOrderRewardEnabled = true;
    const insufficient = rewardTx(619n);
    await expect(grantVerifiedDepositReward(insufficient.tx, { source: 'UPI_DEPOSIT', referenceId: 'deposit-insufficient', userId, actorUserId: actorId, amountPaise: 10_000n }))
      .rejects.toMatchObject({ statusCode: 409, code: 'REWARD_FUND_INSUFFICIENT' });
    expect(insufficient.ledgerCreate).not.toHaveBeenCalled();
  });

  it('refuses approval if the reserve account or destination wallet is missing', async () => {
    Object.assign(env, { financialOperationsEnabled: false, manualUpiOperationsEnabled: true, p2pOrderRewardEnabled: true, p2pOrderRewardFundAccountId: rewardFundId, p2pOrderRewardFundingSource: 'DEDICATED_REWARD_FUND' });
    const missingFund = rewardTx(10_000n, { fundExists: false });
    const missingWallet = rewardTx(10_000n, { availableExists: false });
    const input = { source: 'P2P_ORDER' as const, referenceId: 'order-1', userId, actorUserId: actorId, amountPaise: 10_000n };
    await expect(grantVerifiedDepositReward(missingFund.tx, input)).rejects.toMatchObject({ statusCode: 503, code: 'REWARD_FUND_NOT_READY' });
    await expect(grantVerifiedDepositReward(missingWallet.tx, input)).rejects.toMatchObject({ statusCode: 500, code: 'USER_WALLET_NOT_READY' });
    expect(missingFund.ledgerCreate).not.toHaveBeenCalled();
    expect(missingWallet.ledgerCreate).not.toHaveBeenCalled();
  });
});
