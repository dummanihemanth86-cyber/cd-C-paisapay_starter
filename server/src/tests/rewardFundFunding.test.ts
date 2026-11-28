import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { ADMIN_SETTLEMENT_CASH_ID } from '../modules/admin/walletCreditWorkflow.js';
import { REWARD_FUND_ACCOUNT_ID, readRewardFundDashboard, recordRewardFundFunding, type RecordRewardFundFundingInput } from '../modules/admin/rewardFundFunding.js';

const adminId = '00000000-0000-4000-8000-000000000001';
const makerId = '00000000-0000-4000-8000-000000000002';
const input: RecordRewardFundFundingInput = {
  verifiedByUserId: adminId,
  makerUserId: makerId,
  amountPaise: 500_000,
  sourceAccountLabel: 'PaisaPay operating account ending 1200',
  externalReference: 'BANK-REWARD-20261116-001',
  evidenceReference: 'finance-vault/reward-statement-001',
  evidenceSha256: 'a'.repeat(64),
  statementDate: new Date('2026-11-16T00:00:00.000Z'),
  reason: 'Verified cleared owner funding for reward reserve',
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  fundingRequestId: '11111111-1111-4111-8111-111111111112',
  clearedFundsVerified: true,
};
const previousFundingConfiguration = {
  rewardFundFundingEnabled: env.rewardFundFundingEnabled,
  p2pOrderRewardFundAccountId: env.p2pOrderRewardFundAccountId,
  p2pOrderRewardFundingSource: env.p2pOrderRewardFundingSource,
  p2pOrderRewardEnabled: env.p2pOrderRewardEnabled,
  rewardFundReceiverVpa: env.rewardFundReceiverVpa,
};

beforeEach(() => {
  env.rewardFundFundingEnabled = true;
  env.p2pOrderRewardFundAccountId = REWARD_FUND_ACCOUNT_ID;
  env.p2pOrderRewardFundingSource = 'DEDICATED_REWARD_FUND';
});
afterEach(() => Object.assign(env, previousFundingConfiguration));

function fundingTx(overrides: Record<string, unknown> = {}) {
  const calls = {
    ledgerCreate: vi.fn(async (_args: any) => ({ id: 'ledger-record-id', createdAt: new Date('2026-11-16T01:00:00Z') })),
    fundingCreate: vi.fn(async ({ data }: any) => ({ ...data })),
    auditCreate: vi.fn(async () => ({ id: 'audit-id' })),
  };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join('');
      if (sql.includes('SELECT EXISTS')) return [{ reused: false }];
      if (sql.includes('FROM ledger_accounts a WHERE a.id')) return [{ id: REWARD_FUND_ACCOUNT_ID, type: 'REWARD_FUND', currency: 'INR', balance: 0n, allCredits: 0n, allDebits: 0n, recordedFunding: 0n, fundingCredits: 0n, rewardDebits: 0n, liabilityCredits: 0n, walletAvailable: 0n, ledgerAvailable: 0n, walletPending: 0n, ledgerPending: 0n, walletReserved: 0n, ledgerReserved: 0n, fundingMismatchCount: 0, rewardMismatchCount: 0 }];
      return [];
    }),
    user: { findUnique: vi.fn(async () => ({ id: adminId, status: 'ACTIVE', adminRole: { role: 'SUPER_ADMIN' } })) },
    rewardFundFundingRecord: { findUnique: vi.fn(async () => null), create: calls.fundingCreate, count: vi.fn(async () => 1), aggregate: vi.fn(async () => ({ _sum: { amountPaise: 500_000n } })) },
    adminWalletFundingRequest: { findUnique: vi.fn(async () => null) },
    ledgerAccount: { upsert: vi.fn(async ({ where }: any) => where.id === ADMIN_SETTLEMENT_CASH_ID
      ? { id: ADMIN_SETTLEMENT_CASH_ID, type: 'SETTLEMENT_CASH', currency: 'INR' }
      : { id: REWARD_FUND_ACCOUNT_ID, type: 'REWARD_FUND', currency: 'INR' }) },
    ledgerTransaction: {
      create: calls.ledgerCreate,
      findUnique: vi.fn(async ({ where }: any) => where.id === 'ledger-record-id' ? { id: 'ledger-record-id', createdAt: new Date('2026-11-16T01:00:00Z') } : null),
    },
    auditLog: { create: calls.auditCreate },
    ...overrides,
  } as unknown as Prisma.TransactionClient;
  return { tx, calls };
}

describe('reward reserve manual funding', () => {
  it('keeps funding-intake, reserve-integrity, reward-posting and reserve-ledger statuses distinct', async () => {
    env.rewardFundFundingEnabled = false;
    env.p2pOrderRewardEnabled = false;
    env.rewardFundReceiverVpa = 'reward-test@paisapay.invalid';
    const db = {
      $queryRaw: async () => [{ id: REWARD_FUND_ACCOUNT_ID, type: 'REWARD_FUND', currency: 'INR', balance: 9_380n, allCredits: 10_000n, allDebits: 620n, recordedFunding: 10_000n, fundingCredits: 10_000n, rewardDebits: 620n, liabilityCredits: 620n, walletAvailable: 620n, ledgerAvailable: 620n, walletPending: 0n, ledgerPending: 0n, walletReserved: 0n, ledgerReserved: 0n, fundingMismatchCount: 0, rewardMismatchCount: 0 }],
      rewardFundFundingRecord: { count: async () => 1, aggregate: async () => ({ _sum: { amountPaise: 10_000n } }), findMany: async () => [] },
      rewardFundFundingRequest: { findMany: async () => [] },
      rewardWallet: { aggregate: async () => ({ _sum: { pendingPaise: 0n, totalEarnedPaise: 620n } }) },
      rewardLedgerEntry: { aggregate: async () => ({ _sum: { amountPaise: 620n }, _count: { _all: 1 } }), findMany: async () => [] },
      p2pDepositOrder: { findMany: async () => [] },
      ledgerTransaction: { findMany: async () => [
        { id: 'funding', eventType: 'REWARD_FUNDING', referenceType: 'REWARD_FUND_FUNDING_RECORD', referenceId: 'funding-record', createdAt: new Date(), entries: [{ creditPaise: 10_000n, debitPaise: 0n, account: { type: 'REWARD_FUND', currency: 'INR' } }] },
        { id: 'allocation', eventType: 'P2P_ORDER_REWARD', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: 'order', createdAt: new Date(), entries: [{ creditPaise: 0n, debitPaise: 620n, account: { type: 'REWARD_FUND', currency: 'INR' } }] },
      ] },
    } as unknown as PrismaClient;
    const dashboard = await readRewardFundDashboard(db, adminId);
    expect(dashboard.readiness).toMatchObject({
      fundingIntake: { status: 'BLOCKED', enabled: false },
      reserveIntegrity: { status: 'RECONCILED' },
      rewardPosting: { status: 'BLOCKED', enabled: false },
    });
    expect(dashboard.reserveLedger.map((item) => [item.direction, item.amountPaise])).toEqual([['FUNDING', 10_000], ['REWARD_ALLOCATION', 620]]);
  });

  it('requires the funding gate and explicit cleared-funds attestation before any write', async () => {
    const previous = env.rewardFundFundingEnabled;
    const fixture = fundingTx();
    try {
      env.rewardFundFundingEnabled = false;
      await expect(recordRewardFundFunding(fixture.tx, input)).rejects.toMatchObject({ code: 'REWARD_FUNDING_DISABLED' });
      env.rewardFundFundingEnabled = true;
      await expect(recordRewardFundFunding(fixture.tx, { ...input, clearedFundsVerified: false })).rejects.toMatchObject({ code: 'REWARD_FUND_EVIDENCE_NOT_VERIFIED' });
      expect(fixture.calls.ledgerCreate).not.toHaveBeenCalled();
      expect(fixture.calls.fundingCreate).not.toHaveBeenCalled();
    } finally { env.rewardFundFundingEnabled = previous; }
  });

  it('rejects a funding maker as verifier inside the ledger service', async () => {
    const fixture = fundingTx();
    await expect(recordRewardFundFunding(fixture.tx, { ...input, makerUserId: adminId })).rejects.toMatchObject({ code: 'REWARD_FUNDING_MAKER_CHECKER_REQUIRED' });
    expect(fixture.calls.ledgerCreate).not.toHaveBeenCalled();
    expect(fixture.calls.fundingCreate).not.toHaveBeenCalled();
  });

  it('records a balanced cash-to-reward-fund journal and hash-only evidence atomically', async () => {
    const previous = env.rewardFundFundingEnabled;
    const fixture = fundingTx();
    try {
      env.rewardFundFundingEnabled = true;
      const result = await recordRewardFundFunding(fixture.tx, input);
      expect(result.replayed).toBe(false);
      expect(fixture.calls.ledgerCreate).toHaveBeenCalledOnce();
      const journal = fixture.calls.ledgerCreate.mock.calls[0][0] as any;
      expect(journal.data).toMatchObject({ eventType: 'REWARD_FUNDING', referenceType: 'REWARD_FUND_FUNDING_RECORD', actorUserId: adminId });
      expect(journal.data.entries.create).toEqual([
        { accountId: ADMIN_SETTLEMENT_CASH_ID, debitPaise: 500_000n },
        { accountId: REWARD_FUND_ACCOUNT_ID, creditPaise: 500_000n },
      ]);
      const record = fixture.calls.fundingCreate.mock.calls[0][0] as any;
      expect(record.data.externalReferenceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(record.data, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).not.toContain(input.externalReference);
      expect(record.data).toMatchObject({ amountPaise: 500_000n, ledgerTransactionId: 'ledger-record-id', evidenceSha256: 'a'.repeat(64) });
      expect(fixture.calls.auditCreate).toHaveBeenCalledOnce();
    } finally { env.rewardFundFundingEnabled = previous; }
  });

  it('replays an identical idempotency key without a second ledger journal', async () => {
    const previous = env.rewardFundFundingEnabled;
    const existing = { id: 'record-id', verifiedByUserId: adminId, amountPaise: 500_000n, sourceAccountLabel: input.sourceAccountLabel, externalReferenceHash: 'unused', evidenceReference: input.evidenceReference, evidenceSha256: input.evidenceSha256, statementDate: input.statementDate, reason: input.reason, idempotencyKey: `REWARD_FUND_FUNDING:${adminId}:${input.idempotencyKey}`, ledgerTransactionId: 'ledger-record-id', fundingRequestId: input.fundingRequestId };
    const fixture = fundingTx({ rewardFundFundingRecord: { findUnique: vi.fn(async () => existing), create: vi.fn(), count: vi.fn(), aggregate: vi.fn() } });
    try {
      env.rewardFundFundingEnabled = true;
      const { hashExternalReference } = await import('../modules/admin/walletCreditWorkflow.js');
      existing.externalReferenceHash = hashExternalReference(input.externalReference);
      const result = await recordRewardFundFunding(fixture.tx, input);
      expect(result.replayed).toBe(true);
      expect(fixture.calls.ledgerCreate).not.toHaveBeenCalled();
      expect(fixture.calls.fundingCreate).not.toHaveBeenCalled();
    } finally { env.rewardFundFundingEnabled = previous; }
  });

  it('rejects a reused bank reference or invalid ledger account without posting', async () => {
    const previous = env.rewardFundFundingEnabled;
    const duplicate = fundingTx({ rewardFundFundingRecord: { findUnique: vi.fn(async ({ where }: any) => where.externalReferenceHash ? { id: 'old-record' } : null), create: vi.fn() } });
    const badAccounts = fundingTx({ ledgerAccount: { upsert: vi.fn(async ({ where }: any) => where.id === ADMIN_SETTLEMENT_CASH_ID
      ? { id: ADMIN_SETTLEMENT_CASH_ID, type: 'SETTLEMENT_CASH', currency: 'INR' }
      : { id: REWARD_FUND_ACCOUNT_ID, type: 'AVAILABLE', currency: 'INR' }) } });
    try {
      env.rewardFundFundingEnabled = true;
      await expect(recordRewardFundFunding(duplicate.tx, input)).rejects.toMatchObject({ code: 'REWARD_FUNDING_REFERENCE_ALREADY_USED' });
      await expect(recordRewardFundFunding(badAccounts.tx, input)).rejects.toMatchObject({ code: 'REWARD_FUND_ACCOUNTS_INVALID' });
      expect(duplicate.calls.ledgerCreate).not.toHaveBeenCalled();
      expect(badAccounts.calls.ledgerCreate).not.toHaveBeenCalled();
    } finally { env.rewardFundFundingEnabled = previous; }
  });
});
