import { Router } from 'express';
import { z } from 'zod';
import { databaseRequired } from '../../lib/db.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { financialOperationsGate } from '../../middleware/financialOperations.js';
import { getPaymentMethodAvailability } from '../payments/availability.js';

export const ordersRouter = Router();
ordersRouter.use(requireAuth, financialOperationsGate);
const methods = {
  Paytm: { enum: 'PAYTM' as const, buy: true, sell: true },
  PhonePe: { enum: 'PHONEPE' as const, buy: false, sell: true },
  Navi: { enum: 'NAVI' as const, buy: false, sell: true },
};
const methodLabel = (value: string) => Object.keys(methods).find((name) => methods[name as keyof typeof methods].enum === value) ?? value;
const amountSchema = z.number().int().min(1000).max(100_000_000);

ordersRouter.get('/', asyncRoute(async (req, res) => {
  const db = databaseRequired();
  const now = new Date();
  await db.order.updateMany({ where: { status: 'AVAILABLE', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
  const kind = req.query.kind === 'BUY' ? 'BUY' : req.query.kind === 'SELL' ? 'SELL' : undefined;
  const availability = await getPaymentMethodAvailability();
  const enabled = availability.methods.filter((method) => method.available && (kind === 'BUY' ? method.buyEnabled : method.sellEnabled));
  const rows = enabled.length ? await db.order.findMany({ where: { status: 'AVAILABLE', expiresAt: { gt: now }, method: { in: enabled.map((row) => methods[row.name as keyof typeof methods].enum) }, ...(kind ? { kind } : {}) }, include: { seller: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }) : [];
  const eligible = rows.filter((order) => order.kind !== 'BUY' || methods[methodLabel(order.method) as keyof typeof methods]?.buy);
  res.json({ currency: 'INR', orders: eligible.map((order) => ({ ...order, amountPaise: Number(order.amountPaise), method: methodLabel(order.method), seller: order.seller.displayName ?? 'Paisapay user', expiresInMinutes: Math.max(0, Math.ceil((order.expiresAt.getTime() - now.getTime()) / 60000)) })) });
}));

ordersRouter.post('/', asyncRoute(async (req, res) => {
  const input = z.object({ kind: z.literal('SELL'), amountPaise: amountSchema, method: z.enum(['Paytm', 'PhonePe', 'Navi']) }).strict().parse(req.body);
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 120) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header between 8 and 120 characters.');
  const method = methods[input.method];
  if (!method.sell) throw new HttpError(400, 'METHOD_NOT_ELIGIBLE', 'This payment method is not enabled for Sell orders.');
  const db = databaseRequired();
  const paymentMethod = (await getPaymentMethodAvailability()).methods.find((item) => item.method === method.enum);
  if (!paymentMethod?.available || !paymentMethod.sellEnabled) throw new HttpError(503, 'SELL_ORDER_PROVIDER_UNAVAILABLE', 'No approved, operational provider is enabled for Sell orders. The order was not created.');
  const prior = await db.order.findUnique({ where: { idempotencyKey: key } });
  if (prior) {
    if (prior.sellerId !== req.auth!.userId || Number(prior.amountPaise) !== input.amountPaise || prior.method !== method.enum) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used for another order.');
    return res.json({ order: { ...prior, amountPaise: Number(prior.amountPaise), method: input.method }, demoOnly: true });
  }
  const order = await db.$transaction(async (tx) => {
    const created = await tx.order.create({ data: { kind: 'SELL', sellerId: req.auth!.userId, amountPaise: BigInt(input.amountPaise), method: method.enum, status: 'AVAILABLE', expiresAt: new Date(Date.now() + 30 * 60 * 1000), idempotencyKey: key } });
    await tx.orderStatusHistory.create({ data: { orderId: created.id, status: 'AVAILABLE', actorId: req.auth!.userId, reason: 'Seller created order' } });
    return created;
  });
  res.status(201).json({ order: { ...order, amountPaise: input.amountPaise, method: input.method, seller: 'You', expiresInMinutes: 30 }, message: 'Order listed. This does not create or verify a payment.' });
}));

ordersRouter.get('/:id', asyncRoute(async (req, res) => {
  const order = await databaseRequired().order.findUnique({ where: { id: req.params.id }, include: { history: { orderBy: { createdAt: 'asc' } } } });
  if (!order || (order.status !== 'AVAILABLE' && order.sellerId !== req.auth!.userId && order.buyerId !== req.auth!.userId)) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order was not found.');
  res.json({ order: { ...order, amountPaise: Number(order.amountPaise), method: methodLabel(order.method) } });
}));

ordersRouter.post('/:id/reservations', asyncRoute(async (req, res) => {
  const input = z.object({}).strict().parse(req.body ?? {});
  void input;
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 120) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header between 8 and 120 characters.');
  const db = databaseRequired();
  const scope = `order-reservation:${req.params.id}:${req.auth!.userId}`;
  const prior = await db.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
  if (prior?.responseJson) return res.json(prior.responseJson);
  const now = new Date();
  const order = await db.$transaction(async (tx) => {
    const current = await tx.order.findUnique({ where: { id: req.params.id } });
    if (!current || current.status !== 'AVAILABLE' || current.expiresAt <= now || current.sellerId === req.auth!.userId) throw new HttpError(409, 'ORDER_UNAVAILABLE', 'Order is no longer available.');
    const claimed = await tx.order.updateMany({ where: { id: current.id, status: 'AVAILABLE', expiresAt: { gt: now } }, data: { status: 'RESERVED', buyerId: req.auth!.userId } });
    if (claimed.count !== 1) throw new HttpError(409, 'ORDER_UNAVAILABLE', 'Another user reserved this order first.');
    await tx.orderStatusHistory.create({ data: { orderId: current.id, status: 'RESERVED', actorId: req.auth!.userId, reason: 'Buyer reserved order' } });
    const updated = await tx.order.findUniqueOrThrow({ where: { id: current.id } });
    const response = { message: 'Reserved. Payment is not initiated or verified by PaisaPay.', order: { ...updated, amountPaise: Number(updated.amountPaise), method: methodLabel(updated.method) }, demoOnly: true };
    await tx.idempotencyKey.create({ data: { scope, key, requestHash: `${current.id}:${req.auth!.userId}`, responseJson: JSON.parse(JSON.stringify(response)) } });
    return response;
  }, { isolationLevel: 'Serializable' });
  res.json(order);
}));

ordersRouter.post('/:id/cancel', asyncRoute(async (req, res) => {
  const db = databaseRequired(); const now = new Date();
  const order = await db.order.findFirst({ where: { id: req.params.id, sellerId: req.auth!.userId, status: 'AVAILABLE', expiresAt: { gt: now } } });
  if (!order) throw new HttpError(409, 'ORDER_CANNOT_CANCEL', 'Only your available, unexpired orders can be cancelled.');
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await tx.orderStatusHistory.create({ data: { orderId: order.id, status: 'CANCELLED', actorId: req.auth!.userId, reason: 'Seller cancelled order' } });
  });
  res.json({ id: order.id, status: 'CANCELLED' });
}));

ordersRouter.post('/:id/payment-submission', (_req, res) => res.status(503).json({ error: { code: 'PAYMENT_VERIFICATION_UNAVAILABLE', message: 'No approved payment integration is configured. Payment evidence cannot mark an order paid.' } }));
