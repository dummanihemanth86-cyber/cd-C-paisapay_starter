import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { createCreditRequest, createFundingRequest, decideCreditRequest, decideFundingRequest, hashExternalReference, ADMIN_ADJUSTMENT_FUND_ID, ADMIN_SETTLEMENT_CASH_ID } from '../modules/admin/walletCreditWorkflow.js';

const maker = '00000000-0000-4000-8000-000000000001';
const checker = '00000000-0000-4000-8000-000000000002';
const targetId = '00000000-0000-4000-8000-000000000003';
const requestId = '00000000-0000-4000-8000-000000000004';
const availableId = '00000000-0000-4000-8000-000000000005';
const verifiedTarget = { verifiedPublicId: 'USER12345', verifiedPhoneMasked: '+******1234', verifiedWalletBalancePaise: 0 };
const activeSuper = { id: maker, status: 'ACTIVE', adminRole: { role: 'SUPER_ADMIN' } };
const pendingCredit = { id: requestId, makerUserId: maker, targetUserId: targetId, amountPaise: 10_000n, reason: 'Customer adjustment support', status: 'PENDING_APPROVAL', idempotencyKey: `ADMIN_CREDIT_REQUEST:${maker}:11111111-1111-4111-8111-111111111111`, targetUser: { id: targetId, publicId: 'USER12345', status: 'ACTIVE', adminRole: null } };

function workflowTx(overrides: Record<string, unknown> = {}) {
  const calls = { ledgerCreate: vi.fn(async () => ({ id: 'ledger-id', createdAt: new Date('2026-11-07T00:00:00Z') })), auditCreate: vi.fn(async () => ({ id: 'audit-id' })), requestCreate: vi.fn(async (args: any) => ({ id: requestId, ...args.data })), requestUpdate: vi.fn(async (args: any) => ({ ...pendingCredit, ...args.data })) };
  const tx = {
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => { const sql = parts.join(''); return sql.includes('WHERE a.user_id') ? [{ balance: 0n }] : sql.includes('SUM(credit_paise - debit_paise)') ? [{ accountId: ADMIN_ADJUSTMENT_FUND_ID, balance: 1_000_000n }, { accountId: availableId, balance: 0n }] : []; }),
    user: { findUnique: vi.fn(async ({ where }: any) => where.id === targetId || where.publicId === 'USER12345' ? { id: targetId, publicId: 'USER12345', phoneE164: '+9112341234', status: 'ACTIVE', adminRole: null } : activeSuper) },
    adminWalletCreditRequest: { findUnique: vi.fn(async () => null), create: calls.requestCreate, update: calls.requestUpdate },
    adminWalletFundingRequest: { findUnique: vi.fn(async () => null), create: calls.requestCreate, update: calls.requestUpdate },
    ledgerAccount: { findMany: vi.fn(async () => [{ id: ADMIN_SETTLEMENT_CASH_ID, type: 'SETTLEMENT_CASH' }, { id: ADMIN_ADJUSTMENT_FUND_ID, type: 'ADMIN_ADJUSTMENT_FUND' }]), upsert: vi.fn(async () => ({ id: availableId })), findUnique: vi.fn(async ({ where }: any) => where.id === ADMIN_ADJUSTMENT_FUND_ID ? { id: ADMIN_ADJUSTMENT_FUND_ID, type: 'ADMIN_ADJUSTMENT_FUND' } : { id: availableId }) },
    ledgerTransaction: { findUnique: vi.fn(async () => null), create: calls.ledgerCreate },
    auditLog: { create: calls.auditCreate },
    ...overrides,
  } as unknown as Prisma.TransactionClient;
  return { tx, calls };
}

describe('Admin wallet credit Maker-Checker workflow', () => {
  it('creates only pending requests, with idempotent replay and an audit record', async () => {
    const { tx, calls } = workflowTx();
    const result = await createCreditRequest(tx, { makerUserId: maker, targetUserId: targetId, ...verifiedTarget, amountPaise: 10_000, reason: 'Customer adjustment support', idempotencyKey: '11111111-1111-4111-8111-111111111111' });
    expect(result.replayed).toBe(false);
    expect(calls.requestCreate).toHaveBeenCalledOnce();
    expect(calls.auditCreate).toHaveBeenCalledOnce();
    expect(calls.ledgerCreate).not.toHaveBeenCalled();
    const replayFixture = workflowTx({ adminWalletCreditRequest: { findUnique: vi.fn(async () => ({ id: requestId, targetUserId: targetId, amountPaise: 10_000n, reason: 'Customer adjustment support' })), create: vi.fn(), update: vi.fn() } });
    const replay = await createCreditRequest(replayFixture.tx, { makerUserId: maker, targetUserId: targetId, ...verifiedTarget, amountPaise: 10_000, reason: 'Customer adjustment support', idempotencyKey: '11111111-1111-4111-8111-111111111111' });
    expect(replay.replayed).toBe(true);
    expect(replayFixture.calls.requestCreate).not.toHaveBeenCalled();
    expect(replayFixture.calls.auditCreate).not.toHaveBeenCalled();
  });

  it('rejects amounts outside ₹100–₹10,000 before any writes', async () => {
    const { tx, calls } = workflowTx();
    for (const amountPaise of [9_999, 1_000_001]) await expect(createCreditRequest(tx, { makerUserId: maker, targetUserId: targetId, ...verifiedTarget, amountPaise, reason: 'Customer adjustment support', idempotencyKey: '11111111-1111-4111-8111-111111111111' })).rejects.toMatchObject({ code: 'WALLET_CREDIT_AMOUNT_INVALID' });
    expect(calls.requestCreate).not.toHaveBeenCalled();
    expect(calls.ledgerCreate).not.toHaveBeenCalled();
  });

  it('requires the submitted identity and displayed current balance to match the locked database snapshot', async () => {
    const changedBalance = workflowTx({ $queryRaw: vi.fn(async (parts: TemplateStringsArray) => parts.join('').includes('WHERE a.user_id') ? [{ balance: 20_000n }] : []) });
    await expect(createCreditRequest(changedBalance.tx, { makerUserId: maker, targetUserId: targetId, ...verifiedTarget, amountPaise: 10_000, reason: 'Customer adjustment support', idempotencyKey: '11111111-1111-4111-8111-111111111111' })).rejects.toMatchObject({ code: 'WALLET_CREDIT_TARGET_CHANGED' });
    expect(changedBalance.calls.requestCreate).not.toHaveBeenCalled();
    expect(changedBalance.calls.ledgerCreate).not.toHaveBeenCalled();
  });

  it('requires an active SUPER_ADMIN maker and eligible non-admin active target', async () => {
    const inactive = workflowTx({ user: { findUnique: vi.fn(async () => ({ ...activeSuper, status: 'SUSPENDED' })) } });
    await expect(createCreditRequest(inactive.tx, { makerUserId: maker, targetUserId: targetId, ...verifiedTarget, amountPaise: 10_000, reason: 'Customer adjustment support', idempotencyKey: '11111111-1111-4111-8111-111111111111' })).rejects.toMatchObject({ code: 'SUPER_ADMIN_REQUIRED' });
    const adminTarget = workflowTx({ user: { findUnique: vi.fn(async ({ where }: any) => where.id === targetId ? { id: targetId, status: 'ACTIVE', adminRole: { id: 'admin' } } : activeSuper) } });
    await expect(createCreditRequest(adminTarget.tx, { makerUserId: maker, targetUserId: targetId, ...verifiedTarget, amountPaise: 10_000, reason: 'Customer adjustment support', idempotencyKey: '11111111-1111-4111-8111-111111111111' })).rejects.toMatchObject({ code: 'WALLET_CREDIT_TARGET_UNAVAILABLE' });
  });

  it('prevents maker approval and rejects without ledger mutation', async () => {
    const makerAttempt = workflowTx({ user: { findUnique: vi.fn(async () => ({ ...activeSuper, id: maker })) }, adminWalletCreditRequest: { findUnique: vi.fn(async () => pendingCredit), update: vi.fn(), create: vi.fn() } });
    await expect(decideCreditRequest(makerAttempt.tx, { requestId, checkerUserId: maker, decision: 'APPROVE', reason: 'Approved by maker' })).rejects.toMatchObject({ code: 'MAKER_CANNOT_CHECK' });
    const rejected = workflowTx({ user: { findUnique: vi.fn(async () => ({ ...activeSuper, id: checker })) }, adminWalletCreditRequest: { findUnique: vi.fn(async () => pendingCredit), update: vi.fn(async () => ({ ...pendingCredit, status: 'REJECTED' })), create: vi.fn() } });
    const result = await decideCreditRequest(rejected.tx, { requestId, checkerUserId: checker, decision: 'REJECT', reason: 'Evidence does not support request' });
    expect(result.credit).toBeNull();
    expect(rejected.calls.ledgerCreate).not.toHaveBeenCalled();
    expect(rejected.calls.auditCreate).toHaveBeenCalledOnce();
    const nonAdminChecker = workflowTx({ user: { findUnique: vi.fn(async () => ({ id: checker, status: 'ACTIVE', adminRole: { role: 'FINANCE' } })) }, adminWalletCreditRequest: { findUnique: vi.fn(async () => pendingCredit), update: vi.fn(), create: vi.fn() } });
    await expect(decideCreditRequest(nonAdminChecker.tx, { requestId, checkerUserId: checker, decision: 'REJECT', reason: 'Rejected by finance reviewer' })).rejects.toMatchObject({ code: 'SUPER_ADMIN_REQUIRED' });
  });

  it('approves through one funded, balanced wallet ledger operation and remains idempotency-protected', async () => {
    const tx = workflowTx({ user: { findUnique: vi.fn(async ({ where }: any) => where.id === targetId || where.publicId === 'USER12345' ? { id: targetId, publicId: 'USER12345', status: 'ACTIVE', adminRole: null } : { ...activeSuper, id: checker }) }, adminWalletCreditRequest: { findUnique: vi.fn(async () => pendingCredit), update: vi.fn(async () => ({ ...pendingCredit, status: 'APPROVED', checkerUserId: checker })), create: vi.fn() } });
    const result = await decideCreditRequest(tx.tx, { requestId, checkerUserId: checker, decision: 'APPROVE', reason: 'Independent customer adjustment approval' });
    expect(result.request.status).toBe('APPROVED');
    expect(tx.calls.ledgerCreate).toHaveBeenCalledOnce();
    const journal = tx.calls.ledgerCreate.mock.calls[0][0] as any;
    expect(journal.data.entries.create).toEqual([{ accountId: ADMIN_ADJUSTMENT_FUND_ID, debitPaise: 10_000n }, { accountId: availableId, creditPaise: 10_000n }]);
    expect(tx.calls.auditCreate).toHaveBeenCalledTimes(2);
  });
});

describe('Admin wallet funding and reconciliation safety', () => {
  const fundingInput = { makerUserId: maker, amountPaise: 250_000, sourceAccountLabel: 'Operating account ending 1200', externalReference: 'BANK-REF-20261107-001', evidenceReference: 'finance-vault/statement-001', evidenceSha256: 'a'.repeat(64), statementDate: new Date('2026-11-07T00:00:00.000Z'), reason: 'Verified treasury top-up receipt', idempotencyKey: '22222222-2222-4222-8222-222222222222' };

  it('hashes bank references and stores only the hash', async () => {
    expect(hashExternalReference('BANK-REF-20261107-001')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashExternalReference(' BANK-REF-20261107-001 ')).toBe(hashExternalReference('BANK-REF-20261107-001'));
    const { tx, calls } = workflowTx();
    await createFundingRequest(tx, fundingInput);
    const data = (calls.requestCreate.mock.calls[0][0] as any).data;
    expect(data.externalReferenceHash).toBe(hashExternalReference(fundingInput.externalReference));
    expect(Object.values(data)).not.toContain(fundingInput.externalReference);
    expect(calls.ledgerCreate).not.toHaveBeenCalled();
    const duplicateFixture = workflowTx({ adminWalletFundingRequest: { findUnique: vi.fn(async ({ where }: any) => where.externalReferenceHash ? { id: 'existing-funding' } : null), create: vi.fn(), update: vi.fn() } });
    await expect(createFundingRequest(duplicateFixture.tx, { ...fundingInput, idempotencyKey: '33333333-3333-4333-8333-333333333333' })).rejects.toMatchObject({ code: 'FUNDING_REFERENCE_ALREADY_USED' });
    expect(duplicateFixture.calls.requestCreate).not.toHaveBeenCalled();
    expect(duplicateFixture.calls.ledgerCreate).not.toHaveBeenCalled();
  });

  it('requires independent evidence verification before posting a balanced cash-to-fund journal', async () => {
    const funding = { id: requestId, makerUserId: maker, amountPaise: 250_000n, sourceAccountLabel: 'Operating account ending 1200', externalReferenceHash: 'b'.repeat(64), evidenceReference: 'finance-vault/statement-001', evidenceSha256: 'a'.repeat(64), statementDate: fundingInput.statementDate, reason: fundingInput.reason, status: 'PENDING_APPROVAL' };
    const unchecked = workflowTx({ user: { findUnique: vi.fn(async () => ({ ...activeSuper, id: checker })) }, adminWalletFundingRequest: { findUnique: vi.fn(async () => funding), update: vi.fn(), create: vi.fn() } });
    await expect(decideFundingRequest(unchecked.tx, { requestId, checkerUserId: checker, decision: 'APPROVE', reason: 'Verified actual cleared bank receipt', evidenceVerified: false })).rejects.toMatchObject({ code: 'FUNDING_EVIDENCE_NOT_VERIFIED' });
    expect(unchecked.calls.ledgerCreate).not.toHaveBeenCalled();
    const approved = workflowTx({ user: { findUnique: vi.fn(async () => ({ ...activeSuper, id: checker })) }, adminWalletFundingRequest: { findUnique: vi.fn(async () => funding), update: vi.fn(async () => ({ ...funding, status: 'APPROVED' })), create: vi.fn() } });
    await decideFundingRequest(approved.tx, { requestId, checkerUserId: checker, decision: 'APPROVE', reason: 'Verified actual cleared bank receipt', evidenceVerified: true });
    const journal = approved.calls.ledgerCreate.mock.calls[0][0] as any;
    expect(journal.data.entries.create).toEqual([{ accountId: ADMIN_SETTLEMENT_CASH_ID, debitPaise: 250_000n }, { accountId: ADMIN_ADJUSTMENT_FUND_ID, creditPaise: 250_000n }]);
    expect(approved.calls.auditCreate).toHaveBeenCalledOnce();
  });

  it('fails closed for missing accounting accounts and never writes a ledger transaction', async () => {
    const funding = { id: requestId, makerUserId: maker, amountPaise: 250_000n, sourceAccountLabel: 'Operating account ending 1200', externalReferenceHash: 'b'.repeat(64), evidenceReference: 'finance-vault/statement-001', evidenceSha256: 'a'.repeat(64), statementDate: fundingInput.statementDate, reason: fundingInput.reason, status: 'PENDING_APPROVAL' };
    const missingAccounts = workflowTx({ user: { findUnique: vi.fn(async () => ({ ...activeSuper, id: checker })) }, adminWalletFundingRequest: { findUnique: vi.fn(async () => funding), update: vi.fn(), create: vi.fn() }, ledgerAccount: { findMany: vi.fn(async () => []) } });
    await expect(decideFundingRequest(missingAccounts.tx, { requestId, checkerUserId: checker, decision: 'APPROVE', reason: 'Verified cleared bank receipt', evidenceVerified: true })).rejects.toMatchObject({ code: 'FUNDING_ACCOUNTS_UNAVAILABLE' });
    expect(missingAccounts.calls.ledgerCreate).not.toHaveBeenCalled();
    expect(missingAccounts.calls.auditCreate).not.toHaveBeenCalled();
  });
});
