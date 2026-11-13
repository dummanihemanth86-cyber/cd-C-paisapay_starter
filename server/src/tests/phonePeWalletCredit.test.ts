import { describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { decidePhonePeWalletCredit, createPhonePeWalletCreditRequest } from '../modules/admin/phonePeWalletCredit.js';
import { ADMIN_PHONEPE_FUND_ID as ADMIN_ADJUSTMENT_FUND_ID, ADMIN_PHONEPE_SETTLEMENT_CASH_ID as ADMIN_SETTLEMENT_CASH_ID } from '../modules/admin/phonePeWalletCredit.js';

const makerId = '00000000-0000-4000-8000-000000000201';
const targetId = '00000000-0000-4000-8000-000000000202';
const requestId = '00000000-0000-4000-8000-000000000203';
const availableId = '00000000-0000-4000-8000-000000000204';
const amountPaise = 10_000;
const reason = 'Verified receiver-side payment';
const reference = 'UPI202611131234';
const activeAdmin = { id: makerId, status: 'ACTIVE', adminRole: { role: 'SUPER_ADMIN' } };
const targetUser = { id: targetId, publicId: 'USER12345', phoneE164: '1234567890', displayName: 'Test User', status: 'ACTIVE', adminRole: null };
const pendingRequest = {
  id: requestId, targetUserId: targetId, makerUserId: makerId, amountPaise: BigInt(amountPaise), payeeVpa: 'zitch@ptyes',
  reason, status: 'PENDING_PAYMENT', idempotencyKey: `ADMIN_PHONEPE_CREDIT:${makerId}:11111111-1111-4111-8111-111111111111`,
  paymentReferenceHash: null, paymentReferenceMasked: null, fundingLedgerTransactionId: null, ledgerTransactionId: null,
  expiresAt: new Date(Date.now() + 60_000),
};

function makeTx(overrides: Record<string, any> = {}) {
  const calls = {
    requestCreate: vi.fn(async ({ data }: any) => ({ ...pendingRequest, ...data })),
    requestUpdate: vi.fn(async ({ data }: any) => ({ ...pendingRequest, ...data })),
    ledgerCreate: vi.fn(async ({ data }: any) => ({ id: data.eventType === 'ADMIN_PHONEPE_RECEIPT' ? 'funding-ledger-id' : 'credit-ledger-id', createdAt: new Date('2026-11-13T00:00:00Z') })),
    auditCreate: vi.fn(async () => ({ id: 'audit-id' })),
  };
  const defaults = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join('');
      if (sql.includes('WHERE a.user_id')) return [{ balance: 0n }];
      if (sql.includes('SELECT (')) return [{ used: false }];
      if (sql.includes('WITH per_transaction')) return [{ debits: '10000', credits: '10000', unbalanced: 0n }];
      if (sql.includes('FROM ledger_entries WHERE account_id IN')) return [
        { accountId: ADMIN_ADJUSTMENT_FUND_ID, balance: 10_000n },
        { accountId: availableId, balance: 0n },
      ];
      if (sql.includes('FROM ledger_entries WHERE account_id =')) return [{ balance: BigInt(amountPaise) }];
      return [];
    }),
    user: { findUnique: vi.fn(async ({ where }: any) => {
      if (where.id === makerId) return activeAdmin;
      if (where.id === targetId || where.publicId === targetUser.publicId) return targetUser;
      return null;
    }) },
    adminPhonePeCreditRequest: {
      findUnique: vi.fn(async () => null), create: calls.requestCreate, update: calls.requestUpdate,
    },
    ledgerAccount: {
      findMany: vi.fn(async () => [
        { id: ADMIN_ADJUSTMENT_FUND_ID, type: 'ADMIN_ADJUSTMENT_FUND' },
        { id: ADMIN_SETTLEMENT_CASH_ID, type: 'SETTLEMENT_CASH' },
      ]),
      upsert: vi.fn(async () => ({ id: availableId })),
      findUnique: vi.fn(async ({ where }: any) => where.id === ADMIN_ADJUSTMENT_FUND_ID
        ? { id: ADMIN_ADJUSTMENT_FUND_ID, type: 'ADMIN_ADJUSTMENT_FUND' }
        : { id: availableId }),
    },
    ledgerTransaction: { findUnique: vi.fn(async () => null), create: calls.ledgerCreate },
    auditLog: { create: calls.auditCreate },
  };
  return { tx: {
    ...defaults,
    ...overrides,
    adminPhonePeCreditRequest: { ...defaults.adminPhonePeCreditRequest, ...overrides.adminPhonePeCreditRequest },
  } as any, calls };
}

const createInput = {
  makerUserId: makerId, idempotencyKey: '11111111-1111-4111-8111-111111111111', targetUserId: targetId,
  verifiedPublicId: targetUser.publicId, verifiedPhoneMasked: '******7890', verifiedWalletBalancePaise: 0,
  amountPaise, reason, payeeVpa: 'zitch@ptyes',
};

describe('Admin PhonePe wallet credit workflow', () => {
  it('rejects fractional-rupee amounts before creating a request', async () => {
    const { tx, calls } = makeTx();
    await expect(createPhonePeWalletCreditRequest(tx, { ...createInput, amountPaise: 10_050 }))
      .rejects.toMatchObject({ code: 'PHONEPE_CREDIT_AMOUNT_INVALID' });
    expect(calls.requestCreate).not.toHaveBeenCalled();
    expect(calls.ledgerCreate).not.toHaveBeenCalled();
  });

  it('creates a pending request with idempotency and audit, without posting a wallet ledger entry', async () => {
    const { tx, calls } = makeTx();
    const result = await createPhonePeWalletCreditRequest(tx, createInput);
    expect(result.request.status).toBe('PENDING_PAYMENT');
    expect(result.replayed).toBe(false);
    expect(calls.requestCreate).toHaveBeenCalledOnce();
    expect(calls.auditCreate).toHaveBeenCalledOnce();
    expect(calls.ledgerCreate).not.toHaveBeenCalled();
  });

  it('restricts credit operations to the configured authorized Super Admin number', async () => {
    const previous = env.adminPhonePeCreditsAdminPhoneE164;
    env.adminPhonePeCreditsAdminPhoneE164 = '+919999999999';
    try {
      const { tx, calls } = makeTx({ user: { findUnique: vi.fn(async ({ where }: any) => where.id === makerId
        ? { ...activeAdmin, phoneE164: '+918888888888' }
        : targetUser) } });
      await expect(createPhonePeWalletCreditRequest(tx, createInput))
        .rejects.toMatchObject({ code: 'PHONEPE_CREDITS_ADMIN_NOT_ALLOWED', statusCode: 403 });
      expect(calls.requestCreate).not.toHaveBeenCalled();
    } finally {
      env.adminPhonePeCreditsAdminPhoneE164 = previous;
    }
  });

  it('requires exact receipt confirmation before approval and leaves the ledger untouched on mismatch', async () => {
    const { tx, calls } = makeTx({ adminPhonePeCreditRequest: { findUnique: vi.fn(async () => ({ ...pendingRequest, targetUser })) } });
    await expect(decidePhonePeWalletCredit(tx, {
      requestId, checkerUserId: makerId, decision: 'APPROVE', reason,
      paymentReference: reference, verifiedAmountPaise: amountPaise - 100,
      verifiedPayeeVpa: 'zitch@ptyes', receiverConfirmed: true,
    })).rejects.toMatchObject({ code: 'PHONEPE_RECEIPT_NOT_VERIFIED' });
    expect(calls.ledgerCreate).not.toHaveBeenCalled();
    expect(calls.requestUpdate).not.toHaveBeenCalled();
  });

  it('rejects without a wallet credit', async () => {
    const { tx, calls } = makeTx({ adminPhonePeCreditRequest: { findUnique: vi.fn(async () => ({ ...pendingRequest, targetUser })) } });
    const result = await decidePhonePeWalletCredit(tx, { requestId, checkerUserId: makerId, decision: 'REJECT', reason });
    expect(result.request.status).toBe('REJECTED');
    expect(result.credit).toBeNull();
    expect(calls.ledgerCreate).not.toHaveBeenCalled();
    expect(calls.auditCreate).toHaveBeenCalledOnce();
  });

  it('posts a balanced funding journal and wallet credit only after matching verified receipt details', async () => {
    const { tx, calls } = makeTx({ adminPhonePeCreditRequest: { findUnique: vi.fn(async () => ({ ...pendingRequest, targetUser })) } });
    const result = await decidePhonePeWalletCredit(tx, {
      requestId, checkerUserId: makerId, decision: 'APPROVE', reason,
      paymentReference: reference, verifiedAmountPaise: amountPaise,
      verifiedPayeeVpa: 'zitch@ptyes', receiverConfirmed: true,
    });
    expect(result.request.status).toBe('COMPLETED');
    expect(result.credit).toBeTruthy();
    expect(calls.ledgerCreate).toHaveBeenCalledTimes(2);
    const fundingJournal = calls.ledgerCreate.mock.calls[0][0] as any;
    expect(fundingJournal.data.entries.create).toEqual([
      { accountId: ADMIN_SETTLEMENT_CASH_ID, debitPaise: BigInt(amountPaise) },
      { accountId: ADMIN_ADJUSTMENT_FUND_ID, creditPaise: BigInt(amountPaise) },
    ]);
    const walletJournal = calls.ledgerCreate.mock.calls[1][0] as any;
    expect(walletJournal.data.entries.create).toEqual([
      { accountId: ADMIN_ADJUSTMENT_FUND_ID, debitPaise: BigInt(amountPaise) },
      { accountId: availableId, creditPaise: BigInt(amountPaise) },
    ]);
    expect(result.request.paymentReferenceMasked).toBe('••••1234');
    expect(calls.auditCreate).toHaveBeenCalledOnce();
  });

  it('blocks duplicate UPI references across payment workflows', async () => {
    const { tx, calls } = makeTx({
      adminPhonePeCreditRequest: { findUnique: vi.fn(async () => ({ ...pendingRequest, targetUser })) },
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) => parts.join('').includes('SELECT (') ? [{ used: true }] : []),
    });
    await expect(decidePhonePeWalletCredit(tx, {
      requestId, checkerUserId: makerId, decision: 'APPROVE', reason,
      paymentReference: reference, verifiedAmountPaise: amountPaise,
      verifiedPayeeVpa: 'zitch@ptyes', receiverConfirmed: true,
    })).rejects.toMatchObject({ code: 'PHONEPE_REFERENCE_ALREADY_USED' });
    expect(calls.ledgerCreate).not.toHaveBeenCalled();
    expect(calls.requestUpdate).not.toHaveBeenCalled();
  });
});
