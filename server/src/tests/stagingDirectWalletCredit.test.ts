import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID, MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE } from '../modules/admin/walletAdjustment.js';
import { createStagingDirectCredit } from '../modules/admin/stagingDirectWalletCredit.js';

const actorId = '00000000-0000-4000-8000-000000000111';
const targetId = '00000000-0000-4000-8000-000000000222';
const availableId = '00000000-0000-4000-8000-000000000333';
const requestId = '00000000-0000-4000-8000-000000000444';
const ledgerId = '00000000-0000-4000-8000-000000000555';
const now = new Date('2026-11-08T00:00:00.000Z');

const directInput = {
  actorUserId: actorId,
  idempotencyKey: '00000000-0000-4000-8000-000000000666',
  targetUserId: targetId,
  verifiedPublicId: 'STAGE123',
  verifiedPhoneMasked: '+********3210',
  verifiedWalletBalancePaise: 25_000,
  amountPaise: MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE,
  reason: 'Authorized isolated staging adjustment',
};

function fixture(options: { balance?: bigint; fundBalance?: bigint; existingRequest?: any; existingLedger?: any; target?: any; actor?: any } = {}) {
  const transactionCreate = vi.fn(async () => ({ id: ledgerId, createdAt: now }));
  const creditRequestCreate = vi.fn(async ({ data }: any) => ({ id: requestId, checkerUserId: null, ledgerTransactionId: null, ...data }));
  const creditRequestUpdate = vi.fn(async ({ data }: any) => ({ id: requestId, targetUserId: targetId, amountPaise: 10_000n, reason: directInput.reason, status: 'APPROVED', checkerUserId: null, ...data }));
  const auditCreate = vi.fn(async () => ({ id: 'audit-id' }));
  const queryRaw = vi.fn(async (parts: TemplateStringsArray) => {
    const sql = parts.join('');
    if (sql.includes('LEFT JOIN ledger_entries')) return [{ balance: options.balance ?? 25_000n }];
    if (sql.includes('WHERE account_id IN')) return [
      { accountId: ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID, balance: options.fundBalance ?? 100_000n },
      { accountId: availableId, balance: options.balance ?? 25_000n },
    ];
    if (sql.includes('WHERE account_id =')) return [{ balance: (options.balance ?? 25_000n) + 10_000n }];
    return [];
  });
  const target = options.target ?? { id: targetId, publicId: 'STAGE123', phoneE164: '+919876543210', status: 'ACTIVE', adminRole: null };
  const actor = options.actor ?? { id: actorId, status: 'ACTIVE', adminRole: { role: 'SUPER_ADMIN' } };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: queryRaw as unknown,
    user: { findUnique: vi.fn(async ({ where }: any) => where.id === actorId ? actor : target) },
    adminWalletCreditRequest: {
      findUnique: vi.fn(async () => options.existingRequest ?? null),
      create: creditRequestCreate,
      update: creditRequestUpdate,
    },
    ledgerTransaction: { findUnique: vi.fn(async () => options.existingLedger ?? null), create: transactionCreate },
    ledgerAccount: {
      upsert: vi.fn(async () => ({ id: availableId })),
      findUnique: vi.fn(async ({ where }: any) => where.id === ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID
        ? { id: ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID, type: 'ADMIN_ADJUSTMENT_FUND' }
        : { id: availableId }),
    },
    auditLog: { create: auditCreate },
  } as unknown as Prisma.TransactionClient;
  return { tx, queryRaw, transactionCreate, creditRequestCreate, creditRequestUpdate, auditCreate };
}

describe('staging-only direct wallet credit ledger workflow', () => {
  it('posts an atomic funded ledger credit, completed credit record, and direct-action audit', async () => {
    const mock = fixture();
    const result = await createStagingDirectCredit(mock.tx, directInput);

    expect(result).toMatchObject({
      request: { id: requestId, status: 'APPROVED', checkerUserId: null, ledgerTransactionId: ledgerId },
      credit: { id: ledgerId, direction: 'CREDIT', amountPaise: MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE, balancePaise: 35_000 },
      replayed: false,
    });
    const ledgerInput = mock.transactionCreate.mock.calls[0][0] as any;
    expect(ledgerInput.data.entries.create).toEqual([
      { accountId: ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID, debitPaise: 10_000n },
      { accountId: availableId, creditPaise: 10_000n },
    ]);
    expect(mock.auditCreate).toHaveBeenCalledTimes(2);
    expect(mock.auditCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'ADMIN_STAGING_DIRECT_WALLET_CREDIT',
        metadata: expect.objectContaining({ stagingOnly: true, makerCheckerBypassed: true, ledgerTransactionId: ledgerId }),
      }),
    }));
  });

  it('fails closed when the verified user identity or current balance changed', async () => {
    const mock = fixture({ balance: 25_001n });
    await expect(createStagingDirectCredit(mock.tx, directInput)).rejects.toMatchObject({ code: 'WALLET_CREDIT_TARGET_CHANGED' });
    expect(mock.creditRequestCreate).not.toHaveBeenCalled();
    expect(mock.transactionCreate).not.toHaveBeenCalled();
  });

  it('rejects an admin target and any non-SUPER_ADMIN actor before ledger writes', async () => {
    const adminTarget = fixture({ target: { id: targetId, publicId: 'STAGE123', phoneE164: '+919876543210', status: 'ACTIVE', adminRole: { id: 'admin-row' } } });
    await expect(createStagingDirectCredit(adminTarget.tx, directInput)).rejects.toMatchObject({ code: 'WALLET_CREDIT_TARGET_UNAVAILABLE' });
    expect(adminTarget.transactionCreate).not.toHaveBeenCalled();

    const invalidActor = fixture({ actor: { id: actorId, status: 'ACTIVE', adminRole: { role: 'ADMIN' } } });
    await expect(createStagingDirectCredit(invalidActor.tx, directInput)).rejects.toMatchObject({ code: 'SUPER_ADMIN_REQUIRED' });
    expect(invalidActor.transactionCreate).not.toHaveBeenCalled();
  });

  it('replays the identical direct idempotency key without creating a second ledger or audit entry', async () => {
    const existingRequest = {
      id: requestId, targetUserId: targetId, amountPaise: 10_000n,
      reason: directInput.reason, status: 'APPROVED', ledgerTransactionId: ledgerId,
    };
    const existingLedger = {
      id: ledgerId, referenceId: 'credit-ref', createdAt: now,
      metadata: {
        adminUserId: actorId, targetUserId: targetId, targetPublicId: 'STAGE123', direction: 'CREDIT',
        amountPaise: '10000', reason: directInput.reason, idempotencyScope: 'SUPER_ADMIN_WALLET_CREDIT',
        eventType: 'ADMIN_ADJUSTMENT', referenceType: 'ADMIN_ADJUSTMENT',
      },
    };
    const mock = fixture({ existingRequest, existingLedger });
    const result = await createStagingDirectCredit(mock.tx, directInput);
    expect(result).toMatchObject({ replayed: true, credit: { id: ledgerId } });
    expect(mock.creditRequestCreate).not.toHaveBeenCalled();
    expect(mock.creditRequestUpdate).not.toHaveBeenCalled();
    expect(mock.transactionCreate).not.toHaveBeenCalled();
    expect(mock.auditCreate).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused with different amount or target', async () => {
    const mock = fixture({ existingRequest: {
      id: requestId, targetUserId: targetId, amountPaise: 50_000n,
      reason: 'Different original reason', status: 'APPROVED', ledgerTransactionId: ledgerId,
    } });
    await expect(createStagingDirectCredit(mock.tx, directInput)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(mock.transactionCreate).not.toHaveBeenCalled();
  });

  it('enforces the ₹100–₹10,000 direct-credit range before database work', async () => {
    const belowMinimum = fixture();
    await expect(createStagingDirectCredit(belowMinimum.tx, { ...directInput, amountPaise: 9_999 })).rejects.toMatchObject({ code: 'WALLET_CREDIT_AMOUNT_INVALID' });
    await expect(createStagingDirectCredit(belowMinimum.tx, { ...directInput, amountPaise: 10_050 })).rejects.toMatchObject({ code: 'WALLET_CREDIT_AMOUNT_INVALID' });
    const aboveMaximum = fixture();
    await expect(createStagingDirectCredit(aboveMaximum.tx, { ...directInput, amountPaise: 1_000_001 })).rejects.toMatchObject({ code: 'WALLET_CREDIT_AMOUNT_INVALID' });
    expect(belowMinimum.queryRaw).not.toHaveBeenCalled();
    expect(aboveMaximum.queryRaw).not.toHaveBeenCalled();
  });

  it('does not write a credit when the verified adjustment fund cannot cover the amount', async () => {
    const mock = fixture({ fundBalance: 9_999n });
    await expect(createStagingDirectCredit(mock.tx, directInput)).rejects.toMatchObject({ code: 'WALLET_ADJUSTMENT_FUND_INSUFFICIENT' });
    expect(mock.transactionCreate).not.toHaveBeenCalled();
  });
});
