import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/http.js';
import { lockPaymentReference, paymentReferenceHash } from '../payments/paymentReferenceLock.js';

const REQUEST_TTL_MINUTES = 20;
const MIN_CREDIT_PAISE = 10_000;
const MAX_CREDIT_PAISE = 1_000_000;
export const ADMIN_PHONEPE_SETTLEMENT_CASH_ID = '00000000-0000-4000-8000-000000000102';
// Reuse the already provisioned, zero-balance Admin adjustment fund account.
export const ADMIN_PHONEPE_FUND_ID = '00000000-0000-4000-8000-000000000101';

export function hashExternalReference(reference: string): string {
  return paymentReferenceHash(reference);
}

async function requireActiveSuperAdmin(tx: Prisma.TransactionClient | PrismaClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, phoneE164: true, status: true, adminRole: { select: { role: true } } } });
  if (!user || user.status !== 'ACTIVE' || user.adminRole?.role !== 'SUPER_ADMIN') {
    throw new HttpError(403, 'SUPER_ADMIN_REQUIRED', 'An active SUPER_ADMIN account is required.');
  }
  if (env.adminPhonePeCreditsAdminPhoneE164 && user.phoneE164 !== env.adminPhonePeCreditsAdminPhoneE164) {
    throw new HttpError(403, 'PHONEPE_CREDITS_ADMIN_NOT_ALLOWED', 'This Admin Credits feature is restricted to the configured Super Admin account.');
  }
  return user;
}

export async function assertPhonePeCreditsAdmin(tx: Prisma.TransactionClient | PrismaClient, userId: string) {
  await requireActiveSuperAdmin(tx, userId);
}

export async function readPhonePeWalletCreditReadiness(db: Prisma.TransactionClient | PrismaClient) {
  const blockers: string[] = [];
  if (!env.adminPhonePeCreditsEnabled) blockers.push('ADMIN_PHONEPE_CREDITS_ENABLED is false.');
  if (!env.adminPhonePeCreditsAdminPhoneE164) blockers.push('ADMIN_PHONEPE_CREDITS_ADMIN_PHONE_E164 is not configured for the authorized Super Admin account.');
  if (!env.adminPhonePeReceiverVpa) blockers.push('ADMIN_PHONEPE_RECEIVER_VPA is not configured.');
  if (env.isProduction && !env.adminPhonePeCreditsProductionApproved) blockers.push('ADMIN_PHONEPE_CREDITS_PRODUCTION_APPROVED is false.');

  const migrations = await db.$queryRaw<Array<{ credits: boolean; cash: boolean }>>`
    SELECT
      EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261113100000_admin_phonepe_payment_credits' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS credits,
      EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261113101000_admin_phonepe_ledger_accounts' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS cash`
    .catch(() => []);
  if (!migrations[0]?.credits || !migrations[0]?.cash) {
    blockers.push('Admin PhonePe credit database migrations are not applied.');
    return { enabled: false, receiverVpa: env.adminPhonePeReceiverVpa ?? null, migration: 'MISSING', ledgerIntegrity: 'NOT_CHECKED', ledgerAccounts: 'NOT_CHECKED', completedRequestReconciliation: 'NOT_CHECKED', blockers };
  }

  const [accounts, ledger, reconciled] = await Promise.all([
    db.ledgerAccount.findMany({ where: { id: { in: [ADMIN_PHONEPE_FUND_ID, ADMIN_PHONEPE_SETTLEMENT_CASH_ID] } }, select: { id: true, type: true } })
      .then((rows) => ({ rows, failed: false })).catch(() => ({ rows: [], failed: true })),
    db.$queryRaw<Array<{ debits: string; credits: string; unbalanced: bigint }>>`
      WITH per_transaction AS (SELECT transaction_id, SUM(debit_paise) AS debits, SUM(credit_paise) AS credits FROM ledger_entries GROUP BY transaction_id)
      SELECT COALESCE((SELECT SUM(debit_paise) FROM ledger_entries), 0)::text AS debits,
             COALESCE((SELECT SUM(credit_paise) FROM ledger_entries), 0)::text AS credits,
             COALESCE((SELECT COUNT(*) FROM per_transaction WHERE debits <> credits), 0)::bigint AS unbalanced`
      .then((rows) => rows[0] && rows[0].debits === rows[0].credits && rows[0].unbalanced === 0n ? 'BALANCED' : 'IMBALANCED').catch(() => 'CHECK_FAILED'),
    db.$queryRaw<Array<{ count: bigint }>>`
      WITH completed AS (
        SELECT r.id, r.amount_paise, r.target_user_id, r.funding_ledger_transaction_id, r.ledger_transaction_id,
               f.event_type AS funding_type, f.reference_type AS funding_reference_type, f.reference_id AS funding_reference_id,
               c.event_type AS credit_type, c.reference_type AS credit_reference_type, c.reference_id AS credit_reference_id
          FROM admin_phonepe_credit_requests r
          LEFT JOIN ledger_transactions f ON f.id = r.funding_ledger_transaction_id
          LEFT JOIN ledger_transactions c ON c.id = r.ledger_transaction_id
         WHERE r.status::text = 'COMPLETED'
      ), inconsistent AS (
        SELECT id FROM completed x
         WHERE x.funding_ledger_transaction_id IS NULL OR x.funding_type <> 'ADMIN_PHONEPE_RECEIPT'
            OR x.funding_reference_type <> 'ADMIN_PHONEPE_CREDIT' OR x.funding_reference_id <> x.id::text
            OR x.ledger_transaction_id IS NULL OR x.credit_type <> 'ADMIN_ADJUSTMENT'
            OR x.credit_reference_type <> 'ADMIN_PHONEPE_CREDIT' OR x.credit_reference_id <> x.id::text
            OR (SELECT COALESCE(SUM(e.debit_paise), 0) FROM ledger_entries e WHERE e.transaction_id = x.funding_ledger_transaction_id AND e.account_id = ${ADMIN_PHONEPE_SETTLEMENT_CASH_ID}::uuid) <> x.amount_paise
            OR (SELECT COALESCE(SUM(e.credit_paise), 0) FROM ledger_entries e WHERE e.transaction_id = x.funding_ledger_transaction_id AND e.account_id = ${ADMIN_PHONEPE_FUND_ID}::uuid) <> x.amount_paise
            OR (SELECT COALESCE(SUM(e.debit_paise), 0) FROM ledger_entries e WHERE e.transaction_id = x.ledger_transaction_id AND e.account_id = ${ADMIN_PHONEPE_FUND_ID}::uuid) <> x.amount_paise
            OR (SELECT COALESCE(SUM(e.credit_paise), 0) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id = x.ledger_transaction_id AND a.user_id = x.target_user_id AND a.type::text = 'AVAILABLE') <> x.amount_paise
            OR NOT EXISTS (SELECT 1 FROM admin_phonepe_credit_requests r WHERE r.id = x.id AND r.payment_reference_hash IS NOT NULL AND r.payment_reference_masked IS NOT NULL)
      ), invalid_pending AS (
        SELECT id FROM admin_phonepe_credit_requests
         WHERE status::text <> 'COMPLETED' AND (funding_ledger_transaction_id IS NOT NULL OR ledger_transaction_id IS NOT NULL OR payment_reference_hash IS NOT NULL OR payment_reference_masked IS NOT NULL)
      ), orphaned_account_entries AS (
        SELECT DISTINCT t.id
          FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
         WHERE e.account_id IN (${ADMIN_PHONEPE_SETTLEMENT_CASH_ID}::uuid, ${ADMIN_PHONEPE_FUND_ID}::uuid)
           AND NOT EXISTS (
             SELECT 1 FROM admin_phonepe_credit_requests r
              WHERE r.status::text = 'COMPLETED' AND t.reference_type = 'ADMIN_PHONEPE_CREDIT' AND t.reference_id = r.id::text
                AND t.id IN (r.funding_ledger_transaction_id, r.ledger_transaction_id)
           )
      ), balance_mismatch AS (
        SELECT 1 AS mismatch
         WHERE (SELECT COALESCE(SUM(debit_paise - credit_paise), 0) FROM ledger_entries WHERE account_id = ${ADMIN_PHONEPE_SETTLEMENT_CASH_ID}::uuid)
             <> (SELECT COALESCE(SUM(amount_paise), 0) FROM admin_phonepe_credit_requests WHERE status::text = 'COMPLETED')
            OR (SELECT COALESCE(SUM(credit_paise - debit_paise), 0) FROM ledger_entries WHERE account_id = ${ADMIN_PHONEPE_FUND_ID}::uuid) <> 0
      )
      SELECT ((SELECT COUNT(*) FROM inconsistent) + (SELECT COUNT(*) FROM invalid_pending)
          + (SELECT COUNT(*) FROM orphaned_account_entries) + (SELECT COUNT(*) FROM balance_mismatch))::bigint AS count`
      .then((rows) => rows[0]?.count === 0n ? 'RECONCILED' : 'DISCREPANCY').catch(() => 'CHECK_FAILED'),
  ]);

  const fund = accounts.rows.find((row) => row.id === ADMIN_PHONEPE_FUND_ID && row.type === 'ADMIN_ADJUSTMENT_FUND');
  const cash = accounts.rows.find((row) => row.id === ADMIN_PHONEPE_SETTLEMENT_CASH_ID && row.type === 'SETTLEMENT_CASH');
  const ledgerAccounts = accounts.failed ? 'CHECK_FAILED' : fund && cash ? 'PROVISIONED' : 'MISSING';
  if (ledgerAccounts !== 'PROVISIONED') blockers.push(ledgerAccounts === 'MISSING' ? 'Dedicated PhonePe settlement or credit-fund ledger account is not provisioned.' : 'Ledger account readiness check failed.');
  if (ledger !== 'BALANCED') blockers.push(`Ledger integrity is ${ledger.toLowerCase()}.`);
  if (reconciled !== 'RECONCILED') blockers.push(`Admin PhonePe credit ledger reconciliation is ${reconciled.toLowerCase()}.`);
  return { enabled: blockers.length === 0, receiverVpa: env.adminPhonePeReceiverVpa ?? null, migration: 'APPLIED', ledgerIntegrity: ledger, ledgerAccounts, completedRequestReconciliation: reconciled, blockers };
}

function maskReference(value: string) {
  return `••••${value.trim().slice(-4)}`;
}

export async function createPhonePeWalletCreditRequest(tx: Prisma.TransactionClient, input: {
  makerUserId: string;
  idempotencyKey: string;
  targetUserId: string;
  verifiedPublicId: string;
  verifiedPhoneMasked: string;
  verifiedWalletBalancePaise: number;
  amountPaise: number;
  reason: string;
  payeeVpa: string;
}) {
  await requireActiveSuperAdmin(tx, input.makerUserId);
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < MIN_CREDIT_PAISE || input.amountPaise > MAX_CREDIT_PAISE || input.amountPaise % 100 !== 0) {
    throw new HttpError(400, 'PHONEPE_CREDIT_AMOUNT_INVALID', 'Credit amount must be whole rupees from ₹100 to ₹10,000.');
  }
  const key = `ADMIN_PHONEPE_CREDIT:${input.makerUserId}:${input.idempotencyKey}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  const existing = await tx.adminPhonePeCreditRequest.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    const same = existing.targetUserId === input.targetUserId && existing.amountPaise === BigInt(input.amountPaise)
      && existing.reason === input.reason && existing.payeeVpa.toLowerCase() === input.payeeVpa.toLowerCase();
    if (!same) throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This payment request key already belongs to another credit.');
    return { request: existing, replayed: true };
  }

  await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.targetUserId}::uuid FOR UPDATE`;
  const target = await tx.user.findUnique({ where: { id: input.targetUserId }, select: { id: true, publicId: true, phoneE164: true, status: true, adminRole: { select: { id: true } } } });
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'The credit target does not exist.');
  if (target.status !== 'ACTIVE' || target.adminRole || !target.publicId) throw new HttpError(409, 'PHONEPE_CREDIT_TARGET_UNAVAILABLE', 'Credits are limited to an active non-admin account with a public user ID.');
  const phoneMasked = `${target.phoneE164.slice(0, Math.max(0, target.phoneE164.length - 4)).replace(/\d/g, '*')}${target.phoneE164.slice(-4)}`;
  const balances = await tx.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(e.credit_paise - e.debit_paise), 0)::bigint AS balance
      FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
     WHERE a.user_id = ${target.id}::uuid AND a.type::text = 'AVAILABLE'`;
  const currentBalancePaise = Number(balances[0]?.balance ?? 0n);
  if (target.publicId !== input.verifiedPublicId || phoneMasked !== input.verifiedPhoneMasked || !Number.isSafeInteger(input.verifiedWalletBalancePaise) || currentBalancePaise !== input.verifiedWalletBalancePaise) {
    throw new HttpError(409, 'PHONEPE_CREDIT_TARGET_CHANGED', 'User identity or wallet balance changed. Refresh the account and review again.');
  }
  const request = await tx.adminPhonePeCreditRequest.create({ data: {
    targetUserId: target.id, makerUserId: input.makerUserId, amountPaise: BigInt(input.amountPaise),
    payeeVpa: input.payeeVpa, reason: input.reason, idempotencyKey: key,
    status: 'PENDING_PAYMENT', expiresAt: new Date(Date.now() + REQUEST_TTL_MINUTES * 60_000),
  } });
  await tx.auditLog.create({ data: {
    actorId: input.makerUserId, action: 'ADMIN_PHONEPE_CREDIT_REQUESTED', target: `ADMIN_PHONEPE_CREDIT:${request.id}`,
    reason: input.reason, metadata: { targetUserId: target.id, targetPublicId: target.publicId, targetPhoneMasked: phoneMasked,
      verifiedWalletBalancePaise: String(currentBalancePaise), amountPaise: String(input.amountPaise), payeeVpa: input.payeeVpa, status: request.status, requestId: request.id },
  } });
  return { request, replayed: false };
}

export async function decidePhonePeWalletCredit(tx: Prisma.TransactionClient, input: {
  requestId: string;
  checkerUserId: string;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
  paymentReference?: string;
  verifiedAmountPaise?: number;
  verifiedPayeeVpa?: string;
  receiverConfirmed?: boolean;
}) {
  await requireActiveSuperAdmin(tx, input.checkerUserId);
  await tx.$queryRaw`SELECT id FROM admin_phonepe_credit_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`;
  const request = await tx.adminPhonePeCreditRequest.findUnique({ where: { id: input.requestId }, include: { targetUser: { select: { id: true, publicId: true, status: true, adminRole: { select: { id: true } } } } } });
  if (!request) throw new HttpError(404, 'PHONEPE_CREDIT_NOT_FOUND', 'Admin credit payment request was not found.');
  if (request.status === 'COMPLETED' && input.decision === 'APPROVE' && input.paymentReference) {
    const retryHash = hashExternalReference(input.paymentReference);
    if (retryHash === request.paymentReferenceHash) return { request, credit: null, fundingLedgerTransactionId: request.fundingLedgerTransactionId, replayed: true };
  }
  if (request.status !== 'PENDING_PAYMENT') throw new HttpError(409, 'PHONEPE_CREDIT_ALREADY_DECIDED', 'This payment request has already been decided.');
  const now = new Date();
  if (request.expiresAt <= now) {
    const expired = await tx.adminPhonePeCreditRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED', decisionReason: 'Payment request expired before confirmation.', decidedAt: now } });
    await tx.auditLog.create({ data: { actorId: input.checkerUserId, action: 'ADMIN_PHONEPE_CREDIT_EXPIRED', target: `ADMIN_PHONEPE_CREDIT:${request.id}`, reason: 'Payment request expired; no payment was approved and no wallet balance changed.', metadata: { amountPaise: String(request.amountPaise), targetUserId: request.targetUserId } } });
    return { request: expired, credit: null, fundingLedgerTransactionId: null, replayed: false };
  }
  if (input.decision === 'REJECT') {
    const rejected = await tx.adminPhonePeCreditRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', decisionReason: input.reason, decidedAt: now } });
    await tx.auditLog.create({ data: { actorId: input.checkerUserId, action: 'ADMIN_PHONEPE_CREDIT_REJECTED', target: `ADMIN_PHONEPE_CREDIT:${request.id}`, reason: input.reason, metadata: { amountPaise: String(request.amountPaise), targetUserId: request.targetUserId, ledgerTransactionId: null } } });
    return { request: rejected, credit: null, fundingLedgerTransactionId: null, replayed: false };
  }
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${request.targetUserId}::uuid FOR UPDATE`;
  const target = await tx.user.findUnique({ where: { id: request.targetUserId }, select: { id: true, publicId: true, status: true, adminRole: { select: { id: true } } } });
  if (!target || target.status !== 'ACTIVE' || target.adminRole) throw new HttpError(409, 'PHONEPE_CREDIT_TARGET_UNAVAILABLE', 'The target account is no longer eligible for credit.');
  if (!input.paymentReference || !Number.isSafeInteger(input.verifiedAmountPaise) || input.verifiedAmountPaise !== Number(request.amountPaise) || input.verifiedPayeeVpa?.toLowerCase() !== request.payeeVpa.toLowerCase() || input.receiverConfirmed !== true) {
    throw new HttpError(409, 'PHONEPE_RECEIPT_NOT_VERIFIED', `Confirm the exact ₹${Number(request.amountPaise) / 100} receipt to ${request.payeeVpa} and enter its PhonePe/UPI transaction reference. No wallet balance was changed.`);
  }
  const reference = input.paymentReference.trim().normalize('NFKC');
  if (reference.length < 8 || reference.length > 120 || !/^[A-Za-z0-9._/-]+$/.test(reference)) throw new HttpError(400, 'PHONEPE_REFERENCE_INVALID', 'Enter the exact PhonePe/UPI reference (8–120 letters, numbers, period, slash, dash, or underscore).');
  await lockPaymentReference(tx, reference);
  const referenceHash = hashExternalReference(reference);
  const duplicate = await tx.$queryRaw<Array<{ used: boolean }>>`
    SELECT (
      EXISTS (SELECT 1 FROM admin_phonepe_credit_requests WHERE payment_reference_hash = ${referenceHash}) OR
      EXISTS (SELECT 1 FROM manual_payment_claims WHERE upper(transaction_reference) = ${reference.toUpperCase()}) OR
      EXISTS (SELECT 1 FROM p2p_payment_claims WHERE upper(transaction_reference) = ${reference.toUpperCase()}) OR
      EXISTS (SELECT 1 FROM withdrawals WHERE upper(payout_reference) = ${reference.toUpperCase()})
    ) AS used`;
  if (duplicate[0]?.used) throw new HttpError(409, 'PHONEPE_REFERENCE_ALREADY_USED', 'This payment reference was already recorded. No wallet balance was changed.');

  const amount = request.amountPaise;
  const available = await tx.ledgerAccount.upsert({ where: { userId_type_currency: { userId: target.id, type: 'AVAILABLE', currency: 'INR' } }, create: { userId: target.id, type: 'AVAILABLE', currency: 'INR' }, update: {}, select: { id: true } });
  const accounts = await tx.ledgerAccount.findMany({ where: { id: { in: [ADMIN_PHONEPE_SETTLEMENT_CASH_ID, ADMIN_PHONEPE_FUND_ID] } }, select: { id: true, type: true } });
  const cash = accounts.find((account) => account.id === ADMIN_PHONEPE_SETTLEMENT_CASH_ID && account.type === 'SETTLEMENT_CASH');
  const fund = accounts.find((account) => account.id === ADMIN_PHONEPE_FUND_ID && account.type === 'ADMIN_ADJUSTMENT_FUND');
  if (!cash || !fund) throw new HttpError(503, 'PHONEPE_CREDIT_LEDGER_UNAVAILABLE', 'Dedicated PhonePe settlement and credit-fund accounts are not provisioned. No balance was changed.');
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${cash.id}::uuid, ${fund.id}::uuid, ${available.id}::uuid) ORDER BY id FOR UPDATE`;
  const ledgerTotals = await tx.$queryRaw<Array<{ debits: string; credits: string; unbalanced: bigint }>>`
    WITH per_transaction AS (SELECT transaction_id, SUM(debit_paise) AS debits, SUM(credit_paise) AS credits FROM ledger_entries GROUP BY transaction_id)
    SELECT COALESCE((SELECT SUM(debit_paise) FROM ledger_entries), 0)::text AS debits,
           COALESCE((SELECT SUM(credit_paise) FROM ledger_entries), 0)::text AS credits,
           COALESCE((SELECT COUNT(*) FROM per_transaction WHERE debits <> credits), 0)::bigint AS unbalanced`;
  if (!ledgerTotals[0] || ledgerTotals[0].debits !== ledgerTotals[0].credits || ledgerTotals[0].unbalanced !== 0n) throw new HttpError(503, 'PHONEPE_CREDIT_LEDGER_IMBALANCED', 'Ledger reconciliation is not balanced. No wallet balance was changed.');

  const funding = await tx.ledgerTransaction.create({ data: {
    eventType: 'ADMIN_PHONEPE_RECEIPT', referenceType: 'ADMIN_PHONEPE_CREDIT', referenceId: request.id,
    idempotencyKey: `ADMIN_PHONEPE_RECEIPT:${request.id}`, actorUserId: input.checkerUserId,
    metadata: { requestId: request.id, targetUserId: target.id, amountPaise: String(amount), payeeVpa: request.payeeVpa,
      paymentReferenceHash: referenceHash, paymentReferenceMasked: maskReference(reference), manuallyVerifiedBySuperAdmin: true },
    entries: { create: [{ accountId: cash.id, debitPaise: amount }, { accountId: fund.id, creditPaise: amount }] },
  }, select: { id: true } });
  const credit = await tx.ledgerTransaction.create({ data: {
    eventType: 'ADMIN_ADJUSTMENT', referenceType: 'ADMIN_PHONEPE_CREDIT', referenceId: request.id,
    idempotencyKey: `ADMIN_PHONEPE_CREDIT:${request.id}`, actorUserId: input.checkerUserId,
    metadata: { requestId: request.id, targetUserId: target.id, targetPublicId: target.publicId, amountPaise: String(amount),
      reason: input.reason, fundingAccountId: fund.id, fundingLedgerTransactionId: funding.id, paymentReferenceMasked: maskReference(reference) },
    entries: { create: [{ accountId: fund.id, debitPaise: amount }, { accountId: available.id, creditPaise: amount }] },
  }, select: { id: true, createdAt: true } });
  const updated = await tx.adminPhonePeCreditRequest.update({ where: { id: request.id }, data: {
    status: 'COMPLETED', paymentReferenceHash: referenceHash, paymentReferenceMasked: maskReference(reference),
    fundingLedgerTransactionId: funding.id, ledgerTransactionId: credit.id, decisionReason: input.reason, decidedAt: now,
  } });
  await tx.auditLog.create({ data: { actorId: input.checkerUserId, action: 'ADMIN_PHONEPE_CREDIT_APPROVED', target: `USER:${request.targetUserId}`, reason: input.reason,
    metadata: { requestId: request.id, amountPaise: String(amount), payeeVpa: request.payeeVpa, paymentReferenceMasked: maskReference(reference),
      paymentReferenceHash: referenceHash, fundingLedgerTransactionId: funding.id, ledgerTransactionId: credit.id, targetPublicId: request.targetUser.publicId } } });
  const balance = await tx.$queryRaw<Array<{ balance: bigint }>>`SELECT COALESCE(SUM(credit_paise - debit_paise), 0)::bigint AS balance FROM ledger_entries WHERE account_id = ${available.id}::uuid`;
  const balancePaise = Number(balance[0]?.balance ?? 0n);
  if (!Number.isSafeInteger(balancePaise)) throw new HttpError(500, 'PHONEPE_CREDIT_BALANCE_UNSAFE', 'Updated wallet balance cannot be represented safely. No credit was committed.');
  return { request: updated, credit: { id: credit.id, balancePaise, createdAt: credit.createdAt }, fundingLedgerTransactionId: funding.id, replayed: false };
}
