import type { PrismaClient } from '../../generated/prisma/client.js';

export const UPI_DEPOSIT_EXPIRY_MS = 5 * 60 * 1000;

/** Expire only unpaid UPI deposits; submitted claims move to PAYMENT_PROCESSING. */
export async function expireUnpaidUpiDeposits(db: PrismaClient, now = new Date()) {
  return db.deposit.updateMany({
    where: { method: 'UPI', status: { in: ['CREATED', 'PENDING_PAYMENT'] }, expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
}
