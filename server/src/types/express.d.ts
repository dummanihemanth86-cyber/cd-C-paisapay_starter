import type { AdminRole } from '../generated/prisma/client.js';

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; sessionId: string; status: string; role?: AdminRole };
      requestId?: string;
    }
  }
}

export {};
