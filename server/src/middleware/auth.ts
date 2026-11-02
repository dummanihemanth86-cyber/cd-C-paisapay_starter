import type { NextFunction, Request, Response } from 'express';
import { databaseRequired } from '../lib/db.js';
import { hashToken } from '../lib/security.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
    const db = databaseRequired();
    const session = await db.session.findUnique({ where: { accessTokenHash: hashToken(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.accessExpiresAt <= new Date()) {
      return res.status(401).json({ error: { code: 'SESSION_INVALID', message: 'Your session expired. Sign in again.' } });
    }
    if (session.user.status === 'SUSPENDED' || session.user.status === 'CLOSED') {
      return res.status(403).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'This account cannot sign in.' } });
    }
    req.auth = { userId: session.userId, sessionId: session.id, status: session.user.status };
    next();
  } catch (error) { next(error); }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const db = databaseRequired();
    const admin = await db.adminUser.findUnique({ where: { userId: req.auth!.userId } });
    if (!admin) return res.status(403).json({ error: { code: 'ADMIN_REQUIRED', message: 'Administrator access is required.' } });
    req.auth!.role = admin.role;
    next();
  } catch (error) { next(error); }
}
