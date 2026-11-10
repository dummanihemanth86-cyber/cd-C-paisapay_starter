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

