import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http.js';

export const ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID = '00000000-0000-4000-8000-000000000101';
export const MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE = 10_000; // ₹100 minimum
export const MAX_ADMIN_ADJUSTMENT_PAISE = 1_000_000; // ₹10,000 per adjustment

export type WalletAdjustmentInput = {
  actorUserId: string;
  idempotencyKey: string;
  targetPublicId: string;
  direction: 'CREDIT' | 'DEBIT';
  amountPaise: number;
  reason: string;
  idempotencyScope?: string;
  eventType?: string;
  referenceType?: string;
};

function sameRequest(metadata: Prisma.JsonValue, input: WalletAdjustmentInput, targetUserId: string): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const value = metadata as Record<string, unknown>;
  return value.adminUserId === input.actorUserId && value.targetUserId === targetUserId &&
    value.direction === input.direction && value.amountPaise === String(input.amountPaise) && value.reason === input.reason &&
    (!input.idempotencyScope || value.idempotencyScope === input.idempotencyScope) &&
    (!input.eventType || value.eventType === input.eventType) &&
    (!input.referenceType || value.referenceType === input.referenceType);
}

export async function applyAdminWalletAdjustment(tx: Prisma.TransactionClient, input: WalletAdjustmentInput) {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 1 || input.amountPaise > MAX_ADMIN_ADJUSTMENT_PAISE) {
    throw new HttpError(400, 'WALLET_ADJUSTMENT_AMOUNT_INVALID', 'Amount must be between ₹0.01 and ₹10,000.00.');
  }

  const scopedKey = `${input.idempotencyScope ?? 'ADMIN_WALLET_ADJUSTMENT'}:${input.actorUserId}:${input.idempotencyKey}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopedKey}))`;
  const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: scopedKey }, select: { id: true, referenceId: true, metadata: true, createdAt: true } });
  if (existing) {
    const target = await tx.user.findUnique({ where: { publicId: input.targetPublicId }, select: { id: true, publicId: true } });
    if (!target || !sameRequest(existing.metadata, input, target.id)) throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different adjustment.');
    return { id: existing.id, reference: existing.referenceId, targetUserId: target.publicId, direction: input.direction, amountPaise: input.amountPaise, reason: input.reason, createdAt: existing.createdAt, replayed: true };
  }

  const target = await tx.user.findUnique({ where: { publicId: input.targetPublicId }, select: { id: true, publicId: true, status: true } });
  if (!target) throw new HttpError(404, 'WALLET_ADJUSTMENT_USER_NOT_FOUND', 'No user was found for that public ID.');
  if (target.status !== 'ACTIVE') throw new HttpError(409, 'WALLET_ADJUSTMENT_USER_UNAVAILABLE', 'Wallet adjustments are limited to active user accounts.');

  await tx.$queryRaw`SELECT id FROM users WHERE id = ${target.id}::uuid FOR UPDATE`;
  const available = await tx.ledgerAccount.upsert({
    where: { userId_type_currency: { userId: target.id, type: 'AVAILABLE', currency: 'INR' } },
    create: { userId: target.id, type: 'AVAILABLE', currency: 'INR' }, update: {}, select: { id: true },
  });
  const fund = await tx.ledgerAccount.findUnique({ where: { id: ADMIN_ADJUSTMENT_FUND_ACCOUNT_ID }, select: { id: true, type: true } });
  if (!fund || fund.type !== 'ADMIN_ADJUSTMENT_FUND') throw new HttpError(503, 'WALLET_ADJUSTMENT_FUND_UNAVAILABLE', 'The approved admin adjustment funding account is not provisioned. No balance was changed.');

  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${fund.id}::uuid, ${available.id}::uuid) ORDER BY id FOR UPDATE`;
  const balances = await tx.$queryRaw<Array<{ accountId: string; balance: bigint }>>`
    SELECT account_id::text AS "accountId", COALESCE(SUM(credit_paise - debit_paise), 0)::bigint AS balance
    FROM ledger_entries WHERE account_id IN (${fund.id}::uuid, ${available.id}::uuid) GROUP BY account_id`;
  const fundBalance = balances.find((row) => row.accountId === fund.id)?.balance ?? 0n;
  const userBalance = balances.find((row) => row.accountId === available.id)?.balance ?? 0n;
  const amount = BigInt(input.amountPaise);
  if (input.direction === 'CREDIT' && fundBalance < amount) throw new HttpError(409, 'WALLET_ADJUSTMENT_FUND_INSUFFICIENT', 'The approved adjustment fund does not have enough available funds. No balance was changed.');
  if (input.direction === 'DEBIT' && userBalance < amount) throw new HttpError(409, 'WALLET_ADJUSTMENT_BALANCE_INSUFFICIENT', 'The user does not have enough available wallet balance for this debit. Reserved funds are not debited.');

  const transactionReference = randomUUID();
  const eventType = input.eventType ?? `ADMIN_WALLET_${input.direction}`;
  const referenceType = input.referenceType ?? 'ADMIN_WALLET_ADJUSTMENT';
  const metadata = { adminUserId: input.actorUserId, targetUserId: target.id, targetPublicId: target.publicId ?? input.targetPublicId, direction: input.direction, amountPaise: amount.toString(), currency: 'INR', reason: input.reason, fundingAccountId: fund.id, eventType, referenceType, ...(input.idempotencyScope ? { idempotencyScope: input.idempotencyScope } : {}) };
  const transaction = await tx.ledgerTransaction.create({
    data: {
      eventType, referenceType, referenceId: transactionReference,
      idempotencyKey: scopedKey, actorUserId: input.actorUserId, metadata,
      entries: { create: input.direction === 'CREDIT'
        ? [{ accountId: fund.id, debitPaise: amount }, { accountId: available.id, creditPaise: amount }]
        : [{ accountId: available.id, debitPaise: amount }, { accountId: fund.id, creditPaise: amount }] },
    }, select: { id: true, createdAt: true },
  });
  await tx.auditLog.create({ data: {
    actorId: input.actorUserId, action: `ADMIN_WALLET_${input.direction}`, target: `USER:${target.id}`,
    reason: input.reason, metadata: { ...metadata, ledgerTransactionId: transaction.id, transactionReference },
  } });
  return { id: transaction.id, reference: transactionReference, targetUserId: target.publicId, direction: input.direction, amountPaise: input.amountPaise, reason: input.reason, createdAt: transaction.createdAt, replayed: false };
}

export async function applySuperAdminWalletCredit(tx: Prisma.TransactionClient, input: Omit<WalletAdjustmentInput, 'direction' | 'targetPublicId'> & { targetUserId: string }) {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE || input.amountPaise > MAX_ADMIN_ADJUSTMENT_PAISE || input.amountPaise % 100 !== 0) {
    throw new HttpError(400, 'WALLET_CREDIT_AMOUNT_INVALID', 'Credit amount must be whole rupees from ₹100 to ₹10,000.');
  }
  const target = await tx.user.findUnique({ where: { id: input.targetUserId }, select: { id: true, publicId: true } });
  if (!target) throw new HttpError(404, 'WALLET_ADJUSTMENT_USER_NOT_FOUND', 'No user was found for that ID.');
  if (!target.publicId) throw new HttpError(409, 'WALLET_CREDIT_USER_ID_UNAVAILABLE', 'This account does not have a public user ID and cannot receive a manual wallet credit.');

  const adjustment = await applyAdminWalletAdjustment(tx, {
    actorUserId: input.actorUserId,
    idempotencyKey: input.idempotencyKey,
    targetPublicId: target.publicId,
    direction: 'CREDIT',
    amountPaise: input.amountPaise,
    reason: input.reason,
    idempotencyScope: 'SUPER_ADMIN_WALLET_CREDIT',
    eventType: 'ADMIN_ADJUSTMENT',
    referenceType: 'ADMIN_ADJUSTMENT',
  });
  const account = await tx.ledgerAccount.findUnique({ where: { userId_type_currency: { userId: target.id, type: 'AVAILABLE', currency: 'INR' } }, select: { id: true } });
  const balances = account ? await tx.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(credit_paise - debit_paise), 0)::bigint AS balance
    FROM ledger_entries WHERE account_id = ${account.id}::uuid` : [{ balance: 0n }];
  const balancePaise = Number(balances[0]?.balance ?? 0n);
  if (!Number.isSafeInteger(balancePaise)) throw new HttpError(500, 'WALLET_CREDIT_BALANCE_UNSAFE', 'Updated wallet balance cannot be represented safely. The credit was not committed.');
  return { ...adjustment, balancePaise };
}
