import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { databaseRequired } from '../../lib/db.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { uuidRef } from '../../lib/security.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { assertFinancialOperationsEnabled, assertManualUpiOperationsEnabled } from '../../middleware/financialOperations.js';
import { getPaymentMethodAvailability, summarizeWalletActivation } from './availability.js';
import { validateManualReviewEvidence } from './manualReview.js';
import { grantVerifiedUpiDepositReward } from './depositReward.js';
import { recordVerifiedReferralCommission } from '../users/referralCommission.js';
import { expireUnpaidUpiDeposits, UPI_DEPOSIT_EXPIRY_MS } from './depositExpiry.js';
import { createCashfreeOrder, getCashfreeOrder, getCashfreePayments, verifyCashfreeWebhook, type CashfreePayment } from '../../integrations/payments/cashfree.js';
import { createHash } from 'node:crypto';
import { decodeManualClaimImage, validateUpiUtr } from './manualClaimEvidence.js';
import { lockPaymentReference } from './paymentReferenceLock.js';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);
const MANUAL_DEPOSIT_CLEARING_ACCOUNT_ID = '00000000-0000-4000-8000-000000000097';
const manualClaimLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 6, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'TOO_MANY_CLAIMS', message: 'Too many manual payment claims. Wait before trying again.' } } });
const adminReviewLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'TOO_MANY_REVIEWS', message: 'Too many review requests. Wait before trying again.' } } });

const methods = {
  UPI: { enum: 'UPI' as const, buy: false, sell: false },
  Paytm: { enum: 'PAYTM' as const, buy: true, sell: true },
  PhonePe: { enum: 'PHONEPE' as const, buy: false, sell: true },
  Navi: { enum: 'NAVI' as const, buy: false, sell: true },
  Cashfree: { enum: 'CASHFREE' as const, buy: false, sell: false },
};

function toPaise(value: unknown): bigint | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) return null;
  return BigInt(Math.round(amount * 100));
}

async function confirmCashfreeDeposit(depositId: string, order: Awaited<ReturnType<typeof getCashfreeOrder>>, payments: CashfreePayment[]) {
  const db = databaseRequired();
  const deposit = await db.deposit.findUnique({ where: { id: depositId } });
  if (!deposit || deposit.method !== 'CASHFREE') return false;
  if (order.order_id !== deposit.merchantReference || order.order_status !== 'PAID'
    || toPaise(order.order_amount) !== deposit.amountPaise || order.order_currency !== 'INR') return false;
  const payment = payments.find((item) => item.order_id === deposit.merchantReference
    && item.payment_status === 'SUCCESS'
    && item.payment_currency === 'INR'
    && toPaise(item.payment_amount) === deposit.amountPaise
    && item.cf_payment_id !== undefined);
  if (!payment) return false;
  const providerEventId = String(payment.cf_payment_id);
  const payloadHash = createHash('sha256').update(JSON.stringify({ order: deposit.merchantReference, payment: providerEventId, amountPaise: deposit.amountPaise.toString() })).digest('hex');
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM deposits WHERE id = ${deposit.id}::uuid FOR UPDATE`;
    const current = await tx.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    if (current.status === 'PAYMENT_VERIFIED' || current.status === 'COMPLETED') return;
    const event = await tx.paymentProviderEvent.createMany({ data: [{ provider: 'CASHFREE', providerEventId, payloadHash, signatureVerified: true, status: 'VERIFIED', processedAt: new Date() }], skipDuplicates: true });
    if (event.count !== 1) return;
    await tx.deposit.update({ where: { id: current.id }, data: { status: 'PAYMENT_VERIFIED', providerReference: providerEventId } });
  }, { isolationLevel: 'ReadCommitted' });
  return true;
}

async function startCashfreeCheckout(input: { depositId: string; userId: string }) {
  const db = databaseRequired();
  const deposit = await db.deposit.findUniqueOrThrow({ where: { id: input.depositId } });
  const user = await db.user.findUniqueOrThrow({ where: { id: input.userId }, select: { phoneE164: true } });
  const checkout = await createCashfreeOrder({ orderId: deposit.merchantReference, idempotencyKey: deposit.id, amountPaise: Number(deposit.amountPaise), userId: input.userId, phoneE164: user.phoneE164 });
  const updated = await db.deposit.update({ where: { id: deposit.id }, data: { paymentSessionId: checkout.paymentSessionId } });
  return { deposit: { ...updated, amountPaise: Number(updated.amountPaise), method: 'Cashfree' }, paymentStarted: true, checkout: { ...checkout, environment: 'SANDBOX' as const }, message: 'Cashfree sandbox checkout created. A sandbox verification does not add redeemable funds to your PaisaPay balance.' };
}

export async function handleCashfreeWebhook(req: import('express').Request, res: import('express').Response) {
  const raw = (req as import('express').Request & { rawBody?: Buffer }).rawBody;
  if (!raw || !verifyCashfreeWebhook(raw, req.header('x-webhook-signature'), req.header('x-webhook-timestamp'))) {
    res.status(401).json({ error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Payment notification could not be authenticated.' } });
    return;
  }
  let event: { type?: string; data?: { order?: { order_id?: string }; payment?: CashfreePayment } };
  try { event = JSON.parse(raw.toString('utf8')) as typeof event; } catch {
    res.status(400).json({ error: { code: 'INVALID_WEBHOOK', message: 'Payment notification is malformed.' } }); return;
  }
  const orderId = event.data?.order?.order_id;
  const payment = event.data?.payment;
  if (typeof orderId !== 'string' || !payment || String(payment.cf_payment_id ?? '') === '') {
    res.status(400).json({ error: { code: 'INVALID_WEBHOOK', message: 'Payment notification is missing its order or transaction reference.' } }); return;
  }
  try {
    const db = databaseRequired();
    const deposit = await db.deposit.findFirst({ where: { merchantReference: orderId, method: 'CASHFREE' }, select: { id: true } });
    if (deposit) {
      const [order, payments] = await Promise.all([getCashfreeOrder(orderId), getCashfreePayments(orderId)]);
      await confirmCashfreeDeposit(deposit.id, order, payments);
    }
    res.status(200).json({ received: true });
  } catch {
    res.status(503).json({ error: { code: 'WEBHOOK_PROCESSING_UNAVAILABLE', message: 'Payment notification was authenticated but could not be processed yet.' } });
  }
}

paymentsRouter.get('/wallet-methods', asyncRoute(async (req, res) => {
  const db = databaseRequired();
  const [availability, wallets] = await Promise.all([
    getPaymentMethodAvailability(),
    db.walletAccount.findMany({ where: { userId: req.auth!.userId }, select: { status: true } }),
  ]);
  res.json({
    ...availability,
    walletActivation: summarizeWalletActivation(wallets.map((wallet) => wallet.status)),
  });
}));

paymentsRouter.post('/deposits', asyncRoute(async (req, res) => {
  const requestedMethod = req.body && typeof req.body === 'object' ? (req.body as { method?: unknown }).method : undefined;
  if (requestedMethod === 'UPI') assertManualUpiOperationsEnabled();
  else if (typeof requestedMethod === 'string' && Object.hasOwn(methods, requestedMethod)) assertFinancialOperationsEnabled();
  else if (!env.financialOperationsEnabled && !env.manualUpiOperationsEnabled) assertFinancialOperationsEnabled();
  const input = z.object({ amountPaise: z.number().int().min(1), method: z.enum(['UPI', 'Paytm', 'PhonePe', 'Navi', 'Cashfree']) }).strict().parse(req.body);
  if (input.amountPaise % 10_000 !== 0) {
    throw new HttpError(400, 'DEPOSIT_AMOUNT_INCREMENT_INVALID', 'Deposit amount must be in increments of ₹100 (for example ₹100, ₹200, or ₹500).');
  }
  if (input.method === 'UPI' && (input.amountPaise < env.minDepositPaise || input.amountPaise > env.maxDepositPaise)) {
    throw new HttpError(400, 'DEPOSIT_AMOUNT_OUT_OF_RANGE', `Deposit amount must be between ₹${(env.minDepositPaise / 100).toFixed(2)} and ₹${(env.maxDepositPaise / 100).toFixed(2)}.`);
  }
  if (input.method === 'UPI' && !env.depositReceiverUpiId) {
    throw new HttpError(503, 'DEPOSIT_RECEIVER_NOT_CONFIGURED', 'UPI deposits are unavailable because no authorized recipient is configured. No deposit was created.');
  }
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 120) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header between 8 and 120 characters.');
  const db = databaseRequired();
  const prior = await db.deposit.findUnique({ where: { idempotencyKey: key } });
  if (prior) {
    if (prior.userId !== req.auth!.userId || Number(prior.amountPaise) !== input.amountPaise || prior.method !== methods[input.method].enum) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
    if (input.method === 'Cashfree' && !prior.paymentSessionId && prior.status === 'PENDING_PAYMENT') {
      try { return res.json(await startCashfreeCheckout({ depositId: prior.id, userId: req.auth!.userId })); }
      catch { throw new HttpError(503, 'CASHFREE_CHECKOUT_UNAVAILABLE', 'Cashfree sandbox checkout could not be created. Retry this same request safely.'); }
    }
    return res.json({ deposit: { ...prior, amountPaise: Number(prior.amountPaise), method: input.method }, paymentStarted: Boolean(prior.paymentSessionId), ...(prior.paymentSessionId ? { checkout: { orderId: prior.merchantReference, paymentSessionId: prior.paymentSessionId, environment: 'SANDBOX' } } : {}) });
  }
  const methodAvailability = (await getPaymentMethodAvailability()).methods.find((item) => item.method === methods[input.method].enum);
  if (!methodAvailability?.available && input.method !== 'UPI') {
    throw new HttpError(503, 'DEPOSIT_PROVIDER_UNAVAILABLE', methodAvailability?.availabilityMessage ?? 'This payment method is unavailable. No deposit was created.');
  }
  const createData = {
    userId: req.auth!.userId,
    amountPaise: BigInt(input.amountPaise),
    method: methods[input.method].enum,
    status: 'PENDING_PAYMENT',
    merchantReference: uuidRef('PPDEP'),
    idempotencyKey: key,
    ...(input.method === 'UPI' ? { expiresAt: new Date(Date.now() + UPI_DEPOSIT_EXPIRY_MS) } : {}),
  } as const;
  let deposit;
  if (input.method === 'UPI') {
    const creation = await db.$transaction(async (tx) => {
      // Serialize same-user creates so simultaneous taps cannot open two new deposits.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.auth!.userId}::uuid FOR UPDATE`;
      await tx.deposit.updateMany({ where: { userId: req.auth!.userId, method: 'UPI', status: { in: ['CREATED', 'PENDING_PAYMENT'] }, expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } });
      const pending = await tx.deposit.findMany({
        where: { userId: req.auth!.userId, method: 'UPI', status: { in: ['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, amountPaise: true, status: true, createdAt: true, expiresAt: true, merchantReference: true },
        take: 20,
      });
      if (pending.length >= 2) return { pending };
      return { deposit: await tx.deposit.create({ data: createData }) };
    }, { isolationLevel: 'Serializable' });
    if (creation.pending) return res.status(409).json({
      error: { code: 'PENDING_DEPOSIT_EXISTS', message: 'You can have up to 2 active deposits at a time. Pay, cancel, or wait for one to expire before creating another.' },
      pendingDeposits: creation.pending.map((item) => ({ ...item, amountPaise: Number(item.amountPaise), receiverVpa: env.depositReceiverUpiId })),
    });
    deposit = creation.deposit!;
  } else {
    deposit = await db.deposit.create({ data: createData });
  }
  if (input.method === 'Cashfree') {
    try {
      return res.status(201).json(await startCashfreeCheckout({ depositId: deposit.id, userId: req.auth!.userId }));
    } catch {
      throw new HttpError(503, 'CASHFREE_CHECKOUT_UNAVAILABLE', 'Cashfree sandbox could not create a checkout. No payment was confirmed and no wallet balance was credited. Retry using the same idempotency key.');
    }
  }
  if (input.method === 'UPI') {
    res.status(201).json({
      deposit: { ...deposit, amountPaise: input.amountPaise, method: 'UPI', receiverVpa: env.depositReceiverUpiId },
      paymentStarted: false,
      manualVerificationAvailable: true,
      automaticVerificationAvailable: false,
      message: 'UPI payment handoff is available. This order remains pending until Finance independently confirms the exact receipt in merchant records.',
    });
    return;
  }
  res.status(201).json({ deposit: { ...deposit, amountPaise: input.amountPaise, method: input.method }, paymentStarted: false, message: 'Request recorded. No payment provider is configured, so no payment was started and no balance was credited.' });
}));

paymentsRouter.get('/deposits', asyncRoute(async (req, res) => {
  const db = databaseRequired();
  if (env.manualUpiOperationsEnabled) await expireUnpaidUpiDeposits(db);
  const deposits = await db.deposit.findMany({ where: { userId: req.auth!.userId }, include: { manualPaymentClaim: { select: { status: true, createdAt: true, reviewedAt: true, reviewReason: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ currency: 'INR', deposits: deposits.map((item) => ({ ...item, amountPaise: Number(item.amountPaise), method: Object.keys(methods).find((name) => methods[name as keyof typeof methods].enum === item.method) ?? (item.method === 'MOBIKWIK' ? 'MobiKwik (legacy)' : item.method) })) });
}));

paymentsRouter.post('/deposits/:id/cancel', asyncRoute(async (req, res) => {
  assertManualUpiOperationsEnabled();
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM deposits WHERE id = ${req.params.id}::uuid FOR UPDATE`;
    const deposit = await tx.deposit.findFirst({ where: { id: req.params.id, userId: req.auth!.userId }, include: { manualPaymentClaim: { select: { status: true } } } });
    if (!deposit) throw new HttpError(404, 'DEPOSIT_NOT_FOUND', 'Deposit was not found.');
    if (deposit.method !== 'UPI') throw new HttpError(409, 'DEPOSIT_NOT_CANCELLABLE', 'Only unpaid UPI deposits can be cancelled here.');
    if (deposit.status === 'CANCELLED' || deposit.status === 'EXPIRED') return deposit;
    if (!['CREATED', 'PENDING_PAYMENT'].includes(deposit.status) || deposit.manualPaymentClaim?.status === 'PENDING_REVIEW') {
      throw new HttpError(409, 'DEPOSIT_NOT_CANCELLABLE', 'This deposit has a submitted payment reference or is no longer awaiting payment.');
    }
    if (deposit.expiresAt && deposit.expiresAt <= new Date()) {
      return tx.deposit.update({ where: { id: deposit.id }, data: { status: 'EXPIRED' }, include: { manualPaymentClaim: { select: { status: true } } } });
    }
    return tx.deposit.update({ where: { id: deposit.id }, data: { status: 'CANCELLED' }, include: { manualPaymentClaim: { select: { status: true } } } });
  }, { isolationLevel: 'Serializable' });
  res.json({ deposit: { id: result.id, status: result.status, expiresAt: result.expiresAt }, message: result.status === 'CANCELLED' ? 'Deposit cancelled. No wallet credit was made.' : 'This deposit is expired. If you already paid, submit its reference for manual review; do not pay again.' });
}));

paymentsRouter.post('/deposits/:id/manual-verification', manualClaimLimit, asyncRoute(async (req, res) => {
  assertManualUpiOperationsEnabled();
  const input = z.object({ transactionReference: z.string().optional(), evidenceImageBase64: z.string(), evidenceMimeType: z.string() }).strict().parse(req.body);
  const transactionReference = input.transactionReference?.trim() || null;
  if (transactionReference && !validateUpiUtr(transactionReference)) throw new HttpError(400, 'INVALID_UTR_FORMAT', 'If provided, enter the exact 12-digit UTR/RRN from your payment app.');
  const evidenceImage = decodeManualClaimImage(input.evidenceImageBase64, input.evidenceMimeType);
  const db = databaseRequired();
  const deposit = await db.deposit.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
  if (!deposit) throw new HttpError(404, 'DEPOSIT_NOT_FOUND', 'Deposit was not found.');
  if (deposit.method !== 'UPI') throw new HttpError(409, 'PAYMENT_METHOD_MISMATCH', 'Manual review is available only for UPI pending requests.');
  if (!['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'EXPIRED', 'CANCELLED'].includes(deposit.status)) throw new HttpError(409, 'DEPOSIT_NOT_REVIEWABLE', 'This deposit is not awaiting payment review.');

  const claim = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM deposits WHERE id = ${deposit.id}::uuid FOR UPDATE`;
    const current = await tx.deposit.findUniqueOrThrow({ where: { id: deposit.id }, include: { manualPaymentClaim: true } });
    if (current.status === 'COMPLETED' || current.status === 'PAYMENT_VERIFIED') throw new HttpError(409, 'DEPOSIT_ALREADY_VERIFIED', 'This deposit already has a verified payment.');
    if (!['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'EXPIRED', 'CANCELLED'].includes(current.status)) throw new HttpError(409, 'DEPOSIT_NOT_REVIEWABLE', 'This deposit is not awaiting payment review.');
    if (current.manualPaymentClaim?.status === 'PENDING_REVIEW') throw new HttpError(409, 'CLAIM_ALREADY_PENDING', 'This transaction reference is already waiting for Finance review.');
    if (current.manualPaymentClaim?.status === 'APPROVED') throw new HttpError(409, 'CLAIM_ALREADY_APPROVED', 'This payment claim has already been approved.');
    if (transactionReference) {
      await lockPaymentReference(tx, transactionReference);
      const [p2pClaim, p2pSellerReceipt, p2pPayment, existingDeposit] = await Promise.all([
        tx.p2pPaymentClaim.findFirst({ where: { transactionReference: { equals: transactionReference, mode: 'insensitive' } }, select: { id: true } }),
        tx.p2pSellerPaymentConfirmation.findFirst({ where: { transactionReference: { equals: transactionReference, mode: 'insensitive' } }, select: { id: true } }),
        tx.p2pDepositOrder.findFirst({ where: { providerReference: { equals: transactionReference, mode: 'insensitive' } }, select: { id: true } }),
        tx.deposit.findFirst({ where: { providerReference: { equals: transactionReference, mode: 'insensitive' }, id: { not: current.id } }, select: { id: true } }),
      ]);
      if (p2pClaim || p2pSellerReceipt || p2pPayment || existingDeposit) throw new HttpError(409, 'TRANSACTION_ALREADY_USED', 'This UPI reference is already attached to another payment. No payment claim was submitted.');
    }

    const saved = current.manualPaymentClaim
      ? await tx.manualPaymentClaim.update({ where: { id: current.manualPaymentClaim.id }, data: { transactionReference, evidenceImage: Uint8Array.from(evidenceImage.bytes), evidenceMimeType: evidenceImage.mimeType, status: 'PENDING_REVIEW', reviewedByUserId: null, reviewReason: null, evidenceReference: null, verifiedAmountPaise: null, verifiedCurrency: null, receiverConfirmed: false, reviewedAt: null } })
      : await tx.manualPaymentClaim.create({ data: { depositId: current.id, userId: req.auth!.userId, transactionReference, evidenceImage: Uint8Array.from(evidenceImage.bytes), evidenceMimeType: evidenceImage.mimeType } });
    if (['CREATED', 'PENDING_PAYMENT', 'EXPIRED', 'CANCELLED'].includes(current.status)) {
      await tx.deposit.update({ where: { id: current.id }, data: { status: 'PAYMENT_PROCESSING' } });
    }
    await tx.reconciliationRecord.updateMany({ where: { provider: 'MANUAL_UPI', internalReference: current.merchantReference, status: 'REJECTED' }, data: { status: 'SUPERSEDED' } });
    if (transactionReference) await tx.reconciliationRecord.upsert({
      where: { provider_providerReference: { provider: 'MANUAL_UPI', providerReference: transactionReference } },
      create: { provider: 'MANUAL_UPI', providerReference: transactionReference, internalReference: current.merchantReference, amountPaise: current.amountPaise, currency: 'INR', status: 'PENDING_REVIEW' },
      update: { internalReference: current.merchantReference, amountPaise: current.amountPaise, currency: 'INR', status: 'PENDING_REVIEW' },
    });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'MANUAL_PAYMENT_CLAIM_SUBMITTED', target: `DEPOSIT:${current.id}`, reason: 'User submitted an unverified transaction image for manual review.', metadata: { claimId: saved.id, amountPaise: Number(current.amountPaise), currency: 'INR', transactionReferenceProvided: Boolean(transactionReference) } } });
    const updatedDeposit = await tx.deposit.findUniqueOrThrow({ where: { id: current.id }, select: { id: true, status: true, amountPaise: true, currency: true } });
    return { saved, deposit: updatedDeposit };
  });
  res.status(202).json({ claim: { id: claim.saved.id, status: claim.saved.status, createdAt: claim.saved.createdAt, evidenceAttached: true }, deposit: { ...claim.deposit, amountPaise: Number(claim.deposit.amountPaise) }, message: 'Payment image submitted as an unverified claim. Finance must independently confirm the receipt; no deposit is credited from the image or optional transaction ID alone.' });
}));

paymentsRouter.get('/admin/reconciliation/claims', requireAdmin, asyncRoute(async (req, res) => {
  if (!['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role ?? '')) throw new HttpError(403, 'FINANCE_REVIEW_REQUIRED', 'Finance reviewer access is required.');
  assertManualUpiOperationsEnabled();
  const status = typeof req.query.status === 'string' ? req.query.status : 'PENDING_REVIEW';
  if (!['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED'].includes(status)) throw new HttpError(400, 'INVALID_CLAIM_STATUS', 'Unsupported reconciliation status.');
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page ?? '1');
  const pageSize = z.coerce.number().int().min(1).max(100).default(25).parse(req.query.pageSize ?? '25');
  const db = databaseRequired();
  const [claims, total] = await Promise.all([
    db.manualPaymentClaim.findMany({ where: { status }, select: { id: true, depositId: true, userId: true, transactionReference: true, status: true, evidenceMimeType: true, evidenceImage: false, createdAt: true, reviewedAt: true, reviewReason: true, verifiedAmountPaise: true, verifiedCurrency: true, receiverConfirmed: true, deposit: { select: { id: true, merchantReference: true, amountPaise: true, currency: true, status: true, createdAt: true } }, user: { select: { publicId: true, displayName: true, phoneE164: true } } }, orderBy: { createdAt: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
    db.manualPaymentClaim.count({ where: { status } }),
  ]);
  res.json({ claims: claims.map((claim) => ({ ...claim, deposit: { ...claim.deposit, amountPaise: Number(claim.deposit.amountPaise) }, user: { ...claim.user, phoneMasked: `${claim.user.phoneE164.slice(0, 3)}••••${claim.user.phoneE164.slice(-3)}`, phoneE164: undefined } })), total, page, pageSize });
}));

paymentsRouter.get('/admin/reconciliation/claims/:claimId/evidence', requireAdmin, asyncRoute(async (req, res) => {
  if (!['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role ?? '')) throw new HttpError(403, 'FINANCE_REVIEW_REQUIRED', 'Finance reviewer access is required.');
  assertManualUpiOperationsEnabled();
  const claim = await databaseRequired().manualPaymentClaim.findUnique({ where: { id: req.params.claimId }, select: { evidenceImage: true, evidenceMimeType: true } });
  if (!claim?.evidenceImage || !claim.evidenceMimeType) throw new HttpError(404, 'PAYMENT_EVIDENCE_NOT_FOUND', 'No transaction screenshot is attached to this claim.');
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="payment-evidence"' });
  res.type(claim.evidenceMimeType).send(Buffer.from(claim.evidenceImage));
}));

paymentsRouter.post('/admin/reconciliation/claims/:claimId/review', requireAdmin, adminReviewLimit, asyncRoute(async (req, res) => {
  if (!['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role ?? '')) throw new HttpError(403, 'FINANCE_REVIEW_REQUIRED', 'Finance reviewer access is required.');
  assertManualUpiOperationsEnabled();
  const input = z.object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(8).max(500),
    evidenceReference: z.string().trim().min(3).max(160),
    verifiedTransactionReference: z.string().trim().min(4).max(120).optional(),
    verifiedAmountPaise: z.number().int().positive().optional(),
    verifiedCurrency: z.literal('INR').optional(),
    receiverConfirmed: z.boolean().optional(),
  }).strict().superRefine((data, ctx) => {
    if (data.decision === 'APPROVE') {
      for (const key of ['verifiedTransactionReference', 'verifiedAmountPaise', 'verifiedCurrency', 'receiverConfirmed'] as const) {
        if (data[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: 'Required for approval.' });
      }
    }
  }).parse(req.body);
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    const initial = await tx.manualPaymentClaim.findUnique({ where: { id: req.params.claimId }, include: { deposit: true } });
    if (!initial) throw new HttpError(404, 'CLAIM_NOT_FOUND', 'Manual payment claim was not found.');
    await tx.$queryRaw`SELECT id FROM deposits WHERE id = ${initial.depositId}::uuid FOR UPDATE`;
    const claim = await tx.manualPaymentClaim.findUniqueOrThrow({ where: { id: initial.id }, include: { deposit: true } });
    if (claim.status !== 'PENDING_REVIEW') throw new HttpError(409, 'CLAIM_ALREADY_REVIEWED', 'This claim is no longer awaiting review.');

    if (input.decision === 'REJECT') {
      const updated = await tx.manualPaymentClaim.update({ where: { id: claim.id }, data: { status: 'REJECTED', reviewedByUserId: req.auth!.userId, reviewedAt: new Date(), reviewReason: input.reason, evidenceReference: input.evidenceReference } });
      const depositStatus = claim.deposit.expiresAt && claim.deposit.expiresAt <= new Date() ? 'EXPIRED' : 'PENDING_PAYMENT';
      const updatedDeposit = await tx.deposit.update({ where: { id: claim.depositId }, data: { status: depositStatus } });
      if (claim.transactionReference) await tx.reconciliationRecord.updateMany({ where: { provider: 'MANUAL_UPI', providerReference: claim.transactionReference, status: 'PENDING_REVIEW' }, data: { status: 'REJECTED' } });
      await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'MANUAL_PAYMENT_CLAIM_REJECTED', target: `DEPOSIT:${claim.depositId}`, reason: input.reason, metadata: { claimId: claim.id, evidenceReference: input.evidenceReference } } });
      await tx.notification.create({ data: { userId: claim.userId, title: 'Payment claim needs attention', body: 'Finance could not verify the submitted payment details. Check the review reason before submitting another claim.' } });
      return { claim: updated, deposit: updatedDeposit, ledgerTransactionId: null, rewardAmountPaise: 0n };
    }

    const evidenceError = validateManualReviewEvidence({
      claimStatus: claim.status,
      claimedTransactionReference: claim.transactionReference,
      verifiedTransactionReference: input.verifiedTransactionReference!,
      expectedAmountPaise: claim.deposit.amountPaise,
      verifiedAmountPaise: BigInt(input.verifiedAmountPaise!),
      verifiedCurrency: input.verifiedCurrency!,
      receiverConfirmed: input.receiverConfirmed!,
    });
    if (evidenceError) throw new HttpError(409, evidenceError, 'Approval requires an exact transaction-reference, amount, INR currency, and receiver match in merchant records.');
    if (!['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(claim.deposit.status)) throw new HttpError(409, 'DEPOSIT_NOT_REVIEWABLE', 'Deposit is no longer awaiting payment review.');
    await lockPaymentReference(tx, input.verifiedTransactionReference);
    const [duplicate, duplicateClaim, p2pClaim, p2pSellerReceipt, p2pPayment] = await Promise.all([
      tx.deposit.findFirst({ where: { providerReference: { equals: input.verifiedTransactionReference!, mode: 'insensitive' }, id: { not: claim.depositId } }, select: { id: true } }),
      tx.manualPaymentClaim.findFirst({ where: { transactionReference: { equals: input.verifiedTransactionReference!, mode: 'insensitive' }, id: { not: claim.id } }, select: { id: true } }),
      tx.p2pPaymentClaim.findFirst({ where: { transactionReference: { equals: input.verifiedTransactionReference!, mode: 'insensitive' } }, select: { id: true } }),
      tx.p2pSellerPaymentConfirmation.findFirst({ where: { transactionReference: { equals: input.verifiedTransactionReference!, mode: 'insensitive' } }, select: { id: true } }),
      tx.p2pDepositOrder.findFirst({ where: { providerReference: { equals: input.verifiedTransactionReference!, mode: 'insensitive' } }, select: { id: true } }),
    ]);
    if (duplicate) throw new HttpError(409, 'TRANSACTION_ALREADY_USED', 'This provider transaction reference is already attached to another deposit.');
    if (duplicateClaim) throw new HttpError(409, 'TRANSACTION_ALREADY_USED', 'This provider transaction reference is already attached to another payment claim.');
    if (p2pClaim || p2pSellerReceipt || p2pPayment) throw new HttpError(409, 'TRANSACTION_ALREADY_USED', 'This provider transaction reference is already attached to another P2P payment.');
    const reconciliation = await tx.reconciliationRecord.findUnique({ where: { provider_providerReference: { provider: 'MANUAL_UPI', providerReference: input.verifiedTransactionReference! } } });
    if (reconciliation && reconciliation.internalReference !== claim.deposit.merchantReference) throw new HttpError(409, 'TRANSACTION_ALREADY_USED', 'This provider transaction reference is already attached to another deposit.');

    const clearing = await tx.ledgerAccount.upsert({ where: { id: MANUAL_DEPOSIT_CLEARING_ACCOUNT_ID }, create: { id: MANUAL_DEPOSIT_CLEARING_ACCOUNT_ID, type: 'DEPOSIT_CLEARING', currency: 'INR' }, update: {} });
    const available = await tx.ledgerAccount.upsert({ where: { userId_type_currency: { userId: claim.userId, type: 'AVAILABLE', currency: 'INR' } }, create: { userId: claim.userId, type: 'AVAILABLE', currency: 'INR' }, update: {} });
    const ledger = await tx.ledgerTransaction.create({ data: {
      eventType: 'MANUAL_DEPOSIT_VERIFIED', referenceType: 'DEPOSIT', referenceId: claim.depositId,
      idempotencyKey: `MANUAL_DEPOSIT:${claim.depositId}`, actorUserId: req.auth!.userId,
      metadata: { amountPaise: input.verifiedAmountPaise!, currency: 'INR', evidenceReference: input.evidenceReference, claimId: claim.id },
      entries: { create: [
        { accountId: clearing.id, debitPaise: BigInt(input.verifiedAmountPaise!) },
        { accountId: available.id, creditPaise: BigInt(input.verifiedAmountPaise!) },
      ] },
    } });
    const updatedDeposit = await tx.deposit.update({ where: { id: claim.depositId }, data: { status: 'COMPLETED', providerReference: input.verifiedTransactionReference!, ledgerTransactionId: ledger.id } });
    const updatedClaim = await tx.manualPaymentClaim.update({ where: { id: claim.id }, data: { transactionReference: input.verifiedTransactionReference!, status: 'APPROVED', reviewedByUserId: req.auth!.userId, reviewedAt: new Date(), reviewReason: input.reason, evidenceReference: input.evidenceReference, verifiedAmountPaise: BigInt(input.verifiedAmountPaise!), verifiedCurrency: 'INR', receiverConfirmed: true } });
    const rewardAmountPaise = claim.deposit.method === 'UPI'
      ? await grantVerifiedUpiDepositReward(tx, { depositId: claim.depositId, userId: claim.userId, actorUserId: req.auth!.userId, amountPaise: claim.deposit.amountPaise })
      : 0n;
    if (claim.deposit.method === 'UPI') await recordVerifiedReferralCommission(tx, {
      sourceReference: `DEPOSIT:${claim.depositId}`,
      sourceUserId: claim.userId,
      actorUserId: req.auth!.userId,
      amountPaise: claim.deposit.amountPaise,
    });
    if (claim.transactionReference) await tx.reconciliationRecord.updateMany({ where: { provider: 'MANUAL_UPI', providerReference: claim.transactionReference, status: 'PENDING_REVIEW' }, data: { status: 'APPROVED' } });
    else await tx.reconciliationRecord.create({ data: { provider: 'MANUAL_UPI', providerReference: input.verifiedTransactionReference!, internalReference: claim.deposit.merchantReference, amountPaise: claim.deposit.amountPaise, currency: 'INR', status: 'APPROVED' } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'MANUAL_PAYMENT_CLAIM_APPROVED', target: `DEPOSIT:${claim.depositId}`, reason: input.reason, metadata: { claimId: claim.id, evidenceReference: input.evidenceReference, amountPaise: input.verifiedAmountPaise, currency: 'INR', receiverConfirmed: true } } });
    await tx.notification.create({ data: { userId: claim.userId, title: 'Payment verified', body: rewardAmountPaise > 0n ? `Finance verified your payment. Your deposit is complete and ${Number(rewardAmountPaise) / 100} INR development reward was credited.` : 'Finance verified your payment against merchant records. Your deposit is complete.' } });
    return { claim: updatedClaim, deposit: updatedDeposit, ledgerTransactionId: ledger.id, rewardAmountPaise };
  }, { isolationLevel: 'Serializable' });
  res.json({ claim: { id: result.claim.id, status: result.claim.status, reviewedAt: result.claim.reviewedAt }, deposit: { id: result.deposit.id, status: result.deposit.status, amountPaise: Number(result.deposit.amountPaise), currency: result.deposit.currency }, rewardAmountPaise: Number(result.rewardAmountPaise), ledgerTransactionId: result.ledgerTransactionId });
}));

paymentsRouter.get('/deposits/:id', asyncRoute(async (req, res) => {
  const db = databaseRequired();
  if (env.financialOperationsEnabled) await expireUnpaidUpiDeposits(db);
  let deposit = await db.deposit.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
  if (!deposit) throw new HttpError(404, 'DEPOSIT_NOT_FOUND', 'Deposit was not found.');
  if (env.financialOperationsEnabled && deposit.method === 'CASHFREE' && deposit.paymentSessionId && ['PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(deposit.status)) {
    try {
      const [order, payments] = await Promise.all([getCashfreeOrder(deposit.merchantReference), getCashfreePayments(deposit.merchantReference)]);
      await confirmCashfreeDeposit(deposit.id, order, payments);
      deposit = await db.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    } catch {
      throw new HttpError(503, 'PAYMENT_STATUS_CHECK_FAILED', 'Cashfree sandbox payment status could not be checked. The current order status is unchanged.');
    }
  }
  res.json({ deposit: { ...deposit, amountPaise: Number(deposit.amountPaise) } });
}));

paymentsRouter.post('/wallet-references', asyncRoute(async (req, res) => {
  const input = z.object({ method: z.enum(['Paytm', 'PhonePe', 'Navi']), reference: z.string().trim().regex(/^[\w.\-]+@[\w.\-]+$/).max(120) }).strict().parse(req.body);
  const method = methods[input.method];
  const wallet = await databaseRequired().walletAccount.upsert({ where: { userId_method: { userId: req.auth!.userId, method: method.enum } }, create: { userId: req.auth!.userId, method: method.enum, reference: input.reference, status: 'REFERENCE_SAVED_NOT_CONNECTED', buyEnabled: method.buy, sellEnabled: method.sell }, update: { reference: input.reference, status: 'REFERENCE_SAVED_NOT_CONNECTED', buyEnabled: method.buy, sellEnabled: method.sell } });
  res.status(201).json({ wallet: { ...wallet, reference: wallet.reference, connected: false }, message: 'Saved as a reference only. This does not connect the provider or grant transaction access.' });
}));

paymentsRouter.get('/wallet-references', asyncRoute(async (req, res) => {
  const wallets = await databaseRequired().walletAccount.findMany({ where: { userId: req.auth!.userId, method: { not: 'MOBIKWIK' } }, orderBy: { createdAt: 'desc' } });
  res.json({ wallets: wallets.map((wallet) => ({ ...wallet, method: Object.keys(methods).find((name) => methods[name as keyof typeof methods].enum === wallet.method), connected: false })) });
}));

paymentsRouter.post('/webhooks/payments/:provider', (_req, res) => res.status(503).json({ error: { code: 'PAYMENT_PROVIDER_UNAVAILABLE', message: 'No approved payment provider adapter is configured. No payment can be verified or credited.' } }));
