import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http.js';
import { env } from '../../config/env.js';
import { requireActiveSuperAdmin, hashExternalReference, ADMIN_SETTLEMENT_CASH_ID } from './walletCreditWorkflow.js';
import { lockPaymentReference } from '../payments/paymentReferenceLock.js';
import { REWARD_FUND_ACCOUNT_ID } from '../payments/rewardWallet.js';
import { processPendingRewardAccruals } from '../payments/depositReward.js';
import { assertIndependentFundingVerifier } from '../payments/rewardSafety.js';
import { inspectRewardReserve } from '../payments/rewardReserve.js';

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
  fundingRequestId: string;
  makerUserId: string;
};

export async function readRewardFundReadiness(db: PrismaClient) {
  const reserve = await inspectRewardReserve(db);
  const accountId = reserve.configuredAccountId || REWARD_FUND_ACCOUNT_ID;
  const balancePaise = reserve.balancePaise;
  const [fundingCount, totalFunded, rewardTotals, rewardLedger] = await Promise.all([
    db.rewardFundFundingRecord.count(),
    db.rewardFundFundingRecord.aggregate({ _sum: { amountPaise: true } }),
    db.rewardWallet.aggregate({ _sum: { pendingPaise: true, totalEarnedPaise: true } }),
    db.rewardLedgerEntry.aggregate({ where: { eventType: 'P2P_ORDER_REWARD' }, _sum: { amountPaise: true }, _count: { _all: true } }),
  ]);
  const recordedFundingPaise = totalFunded._sum.amountPaise ?? 0n;
  const totalRewardsCreditedPaise = rewardLedger._sum.amountPaise ?? 0n;
  const fundingIntakeBlockers = [
    ...(!env.rewardFundFundingEnabled ? ['REWARD_FUND_FUNDING_ENABLED is false.'] : []),
    ...(!env.rewardFundReceiverVpa ? ['REWARD_FUND_RECEIVER_VPA is not configured; no UPI funding intent can be created.'] : []),
  ];
  const rewardBlockers = [
    ...reserve.blockers,
    ...(!env.rewardFundFundingEnabled ? ['REWARD_FUND_FUNDING_ENABLED is false; reward credit and release are blocked.'] : []),
    ...(!env.p2pOrderRewardEnabled ? ['P2P_ORDER_REWARD_ENABLED is false.'] : []),
    ...(balancePaise <= 0n ? ['Reward reserve has no positive posted balance.'] : []),
    ...(env.nodeEnv === 'production' && !env.isExplicitRenderStaging && !env.p2pOrderRewardProductionApproved ? ['Production reward approval is not recorded.'] : []),
    ...(env.nodeEnv === 'production' && !env.isExplicitRenderStaging && !env.p2pOrderRewardExternalReconciliationVerified ? ['External reward-fund reconciliation is not attested.'] : []),
  ];
  return {
    accountId,
    accountStatus: reserve.accountStatus,
    currency: 'INR',
    balancePaise: balancePaise.toString(),
    fundingRecords: fundingCount,
    recordedFundingPaise: recordedFundingPaise.toString(),
    totalFundedPaise: recordedFundingPaise.toString(),
    totalRewardsCreditedPaise: totalRewardsCreditedPaise.toString(),
    pendingRewardsPaise: (rewardTotals._sum.pendingPaise ?? 0n).toString(),
    rewardedOrders: rewardLedger._count._all,
    ledgerReconciled: reserve.reconciled,
    ledgerDiscrepancyPaise: (balancePaise - (recordedFundingPaise - reserve.rewardFundDebitPaise)).toString(),
    reserveIntegrity: { status: reserve.reconciled ? 'RECONCILED' : 'BLOCKED', blockers: reserve.blockers, fundingJournalMismatchCount: reserve.fundingJournalMismatchCount, rewardJournalMismatchCount: reserve.rewardJournalMismatchCount },
    fundingIntake: { status: fundingIntakeBlockers.length ? 'BLOCKED' : 'READY', enabled: env.rewardFundFundingEnabled, canStart: fundingIntakeBlockers.length === 0, blockers: fundingIntakeBlockers },
    rewardPosting: { status: rewardBlockers.length ? 'BLOCKED' : 'READY', enabled: env.p2pOrderRewardEnabled && env.rewardFundFundingEnabled, blockers: rewardBlockers },
    fundingWorkflowEnabled: env.rewardFundFundingEnabled,
    fundingCanStart: fundingIntakeBlockers.length === 0,
    receiverVpa: env.rewardFundReceiverVpa ?? null,
    rewardEnabled: env.p2pOrderRewardEnabled,
    rewardRateBps: env.p2pOrderRewardPercentBps,
    activationReady: rewardBlockers.length === 0,
    blockers: [...fundingIntakeBlockers, ...rewardBlockers],
  };
}

/**
 * Book a manually verified, cleared company funding receipt into the reward
 * reserve. The Admin's confirmation is an assertion, not provider verification;
 * callers must keep the funding gate off until their reconciliation process is ready.
 */
export async function recordRewardFundFunding(tx: Prisma.TransactionClient, input: RecordRewardFundFundingInput) {
  if (!env.rewardFundFundingEnabled) throw new HttpError(503, 'REWARD_FUNDING_DISABLED', 'Reward reserve funding is disabled on this server. No ledger entry was created.');
  if (!env.p2pOrderRewardFundAccountId || env.p2pOrderRewardFundingSource !== 'DEDICATED_REWARD_FUND') throw new HttpError(503, 'REWARD_FUND_MAPPING_REQUIRED', 'Map the dedicated reward reserve account and funding source before recording reserve funding.');
  if (!input.fundingRequestId || !input.makerUserId) throw new HttpError(409, 'REWARD_FUNDING_REQUEST_REQUIRED', 'Reserve funding must be verified against an existing maker request.');
  assertIndependentFundingVerifier(input.makerUserId, input.verifiedByUserId);
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
      && existing.reason === input.reason.trim()
      && existing.fundingRequestId === input.fundingRequestId;
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

  const rewardFundAccountId = env.p2pOrderRewardFundAccountId;
  const [cash, rewardFund] = await Promise.all([
    tx.ledgerAccount.upsert({ where: { id: ADMIN_SETTLEMENT_CASH_ID }, create: { id: ADMIN_SETTLEMENT_CASH_ID, type: 'SETTLEMENT_CASH', currency: 'INR' }, update: {} }),
    tx.ledgerAccount.upsert({ where: { id: rewardFundAccountId }, create: { id: rewardFundAccountId, type: 'REWARD_FUND', currency: 'INR' }, update: {} }),
  ]);
  if (cash.type !== 'SETTLEMENT_CASH' || cash.currency !== 'INR' || rewardFund.type !== 'REWARD_FUND' || rewardFund.currency !== 'INR') {
    throw new HttpError(503, 'REWARD_FUND_ACCOUNTS_INVALID', 'The configured INR cash or reward reserve ledger account is invalid. No funding was posted.');
  }
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${cash.id}::uuid, ${rewardFund.id}::uuid) ORDER BY id FOR UPDATE`;
  const reserveState = await inspectRewardReserve(tx);
  if (!reserveState.reconciled) throw new HttpError(503, 'REWARD_FUND_RECONCILIATION_BLOCKED', 'The existing reward reserve does not reconcile. No additional funding was posted; resolve the ledger discrepancy first.');

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
      makerUserId: input.makerUserId,
      verifierUserId: input.verifiedByUserId,
      clearedFundsManuallyVerified: true,
      externalProviderVerification: false,
      rewardFundAccountId: rewardFund.id,
      fundingRequestId: input.fundingRequestId,
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
    metadata: { makerUserId: input.makerUserId, verifierUserId: input.verifiedByUserId, amountPaise: String(input.amountPaise), currency: 'INR', externalReferenceHash, evidenceReference: input.evidenceReference.trim(), evidenceSha256, statementDate: input.statementDate.toISOString().slice(0, 10), ledgerTransactionId: ledger.id, rewardFundAccountId: rewardFund.id, fundingRequestId: input.fundingRequestId, verificationMethod: 'MANUAL_RECEIVER_SIDE_HISTORY', externalProviderVerification: false },
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
  assertIndependentFundingVerifier(request.makerUserId, input.verifierUserId);
  if (request.status === 'VERIFIED' && input.decision === 'VERIFY') return { request, record: request.fundingRecord, replayed: true, pendingRewardsProcessed: 0, pendingRewardPaise: 0n };
  if (request.status === 'REJECTED' && input.decision === 'REJECT') return { request, record: null, replayed: true, pendingRewardsProcessed: 0, pendingRewardPaise: 0n };
  if (!['PENDING_PAYMENT', 'PENDING_VERIFICATION'].includes(request.status)) throw new HttpError(409, 'REWARD_FUNDING_REQUEST_ALREADY_DECIDED', 'This reward-funding request has already been decided.');
  if (input.decision === 'REJECT') {
    const updated = await tx.rewardFundFundingRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', verifiedByUserId: input.verifierUserId, decisionReason: input.reason.trim(), decidedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: input.verifierUserId, action: 'REWARD_FUNDING_REJECTED', target: `REWARD_FUND_FUNDING_REQUEST:${request.id}`, reason: input.reason.trim(), metadata: { makerUserId: request.makerUserId, verifierUserId: input.verifierUserId, amountPaise: String(request.amountPaise), paymentReferenceHash: request.paymentReferenceHash, ledgerTransactionId: null } } });
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
    makerUserId: request.makerUserId,
  });
  const updated = await tx.rewardFundFundingRequest.update({ where: { id: request.id }, data: { status: 'VERIFIED', verifiedByUserId: input.verifierUserId, decisionReason: input.reason.trim(), ledgerTransactionId: result.ledgerTransaction.id, decidedAt: new Date() } });
  await tx.auditLog.create({ data: { actorId: input.verifierUserId, action: 'REWARD_FUNDING_VERIFIED', target: `REWARD_FUND_FUNDING_REQUEST:${request.id}`, reason: input.reason.trim(), metadata: { makerUserId: request.makerUserId, verifierUserId: input.verifierUserId, amountPaise: String(request.amountPaise), paymentReferenceHash: request.paymentReferenceHash, paymentReferenceMasked: request.paymentReferenceMasked, recipientVpa: request.recipientVpa, verificationMethod: 'MANUAL_RECEIVER_SIDE_HISTORY', externalProviderVerification: false, ledgerTransactionId: result.ledgerTransaction.id, fundingRecordId: result.record.id } } });
  const pending = await processPendingRewardAccruals(tx, input.verifierUserId);
  return { request: updated, record: result.record, replayed: result.replayed, pendingRewardsProcessed: pending.processed, pendingRewardPaise: pending.creditedPaise };
}

export async function readRewardFundDashboard(db: PrismaClient, viewerUserId?: string) {
  const readiness = await readRewardFundReadiness(db);
  const [requests, fundings, rewards, reserveLedger] = await Promise.all([
    db.rewardFundFundingRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { maker: { select: { publicId: true, displayName: true } }, verifiedBy: { select: { publicId: true, displayName: true } } } }),
    db.rewardFundFundingRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { verifiedBy: { select: { publicId: true, displayName: true } }, ledgerTransaction: { select: { id: true, createdAt: true } } } }),
    db.rewardLedgerEntry.findMany({ where: { referenceType: 'P2P_DEPOSIT_ORDER' }, orderBy: { createdAt: 'desc' }, take: 100, include: { wallet: { include: { user: { select: { publicId: true, displayName: true } } } } } }),
    db.ledgerTransaction.findMany({
      where: { eventType: { in: ['REWARD_FUNDING', 'P2P_ORDER_REWARD'] } },
      orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, eventType: true, referenceType: true, referenceId: true, createdAt: true, entries: { select: { creditPaise: true, debitPaise: true, account: { select: { type: true, currency: true } } } } },
    }),
  ]);
  const orderIds = [...new Set(rewards.map((row) => row.referenceId))];
  const orders = orderIds.length ? await db.p2pDepositOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, status: true } }) : [];
  const principalStatusByOrder = new Map(orders.map((order) => [order.id, order.status]));
  return {
    readiness,
    requests: requests.map(({ paymentReferenceHash: _hash, makerUserId, verifiedByUserId: _verifierId, ...row }) => ({ ...row, amountPaise: Number(row.amountPaise), isMaker: viewerUserId === makerUserId, maker: { publicId: row.maker.publicId, displayName: row.maker.displayName }, verifiedBy: row.verifiedBy ? { publicId: row.verifiedBy.publicId, displayName: row.verifiedBy.displayName } : null })),
    fundings: fundings.map(({ externalReferenceHash: _hash, evidenceSha256: _sha, verifiedByUserId: _verifierId, ...row }) => ({ ...row, amountPaise: Number(row.amountPaise), verifiedBy: { publicId: row.verifiedBy.publicId, displayName: row.verifiedBy.displayName } })),
    reserveLedger: reserveLedger.map((transaction) => {
      const deltaPaise = transaction.entries.reduce((total, entry) => entry.account.type === 'REWARD_FUND' && entry.account.currency === 'INR'
        ? total + entry.creditPaise - entry.debitPaise : total, 0n);
      return {
        id: transaction.id, eventType: transaction.eventType, referenceType: transaction.referenceType,
        referenceId: transaction.referenceId, amountPaise: Number(deltaPaise < 0n ? -deltaPaise : deltaPaise),
        direction: deltaPaise > 0n ? 'FUNDING' : 'REWARD_ALLOCATION', createdAt: transaction.createdAt,
      };
    }),
    rewards: rewards.map((row) => ({ id: row.id, source: row.eventType, referenceId: row.referenceId, amountPaise: Number(row.amountPaise), principalStatus: principalStatusByOrder.get(row.referenceId) ?? 'UNKNOWN', status: row.eventType.includes('PENDING') ? 'PENDING_FUNDING' : row.eventType.includes('REVERSED') ? 'REVERSED' : 'CREDITED', user: { publicId: row.wallet.user.publicId, displayName: row.wallet.user.displayName }, createdAt: row.createdAt })),
  };
}
