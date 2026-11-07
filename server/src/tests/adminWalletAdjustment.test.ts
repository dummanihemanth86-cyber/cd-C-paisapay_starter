import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/http.js';
import { ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID, applyAdminWalletAdjustment, applySuperAdminWalletCredit, MAX_ADMIN_ADJUSTMENT_PAISE, MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE, type WalletAdjustmentInput } from '../modules/admin/walletAdjustment.js';

const actorUserId = '00000000-0000-4000-8000-000000000001';
const targetId = '00000000-0000-4000-8000-000000000002';
const availableId = '00000000-0000-4000-8000-000000000003';
const now = new Date('2026-11-04T12:00:00.000Z');

function input(overrides: Partial<WalletAdjustmentInput> = {}): WalletAdjustmentInput {
  return { actorUserId, idempotencyKey: '00000000-0000-4000-8000-000000000004', targetPublicId: 'USER12345', direction: 'CREDIT', amountPaise: 2500, reason: 'Approved wallet correction', ...overrides };
}

function fixture(options: { fundBalance?: bigint; userBalance?: bigint; existing?: unknown } = {}) {
  const transactionCreate = vi.fn(async () => ({ id: 'ledger-tx-id', createdAt: now }));
  const auditCreate = vi.fn(async () => ({ id: 'audit-id' }));
  const queryRaw = vi.fn(async (parts: TemplateStringsArray) => {
    if (parts.join('').includes('WHERE account_id =')) return [{ balance: options.userBalance ?? 10_000n }];
    if (parts.join('').includes('SUM(credit_paise - debit_paise)')) return [
      { accountId: ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID, balance: options.fundBalance ?? 100_000n },
      { accountId: availableId, balance: options.userBalance ?? 10_000n },
    ];
    return [];
  });
  const tx = {
    $queryRaw: queryRaw as unknown,
    ledgerTransaction: {
      findUnique: vi.fn(async () => options.existing ?? null),
      create: transactionCreate,
    },
    user: { findUnique: vi.fn(async () => ({ id: targetId, publicId: 'USER12345', status: 'ACTIVE' })) },
    ledgerAccount: {
      upsert: vi.fn(async () => ({ id: availableId })),
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) => where.id === ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID
        ? ({ id: ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID, type: 'ADMIN_ADJUSTMENT_FUND' })
        : ({ id: availableId })),
    },
    auditLog: { create: auditCreate },
  } as unknown as Prisma.TransactionClient;
  return { tx, transactionCreate, auditCreate, queryRaw };
}

describe('single-admin wallet adjustment ledger service', () => {
  it('records a balanced credit and audit entry using integer paise', async () => {
    const mock = fixture({ fundBalance: 5000n });
    const result = await applyAdminWalletAdjustment(mock.tx, input());
    expect(result).toMatchObject({ id: 'ledger-tx-id', targetUserId: 'USER12345', direction: 'CREDIT', amountPaise: 2500, replayed: false });
    const createArg = mock.transactionCreate.mock.calls[0][0] as { data: { actorUserId: string; entries: { create: Array<{ accountId: string; debitPaise?: bigint; creditPaise?: bigint }> } } };
    expect(createArg.data.actorUserId).toBe(actorUserId);
    expect(createArg.data.entries.create).toEqual([
      { accountId: ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID, debitPaise: 2500n },
      { accountId: availableId, creditPaise: 2500n },
    ]);
    expect(mock.auditCreate).toHaveBeenCalledOnce();
  });

  it('debits only available funds and balances the ledger entries', async () => {
    const mock = fixture({ userBalance: 5000n });
    await applyAdminWalletAdjustment(mock.tx, input({ direction: 'DEBIT', amountPaise: 3000 }));
    const entries = (mock.transactionCreate.mock.calls[0][0] as { data: { entries: { create: Array<Record<string, unknown>> } } }).data.entries.create;
    expect(entries).toEqual([
      { accountId: availableId, debitPaise: 3000n },
      { accountId: ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID, creditPaise: 3000n },
    ]);
  });

  it('fails closed when the credit fund is missing sufficient backing', async () => {
    const mock = fixture({ fundBalance: 100n });
    await expect(applyAdminWalletAdjustment(mock.tx, input())).rejects.toMatchObject({ statusCode: 409, code: 'WALLET_ADJUSTMENT_FUND_INSUFFICIENT' });
    expect(mock.transactionCreate).not.toHaveBeenCalled();
    expect(mock.auditCreate).not.toHaveBeenCalled();
  });

  it('fails closed when a debit exceeds the target available balance', async () => {
    const mock = fixture({ userBalance: 100n });
    await expect(applyAdminWalletAdjustment(mock.tx, input({ direction: 'DEBIT', amountPaise: 200 }))).rejects.toMatchObject({ statusCode: 409, code: 'WALLET_ADJUSTMENT_BALANCE_INSUFFICIENT' });
    expect(mock.transactionCreate).not.toHaveBeenCalled();
  });

  it('replays an identical idempotency key without creating a second ledger or audit entry', async () => {
    const request = input();
    const mock = fixture({ existing: { id: 'prior-tx', metadata: { adminUserId: actorUserId, targetUserId: targetId, direction: 'CREDIT', amountPaise: '2500', reason: request.reason }, createdAt: now } });
    const result = await applyAdminWalletAdjustment(mock.tx, request);
    expect(result).toMatchObject({ id: 'prior-tx', replayed: true });
    expect(mock.transactionCreate).not.toHaveBeenCalled();
    expect(mock.auditCreate).not.toHaveBeenCalled();
  });

  it('rejects a reused idempotency key for a different request and enforces the amount limit', async () => {
    const conflicting = fixture({ existing: { id: 'prior-tx', metadata: {}, createdAt: now } });
    await expect(applyAdminWalletAdjustment(conflicting.tx, input())).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    const tooLarge = fixture();
    await expect(applyAdminWalletAdjustment(tooLarge.tx, input({ amountPaise: MAX_ADMIN_ADJUSTMENT_PAISE + 1 }))).rejects.toBeInstanceOf(HttpError);
    expect(tooLarge.queryRaw).not.toHaveBeenCalled();
  });
});

describe('Super Admin wallet credit service', () => {
  it('credits the selected user from the funded ledger account and returns the ledger-derived balance', async () => {
    const mock = fixture({ fundBalance: 100_000n, userBalance: 22_500n });
    const result = await applySuperAdminWalletCredit(mock.tx, {
      actorUserId, idempotencyKey: '00000000-0000-4000-8000-000000000005', targetUserId: targetId,
      amountPaise: MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE, reason: 'Approved customer adjustment',
    });
    expect(result).toMatchObject({ direction: 'CREDIT', amountPaise: 10_000, balancePaise: 22_500, replayed: false });
    expect(mock.transactionCreate).toHaveBeenCalledOnce();
    expect(mock.auditCreate).toHaveBeenCalledOnce();
  });

  it('replays the same Super Admin credit idempotency key without another ledger or audit entry', async () => {
    const reason = 'Approved customer adjustment';
    const mock = fixture({ userBalance: 22_500n, existing: {
      id: 'prior-credit', referenceId: 'prior-credit-reference', createdAt: now,
      metadata: {
        adminUserId: actorUserId, targetUserId: targetId, targetPublicId: 'USER12345', direction: 'CREDIT',
        amountPaise: String(MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE), reason, idempotencyScope: 'SUPER_ADMIN_WALLET_CREDIT',
        eventType: 'ADMIN_ADJUSTMENT', referenceType: 'ADMIN_ADJUSTMENT',
      },
    } });
    const result = await applySuperAdminWalletCredit(mock.tx, {
      actorUserId, idempotencyKey: '00000000-0000-4000-8000-000000000005', targetUserId: targetId,
      amountPaise: MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE, reason,
    });
    expect(result).toMatchObject({ id: 'prior-credit', replayed: true, balancePaise: 22_500 });
    expect(mock.transactionCreate).not.toHaveBeenCalled();
    expect(mock.auditCreate).not.toHaveBeenCalled();
  });

  it('rejects credits outside ₹100–₹10,000 before writing ledger entries', async () => {
    const mock = fixture();
    await expect(applySuperAdminWalletCredit(mock.tx, {
      actorUserId, idempotencyKey: '00000000-0000-4000-8000-000000000005', targetUserId: targetId,
      amountPaise: MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE - 1, reason: 'Approved customer adjustment',
    })).rejects.toMatchObject({ code: 'WALLET_CREDIT_AMOUNT_INVALID' });
    await expect(applySuperAdminWalletCredit(mock.tx, {
      actorUserId, idempotencyKey: '00000000-0000-4000-8000-000000000006', targetUserId: targetId,
      amountPaise: MAX_ADMIN_ADJUSTMENT_PAISE + 1, reason: 'Approved customer adjustment',
    })).rejects.toMatchObject({ code: 'WALLET_CREDIT_AMOUNT_INVALID' });
    expect(mock.transactionCreate).not.toHaveBeenCalled();
    expect(mock.auditCreate).not.toHaveBeenCalled();
    expect(mock.queryRaw).not.toHaveBeenCalled();
  });
});
