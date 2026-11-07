import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http.js';
import { applySuperAdminWalletCredit, MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE, MAX_ADMIN_ADJUSTMENT_PAISE } from './walletAdjustment.js';

export const ADMIN_ADJUSTMENT_FUND_ID = '00000000-0000-4000-8000-000000000101';
export const ADMIN_SETTLEMENT_CASH_ID = '00000000-0000-4000-8000-000000000102';

export function hashExternalReference(reference: string): string {
  return createHash('sha256').update(reference.trim().normalize('NFKC')).digest('hex');
}
async function requireActiveSuperAdmin(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true, adminRole: { select: { role: true } } } });
  if (!user || user.status !== 'ACTIVE' || user.adminRole?.role !== 'SUPER_ADMIN') {
    throw new HttpError(403, 'SUPER_ADMIN_REQUIRED', 'An active SUPER_ADMIN account is required.');
  }
  return user;
}

export async function createCreditRequest(tx: Prisma.TransactionClient, input: {
  makerUserId: string; targetUserId: string; amountPaise: number; reason: string; idempotencyKey: string;
  verifiedPublicId: string; verifiedPhoneMasked: string; verifiedWalletBalancePaise: number;
}) {
  await requireActiveSuperAdmin(tx, input.makerUserId);
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE || input.amountPaise > MAX_ADMIN_ADJUSTMENT_PAISE) {
    throw new HttpError(400, 'WALLET_CREDIT_AMOUNT_INVALID', 'Credit requests must be from ₹100 to ₹10,000.');
  }
  const key = `ADMIN_CREDIT_REQUEST:${input.makerUserId}:${input.idempotencyKey}`;
  const existing = await tx.adminWalletCreditRequest.findUnique({ where: { idempotencyKey: key }, select: { id: true, targetUserId: true, amountPaise: true, reason: true } });
  if (existing) {
    if (existing.targetUserId !== input.targetUserId || existing.amountPaise !== BigInt(input.amountPaise) || existing.reason !== input.reason) throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key belongs to a different credit request.');
    return { request: existing, replayed: true };
  }
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.targetUserId}::uuid FOR UPDATE`;
  const target = await tx.user.findUnique({ where: { id: input.targetUserId }, select: { id: true, publicId: true, phoneE164: true, status: true, adminRole: { select: { id: true } } } });
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'The credit target does not exist.');
  if (target.status !== 'ACTIVE' || target.adminRole) throw new HttpError(409, 'WALLET_CREDIT_TARGET_UNAVAILABLE', 'Credits can only be requested for an active, non-admin user.');
  const phoneMasked = `${target.phoneE164.slice(0, Math.max(0, target.phoneE164.length - 4)).replace(/\d/g, '*')}${target.phoneE164.slice(-4)}`;
  const balance = await tx.$queryRaw<Array<{ balance: bigint }>>`SELECT COALESCE(SUM(e.credit_paise - e.debit_paise), 0)::bigint AS balance FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id WHERE a.user_id = ${target.id}::uuid AND a.type::text = 'AVAILABLE'`;
  const currentBalancePaise = Number(balance[0]?.balance ?? 0n);
  if (target.publicId !== input.verifiedPublicId || phoneMasked !== input.verifiedPhoneMasked || !Number.isSafeInteger(input.verifiedWalletBalancePaise) || currentBalancePaise !== input.verifiedWalletBalancePaise) {
    throw new HttpError(409, 'WALLET_CREDIT_TARGET_CHANGED', 'The selected user identity or wallet balance changed. Refresh the user details and confirm again; no credit request was created.');
  }
  const request = await tx.adminWalletCreditRequest.create({ data: { targetUserId: target.id, makerUserId: input.makerUserId, amountPaise: BigInt(input.amountPaise), reason: input.reason, idempotencyKey: key } });
  await tx.auditLog.create({ data: { actorId: input.makerUserId, action: 'ADMIN_WALLET_CREDIT_REQUESTED', target: `ADMIN_WALLET_CREDIT_REQUEST:${request.id}`, reason: input.reason, metadata: { targetUserId: target.id, targetPublicId: target.publicId, targetPhoneMasked: phoneMasked, verifiedWalletBalancePaise: String(currentBalancePaise), amountPaise: String(input.amountPaise), status: 'PENDING_APPROVAL' } } });
  return { request, replayed: false };
}

export async function decideCreditRequest(tx: Prisma.TransactionClient, input: { requestId: string; checkerUserId: string; decision: 'APPROVE' | 'REJECT'; reason: string }) {
  await requireActiveSuperAdmin(tx, input.checkerUserId);
  await tx.$queryRaw`SELECT id FROM admin_wallet_credit_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`;
  const request = await tx.adminWalletCreditRequest.findUnique({ where: { id: input.requestId }, include: { targetUser: { select: { id: true, publicId: true, status: true, adminRole: { select: { id: true } } } } } });
  if (!request) throw new HttpError(404, 'CREDIT_REQUEST_NOT_FOUND', 'Credit request was not found.');
  if (request.status !== 'PENDING_APPROVAL') throw new HttpError(409, 'CREDIT_REQUEST_ALREADY_DECIDED', 'This credit request has already been decided.');
  if (request.makerUserId === input.checkerUserId) throw new HttpError(403, 'MAKER_CANNOT_CHECK', 'The person who requested a credit cannot approve or reject it.');
  const now = new Date();
  if (input.decision === 'REJECT') {
    const updated = await tx.adminWalletCreditRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', checkerUserId: input.checkerUserId, decisionReason: input.reason, decidedAt: now } });
    await tx.auditLog.create({ data: { actorId: input.checkerUserId, action: 'ADMIN_WALLET_CREDIT_REJECTED', target: `ADMIN_WALLET_CREDIT_REQUEST:${request.id}`, reason: input.reason, metadata: { makerUserId: request.makerUserId, amountPaise: String(request.amountPaise), ledgerTransactionId: null } } });
    return { request: updated, credit: null };
  }
  if (request.targetUser.status !== 'ACTIVE' || request.targetUser.adminRole) throw new HttpError(409, 'WALLET_CREDIT_TARGET_UNAVAILABLE', 'The target account is no longer eligible for credit.');
  const credit = await applySuperAdminWalletCredit(tx, { actorUserId: input.checkerUserId, idempotencyKey: request.id, targetUserId: request.targetUserId, amountPaise: Number(request.amountPaise), reason: request.reason });
  const updated = await tx.adminWalletCreditRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', checkerUserId: input.checkerUserId, decisionReason: input.reason, decidedAt: now, ledgerTransactionId: credit.id } });
  await tx.auditLog.create({ data: { actorId: input.checkerUserId, action: 'ADMIN_WALLET_CREDIT_APPROVED', target: `ADMIN_WALLET_CREDIT_REQUEST:${request.id}`, reason: input.reason, metadata: { makerUserId: request.makerUserId, targetUserId: request.targetUserId, amountPaise: String(request.amountPaise), ledgerTransactionId: credit.id } } });
  return { request: updated, credit };
}

export async function createFundingRequest(tx: Prisma.TransactionClient, input: {
  makerUserId: string; amountPaise: number; sourceAccountLabel: string; externalReference: string; evidenceReference: string; evidenceSha256: string; statementDate: Date; reason: string; idempotencyKey: string;
}) {
  await requireActiveSuperAdmin(tx, input.makerUserId);
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0 || input.amountPaise > 100_000_000_000) throw new HttpError(400, 'FUNDING_AMOUNT_INVALID', 'Funding request amount is outside the allowed range.');
  const externalReferenceHash = hashExternalReference(input.externalReference);
  const key = `ADMIN_WALLET_FUNDING:${input.makerUserId}:${input.idempotencyKey}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${externalReferenceHash}))`;
  const existing = await tx.adminWalletFundingRequest.findUnique({ where: { idempotencyKey: key }, select: { id: true, amountPaise: true, sourceAccountLabel: true, externalReferenceHash: true, evidenceReference: true, evidenceSha256: true, statementDate: true, reason: true } });
  if (existing) {
    const same = existing.amountPaise === BigInt(input.amountPaise) && existing.sourceAccountLabel === input.sourceAccountLabel && existing.externalReferenceHash === externalReferenceHash && existing.evidenceReference === input.evidenceReference && existing.evidenceSha256 === input.evidenceSha256 && existing.statementDate.getTime() === input.statementDate.getTime() && existing.reason === input.reason;
    if (!same) throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key belongs to a different funding request.');
    return { request: existing, replayed: true };
  }
  const duplicateReference = await tx.adminWalletFundingRequest.findUnique({ where: { externalReferenceHash }, select: { id: true } });
  if (duplicateReference) throw new HttpError(409, 'FUNDING_REFERENCE_ALREADY_USED', 'This bank statement reference has already been submitted.');
  const request = await tx.adminWalletFundingRequest.create({ data: { makerUserId: input.makerUserId, amountPaise: BigInt(input.amountPaise), sourceAccountLabel: input.sourceAccountLabel, externalReferenceHash, evidenceReference: input.evidenceReference, evidenceSha256: input.evidenceSha256, statementDate: input.statementDate, reason: input.reason, idempotencyKey: key } });
  await tx.auditLog.create({ data: { actorId: input.makerUserId, action: 'ADMIN_WALLET_FUNDING_REQUESTED', target: `ADMIN_WALLET_FUNDING_REQUEST:${request.id}`, reason: input.reason, metadata: { amountPaise: String(input.amountPaise), sourceAccountLabel: input.sourceAccountLabel, externalReferenceHash, evidenceReference: input.evidenceReference, evidenceSha256: input.evidenceSha256, statementDate: input.statementDate.toISOString().slice(0, 10) } } });
  return { request, replayed: false };
}

export async function decideFundingRequest(tx: Prisma.TransactionClient, input: { requestId: string; checkerUserId: string; decision: 'APPROVE' | 'REJECT'; reason: string; evidenceVerified: boolean }) {
  await requireActiveSuperAdmin(tx, input.checkerUserId);
  await tx.$queryRaw`SELECT id FROM admin_wallet_funding_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`;
  const request = await tx.adminWalletFundingRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new HttpError(404, 'FUNDING_REQUEST_NOT_FOUND', 'Funding request was not found.');
  if (request.status !== 'PENDING_APPROVAL') throw new HttpError(409, 'FUNDING_REQUEST_ALREADY_DECIDED', 'This funding request has already been decided.');
  if (request.makerUserId === input.checkerUserId) throw new HttpError(403, 'MAKER_CANNOT_CHECK', 'The person who submitted funding evidence cannot approve or reject it.');
  const now = new Date();
  if (input.decision === 'REJECT') {
    const updated = await tx.adminWalletFundingRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', checkerUserId: input.checkerUserId, decisionReason: input.reason, decidedAt: now } });
    await tx.auditLog.create({ data: { actorId: input.checkerUserId, action: 'ADMIN_WALLET_FUNDING_REJECTED', target: `ADMIN_WALLET_FUNDING_REQUEST:${request.id}`, reason: input.reason, metadata: { makerUserId: request.makerUserId, amountPaise: String(request.amountPaise), ledgerTransactionId: null } } });
    return { request: updated, ledgerTransactionId: null };
  }
  if (!input.evidenceVerified) throw new HttpError(409, 'FUNDING_EVIDENCE_NOT_VERIFIED', 'Checker must confirm the original bank statement and independently verify actual cleared funds.');
  const accounts = await tx.ledgerAccount.findMany({ where: { id: { in: [ADMIN_SETTLEMENT_CASH_ID, ADMIN_ADJUSTMENT_FUND_ID] } }, select: { id: true, type: true } });
  const cash = accounts.find((a) => a.id === ADMIN_SETTLEMENT_CASH_ID && a.type === 'SETTLEMENT_CASH');
  const adjustment = accounts.find((a) => a.id === ADMIN_ADJUSTMENT_FUND_ID && a.type === 'ADMIN_ADJUSTMENT_FUND');
  if (!cash || !adjustment) throw new HttpError(503, 'FUNDING_ACCOUNTS_UNAVAILABLE', 'The dedicated cash and adjustment accounts are not provisioned.');
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${cash.id}::uuid, ${adjustment.id}::uuid) ORDER BY id FOR UPDATE`;
  const ledger = await tx.ledgerTransaction.create({ data: {
    eventType: 'ADMIN_ADJUSTMENT_FUNDING', referenceType: 'ADMIN_WALLET_FUNDING_REQUEST', referenceId: request.id,
    idempotencyKey: `ADMIN_WALLET_FUNDING_APPROVAL:${request.id}`, actorUserId: input.checkerUserId,
    metadata: { makerUserId: request.makerUserId, checkerUserId: input.checkerUserId, amountPaise: String(request.amountPaise), sourceAccountLabel: request.sourceAccountLabel, externalReferenceHash: request.externalReferenceHash, evidenceReference: request.evidenceReference, evidenceSha256: request.evidenceSha256, statementDate: request.statementDate.toISOString().slice(0, 10), evidenceVerified: true },
    entries: { create: [{ accountId: cash.id, debitPaise: request.amountPaise }, { accountId: adjustment.id, creditPaise: request.amountPaise }] },
  }, select: { id: true, createdAt: true } });
  const updated = await tx.adminWalletFundingRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', checkerUserId: input.checkerUserId, decisionReason: input.reason, decidedAt: now, ledgerTransactionId: ledger.id } });
  await tx.auditLog.create({ data: { actorId: input.checkerUserId, action: 'ADMIN_WALLET_FUNDING_APPROVED', target: `ADMIN_WALLET_FUNDING_REQUEST:${request.id}`, reason: input.reason, metadata: { makerUserId: request.makerUserId, amountPaise: String(request.amountPaise), ledgerTransactionId: ledger.id, externalReferenceHash: request.externalReferenceHash, evidenceVerified: true } } });
  return { request: updated, ledgerTransactionId: ledger.id };
}
