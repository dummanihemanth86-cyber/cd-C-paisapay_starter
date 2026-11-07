import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { databaseRequired } from '../../lib/db.js';
import { HttpError } from '../../lib/http.js';
import { uuidRef } from '../../lib/security.js';
import { assertFinancialOperationsEnabled } from '../../middleware/financialOperations.js';

type Tx = Prisma.TransactionClient;
export const P2P_COMMITTED_ORDER_STATUSES = ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'PAYMENT_PROCESSING', 'DISPUTED', 'COMPLETED'];
export const P2P_ACTIVE_ORDER_STATUSES = ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING'];
export const P2P_HELD_ORDER_STATUSES = ['PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'DISPUTED'];
export const P2P_MATCH_CONFIRM_TTL_MS = 5 * 60_000;

/** A Pay Now tap is uncertain until the app handoff is recorded unavailable. */
export async function p2pPaymentHandoffUnresolved(tx: Tx, order: { id: string; paymentHandoffStartedAt: Date | null; paymentDetailsShownAt: Date | null }) {
  if (order.paymentHandoffStartedAt) return true;
  const events = await tx.auditLog.findMany({
    where: {
      target: `P2P_DEPOSIT_ORDER:${order.id}`,
      action: { in: ['P2P_PAY_NOW_CLICKED', 'P2P_PAYMENT_CONFIRMED_FOR_HANDOFF', 'P2P_PAYMENT_HANDOFF_OPENED', 'P2P_PAYMENT_HANDOFF_UNAVAILABLE'] },
    },
    orderBy: { createdAt: 'desc' }, take: 10, select: { action: true, createdAt: true },
  });
  if (events.some((event) => event.action === 'P2P_PAYMENT_HANDOFF_OPENED')) return true;
  const lastClick = events.find((event) => ['P2P_PAY_NOW_CLICKED', 'P2P_PAYMENT_CONFIRMED_FOR_HANDOFF'].includes(event.action));
  const lastOutcome = events.find((event) => ['P2P_PAYMENT_HANDOFF_OPENED', 'P2P_PAYMENT_HANDOFF_UNAVAILABLE'].includes(event.action));
  if (!lastClick) return Boolean(order.paymentDetailsShownAt);
  return !lastOutcome || lastOutcome.action !== 'P2P_PAYMENT_HANDOFF_UNAVAILABLE' || lastOutcome.createdAt < lastClick.createdAt;
}

/** Derive the public offer label from order allocations, not its last cached status write. */
export function deriveP2pOfferStatus(offerStatus: string, amountPaise: bigint, orders: Array<{ status: string; amountPaise: bigint }>) {
  if (offerStatus === 'CANCELLED' || offerStatus === 'EXPIRED') return offerStatus;
  const completed = orders.filter((order) => order.status === 'COMPLETED').reduce((sum, order) => sum + order.amountPaise, 0n);
  const active = orders.filter((order) => P2P_ACTIVE_ORDER_STATUSES.includes(order.status)).reduce((sum, order) => sum + order.amountPaise, 0n);
  const held = orders.filter((order) => P2P_HELD_ORDER_STATUSES.includes(order.status)).reduce((sum, order) => sum + order.amountPaise, 0n);
  if (completed >= amountPaise) return 'SETTLED';
  if (held > 0n) return 'PAYMENT_REVIEW';
  const reserved = active + completed;
  if (reserved === 0n) return 'OPEN';
  return reserved >= amountPaise ? 'MATCHED' : 'PARTIALLY_MATCHED';
}

export async function committedP2pAmount(tx: Tx, offerId: string) {
  const result = await tx.p2pDepositOrder.aggregate({
    where: { withdrawalOfferId: offerId, status: { in: P2P_COMMITTED_ORDER_STATUSES } },
    _sum: { amountPaise: true },
  });
  return result._sum.amountPaise ?? 0n;
}

async function ledgerBalance(tx: Tx, accountId: string) {
  const [row] = await tx.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(credit_paise - debit_paise), 0)::bigint AS balance
    FROM ledger_entries WHERE account_id = ${accountId}::uuid`;
  return row?.balance ?? 0n;
}

async function getAccount(tx: Tx, userId: string, type: 'AVAILABLE' | 'RESERVED') {
  return tx.ledgerAccount.upsert({
    where: { userId_type_currency: { userId, type, currency: 'INR' } },
    create: { userId, type, currency: 'INR' }, update: {}, select: { id: true },
  });
}

export async function releaseOfferFunds(tx: Tx, offer: { id: string; userId: string; amountPaise: bigint }, actorUserId: string | null, event: 'P2P_WITHDRAWAL_CANCELLED' | 'P2P_WITHDRAWAL_EXPIRED', requestedReleasePaise = offer.amountPaise, releaseReferenceId = offer.id) {
  assertFinancialOperationsEnabled();
  if (requestedReleasePaise <= 0n) return false;
  const reservationKey = `P2P_WITHDRAWAL_RESERVED:${offer.id}`;
  const reservation = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: reservationKey }, select: { id: true } });
  // An unmatched pending request has no ledger hold to release.
  if (!reservation) return false;
  // An offer can release its unmatched remainder now and release an individual
  // held buyer allocation later after Finance resolves it. Give each release
  // its own idempotency reference so the first release does not block the next.
  const releaseKey = `${event}:${offer.id}:${releaseReferenceId}`;
  const priorRelease = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: releaseKey }, select: { id: true } });
  if (priorRelease) return false;
  const reserved = await getAccount(tx, offer.userId, 'RESERVED');
  const available = await getAccount(tx, offer.userId, 'AVAILABLE');
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${reserved.id}::uuid FOR UPDATE`;
  if (await ledgerBalance(tx, reserved.id) < requestedReleasePaise) throw new Error('Reserved balance invariant failed while releasing a P2P offer.');
  await tx.ledgerTransaction.create({ data: {
    eventType: event, referenceType: 'P2P_WITHDRAWAL_OFFER', referenceId: offer.id,
    idempotencyKey: releaseKey, actorUserId,
    metadata: { amountPaise: requestedReleasePaise.toString(), currency: 'INR' },
    entries: { create: [
      { accountId: reserved.id, debitPaise: requestedReleasePaise },
      { accountId: available.id, creditPaise: requestedReleasePaise },
    ] },
  } });
  return true;
}

/** Move funds into RESERVED only when a buyer actually matches an offer. */
export async function reserveOfferFunds(tx: Tx, offer: { id: string; userId: string; amountPaise: bigint }, actorUserId: string | null) {
  assertFinancialOperationsEnabled();
  const idempotencyKey = `P2P_WITHDRAWAL_RESERVED:${offer.id}`;
  const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey }, select: { id: true } });
  if (existing) return true; // Existing offers created by the earlier reserve-on-create flow.
  const available = await getAccount(tx, offer.userId, 'AVAILABLE');
  const reserved = await getAccount(tx, offer.userId, 'RESERVED');
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${available.id}::uuid, ${reserved.id}::uuid) ORDER BY id FOR UPDATE`;
  if (await ledgerBalance(tx, available.id) < offer.amountPaise) return false;
  await tx.ledgerTransaction.create({ data: {
    eventType: 'P2P_WITHDRAWAL_RESERVED', referenceType: 'P2P_WITHDRAWAL_OFFER', referenceId: offer.id,
    idempotencyKey, actorUserId,
    metadata: { amountPaise: offer.amountPaise.toString(), currency: 'INR', reservedAt: 'OFFER_CREATION_OR_LEGACY_BACKFILL' },
    entries: { create: [
      { accountId: available.id, debitPaise: offer.amountPaise },
      { accountId: reserved.id, creditPaise: offer.amountPaise },
    ] },
  } });
  return true;
}

/** Backfill pre-reservation offers before they can be shown or matched. */
export async function ensureOpenP2pOffersReserved(tx: Tx, now = new Date(), limit = 500) {
  assertFinancialOperationsEnabled();
  const offers = await tx.p2pWithdrawalOffer.findMany({ where: { status: { in: ['OPEN', 'PARTIALLY_MATCHED'] }, expiresAt: { gt: now } }, orderBy: { createdAt: 'asc' }, take: limit });
  let reservedCount = 0;
  for (const offer of offers) {
    const held = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: `P2P_WITHDRAWAL_RESERVED:${offer.id}` }, select: { id: true } });
    if (held) continue;
    if (await reserveOfferFunds(tx, offer, null)) {
      reservedCount += 1;
      await tx.auditLog.create({ data: { action: 'P2P_WITHDRAWAL_OFFER_LEGACY_RESERVED', target: `P2P_WITHDRAWAL_OFFER:${offer.id}`, reason: 'Reserved available seller funds for a pre-existing open offer before exposing it to new buyers.', metadata: { amountPaise: offer.amountPaise.toString(), currency: 'INR' } } });
    } else {
      const affectedOrders = await tx.p2pDepositOrder.findMany({ where: { withdrawalOfferId: offer.id, status: { in: ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'DISPUTED'] } }, select: { id: true, buyerUserId: true, status: true } });
      await tx.p2pWithdrawalOffer.update({ where: { id: offer.id }, data: { status: 'DISPUTED' } });
      for (const order of affectedOrders) {
        if (order.status === 'MATCHED') await tx.p2pDepositOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
        else if (order.status !== 'DISPUTED') await tx.p2pDepositOrder.update({ where: { id: order.id }, data: { status: 'DISPUTED' } });
        await tx.notification.create({ data: { userId: order.buyerUserId, title: 'Payment match paused', body: `Order linked to offer ${offer.referenceId} needs Finance review because the older offer could not be backed by available reserved funds. Do not pay or retry.` } });
      }
      await tx.auditLog.create({ data: { action: 'P2P_WITHDRAWAL_OFFER_UNFUNDED_REVIEW', target: `P2P_WITHDRAWAL_OFFER:${offer.id}`, reason: 'A legacy offer had insufficient available funds to establish its required reservation, so it and any payment handoffs were removed from matching for Finance review.', metadata: { amountPaise: offer.amountPaise.toString(), affectedOrderIds: affectedOrders.map((order) => order.id), currency: 'INR' } } });
      await tx.notification.create({ data: { userId: offer.userId, title: 'Withdrawal request paused for review', body: `Offer ${offer.referenceId} could not be fully reserved from your available balance. It is hidden from new matching and needs Finance review.` } });
    }
  }
  return reservedCount;
}

/** Expire unmatched offers and atomically move their reservation back to available balance. */
export async function expireP2pOffers(tx: Tx, now = new Date(), limit = 100) {
  assertFinancialOperationsEnabled();
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM p2p_withdrawal_offers
    WHERE status IN ('OPEN', 'PARTIALLY_MATCHED') AND expires_at <= ${now}
    ORDER BY expires_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT ${limit}`;
  for (const row of rows) {
    const offer = await tx.p2pWithdrawalOffer.findUniqueOrThrow({ where: { id: row.id } });
    const outstanding = await tx.p2pDepositOrder.count({ where: { withdrawalOfferId: offer.id, status: { in: ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'PAYMENT_PROCESSING', 'DISPUTED'] } } });
    // Keep the seller's full reservation while any matched buyer may still have
    // paid outside PaisaPay. Expire and release the unused remainder afterward.
    if (outstanding > 0) continue;
    const committed = await committedP2pAmount(tx, offer.id);
    const unmatched = offer.amountPaise > committed ? offer.amountPaise - committed : 0n;
    await releaseOfferFunds(tx, offer, null, 'P2P_WITHDRAWAL_EXPIRED', unmatched);
    await tx.p2pWithdrawalOffer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } });
    await tx.auditLog.create({ data: { action: 'P2P_WITHDRAWAL_OFFER_EXPIRED', target: `P2P_WITHDRAWAL_OFFER:${offer.id}`, reason: 'P2P offer expired; unmatched remainder was released while matched payment orders remain reserved for review.', metadata: { amountPaise: offer.amountPaise.toString(), releasedAmountPaise: unmatched.toString(), currency: 'INR' } } });
  }
  return rows.length;
}

/** Expire five-minute buyer deadlines. Retain the seller reservation only after a recorded UPI app handoff. */
export async function expireUnconfirmedP2pMatches(tx: Tx, now = new Date(), limit = 100) {
  assertFinancialOperationsEnabled();
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM p2p_deposit_orders
    WHERE status IN ('MATCHED', 'PAYMENT_PENDING') AND expires_at IS NOT NULL AND expires_at <= ${now}
    ORDER BY expires_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT ${limit}`;
  for (const row of rows) {
    const order = await tx.p2pDepositOrder.findUniqueOrThrow({ where: { id: row.id } });
    await tx.$queryRaw`SELECT id FROM p2p_withdrawal_offers WHERE id = ${order.withdrawalOfferId}::uuid FOR UPDATE`;
    // Returning payee details from the API is not by itself a payment attempt:
    // the mobile UI immediately launches the UPI intent and records OPENED or
    // UNAVAILABLE. Keep funds held only when the UPI app handoff was recorded.
    // Check the audit log too for older rows where the timestamp was not saved.
    const paymentHandoffInitiated = await p2pPaymentHandoffUnresolved(tx, order);
    const expiredStatus = paymentHandoffInitiated ? 'PAYMENT_EXPIRED_REVIEW' : 'EXPIRED';
    await tx.p2pDepositOrder.update({ where: { id: order.id }, data: { status: expiredStatus } });
    const offer = await tx.p2pWithdrawalOffer.findUniqueOrThrow({ where: { id: order.withdrawalOfferId } });
    if (paymentHandoffInitiated) {
      await tx.auditLog.create({ data: {
        action: 'P2P_PAYMENT_WINDOW_EXPIRED_REVIEW', target: `P2P_DEPOSIT_ORDER:${order.id}`,
        reason: 'The five-minute payment window expired after the UPI app handoff was recorded. The seller amount remains reserved because an external transfer may have occurred.',
        metadata: { orderReference: order.referenceId, amountPaise: order.amountPaise.toString(), currency: 'INR', expiresAt: order.expiresAt?.toISOString() },
      } });
      await tx.notification.create({ data: { userId: order.buyerUserId, title: 'Payment window expired', body: `Order ${order.referenceId} expired after five minutes after a payment handoff. If payment may have been sent, contact PaisaPay support. Do not pay again.` } });
      await tx.notification.create({ data: { userId: order.sellerUserId, title: 'Matched payment expired', body: `Order ${order.referenceId} expired after five minutes and is held for payment review. Its amount is not available to another buyer yet.` } });
      continue;
    }
    const committed = await committedP2pAmount(tx, offer.id);
    if (!['CANCELLED', 'EXPIRED', 'SETTLED'].includes(offer.status)) {
      const status = committed === 0n ? 'OPEN' : committed >= offer.amountPaise ? 'MATCHED' : 'PARTIALLY_MATCHED';
      await tx.p2pWithdrawalOffer.update({ where: { id: offer.id }, data: { status } });
    }
    await tx.auditLog.create({ data: {
      action: 'P2P_MATCH_EXPIRED_UNCONFIRMED', target: `P2P_DEPOSIT_ORDER:${order.id}`,
      reason: 'Buyer did not initiate the UPI app handoff before the five-minute deadline. The order allocation is released and available for matching again.',
      metadata: { orderReference: order.referenceId, amountPaise: order.amountPaise.toString(), currency: 'INR' },
    } });
    if (offer.expiresAt <= now) await expireP2pOffers(tx, now);
  }
  // An older cancel handler reused PAYMENT_EXPIRED_REVIEW for a cancellation
  // after payment details were disclosed. Preserve the hold, but show the
  // accurate CANCELLED status rather than implying the timer caused it.
  const legacyReviewRows = await tx.p2pDepositOrder.findMany({ where: { status: 'PAYMENT_EXPIRED_REVIEW' }, orderBy: { updatedAt: 'asc' }, take: limit, select: { id: true, referenceId: true, buyerUserId: true, sellerUserId: true } });
  for (const candidate of legacyReviewRows) {
    const target = `P2P_DEPOSIT_ORDER:${candidate.id}`;
    const cancellation = await tx.auditLog.findFirst({ where: { target, action: 'P2P_PAYMENT_WINDOW_CANCELLED_REVIEW' }, select: { id: true, createdAt: true } });
    if (!cancellation) continue;
    await tx.$queryRaw`SELECT id FROM p2p_deposit_orders WHERE id = ${candidate.id}::uuid FOR UPDATE`;
    const current = await tx.p2pDepositOrder.findUnique({ where: { id: candidate.id }, select: { status: true } });
    if (!current || current.status !== 'PAYMENT_EXPIRED_REVIEW') continue;
    await tx.p2pDepositOrder.update({ where: { id: candidate.id }, data: { status: 'CANCELLED_PAYMENT_HOLD' } });
    await tx.auditLog.create({ data: {
      action: 'P2P_LEGACY_CANCEL_HOLD_STATUS_RECONCILED', target,
      reason: 'Corrected a legacy status that used PAYMENT_EXPIRED_REVIEW for a buyer cancellation. The seller allocation remains held; no funds were released.',
      metadata: { orderReference: candidate.referenceId, originalCancellationAt: cancellation.createdAt.toISOString(), fundsReleased: false },
    } });
  }
  // Older server builds could mark a claim REJECTED without closing its order,
  // leaving PAYMENT_PROCESSING allocations counted forever. Finance's recorded
  // rejection is the authorization to reopen that allocation; uncertain or
  // pending claims are deliberately untouched.
  const legacyRejected = await tx.p2pDepositOrder.findMany({
    where: { status: 'PAYMENT_PROCESSING', claims: { some: { status: 'REJECTED' } } },
    orderBy: { updatedAt: 'asc' }, take: limit,
    include: { claims: { orderBy: { createdAt: 'desc' }, take: 1 }, withdrawalOffer: true },
  });
  for (const candidate of legacyRejected) {
    if (candidate.claims[0]?.status !== 'REJECTED') continue;
    await tx.$queryRaw`SELECT id FROM p2p_deposit_orders WHERE id = ${candidate.id}::uuid FOR UPDATE`;
    const order = await tx.p2pDepositOrder.findUnique({ where: { id: candidate.id }, include: { claims: { orderBy: { createdAt: 'desc' }, take: 1 }, withdrawalOffer: true } });
    if (!order || order.status !== 'PAYMENT_PROCESSING' || order.claims[0]?.status !== 'REJECTED') continue;
    await tx.$queryRaw`SELECT id FROM p2p_withdrawal_offers WHERE id = ${order.withdrawalOfferId}::uuid FOR UPDATE`;
    const rejected = await tx.p2pDepositOrder.update({ where: { id: order.id }, data: { status: 'REJECTED' } });
    if (['CANCELLED', 'EXPIRED'].includes(order.withdrawalOffer.status)) {
      await releaseOfferFunds(tx, order.withdrawalOffer, order.claims[0].reviewedByUserId, 'P2P_WITHDRAWAL_CANCELLED', order.amountPaise, `resolved-order:${order.id}`);
    } else if (!['SETTLED'].includes(order.withdrawalOffer.status)) {
      const committed = await committedP2pAmount(tx, order.withdrawalOfferId);
      const completed = await tx.p2pDepositOrder.aggregate({ where: { withdrawalOfferId: order.withdrawalOfferId, status: 'COMPLETED' }, _sum: { amountPaise: true } });
      const nextStatus = (completed._sum.amountPaise ?? 0n) >= order.withdrawalOffer.amountPaise ? 'SETTLED' : committed === 0n ? 'OPEN' : committed >= order.withdrawalOffer.amountPaise ? 'MATCHED' : 'PARTIALLY_MATCHED';
      await tx.p2pWithdrawalOffer.update({ where: { id: order.withdrawalOfferId }, data: { status: nextStatus } });
    }
    await tx.auditLog.create({ data: {
      actorId: order.claims[0].reviewedByUserId,
      action: 'P2P_LEGACY_REJECTED_CLAIM_RECONCILED', target: `P2P_DEPOSIT_ORDER:${order.id}`,
      reason: 'Reconciled a legacy Finance-rejected claim whose order was left PAYMENT_PROCESSING by an older server build. The rejected allocation is no longer reserved for a buyer.',
      metadata: { claimId: order.claims[0].id, orderReference: order.referenceId, amountPaise: order.amountPaise.toString(), currency: 'INR' },
    } });
    await tx.notification.createMany({ data: [
      { userId: order.buyerUserId, title: 'Your deposit was rejected', body: `${order.claims[0].reviewReason || 'Finance could not verify the payment claim.'} No wallet credit was made. Contact PaisaPay support if you believe this decision is incorrect.` },
      { userId: order.sellerUserId, title: 'Withdrawal amount available again', body: `Order ${order.referenceId} was closed after Finance rejected its payment claim. Its allocation is available for another eligible match.` },
    ] });
    void rejected;
  }
  return rows.length;
}

export async function expireP2pOffersBatch(db: PrismaClient, now = new Date()) {
  assertFinancialOperationsEnabled();
  return db.$transaction(async (tx) => {
    await expireUnconfirmedP2pMatches(tx, now);
    await expireP2pOffers(tx, now);
    await ensureOpenP2pOffersReserved(tx, now);
  });
}

export async function createWithdrawalOffer(input: { userId: string; amountPaise: number; idempotencyKey: string }) {
  assertFinancialOperationsEnabled();
  const db = databaseRequired();
  const amount = BigInt(input.amountPaise);
  const key = `P2P_WITHDRAWAL:${input.userId}:${input.idempotencyKey}`;
  const prior = await db.p2pWithdrawalOffer.findUnique({ where: { idempotencyKey: key } });
  if (prior) {
    if (prior.userId !== input.userId || prior.amountPaise !== amount) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used for a different withdrawal offer.');
    return prior;
  }
  return db.$transaction(async (tx) => {
    await ensureOpenP2pOffersReserved(tx);
    await expireP2pOffers(tx);
    const owner = await tx.user.findUnique({ where: { id: input.userId }, select: { upiId: true, upiDisplayName: true } });
    if (!owner?.upiId || !owner.upiDisplayName) throw new HttpError(409, 'UPI_DETAILS_REQUIRED', 'Save both the UPI account name and UPI ID before creating a P2P withdrawal offer.');
    const referenceId = uuidRef('PPWD');
    const offer = await tx.p2pWithdrawalOffer.create({ data: {
      referenceId, userId: input.userId, amountPaise: amount, payeeVpa: owner.upiId, payeeName: owner.upiDisplayName,
      expiresAt: new Date(Date.now() + env.p2pWithdrawalOfferTtlMinutes * 60_000), idempotencyKey: key,
    } });
    if (!await reserveOfferFunds(tx, offer, input.userId)) throw new HttpError(409, 'INSUFFICIENT_FUNDS', 'Available balance is not enough to reserve this withdrawal offer.');
    await tx.auditLog.create({ data: { actorId: input.userId, action: 'P2P_WITHDRAWAL_OFFER_CREATED', target: `P2P_WITHDRAWAL_OFFER:${offer.id}`, reason: 'P2P withdrawal offer created and its full amount was atomically moved from available to reserved ledger balance.', metadata: { amountPaise: amount.toString(), currency: 'INR', paymentMethod: 'UPI', payeeOwnershipStatus: 'UNVERIFIED_USER_PROVIDED' } } });
    return offer;
  }, { isolationLevel: 'Serializable' });
}

export function validateP2pEvidence(input: {
  claimedReference: string | null;
  verifiedReference: string;
  expectedAmountPaise: bigint;
  verifiedAmountPaise: bigint;
  currency: string;
  receiverConfirmed: boolean;
}) {
  if (input.claimedReference && input.claimedReference !== input.verifiedReference) return 'TRANSACTION_REFERENCE_MISMATCH';
  if (input.expectedAmountPaise !== input.verifiedAmountPaise) return 'AMOUNT_MISMATCH';
  if (input.currency !== 'INR') return 'CURRENCY_MISMATCH';
  if (!input.receiverConfirmed) return 'RECEIVER_NOT_CONFIRMED';
  return null;
}

