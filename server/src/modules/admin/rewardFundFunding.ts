import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http.js';
import { env } from '../../config/env.js';
import { requireActiveSuperAdmin, hashExternalReference, ADMIN_SETTLEMENT_CASH_ID } from './walletCreditWorkflow.js';
import { lockPaymentReference } from '../payments/paymentReferenceLock.js';

/** Stable production ledger bucket; it starts at zero and is funded only from verified receipts. */
export const REWARD_FUND_ACCOUNT_ID = '00000000-0000-4000-8000-000000000103';
const MAX_REWARD_FUNDING_PAISE = 100_000_000_000;

export type RecordRewardFundFundingInput = {
  verifiedByUserId: string;
  amountPaise: number;
  sourceAccountLabel: string;
  externalReference: string;
  evidenceReference: string;
  evidenceSha256: string;
  statementDate: Date;
  reason: string;
  idempotencyKey: string;
  clearedFundsVerified: boolean;
};

export async function readRewardFundReadiness(db: PrismaClient) {
  const accountId = env.p2pOrderRewardFundAccountId || REWARD_FUND_ACCOUNT_ID;
  const rows = await db.$queryRaw<Array<{ id: string | null; type: string | null; currency: string | null; balance: bigint | null }>>`
    SELECT a.id::text AS id, a.type::text AS type, a.currency,
           COALESCE(SUM(e.credit_paise - e.debit_paise), 0)::bigint AS balance
      FROM (SELECT ${accountId}::uuid AS id) expected
      LEFT JOIN ledger_accounts a ON a.id = expected.id
      LEFT JOIN ledger_entries e ON e.account_id = a.id
     GROUP BY a.id, a.type, a.currency`;
  const account = rows[0];
  const balancePaise = account?.balance ?? 0n;
  const accountStatus = !account?.id ? 'MISSING' : account.type !== 'REWARD_FUND' || account.currency !== 'INR' ? 'INVALID' : 'PROVISIONED';
  const [fundingCount, totalFunded] = await Promise.all([
    db.rewardFundFundingRecord.count(),
    db.rewardFundFundingRecord.aggregate({ _sum: { amountPaise: true } }),
  ]);
  const blockers = [
    ...(accountStatus !== 'PROVISIONED' ? [`Reward reserve account is ${accountStatus.toLowerCase()}.`] : []),
    ...(balancePaise <= 0n ? ['Reward reserve has no positive posted balance.'] : []),
    ...(env.p2pOrderRewardFundAccountId !== accountId ? ['P2P_ORDER_REWARD_FUND_ACCOUNT_ID is not explicitly mapped to the reserve account.'] : []),
    ...(!env.p2pOrderRewardEnabled ? ['P2P_ORDER_REWARD_ENABLED is false.'] : []),
    ...(env.nodeEnv === 'production' && !env.p2pOrderRewardProductionApproved ? ['Production reward approval is not recorded.'] : []),
    ...(env.nodeEnv === 'production' && !env.p2pOrderRewardExternalReconciliationVerified ? ['External reward-fund reconciliation is not attested.'] : []),
  ];
  return {
    accountId,
    accountStatus,
    currency: 'INR',
    balancePaise: balancePaise.toString(),
    fundingRecords: fundingCount,
    recordedFundingPaise: (totalFunded._sum.amountPaise ?? 0n).toString(),
    fundingWorkflowEnabled: env.rewardFundFundingEnabled,
    rewardEnabled: env.p2pOrderRewardEnabled,
    rewardRateBps: 620,
    activationReady: blockers.length === 0,
    blockers,
  };
}

/**
 * Book a manually verified, cleared company funding receipt into the reward
 * reserve. The Admin's confirmation is an assertion, not provider verification;
 * callers must keep the funding gate off until their reconciliation process is ready.
 */
export async function recordRewardFundFunding(tx: Prisma.TransactionClient, input: RecordRewardFundFundingInput) {
  if (!env.rewardFundFundingEnabled) throw new HttpError(503, 'REWARD_FUNDING_DISABLED', 'Reward reserve funding is disabled on this server. No ledger entry was created.');
  await requireActiveSuperAdmin(tx, input.verifiedByUserId);
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0 || input.amountPaise > MAX_REWARD_FUNDING_PAISE) {
    throw new HttpError(400, 'REWARD_FUNDING_AMOUNT_INVALID', 'Funding amount must be positive and within the supported limit.');
  }
  if (!input.clearedFundsVerified) throw new HttpError(409, 'REWARD_FUND_EVIDENCE_NOT_VERIFIED', 'Confirm that the exact funds have cleared into a PaisaPay company account before recording them.');

  const externalReference = input.externalReference.trim().normalize('NFKC');
  const externalReferenceHash = hashExternalReference(externalReference);
  const idempotencyKey = `REWARD_FUND_FUNDING:${input.verifiedByUserId}:${input.idempotencyKey}`;
  // Use the same lock key as deposits and P2P claims so a payment UTR cannot
  // be concurrently recorded as reward funding while it is being approved.
  await lockPaymentReference(tx, externalReference);

  const existing = await tx.rewardFundFundingRecord.findUnique({ where: { idempotencyKey } });
  if (existing) {
    const same = existing.amountPaise === BigInt(input.amountPaise)
      && existing.sourceAccountLabel === input.sourceAccountLabel.trim()
      && existing.externalReferenceHash === externalReferenceHash
      && existing.evidenceReference === input.evidenceReference.trim()
      && existing.evidenceSha256 === input.evidenceSha256.toLowerCase()
      && existing.statementDate.getTime() === input.statementDate.getTime()
      && existing.reason === input.reason.trim();
    if (!same) throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key belongs to different reserve funding evidence.');
    return { record: existing, replayed: true };
  }

  const [sameReserveReference, sameAdminFundingReference, reusedPaymentReference] = await Promise.all([
    tx.rewardFundFundingRecord.findUnique({ where: { externalReferenceHash }, select: { id: true } }),
    tx.adminWalletFundingRequest.findUnique({ where: { externalReferenceHash }, select: { id: true } }),
    tx.$queryRaw<Array<{ reused: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM manual_payment_claims WHERE lower(btrim(transaction_reference)) = lower(btrim(${externalReference}))
        UNION ALL SELECT 1 FROM p2p_payment_claims WHERE lower(btrim(transaction_reference)) = lower(btrim(${externalReference}))
        UNION ALL SELECT 1 FROM p2p_seller_payment_confirmations WHERE lower(btrim(transaction_reference)) = lower(btrim(${externalReference}))
        UNION ALL SELECT 1 FROM p2p_deposit_orders WHERE lower(btrim(provider_reference)) = lower(btrim(${externalReference}))
      ) AS reused
    `,
  ]);
  if (sameReserveReference || sameAdminFundingReference || reusedPaymentReference[0]?.reused) {
    throw new HttpError(409, 'REWARD_FUNDING_REFERENCE_ALREADY_USED', 'This external transaction reference is already recorded for another payment or funding entry.');
  }

  const rewardFundAccountId = env.p2pOrderRewardFundAccountId || REWARD_FUND_ACCOUNT_ID;
  const [cash, rewardFund] = await Promise.all([
    tx.ledgerAccount.upsert({ where: { id: ADMIN_SETTLEMENT_CASH_ID }, create: { id: ADMIN_SETTLEMENT_CASH_ID, type: 'SETTLEMENT_CASH', currency: 'INR' }, update: {} }),
    tx.ledgerAccount.upsert({ where: { id: rewardFundAccountId }, create: { id: rewardFundAccountId, type: 'REWARD_FUND', currency: 'INR' }, update: {} }),
  ]);
  if (cash.type !== 'SETTLEMENT_CASH' || cash.currency !== 'INR' || rewardFund.type !== 'REWARD_FUND' || rewardFund.currency !== 'INR') {
    throw new HttpError(503, 'REWARD_FUND_ACCOUNTS_INVALID', 'The configured INR cash or reward reserve ledger account is invalid. No funding was posted.');
  }
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${cash.id}::uuid, ${rewardFund.id}::uuid) ORDER BY id FOR UPDATE`;
  const [cashBalance] = await tx.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(debit_paise - credit_paise), 0)::bigint AS balance
      FROM ledger_entries WHERE account_id = ${cash.id}::uuid`;
  if (!cashBalance || cashBalance.balance < BigInt(input.amountPaise)) {
    throw new HttpError(409, 'REWARD_FUND_SOURCE_INSUFFICIENT', 'The cleared settlement cash ledger does not cover this reward-fund transfer. No funding or wallet credit was posted.');
  }

  const recordId = randomUUID();
  const ledger = await tx.ledgerTransaction.create({ data: {
    eventType: 'REWARD_FUNDING',
    referenceType: 'REWARD_FUND_FUNDING_RECORD',
    referenceId: recordId,
    idempotencyKey: `REWARD_FUNDING:${recordId}`,
    actorUserId: input.verifiedByUserId,
    metadata: {
      amountPaise: String(input.amountPaise),
      currency: 'INR',
      sourceAccountLabel: input.sourceAccountLabel.trim(),
      externalReferenceHash,
      evidenceReference: input.evidenceReference.trim(),
      evidenceSha256: input.evidenceSha256.toLowerCase(),
      statementDate: input.statementDate.toISOString().slice(0, 10),
      verifiedByUserId: input.verifiedByUserId,
      clearedFundsVerified: true,
      rewardFundAccountId: rewardFund.id,
    },
    entries: { create: [
      { accountId: cash.id, debitPaise: BigInt(input.amountPaise) },
      { accountId: rewardFund.id, creditPaise: BigInt(input.amountPaise) },
    ] },
  }, select: { id: true, createdAt: true } });

  const record = await tx.rewardFundFundingRecord.create({ data: {
    id: recordId,
    verifiedByUserId: input.verifiedByUserId,
    amountPaise: BigInt(input.amountPaise),
    sourceAccountLabel: input.sourceAccountLabel.trim(),
    externalReferenceHash,
    evidenceReference: input.evidenceReference.trim(),
    evidenceSha256: input.evidenceSha256.toLowerCase(),
    statementDate: input.statementDate,
    reason: input.reason.trim(),
    idempotencyKey,
    ledgerTransactionId: ledger.id,
  } });
  await tx.auditLog.create({ data: {
    actorId: input.verifiedByUserId,
    action: 'REWARD_FUNDING_RECONCILED',
    target: `REWARD_FUND_FUNDING_RECORD:${record.id}`,
    reason: input.reason.trim(),
    metadata: { amountPaise: String(input.amountPaise), currency: 'INR', externalReferenceHash, evidenceReference: input.evidenceReference.trim(), evidenceSha256: input.evidenceSha256.toLowerCase(), statementDate: input.statementDate.toISOString().slice(0, 10), ledgerTransactionId: ledger.id, rewardFundAccountId: rewardFund.id },
  } });
  return { record, ledgerTransaction: ledger, replayed: false };
}
