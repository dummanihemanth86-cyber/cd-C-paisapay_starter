import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { grantReward, queuePendingReward, releasePendingReward } from '../modules/payments/rewardWallet.js';

const previous = { rewardFundFundingEnabled: env.rewardFundFundingEnabled, p2pOrderRewardEnabled: env.p2pOrderRewardEnabled, p2pOrderRewardFundAccountId: env.p2pOrderRewardFundAccountId, p2pOrderRewardFundingSource: env.p2pOrderRewardFundingSource };
afterEach(() => Object.assign(env, previous));

function rewardWalletTx() {
  const calls = { walletUpsert: vi.fn(async () => ({ id: 'wallet', userId: 'buyer', availablePaise: 0n, pendingPaise: 500n, reservedPaise: 0n, totalEarnedPaise: 0n })), walletUpdate: vi.fn(), rewardCreate: vi.fn() };
  const tx = {
    rewardWallet: { upsert: calls.walletUpsert, findUniqueOrThrow: async () => ({ id: 'wallet', userId: 'buyer', availablePaise: 0n, pendingPaise: 620n, reservedPaise: 0n, totalEarnedPaise: 0n }), update: calls.walletUpdate },
    rewardLedgerEntry: { findUnique: async ({ where }: any) => where.idempotencyKey === 'P2P_ORDER_REWARD_PENDING:order'
      ? { id: 'pending', eventType: 'P2P_ORDER_REWARD_PENDING', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: 'order', amountPaise: 620n, metadata: { qualifyingAmountPaise: '10000', percentageBps: 620, amountPaise: '620', fundingSource: 'DEDICATED_REWARD_FUND', cashEquivalent: false, status: 'PENDING_FUNDING' } }
      : null, create: calls.rewardCreate },
    $queryRaw: vi.fn(async () => [{ valid: false }]),
  } as unknown as Prisma.TransactionClient;
  return { tx, calls };
}

describe('P2P Reward Wallet direct-write safeguards', () => {
  it('uses the global reward-funding kill switch for non-P2P direct reward grants', async () => {
    env.rewardFundFundingEnabled = false;
    env.p2pOrderRewardEnabled = true;
    const fixture = rewardWalletTx();
    await expect(grantReward(fixture.tx, { userId: 'buyer', eventType: 'WELCOME_BONUS', amountPaise: 500n, referenceType: 'USER', referenceId: 'signup', idempotencyKey: 'welcome:signup', metadata: {} })).rejects.toMatchObject({ code: 'REWARD_FUNDING_DISABLED' });
    expect(fixture.calls.walletUpsert).not.toHaveBeenCalled();
    expect(fixture.calls.walletUpdate).not.toHaveBeenCalled();
  });

  it('blocks creation of non-P2P pending rewards when the global kill switch is off', async () => {
    env.rewardFundFundingEnabled = false;
    env.p2pOrderRewardEnabled = true;
    const fixture = rewardWalletTx();
    await expect(queuePendingReward(fixture.tx, { userId: 'buyer', eventType: 'WELCOME_BONUS_PENDING', amountPaise: 500n, referenceType: 'USER', referenceId: 'signup', idempotencyKey: 'welcome:pending', metadata: {} })).rejects.toMatchObject({ code: 'REWARD_FUNDING_DISABLED' });
    expect(fixture.calls.walletUpsert).not.toHaveBeenCalled();
    expect(fixture.calls.walletUpdate).not.toHaveBeenCalled();
  });

  it('does not allow the generic direct grant helper to create spendable P2P rewards', async () => {
    env.rewardFundFundingEnabled = true;
    env.p2pOrderRewardEnabled = true;
    const fixture = rewardWalletTx();
    await expect(grantReward(fixture.tx, { userId: 'buyer', eventType: 'P2P_ORDER_REWARD', amountPaise: 500n, referenceType: 'P2P_DEPOSIT_ORDER', referenceId: 'order', idempotencyKey: 'direct', metadata: {} })).rejects.toMatchObject({ code: 'P2P_REWARD_SERVICE_REQUIRED' });
    expect(fixture.calls.walletUpdate).not.toHaveBeenCalled();
  });

  it('blocks P2P reward release when the global reward-funding kill switch is off', async () => {
    env.rewardFundFundingEnabled = false;
    env.p2pOrderRewardEnabled = true;
    const fixture = rewardWalletTx();
    await expect(releasePendingReward(fixture.tx, { userId: 'buyer', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: 'order', pendingIdempotencyKey: 'P2P_ORDER_REWARD_PENDING:order', idempotencyKey: 'P2P_ORDER_REWARD:order', eventType: 'P2P_ORDER_REWARD', metadata: {}, reserveJournalTransactionId: '00000000-0000-4000-8000-000000000501' })).rejects.toMatchObject({ code: 'REWARD_FUNDING_DISABLED' });
    expect(fixture.calls.walletUpsert).not.toHaveBeenCalled();
    expect(fixture.calls.walletUpdate).not.toHaveBeenCalled();
  });

  it('blocks a non-P2P pending reward release when the global kill switch is off', async () => {
    env.rewardFundFundingEnabled = false;
    env.p2pOrderRewardEnabled = true;
    const fixture = rewardWalletTx();
    await expect(releasePendingReward(fixture.tx, { userId: 'buyer', referenceType: 'USER', referenceId: 'signup', pendingIdempotencyKey: 'welcome:pending', idempotencyKey: 'welcome:released', eventType: 'WELCOME_BONUS', metadata: {} })).rejects.toMatchObject({ code: 'REWARD_FUNDING_DISABLED' });
    expect(fixture.calls.walletUpsert).not.toHaveBeenCalled();
    expect(fixture.calls.walletUpdate).not.toHaveBeenCalled();
  });

  it('requires a matching reserve debit and liability journal before pending release', async () => {
    env.rewardFundFundingEnabled = true;
    env.p2pOrderRewardEnabled = true;
    env.p2pOrderRewardFundAccountId = '00000000-0000-4000-8000-000000000103';
    env.p2pOrderRewardFundingSource = 'DEDICATED_REWARD_FUND';
    const fixture = rewardWalletTx();
    await expect(releasePendingReward(fixture.tx, { userId: 'buyer', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: 'order', pendingIdempotencyKey: 'P2P_ORDER_REWARD_PENDING:order', idempotencyKey: 'P2P_ORDER_REWARD:order', eventType: 'P2P_ORDER_REWARD', metadata: {}, reserveJournalTransactionId: '00000000-0000-4000-8000-000000000501' })).rejects.toMatchObject({ code: 'P2P_REWARD_RESERVE_JOURNAL_REQUIRED' });
    expect(fixture.calls.walletUpdate).not.toHaveBeenCalled();
    expect(fixture.calls.rewardCreate).not.toHaveBeenCalled();
  });

  it('does not let callers disguise a P2P pending reward as an unrelated reward release', async () => {
    env.rewardFundFundingEnabled = true;
    env.p2pOrderRewardEnabled = true;
    const fixture = rewardWalletTx();
    await expect(releasePendingReward(fixture.tx, {
      userId: 'buyer', referenceType: 'USER', referenceId: 'signup',
      pendingIdempotencyKey: 'P2P_ORDER_REWARD_PENDING:order', idempotencyKey: 'welcome:released',
      eventType: 'WELCOME_BONUS', metadata: {},
    })).rejects.toMatchObject({ code: 'P2P_REWARD_RESERVE_JOURNAL_REQUIRED' });
    expect(fixture.calls.walletUpsert).not.toHaveBeenCalled();
    expect(fixture.calls.walletUpdate).not.toHaveBeenCalled();
  });

  it('releases pending P2P rewards only after a matching funded reserve journal', async () => {
    env.rewardFundFundingEnabled = true;
    env.p2pOrderRewardEnabled = true;
    env.p2pOrderRewardFundAccountId = '00000000-0000-4000-8000-000000000103';
    env.p2pOrderRewardFundingSource = 'DEDICATED_REWARD_FUND';
    const fixture = rewardWalletTx();
    (fixture.tx.$queryRaw as any).mockResolvedValue([{ valid: true }]);
    const amount = await releasePendingReward(fixture.tx, {
      userId: 'buyer', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: 'order',
      pendingIdempotencyKey: 'P2P_ORDER_REWARD_PENDING:order', idempotencyKey: 'P2P_ORDER_REWARD:order',
      eventType: 'P2P_ORDER_REWARD', metadata: { fundingSource: 'DEDICATED_REWARD_FUND' },
      reserveJournalTransactionId: '00000000-0000-4000-8000-000000000501',
    });
    expect(amount).toBe(620n);
    expect(fixture.calls.walletUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ availablePaise: { increment: 620n }, pendingPaise: { decrement: 620n }, totalEarnedPaise: { increment: 620n } }) }));
    expect(fixture.calls.rewardCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amountPaise: 620n, availableDeltaPaise: 620n, pendingDeltaPaise: -620n }) }));
  });
});
