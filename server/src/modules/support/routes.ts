import { Router } from 'express';
import { z } from 'zod';
import { databaseRequired } from '../../lib/db.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';

export const supportRouter = Router();
supportRouter.use(requireAuth);

supportRouter.post('/tickets', asyncRoute(async (req, res) => {
  const input = z.object({ subject: z.string().trim().min(1).max(100), message: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
  const ticket = await databaseRequired().supportTicket.create({ data: { userId: req.auth!.userId, subject: input.subject, messages: { create: { authorId: req.auth!.userId, message: input.message } } }, include: { messages: true } });
  res.status(201).json({ ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status, createdAt: ticket.createdAt }, messages: ticket.messages });
}));

supportRouter.get('/tickets', asyncRoute(async (req, res) => {
  const tickets = await databaseRequired().supportTicket.findMany({ where: { userId: req.auth!.userId }, orderBy: { updatedAt: 'desc' }, select: { id: true, subject: true, status: true, createdAt: true, updatedAt: true } });
  res.json({ tickets });
}));

supportRouter.get('/tickets/:id', asyncRoute(async (req, res) => {
  const ticket = await databaseRequired().supportTicket.findFirst({ where: { id: req.params.id, userId: req.auth!.userId }, include: { messages: { orderBy: { createdAt: 'asc' }, select: { id: true, authorId: true, message: true, createdAt: true } } } });
  if (!ticket) throw new HttpError(404, 'TICKET_NOT_FOUND', 'Support ticket was not found.');
  res.json({ ticket });
}));

export const notificationRouter = Router();
notificationRouter.use(requireAuth);
notificationRouter.get('/', asyncRoute(async (req, res) => {
  const notifications = await databaseRequired().notification.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ notifications });
}));

export const withdrawalsRouter = Router();
withdrawalsRouter.use(requireAuth);
withdrawalsRouter.get('/', asyncRoute(async (req, res) => {
  const withdrawals = await databaseRequired().withdrawal.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ withdrawals: withdrawals.map((row) => ({ ...row, amountPaise: Number(row.amountPaise) })) });
}));
withdrawalsRouter.post('/', asyncRoute(async (req, res) => {
  const input = z.object({ amountPaise: z.number().int().min(10000).max(100_000_000) }).strict().parse(req.body);
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 120) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header between 8 and 120 characters.');
  const db = databaseRequired();
  const account = await db.ledgerAccount.findFirst({ where: { userId: req.auth!.userId, type: 'AVAILABLE', currency: 'INR' }, include: { entries: { select: { debitPaise: true, creditPaise: true } } } });
  const balancePaise = account?.entries.reduce((sum, entry) => sum + entry.creditPaise - entry.debitPaise, 0n) ?? 0n;
  if (BigInt(input.amountPaise) > balancePaise) throw new HttpError(409, 'INSUFFICIENT_FUNDS', 'There is not enough available balance for this withdrawal.');
  throw new HttpError(503, 'PAYOUT_PROVIDER_UNAVAILABLE', 'No approved payout provider or authorized review process is configured. No withdrawal was created or marked complete.');
}));
