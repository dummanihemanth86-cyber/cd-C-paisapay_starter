import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/http.js';
import { assertFinancialOrManualUpiOperationsEnabled } from '../../middleware/financialOperations.js';
import { DEVELOPMENT_REWARD_FUND_ACCOUNT_ID } from '../users/welcomeBonus.js';
import { queuePendingReward, releasePendingReward, REWARD_LIABILITY_ACCOUNT_ID } from './rewardWallet.js';
import { inspectRewardReserve } from './rewardReserve.js';
import { assertP2pReviewerIsNotParty } from './rewardSafety.js';

export const VERIFIED_DEPOSIT_REWARD_PERCENT_BPS = env.upiDepositRewardPercentBps;
export const P2P_ORDER_REWARD_PERCENT_BPS = env.p2pOrderRewardPercentBps;
const MAX_PENDING_REWARD_BATCH = 250;

type VerifiedDepositRewardInput = {
  source: 'UPI_DEPOSIT' | 'P2P_ORDER';
  referenceId: string;
  userId: string;
  actorUserId: string;
  amountPaise: bigint;
};

export type P2pRewardResult = {
  status: 'DISABLED' | 'BLOCKED' | 'PENDING_FUNDING' | 'CREDITED' | 'LEGACY_RECORDED';
  rewardPaise: bigint;
  pendingPaise: bigint;
  percentageBps: number;
};

function rewardKeys(orderId: string) {
  return { credited: `P2P_ORDER_REWARD:${orderId}`, pending: `P2P_ORDER_REWARD_PENDING:${orderId}` };
}

function rewardMetadata(amountPaise: bigint, orderAmountPaise: bigint, percentageBps: number, rewardFundAccountId: string, pending: boolean) {
  return {
    amountPaise: amountPaise.toString(),
    qualifyingAmountPaise: orderAmountPaise.toString(),
    percentageBps,
    currency: 'INR',
    rewardProgram: 'P2P_ORDER_REWARD',
    source: 'P2P_ORDER',
    fundingSource: 'DEDICATED_REWARD_FUND',
    rewardFundAccountId,
    cashEquivalent: false,
    payoutMode: 'REWARD_WALLET_ONLY_NO_PAYOUT_PATH',
    status: pending ? 'PENDING_FUNDING' : 'CREDITED',
  } satisfies Prisma.InputJsonObject;
}

/**
 * Allocate a reward from the verified reserve. The principal P2P settlement
 * remains independent: a short reserve leaves a pending reward and never
 * rolls back the verified principal transfer.
 */
async function postFundedReward(
  tx: Prisma.TransactionClient,
  input: { userId: string; orderId: string; orderAmountPaise: bigint; rewardPaise: bigint; percentageBps: number; actorUserId: string },
): Promise<'CREDITED' | 'INSUFFICIENT' | 'BLOCKED'> {
  if (!env.rewardFundFundingEnabled || !env.p2pOrderRewardEnabled || !env.p2pOrderRewardFundAccountId
    || env.p2pOrderRewardFundingSource !== 'DEDICATED_REWARD_FUND') return 'BLOCKED';
  const fundId = env.p2pOrderRewardFundAccountId;
  const [fund, liability] = await Promise.all([
    tx.ledgerAccount.findUnique({ where: { id: fundId }, select: { id: true, type: true, currency: true } }),
    tx.ledgerAccount.upsert({ where: { id: REWARD_LIABILITY_ACCOUNT_ID }, create: { id: REWARD_LIABILITY_ACCOUNT_ID, type: 'REWARD_LIABILITY', currency: 'INR' }, update: {} }),
  ]);
  if (!fund || fund.type !== 'REWARD_FUND' || fund.currency !== 'INR' || liability.type !== 'REWARD_LIABILITY' || liability.currency !== 'INR') return 'BLOCKED';

  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${fund.id}::uuid, ${liability.id}::uuid) ORDER BY id FOR UPDATE`;
  const reserve = await inspectRewardReserve(tx);
  if (!reserve.reconciled) return 'BLOCKED';
  const keys = rewardKeys(input.orderId);
  const idempotencyKey = keys.credited;
  const prior = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey }, select: { id: true, metadata: true } });
  if (prior) {
    const priorCredit = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (priorCredit) return 'CREDITED';
    const metadata = prior.metadata as Record<string, unknown>;
    const amount = BigInt(String(metadata.amountPaise ?? input.rewardPaise));
    const pending = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: keys.pending }, select: { id: true } });
    if (!pending) {
      await queuePendingReward(tx, {
        userId: input.userId, eventType: 'P2P_ORDER_REWARD_PENDING', amountPaise: amount,
        referenceType: 'P2P_DEPOSIT_ORDER', referenceId: input.orderId,
        idempotencyKey: keys.pending,
        metadata: rewardMetadata(amount, input.orderAmountPaise, Number(metadata.percentageBps ?? input.percentageBps), fund.id, true),
      });
    }
    const released = await releasePendingReward(tx, {
      userId: input.userId, referenceType: 'P2P_DEPOSIT_ORDER', referenceId: input.orderId,
      pendingIdempotencyKey: keys.pending, idempotencyKey, eventType: 'P2P_ORDER_REWARD',
      metadata: rewardMetadata(amount, input.orderAmountPaise, Number(metadata.percentageBps ?? input.percentageBps), fund.id, false), reserveJournalTransactionId: prior.id,
    });
    return released === amount ? 'CREDITED' : 'BLOCKED';
  }

  const [balance] = await tx.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(credit_paise - debit_paise), 0)::bigint AS balance
    FROM ledger_entries WHERE account_id = ${fund.id}::uuid`;
  if (!balance || balance.balance < input.rewardPaise) return 'INSUFFICIENT';

  const metadata = rewardMetadata(input.rewardPaise, input.orderAmountPaise, input.percentageBps, fund.id, false);
  // Lock ordering is reserve accounts first, then the user reward wallet. This
  // matches pending release during funding and avoids cross-user deadlocks.
  await queuePendingReward(tx, {
    userId: input.userId, eventType: 'P2P_ORDER_REWARD_PENDING', amountPaise: input.rewardPaise,
    referenceType: 'P2P_DEPOSIT_ORDER', referenceId: input.orderId,
    idempotencyKey: rewardKeys(input.orderId).pending,
    metadata: rewardMetadata(input.rewardPaise, input.orderAmountPaise, input.percentageBps, fund.id, true),
  });
  const reserveJournal = await tx.ledgerTransaction.create({ data: {
    eventType: 'P2P_ORDER_REWARD',
    referenceType: 'P2P_DEPOSIT_ORDER',
    referenceId: input.orderId,
    idempotencyKey,
    actorUserId: input.actorUserId,
    metadata,
    entries: { create: [
      { accountId: fund.id, debitPaise: input.rewardPaise },
      { accountId: liability.id, creditPaise: input.rewardPaise },
    ] },
  } });
  const released = await releasePendingReward(tx, {
    userId: input.userId, referenceType: 'P2P_DEPOSIT_ORDER', referenceId: input.orderId,
    pendingIdempotencyKey: keys.pending, idempotencyKey, eventType: 'P2P_ORDER_REWARD', metadata, reserveJournalTransactionId: reserveJournal.id,
  });
  if (released !== input.rewardPaise) throw new HttpError(409, 'REWARD_LEDGER_POSTING_MISMATCH', 'The reserve journal and reward wallet did not post the same amount. The transaction was rolled back.');
  await tx.auditLog.create({ data: {
    actorId: input.actorUserId,
    action: 'P2P_VERIFIED_ORDER_REWARD_GRANTED',
    target: `P2P_DEPOSIT_ORDER:${input.orderId}`,
    reason: 'The verified and settled P2P order reward was funded by the cleared reward reserve and posted to the separate reward wallet.',
    metadata: { amountPaise: String(input.rewardPaise), orderAmountPaise: String(input.orderAmountPaise), percentageBps: input.percentageBps, rewardFundAccountId: fund.id, rewardLiabilityAccountId: liability.id, customerCashTouched: false },
  } });
  return 'CREDITED';
}

async function verifySettledP2pOrder(tx: Prisma.TransactionClient, input: { orderId: string; userId: string; amountPaise: bigint }) {
  const order = await tx.p2pDepositOrder.findUnique({ where: { id: input.orderId }, select: { buyerUserId: true, sellerUserId: true, amountPaise: true, currency: true, status: true, providerReference: true } });
  if (!order || order.status !== 'COMPLETED' || order.buyerUserId !== input.userId || order.currency !== 'INR') {
    throw new HttpError(409, 'P2P_REWARD_ORDER_NOT_SETTLED', 'Only the buyer of a completed INR P2P order can receive a reward.');
  }
  if (order.amountPaise !== input.amountPaise) throw new HttpError(409, 'P2P_REWARD_AMOUNT_MISMATCH', 'Reward calculation must use the persisted completed order amount.');
  const claim = await tx.p2pPaymentClaim.findFirst({
    where: { orderId: input.orderId, status: 'APPROVED', userId: input.userId, receiverConfirmed: true, verifiedAmountPaise: order.amountPaise, verifiedCurrency: 'INR', reviewedByUserId: { not: null } },
    orderBy: { reviewedAt: 'desc' },
    select: { id: true, orderId: true, userId: true, transactionReference: true, reviewedByUserId: true, verifiedAmountPaise: true, verifiedCurrency: true, receiverConfirmed: true },
  });
  if (!claim?.reviewedByUserId || !order.providerReference || claim.transactionReference?.trim().toUpperCase() !== order.providerReference.trim().toUpperCase()) throw new HttpError(409, 'P2P_REWARD_APPROVED_CLAIM_REQUIRED', 'A manually approved payment claim, matching order reference, and receiver-side attestation are required before reward eligibility.');
  assertP2pReviewerIsNotParty(claim.reviewedByUserId, order.buyerUserId, order.sellerUserId);
  const reviewer = await tx.adminUser.findUnique({ where: { userId: claim.reviewedByUserId }, select: { role: true, user: { select: { status: true } } } });
  if (!reviewer || reviewer.user.status !== 'ACTIVE' || !['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(reviewer.role)) {
    throw new HttpError(409, 'P2P_REWARD_REVIEWER_NOT_AUTHORIZED', 'The approved claim has no active authorized Finance/Admin reviewer.');
  }
  const settlement = await tx.ledgerTransaction.findUnique({
    where: { idempotencyKey: `P2P_PAYMENT_VERIFIED:${input.orderId}` },
    include: { entries: { include: { account: { select: { userId: true, type: true, currency: true } } } } },
  });
  const entries = settlement?.entries ?? [];
  const sellerDebit = entries.filter((entry) => entry.account.userId === order.sellerUserId && entry.account.type === 'RESERVED' && entry.account.currency === 'INR' && entry.debitPaise === order.amountPaise && entry.creditPaise === 0n);
  const buyerCredit = entries.filter((entry) => entry.account.userId === order.buyerUserId && entry.account.type === 'AVAILABLE' && entry.account.currency === 'INR' && entry.creditPaise === order.amountPaise && entry.debitPaise === 0n);
  if (!settlement || settlement.eventType !== 'P2P_PAYMENT_VERIFIED' || settlement.referenceType !== 'P2P_DEPOSIT_ORDER'
    || settlement.referenceId !== input.orderId || entries.length !== 2 || sellerDebit.length !== 1 || buyerCredit.length !== 1) {
    throw new HttpError(409, 'P2P_REWARD_PRINCIPAL_SETTLEMENT_REQUIRED', 'A balanced seller-reserve to buyer-cash principal settlement is required before reward eligibility.');
  }
}

/** Process oldest pending rewards after a receiver-side verified funding post. */
export async function processPendingRewardAccruals(tx: Prisma.TransactionClient, fundedByUserId: string, limit = MAX_PENDING_REWARD_BATCH) {
  if (!env.rewardFundFundingEnabled || !env.p2pOrderRewardEnabled || !env.p2pOrderRewardFundAccountId || env.p2pOrderRewardFundingSource !== 'DEDICATED_REWARD_FUND') {
    return { processed: 0, creditedPaise: 0n };
  }
  const reserve = await inspectRewardReserve(tx);
  if (!reserve.reconciled) return { processed: 0, creditedPaise: 0n };
  const pendingRows = await tx.rewardLedgerEntry.findMany({
    where: { eventType: 'P2P_ORDER_REWARD_PENDING', pendingDeltaPaise: { gt: 0n } },
    include: { wallet: { select: { userId: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: Math.min(Math.max(limit, 1), MAX_PENDING_REWARD_BATCH),
  });
  let processed = 0;
  let creditedPaise = 0n;
  for (const pending of pendingRows) {
    const idempotencyKey = rewardKeys(pending.referenceId).credited;
    const priorReward = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (priorReward) continue;
    const pendingMetadata = pending.metadata as Record<string, unknown>;
    const rewardPaise = pending.amountPaise;
    const orderAmountPaise = BigInt(String(pendingMetadata.qualifyingAmountPaise ?? '0'));
    const percentageBps = Number(pendingMetadata.percentageBps ?? P2P_ORDER_REWARD_PERCENT_BPS);
    if (percentageBps !== env.p2pOrderRewardPercentBps || orderAmountPaise <= 0n
      || rewardPaise !== orderAmountPaise * BigInt(percentageBps) / 10_000n) continue;
    try { await verifySettledP2pOrder(tx, { orderId: pending.referenceId, userId: pending.wallet.userId, amountPaise: orderAmountPaise }); }
    catch { continue; }
    const didCredit = await postFundedReward(tx, { userId: pending.wallet.userId, orderId: pending.referenceId, orderAmountPaise, rewardPaise, percentageBps, actorUserId: fundedByUserId });
    if (didCredit !== 'CREDITED') break;
    processed += 1;
    creditedPaise += rewardPaise;
  }
  return { processed, creditedPaise };
}

/**
 * Eligible reward credit entry point. P2P rewards are earned only after the
 * caller has successfully verified and settled the payment. If the reserve is
 * insufficient, a separate pending reward is visible but not spendable.
 */
export async function grantVerifiedP2pOrderRewardResult(
  tx: Prisma.TransactionClient,
  input: { orderId: string; userId: string; actorUserId: string; amountPaise: bigint },
): Promise<P2pRewardResult> {
  assertFinancialOrManualUpiOperationsEnabled();
  const percentageBps = env.p2pOrderRewardPercentBps;
  if (!env.rewardFundFundingEnabled || !env.p2pOrderRewardEnabled) return { status: 'DISABLED', rewardPaise: 0n, pendingPaise: 0n, percentageBps };
  if (!input.orderId.trim() || input.amountPaise <= 0n) throw new HttpError(400, 'REWARD_SOURCE_INVALID', 'A positive settled P2P amount and order reference are required.');
  if (!env.p2pOrderRewardFundAccountId || env.p2pOrderRewardFundingSource !== 'DEDICATED_REWARD_FUND') {
    throw new HttpError(503, 'REWARD_FUND_NOT_READY', 'P2P rewards require a mapped dedicated reward reserve. No reward was credited.');
  }
  await verifySettledP2pOrder(tx, input);
  const reserve = await inspectRewardReserve(tx);
  if (!reserve.reconciled) return { status: 'BLOCKED', rewardPaise: 0n, pendingPaise: 0n, percentageBps };
  const rewardPaise = input.amountPaise * BigInt(percentageBps) / 10_000n;
  if (rewardPaise <= 0n) return { status: 'DISABLED', rewardPaise: 0n, pendingPaise: 0n, percentageBps };
  const keys = rewardKeys(input.orderId);
  const [existingLedger, existingReward] = await Promise.all([
    tx.ledgerTransaction.findUnique({ where: { idempotencyKey: keys.credited }, select: { metadata: true } }),
    tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: keys.credited }, select: { id: true, amountPaise: true } }),
  ]);
  if (existingReward && !existingLedger) {
    // A prior release could have posted promotional reward-wallet entries
    // without a reserve debit. Preserve that history, but never represent it as
    // funded by this reserve or issue another reward for the same order.
    return { status: 'LEGACY_RECORDED', rewardPaise: 0n, pendingPaise: 0n, percentageBps };
  }
  if (existingLedger) {
    const amount = BigInt(String((existingLedger.metadata as Record<string, unknown>).amountPaise ?? rewardPaise));
    const didRepair = await postFundedReward(tx, { userId: input.userId, orderId: input.orderId, orderAmountPaise: input.amountPaise, rewardPaise: amount, percentageBps, actorUserId: input.actorUserId });
    return didRepair === 'CREDITED'
      ? { status: 'CREDITED', rewardPaise: amount, pendingPaise: 0n, percentageBps }
      : didRepair === 'INSUFFICIENT' ? { status: 'PENDING_FUNDING', rewardPaise: 0n, pendingPaise: amount, percentageBps }
        : { status: 'BLOCKED', rewardPaise: 0n, pendingPaise: 0n, percentageBps };
  }
  const didCredit = await postFundedReward(tx, { userId: input.userId, orderId: input.orderId, orderAmountPaise: input.amountPaise, rewardPaise, percentageBps, actorUserId: input.actorUserId });
  if (didCredit === 'CREDITED') return { status: 'CREDITED', rewardPaise, pendingPaise: 0n, percentageBps };
  if (didCredit === 'BLOCKED') return { status: 'BLOCKED', rewardPaise: 0n, pendingPaise: 0n, percentageBps };
  await queuePendingReward(tx, {
    userId: input.userId, eventType: 'P2P_ORDER_REWARD_PENDING', amountPaise: rewardPaise,
    referenceType: 'P2P_DEPOSIT_ORDER', referenceId: input.orderId,
    idempotencyKey: keys.pending,
    metadata: rewardMetadata(rewardPaise, input.amountPaise, percentageBps, env.p2pOrderRewardFundAccountId, true),
  });
  const credited = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: keys.credited }, select: { amountPaise: true } });
  return credited
    ? { status: 'CREDITED', rewardPaise: credited.amountPaise, pendingPaise: 0n, percentageBps }
    : { status: 'PENDING_FUNDING', rewardPaise: 0n, pendingPaise: rewardPaise, percentageBps };
}

/** Compatibility entry point used by P2P settlement callers that consume a credited amount. */
export async function grantVerifiedP2pOrderReward(
  tx: Prisma.TransactionClient,
  input: { orderId: string; userId: string; actorUserId: string; amountPaise: bigint },
): Promise<bigint> {
  return (await grantVerifiedP2pOrderRewardResult(tx, input)).rewardPaise;
}

/**
 * UPI deposit rewards keep their existing development/test-only setting. The
 * Admin-funded reserve is dedicated to settled P2P order rewards.
 */
export async function grantVerifiedDepositReward(tx: Prisma.TransactionClient, input: VerifiedDepositRewardInput): Promise<bigint> {
  assertFinancialOrManualUpiOperationsEnabled();
  if (!env.rewardFundFundingEnabled) return 0n;
  if (input.source === 'P2P_ORDER') {
    return grantVerifiedP2pOrderReward(tx, { orderId: input.referenceId, userId: input.userId, actorUserId: input.actorUserId, amountPaise: input.amountPaise });
  }
  if (!env.upiDepositRewardEnabled) return 0n;
  const percentageBps = env.upiDepositRewardPercentBps;
  const rewardPaise = input.amountPaise * BigInt(percentageBps) / 10_000n;
  if (rewardPaise <= 0n) return 0n;
  const idempotencyKey = `UPI_DEPOSIT_REWARD:${input.referenceId}`;
  if (await tx.ledgerTransaction.findUnique({ where: { idempotencyKey }, select: { id: true } })) return 0n;
  const [fund, available] = await Promise.all([
    tx.ledgerAccount.findUnique({ where: { id: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID }, select: { id: true } }),
    tx.ledgerAccount.findUnique({ where: { userId_type_currency: { userId: input.userId, type: 'AVAILABLE', currency: 'INR' } }, select: { id: true } }),
  ]);
  if (!fund || !available) return 0n;
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${fund.id}::uuid, ${available.id}::uuid) ORDER BY id FOR UPDATE`;
  const [balance] = await tx.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(credit_paise - debit_paise), 0)::bigint AS balance
    FROM ledger_entries WHERE account_id = ${fund.id}::uuid`;
  if (!balance || balance.balance < rewardPaise) return 0n;
  const metadata = {
    amountPaise: rewardPaise.toString(), depositAmountPaise: input.amountPaise.toString(),
    percentageBps, currency: 'INR', fundingSource: env.upiDepositRewardFundingSource, developmentOnly: true,
  } satisfies Prisma.InputJsonObject;
  await tx.ledgerTransaction.create({ data: {
    eventType: 'UPI_DEPOSIT_REWARD', referenceType: 'DEPOSIT', referenceId: input.referenceId,
    idempotencyKey, actorUserId: input.actorUserId, metadata,
    entries: { create: [ { accountId: fund.id, debitPaise: rewardPaise }, { accountId: available.id, creditPaise: rewardPaise } ] },
  } });
  await tx.auditLog.create({ data: {
    actorId: input.actorUserId, action: 'UPI_DEPOSIT_REWARD_GRANTED', target: `DEPOSIT:${input.referenceId}`,
    reason: 'Configured development UPI deposit reward funded from its development test pool.', metadata,
  } });
  return rewardPaise;
}

export async function grantVerifiedUpiDepositReward(
  tx: Prisma.TransactionClient,
  input: { depositId: string; userId: string; actorUserId: string; amountPaise: bigint },
): Promise<bigint> {
  return grantVerifiedDepositReward(tx, { ...input, source: 'UPI_DEPOSIT', referenceId: input.depositId });
}
