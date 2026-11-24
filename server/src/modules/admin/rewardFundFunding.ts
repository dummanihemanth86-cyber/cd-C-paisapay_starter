import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http.js';
import { env } from '../../config/env.js';
import { requireActiveSuperAdmin, hashExternalReference, ADMIN_SETTLEMENT_CASH_ID } from './walletCreditWorkflow.js';
import { lockPaymentReference } from '../payments/paymentReferenceLock.js';
import { REWARD_FUND_ACCOUNT_ID } from '../payments/rewardWallet.js';
import { processPendingRewardAccruals } from '../payments/depositReward.js';

export { REWARD_FUND_ACCOUNT_ID };
const MAX_REWARD_FUNDING_PAISE = 100_000_000_000;

export type RecordRewardFundFundingInput = {
  verifiedByUserId: string;
  amountPaise: number;
  sourceAccountLabel: string;
  externalReference: string;
  evidenceReference: string;
  evidenceSha256?: string;
  statementDate: Date;
  reason: string;
  idempotencyKey: string;
  clearedFundsVerified: boolean;
  fundingRequestId?: string;
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
  const [fundingCount, totalFunded, rewardTotals, rewardLedger] = await Promise.all([
    db.rewardFundFundingRecord.count(),
    db.rewardFundFundingRecord.aggregate({ _sum: { amountPaise: true } }),
    db.rewardWallet.aggregate({ _sum: { pendingPaise: true, totalEarnedPaise: true } }),
    db.rewardLedgerEntry.aggregate({ where: { eventType: 'P2P_ORDER_REWARD' }, _sum: { amountPaise: true }, _count: { _all: true } }),
  ]);
  const [reconciliation] = await db.$queryRaw<Array<{ debits: bigint; credits: bigint }>>`
    SELECT
      COALESCE(SUM(CASE WHEN e.account_id = ${accountId}::uuid THEN e.debit_paise ELSE 0 END), 0)::bigint AS debits,
      COALESCE(SUM(CASE WHEN e.account_id = ${accountId}::uuid THEN e.credit_paise ELSE 0 END), 0)::bigint AS credits
    FROM ledger_entries e
    WHERE e.account_id = ${accountId}::uuid`;
  const ledgerBalancePaise = (reconciliation?.credits ?? 0n) - (reconciliation?.debits ?? 0n);
  const recordedFundingPaise = totalFunded._sum.amountPaise ?? 0n;
  const totalRewardsCreditedPaise = rewardLedger._sum.amountPaise ?? 0n;
  const rewardFundingLedgerDebit = await db.$queryRaw<Array<{ amount: bigint }>>`
    SELECT COALESCE(SUM(e.debit_paise), 0)::bigint AS amount
    FROM ledger_entries e
    JOIN ledger_transactions t ON t.id = e.transaction_id
    WHERE e.account_id = ${accountId}::uuid AND t.event_type = 'P2P_ORDER_REWARD'`;
  const reconciled = ledgerBalancePaise === recordedFundingPaise - (rewardFundingLedgerDebit[0]?.amount ?? 0n);
  const blockers = [
    ...(accountStatus !== 'PROVISIONED' ? [`Reward reserve account is ${accountStatus.toLowerCase()}.`] : []),
    ...(balancePaise <= 0n ? ['Reward reserve has no positive posted balance.'] : []),
    ...(env.p2pOrderRewardFundAccountId !== accountId ? ['P2P_ORDER_REWARD_FUND_ACCOUNT_ID is not explicitly mapped to the reserve account.'] : []),
    ...(!reconciled ? ['Reward reserve ledger does not reconcile to verified funding and reward allocations.'] : []),
    ...(!env.rewardFundReceiverVpa ? ['REWARD_FUND_RECEIVER_VPA is not configured; no UPI funding intent can be created.'] : []),
    ...(!env.rewardFundFundingEnabled ? ['REWARD_FUND_FUNDING_ENABLED is false.'] : []),
    ...(!env.p2pOrderRewardEnabled ? ['P2P_ORDER_REWARD_ENABLED is false.'] : []),
    ...(env.nodeEnv === 'production' && !env.isExplicitRenderStaging && !env.p2pOrderRewardProductionApproved ? ['Production reward approval is not recorded.'] : []),
    ...(env.nodeEnv === 'production' && !env.isExplicitRenderStaging && !env.p2pOrderRewardExternalReconciliationVerified ? ['External reward-fund reconciliation is not attested.'] : []),
  ];
  return {
    accountId,
    accountStatus,
    currency: 'INR',
    balancePaise: balancePaise.toString(),
    fundingRecords: fundingCount,
    recordedFundingPaise: recordedFundingPaise.toString(),
    totalFundedPaise: recordedFundingPaise.toString(),
    totalRewardsCreditedPaise: totalRewardsCreditedPaise.toString(),
    pendingRewardsPaise: (rewardTotals._sum.pendingPaise ?? 0n).toString(),
    rewardedOrders: rewardLedger._count._all,
    ledgerReconciled: reconciled,
    ledgerDiscrepancyPaise: (ledgerBalancePaise - (recordedFundingPaise - (rewardFundingLedgerDebit[0]?.amount ?? 0n))).toString(),
    fundingWorkflowEnabled: env.rewardFundFundingEnabled,
    fundingCanStart: env.rewardFundFundingEnabled && Boolean(env.rewardFundReceiverVpa),
    receiverVpa: env.rewardFundReceiverVpa ?? null,
    rewardEnabled: env.p2pOrderRewardEnabled,
    rewardRateBps: env.p2pOrderRewardPercentBps,
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
  const evidenceSha256 = input.evidenceSha256?.toLowerCase() ?? null;
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
      && existing.evidenceSha256 === evidenceSha256
      && existing.statementDate.getTime() === input.statementDate.getTime()
      && existing.reason === input.reason.trim();
    if (!same) throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key belongs to different reserve funding evidence.');
    const ledgerTransaction = await tx.ledgerTransaction.findUnique({
      where: { id: existing.ledgerTransactionId },
      select: { id: true, createdAt: true },
    });
    if (!ledgerTransaction) throw new HttpError(500, 'REWARD_FUNDING_LEDGER_MISSING', 'The recorded funding entry has no matching ledger transaction. No additional funding was posted.');
    return { record: existing, ledgerTransaction, replayed: true };
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
      evidenceSha256,
      statementDate: input.statementDate.toISOString().slice(0, 10),
      verifiedByUserId: input.verifiedByUserId,
      clearedFundsVerified: true,
      rewardFundAccountId: rewardFund.id,
      fundingRequestId: input.fundingRequestId ?? null,
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
    evidenceSha256,
    statementDate: input.statementDate,
    reason: input.reason.trim(),
    idempotencyKey,
    ledgerTransactionId: ledger.id,
    fundingRequestId: input.fundingRequestId,
  } });
  await tx.auditLog.create({ data: {
    actorId: input.verifiedByUserId,
    action: 'REWARD_FUNDING_RECONCILED',
    target: `REWARD_FUND_FUNDING_RECORD:${record.id}`,
    reason: input.reason.trim(),
    metadata: { amountPaise: String(input.amountPaise), currency: 'INR', externalReferenceHash, evidenceReference: input.evidenceReference.trim(), evidenceSha256, statementDate: input.statementDate.toISOString().slice(0, 10), ledgerTransactionId: ledger.id, rewardFundAccountId: rewardFund.id, fundingRequestId: input.fundingRequestId ?? null },
  } });
  return { record, ledgerTransaction: ledger, replayed: false };
}

function normalizedReferenceHash(reference: string) {
  return hashExternalReference(reference.trim().normalize('NFKC').toUpperCase());
}

function maskPaymentReference(reference: string) {
  const compact = reference.trim().replace(/\s+/g, '');
  return `••••${compact.slice(-4)}`;
}

export async function createRewardFundFundingRequest(tx: Prisma.TransactionClient, input: {
  makerUserId: string; amountPaise: number; reason: string; idempotencyKey: string;
}) {
  if (!env.rewardFundFundingEnabled) throw new HttpError(503, 'REWARD_FUNDING_DISABLED', 'Reward reserve funding is disabled on this server. No payment request was created.');
  if (!env.rewardFundReceiverVpa) throw new HttpError(503, 'REWARD_FUND_RECIPIENT_NOT_CONFIGURED', 'The reward-fund UPI recipient is not configured. No payment request was created.');
  await requireActiveSuperAdmin(tx, input.makerUserId);
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 100 || input.amountPaise > MAX_REWARD_FUNDING_PAISE) {
    throw new HttpError(400, 'REWARD_FUNDING_AMOUNT_INVALID', 'Funding amount must be at least ₹1 and within the supported limit.');
  }
  const idempotencyKey = `REWARD_FUND_REQUEST:${input.makerUserId}:${input.idempotencyKey}`;
  const existing = await tx.rewardFundFundingRequest.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.amountPaise !== BigInt(input.amountPaise) || existing.recipientVpa !== env.rewardFundReceiverVpa || existing.reason !== input.reason.trim()) {
      throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key belongs to another reward funding request.');
    }
    return { request: existing, replayed: true };
  }
  const request = await tx.rewardFundFundingRequest.create({ data: {
    makerUserId: input.makerUserId,
    amountPaise: BigInt(input.amountPaise),
    recipientVpa: env.rewardFundReceiverVpa,
    reason: input.reason.trim(),
    status: 'PENDING_PAYMENT',
    idempotencyKey,
  } });
  await tx.auditLog.create({ data: {
    actorId: input.makerUserId,
    action: 'REWARD_FUNDING_PAYMENT_REQUEST_CREATED',
    target: `REWARD_FUND_FUNDING_REQUEST:${request.id}`,
    reason: input.reason.trim(),
    metadata: { amountPaise: String(input.amountPaise), recipientVpa: request.recipientVpa, status: request.status, paymentIntent: 'UPI_INTENT_ONLY_NO_FUNDS_POSTED' },
  } });
  return { request, replayed: false };
}

/** Store only a normalized hash and short mask of a claimed UPI reference. */
export async function submitRewardFundFundingPayment(tx: Prisma.TransactionClient, input: {
  requestId: string; makerUserId: string; paymentReference: string; statementDate: Date;
}) {
  if (!env.rewardFundFundingEnabled) throw new HttpError(503, 'REWARD_FUNDING_DISABLED', 'Reward reserve funding is disabled. No funding was recorded.');
  await requireActiveSuperAdmin(tx, input.makerUserId);
  const externalReference = input.paymentReference.trim().normalize('NFKC');
  if (externalReference.length < 6 || externalReference.length > 200) throw new HttpError(400, 'REWARD_FUNDING_REFERENCE_INVALID', 'Enter the UPI transaction reference shown in the receiver-side history.');
  await lockPaymentReference(tx, externalReference);
  await tx.$queryRaw`SELECT id FROM reward_fund_funding_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`;
  const request = await tx.rewardFundFundingRequest.findUnique({ where: { id: input.requestId } });
  if (!request || request.makerUserId !== input.makerUserId) throw new HttpError(404, 'REWARD_FUNDING_REQUEST_NOT_FOUND', 'Reward funding request was not found.');
  const referenceHash = normalizedReferenceHash(externalReference);
  if (request.status !== 'PENDING_PAYMENT') {
    if (request.paymentReferenceHash === referenceHash) return { request, replayed: true };
    throw new HttpError(409, 'REWARD_FUNDING_REQUEST_NOT_PENDING', 'This funding request has already been submitted or decided.');
  }
  const hashVariants = [...new Set([referenceHash, hashExternalReference(externalReference)])];
  const [reserveRecord, walletFunding, phonePeCredit, anotherRequest, reusedPaymentReference] = await Promise.all([
    tx.rewardFundFundingRecord.findFirst({ where: { externalReferenceHash: { in: hashVariants } }, select: { id: true } }),
    tx.adminWalletFundingRequest.findFirst({ where: { externalReferenceHash: { in: hashVariants } }, select: { id: true } }),
    tx.adminPhonePeCreditRequest.findFirst({ where: { paymentReferenceHash: { in: hashVariants } }, select: { id: true } }),
    tx.rewardFundFundingRequest.findFirst({ where: { paymentReferenceHash: referenceHash, id: { not: request.id } }, select: { id: true } }),
    tx.$queryRaw<Array<{ reused: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM manual_payment_claims WHERE lower(btrim(transaction_reference)) = lower(btrim(${externalReference}))
        UNION ALL SELECT 1 FROM p2p_payment_claims WHERE lower(btrim(transaction_reference)) = lower(btrim(${externalReference}))
        UNION ALL SELECT 1 FROM p2p_seller_payment_confirmations WHERE lower(btrim(transaction_reference)) = lower(btrim(${externalReference}))
        UNION ALL SELECT 1 FROM p2p_deposit_orders WHERE lower(btrim(provider_reference)) = lower(btrim(${externalReference}))
        UNION ALL SELECT 1 FROM deposits WHERE lower(btrim(provider_reference)) = lower(btrim(${externalReference}))
      ) AS reused
    `,
  ]);
  if (reserveRecord || walletFunding || phonePeCredit || anotherRequest || reusedPaymentReference[0]?.reused) {
    throw new HttpError(409, 'REWARD_FUNDING_REFERENCE_ALREADY_USED', 'This transaction reference is already associated with another financial record. No reward funding was posted.');
  }
  const updated = await tx.rewardFundFundingRequest.update({ where: { id: request.id }, data: {
    status: 'PENDING_VERIFICATION',
    paymentReferenceHash: referenceHash,
    paymentReferenceMasked: maskPaymentReference(externalReference),
    statementDate: input.statementDate,
    evidenceReference: 'Receiver-side UPI history; manual Super Admin verification required',
    submittedAt: new Date(),
  } });
  await tx.auditLog.create({ data: {
    actorId: input.makerUserId,
    action: 'REWARD_FUNDING_PAYMENT_SUBMITTED',
    target: `REWARD_FUND_FUNDING_REQUEST:${request.id}`,
    reason: request.reason,
    metadata: { amountPaise: String(request.amountPaise), recipientVpa: request.recipientVpa, paymentReferenceHash: referenceHash, paymentReferenceMasked: updated.paymentReferenceMasked, status: updated.status, receiverVerified: false },
  } });
  return { request: updated, replayed: false };
}

export async function decideRewardFundFundingRequest(tx: Prisma.TransactionClient, input: {
  requestId: string; verifierUserId: string; decision: 'VERIFY' | 'REJECT'; reason: string;
  paymentReference?: string; receivedAmountPaise?: number; receivedVpa?: string; receiverConfirmed?: boolean;
}) {
  if (!env.rewardFundFundingEnabled) throw new HttpError(503, 'REWARD_FUNDING_DISABLED', 'Reward reserve funding is disabled. No funding or reward was posted.');
  await requireActiveSuperAdmin(tx, input.verifierUserId);
  await tx.$queryRaw`SELECT id FROM reward_fund_funding_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`;
  const request = await tx.rewardFundFundingRequest.findUnique({ where: { id: input.requestId }, include: { fundingRecord: true } });
  if (!request) throw new HttpError(404, 'REWARD_FUNDING_REQUEST_NOT_FOUND', 'Reward funding request was not found.');
  if (request.status === 'VERIFIED' && input.decision === 'VERIFY') return { request, record: request.fundingRecord, replayed: true, pendingRewardsProcessed: 0, pendingRewardPaise: 0n };
  if (request.status === 'REJECTED' && input.decision === 'REJECT') return { request, record: null, replayed: true, pendingRewardsProcessed: 0, pendingRewardPaise: 0n };
  if (!['PENDING_PAYMENT', 'PENDING_VERIFICATION'].includes(request.status)) throw new HttpError(409, 'REWARD_FUNDING_REQUEST_ALREADY_DECIDED', 'This reward-funding request has already been decided.');
  if (input.decision === 'REJECT') {
    const updated = await tx.rewardFundFundingRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', verifiedByUserId: input.verifierUserId, decisionReason: input.reason.trim(), decidedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: input.verifierUserId, action: 'REWARD_FUNDING_REJECTED', target: `REWARD_FUND_FUNDING_REQUEST:${request.id}`, reason: input.reason.trim(), metadata: { amountPaise: String(request.amountPaise), paymentReferenceHash: request.paymentReferenceHash, ledgerTransactionId: null } } });
    return { request: updated, record: null, replayed: false, pendingRewardsProcessed: 0, pendingRewardPaise: 0n };
  }
  if (request.status !== 'PENDING_VERIFICATION' || !request.paymentReferenceHash || !input.paymentReference) {
    throw new HttpError(409, 'REWARD_FUNDING_PAYMENT_NOT_SUBMITTED', 'Submit a payment reference before verifying the received funds.');
  }
  const submittedReference = input.paymentReference.trim().normalize('NFKC');
  if (normalizedReferenceHash(submittedReference) !== request.paymentReferenceHash) throw new HttpError(409, 'REWARD_FUNDING_REFERENCE_MISMATCH', 'The entered reference differs from the submitted payment reference.');
  if (input.receivedAmountPaise !== Number(request.amountPaise)) throw new HttpError(409, 'REWARD_FUNDING_AMOUNT_MISMATCH', 'The receiver-side UPI history must show the exact requested amount.');
  if (!input.receivedVpa || input.receivedVpa.trim().toLowerCase() !== request.recipientVpa.toLowerCase() || request.recipientVpa.toLowerCase() !== env.rewardFundReceiverVpa?.toLowerCase()) {
    throw new HttpError(409, 'REWARD_FUNDING_RECIPIENT_MISMATCH', 'The receiver-side transaction must match the configured reward-fund UPI ID.');
  }
  if (input.receiverConfirmed !== true) throw new HttpError(409, 'REWARD_FUNDING_RECEIPT_NOT_CONFIRMED', 'Confirm that the exact cleared credit appears in receiver-side UPI history.');
  const result = await recordRewardFundFunding(tx, {
    verifiedByUserId: input.verifierUserId,
    amountPaise: Number(request.amountPaise),
    sourceAccountLabel: 'ADMIN_UPI_RECEIPT',
    externalReference: submittedReference,
    evidenceReference: request.evidenceReference ?? 'Receiver-side UPI history manually verified by Super Admin',
    statementDate: request.statementDate ?? new Date(),
    reason: input.reason.trim(),
    idempotencyKey: request.id,
    clearedFundsVerified: true,
    fundingRequestId: request.id,
  });
  const updated = await tx.rewardFundFundingRequest.update({ where: { id: request.id }, data: { status: 'VERIFIED', verifiedByUserId: input.verifierUserId, decisionReason: input.reason.trim(), ledgerTransactionId: result.ledgerTransaction.id, decidedAt: new Date() } });
  await tx.auditLog.create({ data: { actorId: input.verifierUserId, action: 'REWARD_FUNDING_VERIFIED', target: `REWARD_FUND_FUNDING_REQUEST:${request.id}`, reason: input.reason.trim(), metadata: { amountPaise: String(request.amountPaise), paymentReferenceHash: request.paymentReferenceHash, paymentReferenceMasked: request.paymentReferenceMasked, recipientVpa: request.recipientVpa, verificationMethod: 'MANUAL_RECEIVER_SIDE_HISTORY', ledgerTransactionId: result.ledgerTransaction.id, fundingRecordId: result.record.id } } });
  const pending = await processPendingRewardAccruals(tx, input.verifierUserId);
  return { request: updated, record: result.record, replayed: result.replayed, pendingRewardsProcessed: pending.processed, pendingRewardPaise: pending.creditedPaise };
}

export async function readRewardFundDashboard(db: PrismaClient) {
  const readiness = await readRewardFundReadiness(db);
  const [requests, fundings, rewards] = await Promise.all([
    db.rewardFundFundingRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { maker: { select: { publicId: true, displayName: true } }, verifiedBy: { select: { publicId: true, displayName: true } } } }),
    db.rewardFundFundingRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { verifiedBy: { select: { publicId: true, displayName: true } }, ledgerTransaction: { select: { id: true, createdAt: true } } } }),
    db.rewardLedgerEntry.findMany({ where: { referenceType: 'P2P_DEPOSIT_ORDER' }, orderBy: { createdAt: 'desc' }, take: 100, include: { wallet: { include: { user: { select: { publicId: true, displayName: true } } } } } }),
  ]);
  return {
    readiness,
    requests: requests.map(({ paymentReferenceHash: _hash, ...row }) => ({ ...row, amountPaise: Number(row.amountPaise), maker: { publicId: row.maker.publicId, displayName: row.maker.displayName }, verifiedBy: row.verifiedBy ? { publicId: row.verifiedBy.publicId, displayName: row.verifiedBy.displayName } : null })),
    fundings: fundings.map(({ externalReferenceHash: _hash, evidenceSha256: _sha, ...row }) => ({ ...row, amountPaise: Number(row.amountPaise), verifiedBy: { publicId: row.verifiedBy.publicId, displayName: row.verifiedBy.displayName } })),
    rewards: rewards.map((row) => ({ id: row.id, source: row.eventType, referenceId: row.referenceId, amountPaise: Number(row.amountPaise), status: row.eventType.includes('PENDING') ? 'PENDING_FUNDING' : row.eventType.includes('REVERSED') ? 'REVERSED' : 'CREDITED', user: { publicId: row.wallet.user.publicId, displayName: row.wallet.user.displayName }, createdAt: row.createdAt })),
  };
}
