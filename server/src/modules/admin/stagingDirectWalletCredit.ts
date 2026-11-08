import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http.js';
import { applySuperAdminWalletCredit, MAX_ADMIN_ADJUSTMENT_PAISE, MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE } from './walletAdjustment.js';

const maskPhone = (phone: string) => `${phone.slice(0, Math.max(0, phone.length - 4)).replace(/\d/g, '*')}${phone.slice(-4)}`;

export async function createStagingDirectCredit(tx: Prisma.TransactionClient, input: {
  actorUserId: string;
  idempotencyKey: string;
  targetUserId: string;
  verifiedPublicId: string;
  verifiedPhoneMasked: string;
  verifiedWalletBalancePaise: number;
  amountPaise: number;
  reason: string;
}) {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE || input.amountPaise > MAX_ADMIN_ADJUSTMENT_PAISE) {
    throw new HttpError(400, 'WALLET_CREDIT_AMOUNT_INVALID', 'Credit amount must be an integer from ₹100 to ₹10,000.');
  }
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.actorUserId}::uuid FOR UPDATE`;
  const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: { id: true, status: true, adminRole: { select: { role: true } } } });
  if (!actor || actor.status !== 'ACTIVE' || actor.adminRole?.role !== 'SUPER_ADMIN') {
    throw new HttpError(403, 'SUPER_ADMIN_REQUIRED', 'An active SUPER_ADMIN account is required.');
  }

  const requestKey = `ADMIN_STAGING_DIRECT:${input.actorUserId}:${input.idempotencyKey}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))`;
  let request = await tx.adminWalletCreditRequest.findUnique({ where: { idempotencyKey: requestKey } });
  if (request) {
    if (request.targetUserId !== input.targetUserId || request.amountPaise !== BigInt(input.amountPaise) || request.reason !== input.reason) {
      throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key belongs to a different staging credit.');
    }
    if (request.status !== 'APPROVED' || !request.ledgerTransactionId) {
      throw new HttpError(409, 'STAGING_CREDIT_INCOMPLETE', 'The prior direct credit record is incomplete. Review its audit and ledger state; do not retry with a new key.');
    }
  } else {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.targetUserId}::uuid FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: input.targetUserId }, select: { id: true, publicId: true, phoneE164: true, status: true, adminRole: { select: { id: true } } } });
    if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'The credit target does not exist.');
    if (target.status !== 'ACTIVE' || target.adminRole || !target.publicId) {
      throw new HttpError(409, 'WALLET_CREDIT_TARGET_UNAVAILABLE', 'Direct staging credits require an active, non-admin user with a public ID.');
    }
    const phoneMasked = maskPhone(target.phoneE164);
    const balances = await tx.$queryRaw<Array<{ balance: bigint }>>`
      SELECT COALESCE(SUM(e.credit_paise - e.debit_paise), 0)::bigint AS balance
      FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
      WHERE a.user_id = ${target.id}::uuid AND a.type::text = 'AVAILABLE'`;
    const currentBalancePaise = Number(balances[0]?.balance ?? 0n);
    if (target.publicId !== input.verifiedPublicId || phoneMasked !== input.verifiedPhoneMasked ||
      !Number.isSafeInteger(input.verifiedWalletBalancePaise) || currentBalancePaise !== input.verifiedWalletBalancePaise) {
      throw new HttpError(409, 'WALLET_CREDIT_TARGET_CHANGED', 'The selected user identity or wallet balance changed. Refresh the details and confirm again; no credit was posted.');
    }
    request = await tx.adminWalletCreditRequest.create({ data: {
      targetUserId: target.id,
      makerUserId: input.actorUserId,
      amountPaise: BigInt(input.amountPaise),
      reason: input.reason,
      status: 'APPROVED',
      idempotencyKey: requestKey,
      decisionReason: 'Authorized direct staging credit; maker-checker approval is not used on the isolated staging service.',
      decidedAt: new Date(),
    } });
  }

  const credit = await applySuperAdminWalletCredit(tx, {
    actorUserId: input.actorUserId,
    idempotencyKey: request.id,
    targetUserId: input.targetUserId,
    amountPaise: input.amountPaise,
    reason: input.reason,
  });
  if (!request.ledgerTransactionId) {
    request = await tx.adminWalletCreditRequest.update({
      where: { id: request.id },
      data: { ledgerTransactionId: credit.id, decidedAt: new Date() },
    });
    await tx.auditLog.create({ data: {
      actorId: input.actorUserId,
      action: 'ADMIN_STAGING_DIRECT_WALLET_CREDIT',
      target: `USER:${input.targetUserId}`,
      reason: input.reason,
      metadata: {
        stagingOnly: true,
        makerCheckerBypassed: true,
        creditRequestId: request.id,
        ledgerTransactionId: credit.id,
        targetPublicId: input.verifiedPublicId,
        targetPhoneMasked: input.verifiedPhoneMasked,
        amountPaise: String(input.amountPaise),
        balancePaise: String(credit.balancePaise),
      },
    } });
  }
  return { request, credit, replayed: credit.replayed };
}
