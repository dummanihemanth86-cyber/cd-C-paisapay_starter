import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { databaseRequired } from '../../lib/db.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { uuidRef } from '../../lib/security.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { assertFinancialOperationsEnabled, financialOperationsGate } from '../../middleware/financialOperations.js';
import { env } from '../../config/env.js';
import { grantVerifiedP2pOrderReward, P2P_ORDER_REWARD_PERCENT_BPS } from '../payments/depositReward.js';
import { grantVerifiedReferralCommission } from '../users/referralCommission.js';
import { lockPaymentReference, paymentReferenceHash } from '../payments/paymentReferenceLock.js';
import { committedP2pAmount, createWithdrawalOffer, deriveP2pOfferStatus, ensureOpenP2pOffersReserved, expireP2pOffers, expireUnconfirmedP2pMatches, p2pPaymentHandoffUnresolved, P2P_ACTIVE_ORDER_STATUSES, P2P_COMMITTED_ORDER_STATUSES, P2P_HELD_ORDER_STATUSES, P2P_MATCH_CONFIRM_TTL_MS, releaseOfferFunds, reserveOfferFunds, validateP2pEvidence } from './service.js';

export const p2pRouter = Router();
p2pRouter.use(requireAuth);
// User-owned reads are available while payments are disabled. Maintenance
// writes are skipped while the feature gate is off, and every state-changing
// action remains behind the global financial-operations gate.
p2pRouter.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const path = req.path;
  const p2pFinancialPath = path === '/withdrawals'
    || path.startsWith('/withdrawals/')
    || path === '/deposits/quick-match'
    || path.startsWith('/deposits/orders/')
    || /^\/orders\/[^/]+\/dispute$/.test(path);
  return p2pFinancialPath ? financialOperationsGate(req, res, next) : next();
});

const p2pLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => env.isTest, message: { error: { code: 'P2P_RATE_LIMITED', message: 'Too many P2P requests. Wait and retry.' } } });
const adminListInput = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), q: z.string().trim().max(120).optional(), status: z.string().trim().max(40).optional() });
const idempotencyHeader = (req: import('express').Request) => {
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 120) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header between 8 and 120 characters.');
  return key;
};
const rupeeAmount = z.number().int().min(10_000).max(100_000_000).refine((value) => value % 10_000 === 0, 'Amount must be in increments of ₹100.');
const quickDepositAmount = rupeeAmount.max(1_000_000, 'Quick deposit cannot exceed ₹10,000.');
const transactionReference = z.string().trim().min(4).max(120).regex(/^[A-Za-z0-9._/-]+$/);
// Proof claims can outlive the payment window. Older app/server versions left
// those orders in a held/expired state even though the claim is still pending.
// A pending claim remains reviewable, but rejection still requires Finance to
// confirm non-receipt and approval still requires independent receipt checks.
const P2P_CLAIM_REVIEWABLE_ORDER_STATUSES = ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'PAYMENT_PROCESSING', 'DISPUTED'];

function p2pOrderTimestamps(order: { createdAt: Date; expiresAt: Date | null; paymentDetailsShownAt: Date | null; paymentHandoffStartedAt: Date | null; cancellationRequestedAt?: Date | null }, events: Array<{ action: string; createdAt: Date }>) {
  const at = (...actions: string[]) => events.find((event) => actions.includes(event.action))?.createdAt ?? null;
  return {
    orderCreatedAt: order.createdAt,
    matchedAt: at('P2P_DEPOSIT_MATCHED') ?? order.createdAt,
    payNowClickedAt: at('P2P_PAY_NOW_CLICKED'),
    paymentDetailsViewedAt: order.paymentDetailsShownAt ?? at('P2P_PAYMENT_DETAILS_SHOWN'),
    paymentHandoffInitiatedAt: order.paymentHandoffStartedAt ?? at('P2P_PAYMENT_HANDOFF_OPENED'),
    expiresAt: order.expiresAt,
    cancellationRequestedAt: order.cancellationRequestedAt ?? at('P2P_CANCELLATION_REQUESTED', 'P2P_ORDER_CANCELLED_AFTER_PAYMENT_HANDOFF'),
    paymentSubmittedAt: at('P2P_PAYMENT_REFERENCE_SUBMITTED'),
    reservationReleasedAt: at('P2P_MATCH_EXPIRED_UNCONFIRMED', 'P2P_PAYMENT_CLAIM_REJECTED_ORDER_CLOSED', 'P2P_LEGACY_REJECTED_CLAIM_RECONCILED'),
    paymentVerifiedAt: at('P2P_PAYMENT_CLAIM_APPROVED'),
    financeResolvedAt: at('P2P_PAYMENT_CLAIM_APPROVED', 'P2P_PAYMENT_CLAIM_REJECTED_ORDER_CLOSED', 'P2P_LEGACY_REJECTED_CLAIM_RECONCILED'),
  };
}

async function p2pOrderEvents(db: ReturnType<typeof databaseRequired>, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, Array<{ action: string; createdAt: Date }>>();
  const events = await db.auditLog.findMany({ where: { target: { in: orderIds.map((id) => `P2P_DEPOSIT_ORDER:${id}`) } }, orderBy: { createdAt: 'asc' }, select: { target: true, action: true, createdAt: true } });
  const byOrder = new Map<string, Array<{ action: string; createdAt: Date }>>();
  for (const event of events) {
    const id = event.target.slice('P2P_DEPOSIT_ORDER:'.length);
    byOrder.set(id, [...(byOrder.get(id) ?? []), { action: event.action, createdAt: event.createdAt }]);
  }
  return byOrder;
}

// Existing withdrawals API now creates a P2P offer; it never submits an external payout.
p2pRouter.post('/withdrawals', p2pLimit, asyncRoute(async (req, res) => {
  const input = z.object({ amountPaise: rupeeAmount }).strict().parse(req.body);
  const offer = await createWithdrawalOffer({ userId: req.auth!.userId, amountPaise: input.amountPaise, idempotencyKey: idempotencyHeader(req) });
  res.status(201).json({ withdrawalOffer: { ...offer, amountPaise: Number(offer.amountPaise), status: offer.status, paymentMethod: 'UPI', payeeVpa: undefined, payeeName: undefined, payeeVerificationStatus: 'USER_PROVIDED' }, message: 'Withdrawal request is open until another user matches it. Its full amount is reserved from your available balance while the offer is active. This is a P2P offer, not a bank payout.' });
}));

p2pRouter.get('/withdrawals', asyncRoute(async (req, res, next) => {
  // Let the existing route return legacy payout requests and add the owner's P2P offers.
  const db = databaseRequired();
  if (env.financialOperationsEnabled) {
    await db.$transaction((tx) => expireUnconfirmedP2pMatches(tx));
    await db.$transaction((tx) => expireP2pOffers(tx));
    await db.$transaction((tx) => ensureOpenP2pOffersReserved(tx));
  }
  const [withdrawals, offers] = await Promise.all([
    db.withdrawal.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.p2pWithdrawalOffer.findMany({ where: { userId: req.auth!.userId }, include: { orders: { orderBy: { createdAt: 'asc' }, include: { buyer: { select: { publicId: true, phoneE164: true } }, claims: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, createdAt: true, claimedAmountPaise: true, claimedPaidAt: true, evidenceMimeType: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const orderEvents = await p2pOrderEvents(db, offers.flatMap((offer) => offer.orders.map((order) => order.id)));
  res.json({ serverTime: new Date(), withdrawals: withdrawals.map((row) => ({ ...row, amountPaise: Number(row.amountPaise) })), offers: await Promise.all(offers.map(async (row) => {
    const completedPaise = row.orders.filter((order) => order.status === 'COMPLETED').reduce((sum, order) => sum + order.amountPaise, 0n);
    const activeReservedPaise = row.orders.filter((order) => P2P_ACTIVE_ORDER_STATUSES.includes(order.status)).reduce((sum, order) => sum + order.amountPaise, 0n);
    const disputedHeldPaise = row.orders.filter((order) => P2P_HELD_ORDER_STATUSES.includes(order.status)).reduce((sum, order) => sum + order.amountPaise, 0n);
    const committedPaise = completedPaise + activeReservedPaise + disputedHeldPaise;
    const availablePaise = row.amountPaise > committedPaise ? row.amountPaise - committedPaise : 0n;
    const released = await db.ledgerEntry.aggregate({ where: { account: { userId: row.userId, type: 'AVAILABLE' }, transaction: { referenceType: 'P2P_WITHDRAWAL_OFFER', referenceId: row.id, eventType: { in: ['P2P_WITHDRAWAL_CANCELLED', 'P2P_WITHDRAWAL_EXPIRED'] } } }, _sum: { creditPaise: true } });
    const sellerFundsReservedPaise = row.amountPaise > completedPaise + (released._sum.creditPaise ?? 0n) ? row.amountPaise - completedPaise - (released._sum.creditPaise ?? 0n) : 0n;
    const status = deriveP2pOfferStatus(row.status, row.amountPaise, row.orders);
    const canMatch = !['CANCELLED', 'EXPIRED', 'SETTLED'].includes(row.status);
    return { ...row, payeeVpa: undefined, status: status === 'OPEN' ? 'PENDING_MATCH' : status, amountPaise: Number(row.amountPaise), completedAmountPaise: Number(completedPaise), activeReservedPaise: Number(activeReservedPaise), disputedHeldPaise: Number(disputedHeldPaise), sellerFundsReservedPaise: Number(sellerFundsReservedPaise), matchedAmountPaise: Number(committedPaise), remainingAmountPaise: Number(availablePaise), availableAmountPaise: Number(canMatch ? availablePaise : 0n), orders: row.orders.map((order) => ({ ...order, buyer: { publicId: order.buyer.publicId, phoneMasked: `${order.buyer.phoneE164.slice(0, 3)}••••${order.buyer.phoneE164.slice(-3)}` }, verificationStatus: order.claims[0]?.status ?? 'NOT_SUBMITTED', handoffStatus: order.paymentHandoffStartedAt ? 'UPI_HANDOFF_REPORTED' : order.paymentDetailsShownAt ? 'PAYMENT_DETAILS_SHOWN' : 'NOT_STARTED', timestamps: p2pOrderTimestamps(order, orderEvents.get(order.id) ?? []), claims: order.claims.map((claim) => ({ ...claim, claimedAmountPaise: claim.claimedAmountPaise === null ? null : Number(claim.claimedAmountPaise), evidenceAttached: Boolean(claim.evidenceMimeType), evidenceMimeType: undefined })), amountPaise: Number(order.amountPaise) })) };
  })) });
  void next;
}));

p2pRouter.get('/withdrawals/marketplace', p2pLimit, asyncRoute(async (req, res) => {
  const db = databaseRequired();
  if (env.financialOperationsEnabled) {
    await db.$transaction((tx) => expireUnconfirmedP2pMatches(tx));
    await db.$transaction((tx) => expireP2pOffers(tx));
    await db.$transaction((tx) => ensureOpenP2pOffersReserved(tx));
  }
  // Include stale MATCHED rows: their historical order may have been cancelled
  // or expired, restoring available capacity without refreshing the cached offer status.
  const rows = await db.p2pWithdrawalOffer.findMany({ where: { status: { in: ['OPEN', 'PARTIALLY_MATCHED', 'MATCHED'] }, payeeName: { not: null }, expiresAt: { gt: new Date() }, userId: { not: req.auth!.userId }, user: { is: { upiId: { not: null }, upiDisplayName: { not: null } } } }, orderBy: { createdAt: 'asc' }, take: 100, select: { id: true, referenceId: true, amountPaise: true, paymentMethod: true, status: true, createdAt: true, expiresAt: true, orders: { where: { status: { in: P2P_COMMITTED_ORDER_STATUSES } }, select: { amountPaise: true, status: true } } } });
  const availableOffers = rows.map((row) => {
    const matchedAmountPaise = row.orders.reduce((sum, order) => sum + order.amountPaise, 0n);
    const remainingAmountPaise = row.amountPaise > matchedAmountPaise ? row.amountPaise - matchedAmountPaise : 0n;
    const { orders: _orders, ...offer } = row;
    const status = deriveP2pOfferStatus(row.status, row.amountPaise, row.orders);
    return { ...offer, status, amountPaise: Number(row.amountPaise), matchedAmountPaise: Number(matchedAmountPaise), remainingAmountPaise: Number(remainingAmountPaise) };
  }).filter((row) => row.remainingAmountPaise > 0);
  res.json({ currency: 'INR', offers: availableOffers, paymentVerificationAvailable: false, message: 'Buyers can match smaller amounts against the remaining offer balance; payment claims require independent Finance review.' });
}));

p2pRouter.post('/withdrawals/offers/:id/cancel', p2pLimit, asyncRoute(async (req, res) => {
  const db = databaseRequired();
  const updated = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM p2p_withdrawal_offers WHERE id = ${req.params.id}::uuid FOR UPDATE`;
    const offer = await tx.p2pWithdrawalOffer.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!offer) throw new HttpError(404, 'OFFER_NOT_FOUND', 'Withdrawal offer was not found.');
    if (offer.status === 'CANCELLED' || offer.status === 'EXPIRED') return offer;
    if (!['OPEN', 'PARTIALLY_MATCHED', 'MATCHED'].includes(offer.status)) throw new HttpError(409, 'OFFER_ALREADY_MATCHED', 'This offer cannot be cancelled in its current state.');
    const committed = await committedP2pAmount(tx, offer.id);
    const unfilledPaise = offer.amountPaise > committed ? offer.amountPaise - committed : 0n;
    await tx.p2pWithdrawalOffer.update({ where: { id: offer.id }, data: { status: 'CANCELLED' } });
    await releaseOfferFunds(tx, offer, req.auth!.userId, 'P2P_WITHDRAWAL_CANCELLED', unfilledPaise);
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_WITHDRAWAL_OFFER_CANCELLED', target: `P2P_WITHDRAWAL_OFFER:${offer.id}`, reason: 'Creator cancelled the unmatched remainder; any completed partial orders stay settled and any matched buyer payment remains protected.', metadata: { releasedAmountPaise: unfilledPaise.toString() } } });
    return tx.p2pWithdrawalOffer.findUniqueOrThrow({ where: { id: offer.id } });
  });
  res.json({ offer: { id: updated.id, referenceId: updated.referenceId, status: updated.status, amountPaise: Number(updated.amountPaise) }, message: 'Withdrawal offer cancelled. The unmatched amount was returned to your available balance. Existing matched buyer orders remain reserved until safely completed or resolved by Finance.' });
}));

p2pRouter.post('/deposits/quick-match', p2pLimit, asyncRoute(async (req, res) => {
  const input = z.object({ amountPaise: quickDepositAmount, withdrawalOfferId: z.string().uuid().optional(), excludeWithdrawalOfferId: z.string().uuid().optional() }).strict().superRefine((value, ctx) => {
    if (value.withdrawalOfferId && value.withdrawalOfferId === value.excludeWithdrawalOfferId) ctx.addIssue({ code: 'custom', path: ['excludeWithdrawalOfferId'], message: 'The selected offer cannot also be excluded.' });
  }).parse(req.body);
  const key = `P2P_MATCH:${req.auth!.userId}:${idempotencyHeader(req)}`;
  const db = databaseRequired();
  await db.$transaction((tx) => expireUnconfirmedP2pMatches(tx));
  await db.$transaction((tx) => ensureOpenP2pOffersReserved(tx));
  const prior = await db.p2pDepositOrder.findUnique({ where: { idempotencyKey: key }, include: { withdrawalOffer: { select: { referenceId: true, paymentMethod: true } } } });
  if (prior) {
    if (prior.amountPaise !== BigInt(input.amountPaise)) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used for a different amount.');
    return res.json({ order: { ...prior, amountPaise: Number(prior.amountPaise) }, withdrawalOffer: prior.withdrawalOffer, reward: p2pRewardPreview(prior.amountPaise), message: 'Your existing matched order was returned.' });
  }
  const result = await db.$transaction(async (tx) => {
    await expireP2pOffers(tx);
    const matchingTime = new Date();
    const excludedOfferId = input.excludeWithdrawalOfferId ?? null;
    const candidates = input.withdrawalOfferId
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM p2p_withdrawal_offers
          WHERE status IN ('OPEN', 'PARTIALLY_MATCHED', 'MATCHED')
            AND user_id <> ${req.auth!.userId}::uuid AND expires_at > ${matchingTime}
            AND (${excludedOfferId}::uuid IS NULL OR id <> ${excludedOfferId}::uuid)
            AND p2p_withdrawal_offers.payee_name IS NOT NULL
            AND EXISTS (SELECT 1 FROM users seller WHERE seller.id = p2p_withdrawal_offers.user_id AND seller.upi_id = p2p_withdrawal_offers.payee_vpa AND seller.upi_display_name = p2p_withdrawal_offers.payee_name)
            AND id = ${input.withdrawalOfferId}::uuid
          ORDER BY created_at ASC LIMIT 100 FOR UPDATE SKIP LOCKED`
      : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM p2p_withdrawal_offers
          WHERE status IN ('OPEN', 'PARTIALLY_MATCHED', 'MATCHED')
            AND user_id <> ${req.auth!.userId}::uuid AND expires_at > ${matchingTime}
            AND (${excludedOfferId}::uuid IS NULL OR id <> ${excludedOfferId}::uuid)
            AND p2p_withdrawal_offers.payee_name IS NOT NULL
            AND EXISTS (SELECT 1 FROM users seller WHERE seller.id = p2p_withdrawal_offers.user_id AND seller.upi_id = p2p_withdrawal_offers.payee_vpa AND seller.upi_display_name = p2p_withdrawal_offers.payee_name)
          ORDER BY created_at ASC LIMIT 100 FOR UPDATE SKIP LOCKED`;
    for (const candidate of candidates) {
      const offer = await tx.p2pWithdrawalOffer.findUniqueOrThrow({ where: { id: candidate.id } });
      const committed = await committedP2pAmount(tx, offer.id);
      const remaining = offer.amountPaise > committed ? offer.amountPaise - committed : 0n;
      if (remaining < BigInt(input.amountPaise)) continue;
      const funded = await reserveOfferFunds(tx, offer, req.auth!.userId);
      if (!funded) {
        await tx.p2pWithdrawalOffer.update({ where: { id: offer.id }, data: { status: 'CANCELLED' } });
        await tx.auditLog.create({ data: { action: 'P2P_WITHDRAWAL_OFFER_CANCELLED_INSUFFICIENT_FUNDS', target: `P2P_WITHDRAWAL_OFFER:${offer.id}`, reason: 'Funds were no longer available when a buyer attempted to match the pending offer.', metadata: { amountPaise: offer.amountPaise.toString(), currency: 'INR' } } });
        continue;
      }
      const referenceId = uuidRef('PPDEP');
      const order = await tx.p2pDepositOrder.create({ data: {
        referenceId, buyerUserId: req.auth!.userId, sellerUserId: offer.userId,
        withdrawalOfferId: offer.id, amountPaise: BigInt(input.amountPaise), idempotencyKey: key, status: 'MATCHED',
        expiresAt: new Date(matchingTime.getTime() + P2P_MATCH_CONFIRM_TTL_MS),
      } });
      const matchedAfter = committed + order.amountPaise;
      const offerStatus = matchedAfter >= offer.amountPaise ? 'MATCHED' : 'PARTIALLY_MATCHED';
      await tx.p2pWithdrawalOffer.update({ where: { id: offer.id }, data: { status: offerStatus } });
      await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_DEPOSIT_MATCHED', target: `P2P_DEPOSIT_ORDER:${order.id}`, reason: 'Quick deposit matched an exact buyer amount against the remaining offer; seller offer funds were reserved atomically.', metadata: { withdrawalOfferId: offer.id, amountPaise: order.amountPaise.toString(), matchedAfterPaise: matchedAfter.toString(), remainingPaise: (offer.amountPaise - matchedAfter).toString(), currency: 'INR' } } });
      await tx.notification.create({ data: { userId: offer.userId, title: 'Withdrawal offer matched', body: `Order ${order.referenceId} matched ${Number(order.amountPaise) / 100} INR of your offer. Check Withdrawal → Pending for its status and available amount.` } });
      await tx.notification.create({ data: { userId: req.auth!.userId, title: 'Quick Deposit matched', body: `Your order ${order.referenceId} matched ${Number(order.amountPaise) / 100} INR. Complete payment within five minutes and check its status in Quick Deposit.` } });
      return { order, withdrawalOffer: offer, remainingAmountPaise: offer.amountPaise - matchedAfter };
    }
    return null;
  }, { isolationLevel: 'ReadCommitted' });
  if (!result) throw new HttpError(409, 'NO_MATCHING_WITHDRAWAL_OFFERS', 'No matching withdrawal offers available right now. Please try again later.');
  res.status(201).json({ serverTime: new Date(), order: { ...result.order, amountPaise: Number(result.order.amountPaise) }, withdrawalOffer: { id: result.withdrawalOffer.id, referenceId: result.withdrawalOffer.referenceId, amountPaise: Number(result.withdrawalOffer.amountPaise), remainingAmountPaise: Number(result.remainingAmountPaise), paymentMethod: result.withdrawalOffer.paymentMethod }, reward: p2pRewardPreview(result.order.amountPaise), message: `₹${(input.amountPaise / 100).toLocaleString('en-IN')} matched. Pay within five minutes. If the payment details have been shown, an expired order is held for review and will not be matched to another buyer until payment is resolved. Reward is credited only after payment receipt verification and only when the reward pool is funded.` });
}));

function p2pRewardPreview(amountPaise: bigint) {
  return {
    percentBps: P2P_ORDER_REWARD_PERCENT_BPS,
    estimatedPaise: Number(amountPaise * BigInt(P2P_ORDER_REWARD_PERCENT_BPS) / 10_000n),
    enabled: env.upiDepositRewardEnabled,
    status: env.upiDepositRewardEnabled ? 'PENDING_PAYMENT_VERIFICATION' : 'PENDING_VERIFICATION_AND_FUNDED_PROGRAM',
    message: env.upiDepositRewardEnabled
      ? 'Estimated 6% order reward; credited after independent payment verification if the funded reward pool has enough balance.'
      : 'Estimated 6% order reward; no reward program is funded/enabled, so this is not guaranteed wallet credit.',
  };
}

p2pRouter.post('/deposits/orders/:id/confirm', p2pLimit, asyncRoute(async (req, res) => {
  z.object({}).strict().parse(req.body ?? {});
  const db = databaseRequired();
  await db.$transaction((tx) => expireUnconfirmedP2pMatches(tx));
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM p2p_deposit_orders WHERE id = ${req.params.id}::uuid FOR UPDATE`;
    const order = await tx.p2pDepositOrder.findFirst({ where: { id: req.params.id, buyerUserId: req.auth!.userId }, include: { withdrawalOffer: true } });
    if (!order) throw new HttpError(404, 'P2P_ORDER_NOT_FOUND', 'Matched deposit order was not found.');
    if (order.status === 'EXPIRED' || order.status === 'PAYMENT_EXPIRED_REVIEW' || (order.expiresAt && order.expiresAt <= new Date() && ['MATCHED', 'PAYMENT_PENDING'].includes(order.status))) throw new HttpError(409, 'P2P_MATCH_EXPIRED', 'This five-minute payment window expired. If payment may have been sent, contact PaisaPay support and do not pay again.');
    if (!order.withdrawalOffer.payeeVpa || !order.withdrawalOffer.payeeName) throw new HttpError(409, 'P2P_PAYEE_DETAILS_UNAVAILABLE', 'This offer has no saved UPI account details. Contact support.');
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_PAY_NOW_CLICKED', target: `P2P_DEPOSIT_ORDER:${order.id}`, reason: 'Buyer requested the payment handoff and seller payment details. This records intent only; it is not proof that an external payment was initiated.', metadata: { orderReference: order.referenceId } } });
    if (order.status === 'MATCHED') {
      await tx.p2pDepositOrder.update({ where: { id: order.id }, data: { status: 'PAYMENT_PENDING', paymentDetailsShownAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_PAYMENT_DETAILS_SHOWN', target: `P2P_DEPOSIT_ORDER:${order.id}`, reason: 'Seller UPI details were disclosed for the buyer payment handoff; payment is not confirmed by this event.', metadata: { orderReference: order.referenceId, amountPaise: order.amountPaise.toString(), currency: 'INR' } } });
    }
    else if (!['PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'DISPUTED'].includes(order.status)) throw new HttpError(409, 'P2P_ORDER_NOT_CONFIRMABLE', 'This order cannot be confirmed in its current state.');
    return order;
  });
  const shownAt = result.status === 'MATCHED' ? new Date() : result.paymentDetailsShownAt;
  res.json({ serverTime: new Date(), order: { id: result.id, referenceId: result.referenceId, amountPaise: Number(result.amountPaise), currency: 'INR', status: 'PAYMENT_PENDING', expiresAt: result.expiresAt, paymentDetailsShownAt: shownAt }, paymentDetails: { method: 'UPI', payeeVpa: result.withdrawalOffer.payeeVpa, payeeName: result.withdrawalOffer.payeeName, ownershipStatus: 'UNVERIFIED_USER_PROVIDED' }, message: 'Five-minute payment window is running from the time of match. Seller-provided UPI name and ID are unverified. No wallet credit occurs until Finance independently confirms receipt.' });
}));

// Records the device's handoff attempt; a launch result is never payment evidence.
p2pRouter.post('/deposits/orders/:id/handoff-attempt', p2pLimit, asyncRoute(async (req, res) => {
  const input = z.object({ outcome: z.enum(['OPENED', 'UNAVAILABLE']) }).strict().parse(req.body);
  const db = databaseRequired();
  const order = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM p2p_deposit_orders WHERE id = ${req.params.id}::uuid FOR UPDATE`;
    const current = await tx.p2pDepositOrder.findFirst({ where: { id: req.params.id, buyerUserId: req.auth!.userId } });
    if (!current) throw new HttpError(404, 'P2P_ORDER_NOT_FOUND', 'Matched deposit order was not found.');
    if (!['PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'DISPUTED', 'CANCELLED_PAYMENT_HOLD'].includes(current.status)) throw new HttpError(409, 'P2P_HANDOFF_NOT_AVAILABLE', 'This order has not entered the payment handoff state.');
    const handoffAt = input.outcome === 'OPENED' ? current.paymentHandoffStartedAt ?? new Date() : current.paymentHandoffStartedAt;
    const updated = handoffAt !== current.paymentHandoffStartedAt ? await tx.p2pDepositOrder.update({ where: { id: current.id }, data: { paymentHandoffStartedAt: handoffAt } }) : current;
    await tx.auditLog.create({ data: {
      actorId: req.auth!.userId, action: `P2P_PAYMENT_HANDOFF_${input.outcome}`, target: `P2P_DEPOSIT_ORDER:${current.id}`,
      reason: input.outcome === 'OPENED' ? 'Mobile client reported that the Android UPI intent was handed to the operating system; this is not proof of payment.' : 'Mobile client reported that the UPI app handoff could not be opened; the order remains pending because payee details were already disclosed.',
      metadata: { orderReference: current.referenceId, amountPaise: current.amountPaise.toString(), currency: 'INR', result: input.outcome },
    } });
    return updated;
  });
  res.status(202).json({ order: { id: order.id, status: order.status, paymentHandoffStartedAt: order.paymentHandoffStartedAt }, paymentConfirmed: false, message: 'Handoff attempt recorded. Only trusted Finance/provider verification can confirm payment.' });
}));

p2pRouter.post('/deposits/orders/:id/payment-reference', p2pLimit, asyncRoute(async (req, res) => {
  const input = z.object({
    transactionReference,
    evidenceImageBase64: z.string().min(16).max(1_900_000),
    evidenceMimeType: z.enum(['image/jpeg', 'image/png']),
    claimedAmountPaise: z.number().int().positive().max(100_000_000),
    claimedPaidAt: z.string().datetime({ offset: true }),
  }).strict().superRefine((value, ctx) => {
    const image = Buffer.from(value.evidenceImageBase64, 'base64');
    const validBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(value.evidenceImageBase64) && image.toString('base64') === value.evidenceImageBase64;
    const isJpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    const isPng = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!validBase64 || image.length > 1_400_000 || (value.evidenceMimeType === 'image/jpeg' ? !isJpeg : !isPng)) {
      ctx.addIssue({ code: 'custom', path: ['evidenceImageBase64'], message: 'Upload a valid JPEG or PNG transaction image no larger than 1.4 MB.' });
    }
  }).parse(req.body);
  const paidAt = new Date(input.claimedPaidAt);
  if (paidAt.getTime() > Date.now() + 5 * 60_000) throw new HttpError(400, 'PAYMENT_TIME_IN_FUTURE', 'Payment time cannot be in the future.');
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM p2p_deposit_orders WHERE id = ${req.params.id}::uuid FOR UPDATE`;
    const order = await tx.p2pDepositOrder.findFirst({ where: { id: req.params.id, buyerUserId: req.auth!.userId }, include: { claims: { where: { status: 'PENDING_REVIEW' }, take: 1 } } });
    if (!order) throw new HttpError(404, 'P2P_ORDER_NOT_FOUND', 'Matched deposit order was not found.');
    if (!['PAYMENT_PENDING', 'PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'PAYMENT_PROCESSING', 'DISPUTED'].includes(order.status)) throw new HttpError(409, 'P2P_ORDER_NOT_REVIEWABLE', 'Order is not awaiting payment review.');
    if (order.claims.length) throw new HttpError(409, 'P2P_CLAIM_ALREADY_PENDING', 'Payment proof is already awaiting Finance review.');
    if (input.transactionReference) {
      await lockPaymentReference(tx, input.transactionReference);
      const [usedP2pClaim, usedDeposit, usedManualClaim] = await Promise.all([
        tx.p2pPaymentClaim.findUnique({ where: { transactionReference: input.transactionReference }, select: { id: true } }),
        tx.deposit.findFirst({ where: { providerReference: input.transactionReference }, select: { id: true } }),
        tx.manualPaymentClaim.findUnique({ where: { transactionReference: input.transactionReference }, select: { id: true } }),
      ]);
      const usedP2pOrder = await tx.p2pDepositOrder.findFirst({ where: { providerReference: input.transactionReference }, select: { id: true } });
      const usedAdminCredit = await tx.adminPhonePeCreditRequest.findUnique({ where: { paymentReferenceHash: paymentReferenceHash(input.transactionReference) }, select: { id: true } });
      if (usedP2pClaim || usedDeposit || usedManualClaim || usedP2pOrder || usedAdminCredit) throw new HttpError(409, 'TRANSACTION_ALREADY_USED', 'This transaction reference is already attached to another payment.');
    }
    const image = Buffer.from(input.evidenceImageBase64, 'base64');
    const claim = await tx.p2pPaymentClaim.create({ data: {
      orderId: order.id, userId: req.auth!.userId, transactionReference: input.transactionReference ?? null,
      claimedAmountPaise: BigInt(input.claimedAmountPaise), claimedPaidAt: paidAt,
      evidenceImage: image, evidenceMimeType: input.evidenceMimeType,
    } });
    const updated = order.status === 'DISPUTED' ? order : await tx.p2pDepositOrder.update({ where: { id: order.id }, data: { status: 'PAYMENT_PROCESSING' } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_PAYMENT_REFERENCE_SUBMITTED', target: `P2P_DEPOSIT_ORDER:${order.id}`, reason: 'Buyer submitted an unverified UPI payment claim with a securely stored image and claimed payment details.', metadata: { claimId: claim.id, claimedAmountPaise: input.claimedAmountPaise, claimedPaidAt: paidAt.toISOString(), hasTransactionReference: Boolean(input.transactionReference), evidenceMimeType: input.evidenceMimeType } } });
    await tx.adminPushEvent.create({ data: {
      eventKey: `P2P_PAYMENT_PROOF:${claim.id}`,
      type: 'P2P_PAYMENT_PROOF_SUBMITTED',
      title: 'New Deposit Order · Verification Required',
      body: `New payment proof submitted for ${order.referenceId}. Open the Admin App to review.`,
      claimId: claim.id,
    } });
    return { claim, order: updated };
  });
  res.status(202).json({ claim: { id: result.claim.id, status: result.claim.status, transactionReference: result.claim.transactionReference, claimedAmountPaise: Number(result.claim.claimedAmountPaise), claimedPaidAt: result.claim.claimedPaidAt, createdAt: result.claim.createdAt, evidenceAttached: true }, order: { id: result.order.id, referenceId: result.order.referenceId, status: result.order.status }, message: 'Payment submitted. Waiting for verification. The UTR and image are unverified claims; no wallet credit was made.' });
}));

p2pRouter.post('/deposits/orders/:id/cancel', p2pLimit, asyncRoute(async (req, res) => {
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM p2p_deposit_orders WHERE id = ${req.params.id}::uuid FOR UPDATE`;
    const order = await tx.p2pDepositOrder.findFirst({ where: { id: req.params.id, buyerUserId: req.auth!.userId }, include: { withdrawalOffer: true, claims: { where: { status: 'PENDING_REVIEW' }, take: 1 } } });
    if (!order) throw new HttpError(404, 'P2P_ORDER_NOT_FOUND', 'Matched deposit order was not found.');
    const target = `P2P_DEPOSIT_ORDER:${order.id}`;
    if (order.claims.length) throw new HttpError(409, 'P2P_PROOF_ALREADY_SUBMITTED', 'Payment proof is awaiting Finance review. Normal cancellation is disabled; contact support if you need help.');
    if (['REJECTED', 'EXPIRED', 'COMPLETED', 'FAILED'].includes(order.status)) throw new HttpError(409, 'P2P_ORDER_CLOSED', 'This order is already closed and cannot be cancelled again.');
    if (order.status === 'CANCELLED_PAYMENT_HOLD') return { id: order.id, referenceId: order.referenceId, status: order.status, holdForSettlement: true, cancellationRequestedAt: order.cancellationRequestedAt };
    if (order.status === 'CANCELLED') return { id: order.id, referenceId: order.referenceId, status: order.status, holdForSettlement: false, cancellationRequestedAt: order.cancellationRequestedAt };
    const paymentMayHaveStarted = await p2pPaymentHandoffUnresolved(tx, order);
    if (order.status === 'PAYMENT_PENDING' && paymentMayHaveStarted) {
      const requestedAt = new Date();
      const updated = await tx.p2pDepositOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED_PAYMENT_HOLD', cancellationRequestedAt: requestedAt } });
      await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_CANCELLATION_REQUESTED', target, reason: 'Buyer requested cancellation after the UPI app handoff was recorded. The order and seller allocation remain held because an external payment may have occurred.', metadata: { orderReference: order.referenceId, amountPaise: order.amountPaise.toString(), currency: 'INR' } } });
      await tx.notification.create({ data: { userId: order.buyerUserId, title: 'Order cancelled', body: `Order ${order.referenceId} is cancelled and removed from Quick Deposit. If you already sent payment, contact PaisaPay support; do not pay again.` } });
      await tx.notification.create({ data: { userId: order.sellerUserId, title: 'Buyer cancelled a matched order', body: `Order ${order.referenceId} was cancelled after the UPI app handoff. Its amount remains held and is not available to another buyer until any payment is resolved.` } });
      return { id: updated.id, referenceId: updated.referenceId, status: updated.status, holdForSettlement: true, cancellationRequestedAt: requestedAt };
    }
    if (!['MATCHED', 'PAYMENT_PENDING'].includes(order.status)) throw new HttpError(409, 'P2P_ORDER_CANNOT_CANCEL', 'This order cannot be cancelled in its current state.');
    const requestedAt = new Date();
    await tx.p2pDepositOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancellationRequestedAt: requestedAt } });
    await tx.$queryRaw`SELECT id FROM p2p_withdrawal_offers WHERE id = ${order.withdrawalOfferId}::uuid FOR UPDATE`;
    const offer = await tx.p2pWithdrawalOffer.findUniqueOrThrow({ where: { id: order.withdrawalOfferId } });
    if (!['CANCELLED', 'EXPIRED', 'SETTLED'].includes(offer.status)) {
      const committed = await committedP2pAmount(tx, offer.id);
      const nextStatus = committed >= offer.amountPaise ? 'MATCHED' : committed > 0n ? 'PARTIALLY_MATCHED' : 'OPEN';
      await tx.p2pWithdrawalOffer.update({ where: { id: offer.id }, data: { status: nextStatus } });
      if (offer.expiresAt <= new Date()) await expireP2pOffers(tx);
    } else if (['CANCELLED', 'EXPIRED'].includes(offer.status)) {
      await releaseOfferFunds(tx, offer, req.auth!.userId, offer.status === 'EXPIRED' ? 'P2P_WITHDRAWAL_EXPIRED' : 'P2P_WITHDRAWAL_CANCELLED', order.amountPaise, `cancelled-order:${order.id}`);
    }
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_CANCELLATION_REQUESTED', target, reason: 'Buyer cancelled before a UPI app handoff was recorded; the allocation was released for rematching.' } });
    await tx.notification.create({ data: { userId: order.sellerUserId, title: 'Buyer cancelled before payment', body: `Order ${order.referenceId} was cancelled before a UPI app handoff. Its amount is available for another match if the offer is still open.` } });
    return { ...(await tx.p2pDepositOrder.findUniqueOrThrow({ where: { id: order.id }, select: { id: true, referenceId: true, status: true } })), holdForSettlement: false };
  });
  res.json({ order: result, message: result.holdForSettlement ? 'Order cancelled. The UPI app handoff was started, so the amount stays held until the payment outcome is resolved.' : 'Order cancelled. No UPI app handoff was recorded, so its amount is available again if the offer is still open.' });
}));

p2pRouter.get('/deposits/orders/my', asyncRoute(async (req, res) => {
  const db = databaseRequired();
  if (env.financialOperationsEnabled) await db.$transaction((tx) => expireUnconfirmedP2pMatches(tx));
  const rows = await db.p2pDepositOrder.findMany({ where: { OR: [{ buyerUserId: req.auth!.userId }, { sellerUserId: req.auth!.userId }] }, include: { withdrawalOffer: { select: { id: true, referenceId: true } }, claims: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, transactionReference: true, reviewReason: true, createdAt: true, claimedAmountPaise: true, claimedPaidAt: true, evidenceMimeType: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  const orderEvents = await p2pOrderEvents(db, rows.map((row) => row.id));
  const rewards = await db.ledgerTransaction.findMany({ where: { idempotencyKey: { in: rows.map((row) => `P2P_ORDER_REWARD:${row.id}`) } }, select: { idempotencyKey: true, metadata: true } });
  const rewardByOrder = new Map(rewards.map((reward) => [reward.idempotencyKey.slice('P2P_ORDER_REWARD:'.length), reward.metadata]));
  res.json({ serverTime: new Date(), orders: rows.map((row) => {
    const metadata = rewardByOrder.get(row.id) as Record<string, unknown> | undefined;
    const preview = row.buyerUserId === req.auth!.userId ? p2pRewardPreview(row.amountPaise) : undefined;
    return { ...row, viewerRole: row.buyerUserId === req.auth!.userId ? 'BUYER' : 'SELLER', amountPaise: Number(row.amountPaise), withdrawalOffer: row.withdrawalOffer, timestamps: p2pOrderTimestamps(row, orderEvents.get(row.id) ?? []), reward: preview ? { ...preview, creditedPaise: Number(metadata?.amountPaise ?? 0) } : undefined, claims: row.claims.map((claim) => ({ ...claim, claimedAmountPaise: claim.claimedAmountPaise === null ? null : Number(claim.claimedAmountPaise), evidenceAttached: Boolean(claim.evidenceMimeType), evidenceMimeType: undefined, transactionReference: row.buyerUserId === req.auth!.userId ? claim.transactionReference : undefined })) };
  }) });
}));

p2pRouter.get('/deposits/orders/:id', asyncRoute(async (req, res) => {
  const db = databaseRequired();
  if (env.financialOperationsEnabled) await db.$transaction((tx) => expireUnconfirmedP2pMatches(tx));
  const order = await db.p2pDepositOrder.findUnique({ where: { id: req.params.id }, include: { withdrawalOffer: { select: { referenceId: true } }, claims: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, transactionReference: true, createdAt: true, claimedAmountPaise: true, claimedPaidAt: true, evidenceMimeType: true } } } });
  if (!order || (order.buyerUserId !== req.auth!.userId && order.sellerUserId !== req.auth!.userId)) throw new HttpError(404, 'P2P_ORDER_NOT_FOUND', 'Matched deposit order was not found.');
  const reward = order.buyerUserId === req.auth!.userId ? await db.ledgerTransaction.findUnique({ where: { idempotencyKey: `P2P_ORDER_REWARD:${order.id}` }, select: { metadata: true } }) : null;
  const orderEvents = await p2pOrderEvents(db, [order.id]);
  const rewardMetadata = reward?.metadata as Record<string, unknown> | undefined;
  res.json({ serverTime: new Date(), order: { ...order, amountPaise: Number(order.amountPaise), timestamps: p2pOrderTimestamps(order, orderEvents.get(order.id) ?? []), reward: order.buyerUserId === req.auth!.userId ? { ...p2pRewardPreview(order.amountPaise), creditedPaise: Number(rewardMetadata?.amountPaise ?? 0) } : undefined, claims: order.claims.map((claim) => ({ ...claim, claimedAmountPaise: claim.claimedAmountPaise === null ? null : Number(claim.claimedAmountPaise), evidenceAttached: Boolean(claim.evidenceMimeType), evidenceMimeType: undefined, transactionReference: order.buyerUserId === req.auth!.userId ? claim.transactionReference : undefined })) } });
}));

p2pRouter.post('/orders/:id/dispute', p2pLimit, asyncRoute(async (req, res) => {
  const input = z.object({ reason: z.string().trim().min(8).max(500) }).strict().parse(req.body);
  const db = databaseRequired();
  const order = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM p2p_deposit_orders WHERE id = ${req.params.id}::uuid FOR UPDATE`;
    const current = await tx.p2pDepositOrder.findUnique({ where: { id: req.params.id } });
    if (!current || (current.buyerUserId !== req.auth!.userId && current.sellerUserId !== req.auth!.userId)) throw new HttpError(404, 'P2P_ORDER_NOT_FOUND', 'Matched deposit order was not found.');
    if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(current.status)) throw new HttpError(409, 'P2P_ORDER_CLOSED', 'A closed order cannot be disputed.');
    const updated = await tx.p2pDepositOrder.update({ where: { id: current.id }, data: { status: 'DISPUTED' } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_ORDER_DISPUTED', target: `P2P_DEPOSIT_ORDER:${current.id}`, reason: input.reason } });
    return updated;
  });
  res.status(202).json({ order: { id: order.id, referenceId: order.referenceId, status: order.status }, message: 'Dispute recorded. Reserved funds remain held while Finance reviews it.' });
}));

p2pRouter.get('/admin/p2p/offers', requireAdmin, asyncRoute(async (req, res) => {
  if (!['FINANCE', 'OPERATIONS', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role ?? '')) throw new HttpError(403, 'P2P_REVIEW_REQUIRED', 'Operations or Finance access is required.');
  const input = adminListInput.parse(req.query);
  const where = { ...(input.q ? { referenceId: { contains: input.q, mode: 'insensitive' as const } } : {}), ...(input.status ? { status: input.status as never } : {}) };
  const db = databaseRequired();
  const [total, offers] = await Promise.all([
    db.p2pWithdrawalOffer.count({ where }),
    db.p2pWithdrawalOffer.findMany({ where, include: { user: { select: { id: true, publicId: true, phoneE164: true, displayName: true } }, orders: { orderBy: { createdAt: 'desc' }, take: 25, include: { claims: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, createdAt: true, reviewReason: true, evidenceReference: true } } } }, _count: { select: { orders: true } } }, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
  ]);
  const orderTotals = offers.length ? await db.p2pDepositOrder.groupBy({ by: ['withdrawalOfferId', 'status'], where: { withdrawalOfferId: { in: offers.map((offer) => offer.id) } }, _sum: { amountPaise: true } }) : [];
  const totalsByOffer = new Map<string, Array<{ status: string; amountPaise: bigint }>>();
  for (const row of orderTotals) totalsByOffer.set(row.withdrawalOfferId, [...(totalsByOffer.get(row.withdrawalOfferId) ?? []), { status: row.status, amountPaise: row._sum.amountPaise ?? 0n }]);
  res.json({ offers: offers.map((offer) => {
    const aggregateOrders = totalsByOffer.get(offer.id) ?? [];
    const completed = aggregateOrders.filter((order) => order.status === 'COMPLETED').reduce((sum, order) => sum + order.amountPaise, 0n);
    const active = aggregateOrders.filter((order) => P2P_ACTIVE_ORDER_STATUSES.includes(order.status)).reduce((sum, order) => sum + order.amountPaise, 0n);
    const held = aggregateOrders.filter((order) => P2P_HELD_ORDER_STATUSES.includes(order.status)).reduce((sum, order) => sum + order.amountPaise, 0n);
    const committed = completed + active + held;
    const derivedStatus = deriveP2pOfferStatus(offer.status, offer.amountPaise, aggregateOrders);
    const matchable = !['CANCELLED', 'EXPIRED', 'SETTLED'].includes(offer.status);
    return { ...offer, status: derivedStatus, amountPaise: Number(offer.amountPaise), completedAmountPaise: Number(completed), activeReservedPaise: Number(active), disputedHeldPaise: Number(held), matchedAmountPaise: Number(committed), remainingAmountPaise: Number(offer.amountPaise > committed ? offer.amountPaise - committed : 0n), availableAmountPaise: Number(matchable && offer.amountPaise > committed ? offer.amountPaise - committed : 0n), payeeVpa: undefined, user: { ...offer.user, phoneMasked: `${offer.user.phoneE164.slice(0, 3)}••••${offer.user.phoneE164.slice(-3)}`, phoneE164: undefined }, orders: offer.orders.map((order) => ({ ...order, amountPaise: Number(order.amountPaise), buyer: 'REDACTED_FOR_ADMIN_LIST', verificationStatus: order.claims[0]?.status ?? 'NOT_SUBMITTED', handoffStatus: order.paymentHandoffStartedAt ? 'UPI_HANDOFF_REPORTED' : order.paymentDetailsShownAt ? 'PAYMENT_DETAILS_SHOWN' : 'NOT_STARTED' })), orderCount: offer._count.orders };
  }), page: input.page, pageSize: input.pageSize, total });
}));

p2pRouter.post('/admin/p2p/offers/:id/cancel', requireAdmin, asyncRoute(async (req, res) => {
  if (!['FINANCE', 'OPERATIONS', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role ?? '')) throw new HttpError(403, 'P2P_REVIEW_REQUIRED', 'Operations or Finance access is required.');
  assertFinancialOperationsEnabled();
  const input = z.object({ reason: z.string().trim().min(8).max(500) }).strict().parse(req.body);
  const db = databaseRequired();
  const offer = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM p2p_withdrawal_offers WHERE id = ${req.params.id}::uuid FOR UPDATE`;
    const current = await tx.p2pWithdrawalOffer.findUnique({ where: { id: req.params.id } });
    if (!current) throw new HttpError(404, 'OFFER_NOT_FOUND', 'Withdrawal offer was not found.');
    if (!['OPEN', 'PARTIALLY_MATCHED'].includes(current.status)) throw new HttpError(409, 'OFFER_NOT_CANCELLABLE', 'Only open or partially matched offers can be cancelled by an administrator.');
    const outstanding = await tx.p2pDepositOrder.count({ where: { withdrawalOfferId: current.id, status: { in: ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'PAYMENT_PROCESSING', 'DISPUTED'] } } });
    if (outstanding > 0) throw new HttpError(409, 'OFFER_HAS_PENDING_BUYERS', 'This offer has buyer payments pending; resolve those orders before cancelling the unmatched remainder.');
    const committed = await committedP2pAmount(tx, current.id);
    const unfilledPaise = current.amountPaise > committed ? current.amountPaise - committed : 0n;
    await tx.p2pWithdrawalOffer.update({ where: { id: current.id }, data: { status: 'CANCELLED' } });
    await releaseOfferFunds(tx, current, req.auth!.userId, 'P2P_WITHDRAWAL_CANCELLED', unfilledPaise);
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_WITHDRAWAL_OFFER_ADMIN_CANCELLED', target: `P2P_WITHDRAWAL_OFFER:${current.id}`, reason: input.reason, metadata: { amountPaise: current.amountPaise.toString(), releasedAmountPaise: unfilledPaise.toString(), currency: 'INR' } } });
    return { id: current.id, referenceId: current.referenceId, status: 'CANCELLED', amountPaise: Number(current.amountPaise) };
  });
  res.json({ offer, message: 'Unmatched offer remainder cancelled; the released amount and action were recorded in the ledger and audit log.' });
}));

p2pRouter.get('/admin/p2p/orders', requireAdmin, asyncRoute(async (req, res) => {
  if (!['FINANCE', 'OPERATIONS', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role ?? '')) throw new HttpError(403, 'P2P_REVIEW_REQUIRED', 'Operations or Finance access is required.');
  const input = adminListInput.parse(req.query);
  const db = databaseRequired();
  const where: Prisma.P2pDepositOrderWhereInput = {
    ...(input.q ? { OR: [
      { referenceId: { contains: input.q, mode: 'insensitive' } },
      { withdrawalOffer: { is: { referenceId: { contains: input.q, mode: 'insensitive' } } } },
    ] } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
  const [total, orders] = await Promise.all([db.p2pDepositOrder.count({ where }), db.p2pDepositOrder.findMany({
    where,
    include: { buyer: { select: { id: true, publicId: true, displayName: true, phoneE164: true } }, seller: { select: { id: true, publicId: true, displayName: true, phoneE164: true } }, withdrawalOffer: { select: { id: true, referenceId: true, status: true, paymentMethod: true, amountPaise: true, createdAt: true, expiresAt: true } }, claims: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, transactionReference: true, reviewReason: true, evidenceReference: true, verifiedAmountPaise: true, verifiedCurrency: true, receiverConfirmed: true, reviewedAt: true, createdAt: true } } },
    orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize,
  })]);
  const targetIds = orders.flatMap((order) => [`P2P_DEPOSIT_ORDER:${order.id}`, `P2P_WITHDRAWAL_OFFER:${order.withdrawalOfferId}`]);
  const audit = targetIds.length ? await db.auditLog.findMany({ where: { target: { in: targetIds } }, orderBy: { createdAt: 'asc' }, take: 3000 }) : [];
  const timelineByTarget = new Map<string, typeof audit>();
  for (const event of audit) timelineByTarget.set(event.target, [...(timelineByTarget.get(event.target) ?? []), event]);
  res.json({ orders: orders.map((order) => ({ ...order, amountPaise: Number(order.amountPaise), withdrawalOffer: { ...order.withdrawalOffer, amountPaise: Number(order.withdrawalOffer.amountPaise) }, buyer: { ...order.buyer, phoneMasked: `${order.buyer.phoneE164.slice(0, 3)}••••${order.buyer.phoneE164.slice(-3)}`, phoneE164: undefined }, seller: { ...order.seller, phoneMasked: `${order.seller.phoneE164.slice(0, 3)}••••${order.seller.phoneE164.slice(-3)}`, phoneE164: undefined }, claims: order.claims.map((claim) => ({ ...claim, verifiedAmountPaise: claim.verifiedAmountPaise === null ? null : Number(claim.verifiedAmountPaise) })), timeline: timelineByTarget.get(`P2P_DEPOSIT_ORDER:${order.id}`) ?? [] })), page: input.page, pageSize: input.pageSize, total });
}));

p2pRouter.get('/admin/p2p/claims', requireAdmin, asyncRoute(async (req, res) => {
  if (!['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role ?? '')) throw new HttpError(403, 'FINANCE_REVIEW_REQUIRED', 'Finance reviewer access is required.');
  assertFinancialOperationsEnabled();
  const db = databaseRequired(); const input = adminListInput.parse(req.query);
  const [total, claims] = await Promise.all([db.p2pPaymentClaim.count({ where: { status: 'PENDING_REVIEW' } }), db.p2pPaymentClaim.findMany({ where: { status: 'PENDING_REVIEW' }, select: {
    id: true, orderId: true, userId: true, transactionReference: true, status: true, claimedAmountPaise: true, claimedPaidAt: true,
    evidenceMimeType: true, evidenceReference: true, reviewReason: true, createdAt: true,
    order: { select: { id: true, referenceId: true, amountPaise: true, status: true, createdAt: true, expiresAt: true, paymentDetailsShownAt: true, paymentHandoffStartedAt: true, cancellationRequestedAt: true, seller: { select: { id: true, publicId: true } }, withdrawalOffer: { select: { id: true, referenceId: true, payeeVpa: true, payeeName: true } } } },
    user: { select: { id: true, publicId: true, phoneE164: true, displayName: true } },
  }, orderBy: { createdAt: 'asc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize })]);
  const events = claims.length ? await db.auditLog.findMany({ where: { target: { in: claims.map((claim) => `P2P_DEPOSIT_ORDER:${claim.orderId}`) } }, orderBy: { createdAt: 'asc' }, select: { target: true, action: true, createdAt: true, reason: true } }) : [];
  const eventMap = new Map<string, typeof events>();
  for (const event of events) eventMap.set(event.target, [...(eventMap.get(event.target) ?? []), event]);
  res.json({ claims: claims.map((claim) => ({
    ...claim, claimedAmountPaise: claim.claimedAmountPaise === null ? null : Number(claim.claimedAmountPaise), evidenceAttached: Boolean(claim.evidenceMimeType),
    user: { ...claim.user, phoneMasked: `${claim.user.phoneE164.slice(0, 3)}••••${claim.user.phoneE164.slice(-3)}`, phoneE164: undefined },
    order: { ...claim.order, amountPaise: Number(claim.order.amountPaise), timestamps: p2pOrderTimestamps(claim.order, eventMap.get(`P2P_DEPOSIT_ORDER:${claim.orderId}`) ?? []), timeline: eventMap.get(`P2P_DEPOSIT_ORDER:${claim.orderId}`) ?? [], withdrawalOffer: claim.order.withdrawalOffer },
  })), page: input.page, pageSize: input.pageSize, total });
}));

p2pRouter.get('/admin/p2p/claims/:claimId', requireAdmin, asyncRoute(async (req, res) => {
  if (!['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role ?? '')) throw new HttpError(403, 'FINANCE_REVIEW_REQUIRED', 'Finance reviewer access is required.');
  assertFinancialOperationsEnabled();
  const db = databaseRequired();
  const claim = await db.p2pPaymentClaim.findUnique({ where: { id: req.params.claimId }, select: {
    id: true, status: true, transactionReference: true, claimedAmountPaise: true, claimedPaidAt: true, evidenceMimeType: true, createdAt: true, reviewReason: true,
    user: { select: { id: true, publicId: true, displayName: true, phoneE164: true } },
    order: { select: { id: true, referenceId: true, buyerUserId: true, sellerUserId: true, amountPaise: true, currency: true, status: true, createdAt: true, expiresAt: true, paymentDetailsShownAt: true, paymentHandoffStartedAt: true, cancellationRequestedAt: true, seller: { select: { id: true, publicId: true } }, withdrawalOffer: { select: { id: true, referenceId: true, payeeVpa: true, payeeName: true } } } },
  } });
  if (!claim) throw new HttpError(404, 'P2P_CLAIM_NOT_FOUND', 'Payment verification claim was not found.');
  const events = await p2pOrderEvents(db, [claim.order.id]);
  const timeline = events.get(claim.order.id) ?? [];
  res.json({ claim: {
    ...claim,
    claimedAmountPaise: claim.claimedAmountPaise === null ? null : Number(claim.claimedAmountPaise),
    evidenceAttached: Boolean(claim.evidenceMimeType),
    user: { id: claim.user.id, publicId: claim.user.publicId, displayName: claim.user.displayName, phoneMasked: `${claim.user.phoneE164.slice(0, 3)}••••${claim.user.phoneE164.slice(-3)}` },
    order: { ...claim.order, amountPaise: Number(claim.order.amountPaise), timestamps: p2pOrderTimestamps(claim.order, timeline), timeline },
  } });
}));

p2pRouter.get('/admin/p2p/claims/:claimId/evidence', requireAdmin, asyncRoute(async (req, res) => {
  if (!['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role ?? '')) throw new HttpError(403, 'FINANCE_REVIEW_REQUIRED', 'Finance reviewer access is required.');
  assertFinancialOperationsEnabled();
  const claim = await databaseRequired().p2pPaymentClaim.findUnique({ where: { id: req.params.claimId }, select: { evidenceImage: true, evidenceMimeType: true } });
  if (!claim?.evidenceImage || !claim.evidenceMimeType) throw new HttpError(404, 'P2P_PAYMENT_EVIDENCE_NOT_FOUND', 'No payment image is attached to this claim.');
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="p2p-payment-evidence"' });
  res.type(claim.evidenceMimeType).send(Buffer.from(claim.evidenceImage));
}));

p2pRouter.post('/admin/p2p/claims/:id/review', requireAdmin, asyncRoute(async (req, res) => {
  if (!['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role ?? '')) throw new HttpError(403, 'FINANCE_REVIEW_REQUIRED', 'Finance reviewer access is required.');
  assertFinancialOperationsEnabled();
  const input = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().min(8).max(500), evidenceReference: z.string().trim().min(3).max(160), verifiedTransactionReference: transactionReference.optional(), verifiedAmountPaise: z.number().int().positive().optional(), verifiedCurrency: z.string().length(3).optional(), verifiedPayeeVpa: z.string().trim().min(3).max(100).optional(), receiverConfirmed: z.boolean().optional(), paymentNotReceivedConfirmed: z.boolean().optional() }).strict().superRefine((value, ctx) => {
    if (value.decision === 'APPROVE') for (const key of ['verifiedTransactionReference', 'verifiedAmountPaise', 'verifiedCurrency', 'verifiedPayeeVpa', 'receiverConfirmed'] as const) if (value[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: 'Required for approval.' });
    if (value.decision === 'REJECT' && value.paymentNotReceivedConfirmed !== true) ctx.addIssue({ code: 'custom', path: ['paymentNotReceivedConfirmed'], message: 'Finance must confirm from recipient-side records that no payment was received and no late payment is pending before releasing the reservation.' });
  }).parse(req.body);
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    const initial = await tx.p2pPaymentClaim.findUnique({ where: { id: req.params.id }, select: { orderId: true } });
    if (!initial) throw new HttpError(404, 'P2P_CLAIM_NOT_FOUND', 'P2P payment claim was not found.');
    await tx.$queryRaw`SELECT id FROM p2p_deposit_orders WHERE id = ${initial.orderId}::uuid FOR UPDATE`;
    const claim = await tx.p2pPaymentClaim.findUniqueOrThrow({ where: { id: req.params.id }, include: { order: { include: { withdrawalOffer: true } } } });
    if (claim.status !== 'PENDING_REVIEW') throw new HttpError(409, 'P2P_CLAIM_ALREADY_REVIEWED', 'This payment claim has already been reviewed.');
    if (input.decision === 'REJECT') {
      if (!P2P_CLAIM_REVIEWABLE_ORDER_STATUSES.includes(claim.order.status)) throw new HttpError(409, 'P2P_ORDER_NOT_REVIEWABLE', 'This matched order is not awaiting independent payment review.');
      await tx.$queryRaw`SELECT id FROM p2p_withdrawal_offers WHERE id = ${claim.order.withdrawalOfferId}::uuid FOR UPDATE`;
      const updated = await tx.p2pPaymentClaim.update({ where: { id: claim.id }, data: { status: 'REJECTED', reviewedByUserId: req.auth!.userId, reviewedAt: new Date(), reviewReason: input.reason, evidenceReference: input.evidenceReference } });
      const rejectedOrder = await tx.p2pDepositOrder.update({ where: { id: claim.orderId }, data: { status: 'REJECTED' } });
      // If the seller cancelled the unfilled offer while this payment claim was
      // pending, Finance rejection establishes that this allocation was not
      // received; release only this buyer's held allocation. Active offers keep
      // the reservation available for another eligible match.
      if (['CANCELLED', 'EXPIRED'].includes(claim.order.withdrawalOffer.status)) {
        await releaseOfferFunds(tx, claim.order.withdrawalOffer, req.auth!.userId, 'P2P_WITHDRAWAL_CANCELLED', claim.order.amountPaise, `resolved-order:${claim.orderId}`);
      }
      const committed = await committedP2pAmount(tx, claim.order.withdrawalOfferId);
      const remainingPaise = claim.order.withdrawalOffer.amountPaise > committed ? claim.order.withdrawalOffer.amountPaise - committed : 0n;
      const nextOfferStatus = committed === 0n ? 'OPEN' : committed >= claim.order.withdrawalOffer.amountPaise ? 'MATCHED' : 'PARTIALLY_MATCHED';
      const offerStatus = ['CANCELLED', 'EXPIRED', 'SETTLED'].includes(claim.order.withdrawalOffer.status) ? claim.order.withdrawalOffer.status : nextOfferStatus;
      if (!['CANCELLED', 'EXPIRED', 'SETTLED'].includes(claim.order.withdrawalOffer.status)) {
        await tx.p2pWithdrawalOffer.update({ where: { id: claim.order.withdrawalOfferId }, data: { status: offerStatus } });
      }
      await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_PAYMENT_CLAIM_REJECTED_ORDER_CLOSED', target: `P2P_DEPOSIT_ORDER:${claim.orderId}`, reason: input.reason, metadata: { claimId: claim.id, evidenceReference: input.evidenceReference, previousOrderStatus: claim.order.status, orderStatus: rejectedOrder.status, offerStatus, rematchableAmountPaise: remainingPaise.toString(), paymentNotReceivedConfirmed: true, currency: 'INR' } } });
      await tx.notification.createMany({ data: [
        { userId: claim.order.buyerUserId, title: 'Your deposit was rejected', body: `Order ${claim.order.referenceId}: ${input.reason} No wallet credit was made. Do not pay using the old order details. Contact PaisaPay support if you believe this decision is incorrect.` },
        { userId: claim.order.sellerUserId, title: 'P2P offer available again', body: `Order ${claim.order.referenceId} was cancelled after review. Its amount is available for another buyer match.` },
      ] });
      return { claim: updated, orderStatus: rejectedOrder.status, offerStatus, rematchableAmountPaise: remainingPaise, credited: false };
    }
    const evidenceError = validateP2pEvidence({ claimedReference: claim.transactionReference, verifiedReference: input.verifiedTransactionReference!, expectedAmountPaise: claim.order.amountPaise, verifiedAmountPaise: BigInt(input.verifiedAmountPaise!), currency: input.verifiedCurrency!, receiverConfirmed: input.receiverConfirmed! });
    if (evidenceError) throw new HttpError(409, evidenceError, 'Approval requires independently verified exact transaction reference, INR amount, and recipient receipt.');
    if (input.verifiedPayeeVpa !== claim.order.withdrawalOffer.payeeVpa) throw new HttpError(409, 'PAYEE_MISMATCH', 'Verified recipient UPI ID does not match the payee on this matched offer.');
    if (!P2P_CLAIM_REVIEWABLE_ORDER_STATUSES.includes(claim.order.status) || !['MATCHED', 'PARTIALLY_MATCHED', 'CANCELLED'].includes(claim.order.withdrawalOffer.status)) throw new HttpError(409, 'P2P_ORDER_NOT_REVIEWABLE', 'This matched order is not awaiting independent payment review.');
    await lockPaymentReference(tx, input.verifiedTransactionReference);
    const [usedDeposit, usedP2pOrder, usedManualClaim] = await Promise.all([
      tx.deposit.findFirst({ where: { providerReference: input.verifiedTransactionReference! }, select: { id: true } }),
      tx.p2pDepositOrder.findFirst({ where: { providerReference: input.verifiedTransactionReference!, id: { not: claim.orderId } }, select: { id: true } }),
      tx.manualPaymentClaim.findUnique({ where: { transactionReference: input.verifiedTransactionReference! }, select: { id: true } }),
    ]);
    const usedAdminCredit = await tx.adminPhonePeCreditRequest.findUnique({ where: { paymentReferenceHash: paymentReferenceHash(input.verifiedTransactionReference!) }, select: { id: true } });
    if (usedDeposit || usedP2pOrder || usedManualClaim || usedAdminCredit) throw new HttpError(409, 'TRANSACTION_ALREADY_USED', 'This transaction reference is already attached to another payment.');
    const sellerReserved = await getLedgerAccount(tx, claim.order.sellerUserId, 'RESERVED');
    const buyerAvailable = await getLedgerAccount(tx, claim.order.buyerUserId, 'AVAILABLE');
    await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${sellerReserved.id}::uuid, ${buyerAvailable.id}::uuid) ORDER BY id FOR UPDATE`;
    const reservedBalance = await tx.$queryRaw<Array<{ balance: bigint }>>`SELECT COALESCE(SUM(credit_paise - debit_paise),0)::bigint AS balance FROM ledger_entries WHERE account_id = ${sellerReserved.id}::uuid`;
    if (!reservedBalance[0] || reservedBalance[0].balance < claim.order.amountPaise) throw new HttpError(409, 'RESERVED_BALANCE_MISMATCH', 'The seller reservation no longer covers this order; Finance review is required.');
    const ledger = await tx.ledgerTransaction.create({ data: {
      eventType: 'P2P_PAYMENT_VERIFIED', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: claim.orderId,
      idempotencyKey: `P2P_PAYMENT_VERIFIED:${claim.orderId}`, actorUserId: req.auth!.userId,
      metadata: { amountPaise: claim.order.amountPaise.toString(), currency: 'INR', providerReference: input.verifiedTransactionReference!, evidenceReference: input.evidenceReference, claimId: claim.id },
      entries: { create: [ { accountId: sellerReserved.id, debitPaise: claim.order.amountPaise }, { accountId: buyerAvailable.id, creditPaise: claim.order.amountPaise } ] },
    } });
    const updatedClaim = await tx.p2pPaymentClaim.update({ where: { id: claim.id }, data: { status: 'APPROVED', reviewedByUserId: req.auth!.userId, reviewedAt: new Date(), reviewReason: input.reason, evidenceReference: input.evidenceReference, verifiedAmountPaise: BigInt(input.verifiedAmountPaise!), verifiedCurrency: 'INR', receiverConfirmed: true } });
    await tx.p2pDepositOrder.update({ where: { id: claim.orderId }, data: { status: 'COMPLETED', providerReference: input.verifiedTransactionReference! } });
    const rewardPaise = await grantVerifiedP2pOrderReward(tx, { orderId: claim.orderId, userId: claim.order.buyerUserId, actorUserId: req.auth!.userId, amountPaise: claim.order.amountPaise });
    const referralCommission = await grantVerifiedReferralCommission(tx, { orderId: claim.orderId, buyerUserId: claim.order.buyerUserId, actorUserId: req.auth!.userId, amountPaise: claim.order.amountPaise });
    const completed = await tx.p2pDepositOrder.aggregate({ where: { withdrawalOfferId: claim.order.withdrawalOfferId, status: 'COMPLETED' }, _sum: { amountPaise: true } });
    const committed = await committedP2pAmount(tx, claim.order.withdrawalOfferId);
    const nextOfferStatus = (completed._sum.amountPaise ?? 0n) >= claim.order.withdrawalOffer.amountPaise
      ? 'SETTLED'
      : committed >= claim.order.withdrawalOffer.amountPaise ? 'MATCHED' : 'PARTIALLY_MATCHED';
    const offerStatus = ['CANCELLED', 'EXPIRED', 'SETTLED'].includes(claim.order.withdrawalOffer.status) ? claim.order.withdrawalOffer.status : nextOfferStatus;
    if (!['CANCELLED', 'EXPIRED'].includes(claim.order.withdrawalOffer.status)) {
      await tx.p2pWithdrawalOffer.update({ where: { id: claim.order.withdrawalOfferId }, data: { status: offerStatus } });
      await expireP2pOffers(tx);
    }
    await tx.reconciliationRecord.create({ data: { provider: 'MANUAL_P2P_UPI', providerReference: input.verifiedTransactionReference!, internalReference: claim.order.referenceId, amountPaise: claim.order.amountPaise, currency: 'INR', status: 'APPROVED' } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'P2P_PAYMENT_CLAIM_APPROVED', target: `P2P_DEPOSIT_ORDER:${claim.orderId}`, reason: input.reason, metadata: { claimId: claim.id, evidenceReference: input.evidenceReference, amountPaise: claim.order.amountPaise.toString(), currency: 'INR', receiverConfirmed: true, ledgerTransactionId: ledger.id } } });
    await tx.notification.createMany({ data: [
      { userId: claim.order.buyerUserId, title: 'Congratulations! Your deposit was successful.', body: `Order ${claim.order.referenceId}: ₹${(Number(claim.order.amountPaise) / 100).toFixed(2)} deposit${rewardPaise > 0n ? ` + ₹${(Number(rewardPaise) / 100).toFixed(2)} eligible reward = ₹${(Number(claim.order.amountPaise + rewardPaise) / 100).toFixed(2)} credited` : ' credited. No funded reward was available for this order'}. View your receipt in Quick Deposit.` },
      { userId: claim.order.sellerUserId, title: offerStatus === 'SETTLED' ? 'P2P withdrawal settled' : 'P2P payment verified', body: offerStatus === 'SETTLED' ? `Offer ${claim.order.withdrawalOffer.referenceId} was fully settled after Finance verified receipt.` : offerStatus === 'CANCELLED' || offerStatus === 'EXPIRED' ? `A matched order for offer ${claim.order.withdrawalOffer.referenceId} was verified and settled. The offer remains ${offerStatus.toLowerCase()}; its unmatched amount is not available to new buyers.` : `A partial payment was verified for offer ${claim.order.withdrawalOffer.referenceId}. Other buyers may still match its remaining amount.` },
    ] });
    return { claim: updatedClaim, orderStatus: 'COMPLETED', offerStatus, credited: true, rewardPaise, referralCommission };
  }, { isolationLevel: 'Serializable' });
  res.json({ claim: { id: result.claim.id, status: result.claim.status }, orderStatus: result.orderStatus, offerStatus: result.offerStatus, rematchableAmountPaise: result.rematchableAmountPaise === undefined ? undefined : Number(result.rematchableAmountPaise), credited: result.credited, rewardPaise: Number(result.rewardPaise ?? 0n), referralCommissionPaise: Number(result.referralCommission?.amountPaise ?? 0n), referralCommissionStatus: result.referralCommission?.status ?? 'NONE', message: result.credited ? `Finance verified the exact receipt. The buyer was credited once; reward credited ₹${(Number(result.rewardPaise) / 100).toFixed(2)}; offer status is ${result.offerStatus}.` : 'Claim rejected, buyer order cancelled and its amount released for another match. No wallet credit was made.' });
}));

async function getLedgerAccount(tx: import('../../generated/prisma/client.js').Prisma.TransactionClient, userId: string, type: 'AVAILABLE' | 'RESERVED') {
  return tx.ledgerAccount.upsert({ where: { userId_type_currency: { userId, type, currency: 'INR' } }, create: { userId, type, currency: 'INR' }, update: {}, select: { id: true } });
}

