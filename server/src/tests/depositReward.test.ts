import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { grantVerifiedDepositReward, grantVerifiedP2pOrderRewardResult } from '../modules/payments/depositReward.js';
import { REWARD_FUND_ACCOUNT_ID, REWARD_LIABILITY_ACCOUNT_ID } from '../modules/payments/rewardWallet.js';

const userId = '00000000-0000-4000-8000-000000000301';
const actorId = '00000000-0000-4000-8000-000000000302';
const sellerId = '00000000-0000-4000-8000-000000000303';

function rewardTx(initialReservePaise: bigint, orderOverrides: Record<string, { status?: string; amountPaise?: bigint }> = {}, reserveDiscrepancy = false) {
  const wallet: Record<string, any> = { id: 'reward-wallet-id', userId, availablePaise: 0n, pendingPaise: 0n, reservedPaise: 0n, totalEarnedPaise: 0n };
  const entries = new Map<string, any>();
  const transactions = new Map<string, any>();
  let reservePaise = initialReservePaise;
  const rewardDebits = () => initialReservePaise - reservePaise;
  const rewardWalletUpdate = vi.fn(async ({ data }: any) => {
    for (const field of ['availablePaise', 'pendingPaise', 'reservedPaise', 'totalEarnedPaise']) {
      if (data[field]?.increment !== undefined) wallet[field] += data[field].increment;
      if (data[field]?.decrement !== undefined) wallet[field] -= data[field].decrement;
    }
    return wallet;
  });
  const rewardEntryCreate = vi.fn(async ({ data }: any) => {
    if (entries.has(data.idempotencyKey)) throw new Error('DUPLICATE_REWARD_IDEMPOTENCY_KEY');
    const entry = { id: `reward-entry-${entries.size + 1}`, ...data };
    entries.set(data.idempotencyKey, entry);
    return entry;
  });
  const ledgerTransactionCreate = vi.fn(async ({ data }: any) => {
    if (transactions.has(data.idempotencyKey)) throw new Error('DUPLICATE_LEDGER_IDEMPOTENCY_KEY');
    const ledger = { id: `ledger-transaction-${transactions.size + 1}`, metadata: data.metadata, eventType: data.eventType, referenceType: data.referenceType, referenceId: data.referenceId, entries: data.entries?.create ?? [], createdAt: new Date() };
    transactions.set(data.idempotencyKey, ledger);
    const reserveDebit = data.entries.create.find((entry: any) => entry.accountId === REWARD_FUND_ACCOUNT_ID)?.debitPaise ?? 0n;
    reservePaise -= reserveDebit;
    return ledger;
  });
  const tx = {
    p2pDepositOrder: {
      findUnique: vi.fn(async ({ where }: any) => ({
        buyerUserId: userId,
        sellerUserId: sellerId,
        currency: 'INR',
        providerReference: `verified-${where.id}`,
        status: orderOverrides[where.id]?.status ?? 'COMPLETED',
        amountPaise: orderOverrides[where.id]?.amountPaise ?? 10_000n,
      })),
    },
    p2pPaymentClaim: { findFirst: vi.fn(async ({ where }: any) => ({ id: 'approved-claim', orderId: where.orderId, userId, transactionReference: `verified-${where.orderId}`, reviewedByUserId: actorId, verifiedAmountPaise: orderOverrides[where.orderId]?.amountPaise ?? 10_000n, verifiedCurrency: 'INR', receiverConfirmed: true })) },
    adminUser: { findUnique: vi.fn(async () => ({ role: 'FINANCE', user: { status: 'ACTIVE' } })) },
    ledgerAccount: {
      findUnique: vi.fn(async ({ where }: any) => ({ id: where.id, type: 'REWARD_FUND', currency: 'INR' })),
      upsert: vi.fn(async ({ where }: any) => ({
        id: where.id,
        type: where.id === REWARD_FUND_ACCOUNT_ID ? 'REWARD_FUND' : 'REWARD_LIABILITY',
        currency: 'INR',
      })),
    },
    ledgerTransaction: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.idempotencyKey?.startsWith('P2P_PAYMENT_VERIFIED:')) {
          const orderId = where.idempotencyKey.slice('P2P_PAYMENT_VERIFIED:'.length);
          const principalPaise = orderOverrides[orderId]?.amountPaise ?? 10_000n;
          return { id: `principal-${orderId}`, eventType: 'P2P_PAYMENT_VERIFIED', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: orderId, entries: [
            { account: { userId: sellerId, type: 'RESERVED', currency: 'INR' }, debitPaise: principalPaise, creditPaise: 0n },
            { account: { userId, type: 'AVAILABLE', currency: 'INR' }, debitPaise: 0n, creditPaise: principalPaise },
          ] };
        }
        return transactions.get(where.idempotencyKey) ?? null;
      }),
      create: ledgerTransactionCreate,
    },
    rewardWallet: {
      upsert: vi.fn(async () => wallet),
      findUniqueOrThrow: vi.fn(async () => wallet),
      update: rewardWalletUpdate,
    },
    rewardLedgerEntry: {
      findUnique: vi.fn(async ({ where }: any) => entries.get(where.idempotencyKey) ?? null),
      create: rewardEntryCreate,
    },
    auditLog: { create: vi.fn(async () => ({ id: 'audit-entry' })) },
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join('');
      if (sql.includes('SELECT EXISTS')) return [{ valid: true }];
      if (sql.includes('FROM ledger_accounts a WHERE a.id')) return [{
        id: REWARD_FUND_ACCOUNT_ID, type: 'REWARD_FUND', currency: 'INR', balance: reservePaise,
        allCredits: initialReservePaise, allDebits: rewardDebits(), recordedFunding: initialReservePaise,
        fundingCredits: initialReservePaise, rewardDebits: rewardDebits(), liabilityCredits: rewardDebits(),
        walletAvailable: wallet.availablePaise,
        ledgerAvailable: [...entries.values()].reduce((sum, entry: any) => sum + (entry.availableDeltaPaise ?? 0n), 0n),
        walletPending: wallet.pendingPaise,
        ledgerPending: [...entries.values()].reduce((sum, entry: any) => sum + (entry.pendingDeltaPaise ?? 0n), 0n),
        walletReserved: wallet.reservedPaise,
        ledgerReserved: [...entries.values()].reduce((sum, entry: any) => sum + (entry.reservedDeltaPaise ?? 0n), 0n),
        fundingMismatchCount: reserveDiscrepancy ? 1 : 0, rewardMismatchCount: 0,
      }];
      if (sql.includes('COALESCE(SUM(credit_paise - debit_paise)')) return [{ balance: reservePaise }];
      return [];
    }),
  } as unknown as Prisma.TransactionClient;
  return { tx, wallet, entries, transactions, rewardEntryCreate, ledgerTransactionCreate, get reservePaise() { return reservePaise; } };
}

async function withRewardConfiguration<T>(work: () => Promise<T>) {
  const previous = {
    manualUpiOperationsEnabled: env.manualUpiOperationsEnabled,
    rewardFundFundingEnabled: env.rewardFundFundingEnabled,
    p2pOrderRewardEnabled: env.p2pOrderRewardEnabled,
    p2pOrderRewardPercentBps: env.p2pOrderRewardPercentBps,
    p2pOrderRewardFundAccountId: env.p2pOrderRewardFundAccountId,
    p2pOrderRewardFundingSource: env.p2pOrderRewardFundingSource,
  };
  try {
    env.manualUpiOperationsEnabled = true;
    env.rewardFundFundingEnabled = true;
    env.p2pOrderRewardEnabled = true;
    env.p2pOrderRewardPercentBps = 620;
    env.p2pOrderRewardFundAccountId = REWARD_FUND_ACCOUNT_ID;
    env.p2pOrderRewardFundingSource = 'DEDICATED_REWARD_FUND';
    return await work();
  } finally {
    Object.assign(env, previous);
  }
}

describe('admin-funded P2P reward calculation and ledger safety', () => {
  it('uses the global reward-funding kill switch to block legacy UPI deposit reward posting', async () => {
    const previous = {
      manualUpiOperationsEnabled: env.manualUpiOperationsEnabled,
      rewardFundFundingEnabled: env.rewardFundFundingEnabled,
      upiDepositRewardEnabled: env.upiDepositRewardEnabled,
    };
    try {
      env.manualUpiOperationsEnabled = true;
      env.rewardFundFundingEnabled = false;
      env.upiDepositRewardEnabled = true;
      const fixture = rewardTx(10_000n);
      const result = await grantVerifiedDepositReward(fixture.tx, { source: 'UPI_DEPOSIT', referenceId: 'legacy-deposit', userId, actorUserId: actorId, amountPaise: 10_000n });
      expect(result).toBe(0n);
      expect(fixture.ledgerTransactionCreate).not.toHaveBeenCalled();
      expect(fixture.tx.ledgerAccount.findUnique).not.toHaveBeenCalled();
    } finally { Object.assign(env, previous); }
  });

  it('credits 6.2% from the verified reserve as a separate reward-wallet liability', async () => withRewardConfiguration(async () => {
    const fixture = rewardTx(100_000n, { 'order-500': { amountPaise: 50_000n } });
    const order100 = await grantVerifiedP2pOrderRewardResult(fixture.tx, { orderId: 'order-100', userId, actorUserId: actorId, amountPaise: 10_000n });
    const order500 = await grantVerifiedP2pOrderRewardResult(fixture.tx, { orderId: 'order-500', userId, actorUserId: actorId, amountPaise: 50_000n });

    expect(order100).toMatchObject({ status: 'CREDITED', rewardPaise: 620n, pendingPaise: 0n, percentageBps: 620 });
    expect(order500).toMatchObject({ status: 'CREDITED', rewardPaise: 3_100n, pendingPaise: 0n, percentageBps: 620 });
    expect(fixture.reservePaise).toBe(96_280n);
    expect(fixture.wallet).toMatchObject({ availablePaise: 3_720n, pendingPaise: 0n, totalEarnedPaise: 3_720n });
    expect(fixture.entries.get('P2P_ORDER_REWARD:order-100')).toMatchObject({ amountPaise: 620n, availableDeltaPaise: 620n });
    const journal = fixture.ledgerTransactionCreate.mock.calls[0][0] as any;
    expect(journal.data.entries.create).toEqual([
      { accountId: REWARD_FUND_ACCOUNT_ID, debitPaise: 620n },
      { accountId: REWARD_LIABILITY_ACCOUNT_ID, creditPaise: 620n },
    ]);
  }));

  it('never awards more than the verified reserve and records shortage as non-spendable pending reward', async () => withRewardConfiguration(async () => {
    const fixture = rewardTx(500n);
    const result = await grantVerifiedP2pOrderRewardResult(fixture.tx, { orderId: 'underfunded-order', userId, actorUserId: actorId, amountPaise: 10_000n });

    expect(result).toMatchObject({ status: 'PENDING_FUNDING', rewardPaise: 0n, pendingPaise: 620n });
    expect(fixture.reservePaise).toBe(500n);
    expect(fixture.wallet).toMatchObject({ availablePaise: 0n, pendingPaise: 620n, totalEarnedPaise: 0n });
    expect(fixture.ledgerTransactionCreate).not.toHaveBeenCalled();
    expect(fixture.entries.get('P2P_ORDER_REWARD_PENDING:underfunded-order')).toMatchObject({ amountPaise: 620n, pendingDeltaPaise: 620n });
  }));

  it('blocks spendable and pending rewards when reserve reconciliation has a discrepancy', async () => withRewardConfiguration(async () => {
    const fixture = rewardTx(10_000n, {}, true);
    const result = await grantVerifiedP2pOrderRewardResult(fixture.tx, { orderId: 'drifted-reserve-order', userId, actorUserId: actorId, amountPaise: 10_000n });
    expect(result).toMatchObject({ status: 'BLOCKED', rewardPaise: 0n, pendingPaise: 0n });
    expect(fixture.wallet).toMatchObject({ availablePaise: 0n, pendingPaise: 0n, totalEarnedPaise: 0n });
    expect(fixture.ledgerTransactionCreate).not.toHaveBeenCalled();
    expect(fixture.rewardEntryCreate).not.toHaveBeenCalled();
  }));

  it('does not double debit the reserve or credit the reward wallet on duplicate settlement', async () => withRewardConfiguration(async () => {
    const fixture = rewardTx(10_000n);
    const input = { orderId: 'duplicate-order', userId, actorUserId: actorId, amountPaise: 10_000n };
    const first = await grantVerifiedP2pOrderRewardResult(fixture.tx, input);
    const replay = await grantVerifiedP2pOrderRewardResult(fixture.tx, input);

    expect(first.status).toBe('CREDITED');
    expect(replay).toMatchObject({ status: 'CREDITED', rewardPaise: 620n });
    expect(fixture.reservePaise).toBe(9_380n);
    expect(fixture.wallet).toMatchObject({ availablePaise: 620n, pendingPaise: 0n, totalEarnedPaise: 620n });
    expect(fixture.ledgerTransactionCreate).toHaveBeenCalledOnce();
    expect(fixture.rewardEntryCreate).toHaveBeenCalledTimes(2);
  }));

  it.each(['CANCELLED', 'REFUNDED', 'PAYMENT_SUBMITTED'])('rejects %s orders before writing any reward', async (status) => withRewardConfiguration(async () => {
    const fixture = rewardTx(10_000n, { [`order-${status}`]: { status } });
    await expect(grantVerifiedP2pOrderRewardResult(fixture.tx, {
      orderId: `order-${status}`, userId, actorUserId: actorId, amountPaise: 10_000n,
    })).rejects.toMatchObject({ code: 'P2P_REWARD_ORDER_NOT_SETTLED' });
    expect(fixture.ledgerTransactionCreate).not.toHaveBeenCalled();
    expect(fixture.rewardEntryCreate).not.toHaveBeenCalled();
  }));

  it('uses the persisted completed order amount and rejects a mismatched caller amount', async () => withRewardConfiguration(async () => {
    const fixture = rewardTx(10_000n);
    await expect(grantVerifiedP2pOrderRewardResult(fixture.tx, {
      orderId: 'order-100', userId, actorUserId: actorId, amountPaise: 20_000n,
    })).rejects.toMatchObject({ code: 'P2P_REWARD_AMOUNT_MISMATCH' });
    expect(fixture.ledgerTransactionCreate).not.toHaveBeenCalled();
    expect(fixture.rewardEntryCreate).not.toHaveBeenCalled();
  }));

  it('requires an approved matching claim and an active authorized reviewer before posting', async () => withRewardConfiguration(async () => {
    const missingClaim = rewardTx(10_000n);
    (missingClaim.tx.p2pPaymentClaim.findFirst as any).mockResolvedValue(null);
    await expect(grantVerifiedP2pOrderRewardResult(missingClaim.tx, { orderId: 'missing-claim-order', userId, actorUserId: actorId, amountPaise: 10_000n })).rejects.toMatchObject({ code: 'P2P_REWARD_APPROVED_CLAIM_REQUIRED' });
    expect(missingClaim.ledgerTransactionCreate).not.toHaveBeenCalled();

    const conflictedReviewer = rewardTx(10_000n);
    (conflictedReviewer.tx.p2pPaymentClaim.findFirst as any).mockImplementation(async ({ where }: any) => ({ id: 'claim', orderId: where.orderId, userId, transactionReference: `verified-${where.orderId}`, reviewedByUserId: userId, verifiedAmountPaise: 10_000n, verifiedCurrency: 'INR', receiverConfirmed: true }));
    await expect(grantVerifiedP2pOrderRewardResult(conflictedReviewer.tx, { orderId: 'conflict-order', userId, actorUserId: actorId, amountPaise: 10_000n })).rejects.toMatchObject({ code: 'P2P_REVIEW_CONFLICT_OF_INTEREST' });
    expect(conflictedReviewer.ledgerTransactionCreate).not.toHaveBeenCalled();

    const inactiveReviewer = rewardTx(10_000n);
    (inactiveReviewer.tx.adminUser.findUnique as any).mockResolvedValue({ role: 'FINANCE', user: { status: 'SUSPENDED' } });
    await expect(grantVerifiedP2pOrderRewardResult(inactiveReviewer.tx, { orderId: 'inactive-reviewer-order', userId, actorUserId: actorId, amountPaise: 10_000n })).rejects.toMatchObject({ code: 'P2P_REWARD_REVIEWER_NOT_AUTHORIZED' });
    expect(inactiveReviewer.ledgerTransactionCreate).not.toHaveBeenCalled();
  }));
});
