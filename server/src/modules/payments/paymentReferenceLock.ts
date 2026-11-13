import type { Prisma } from '../../generated/prisma/client.js';

/** Serializes UPI reference checks across all manual payment tables.
 * The reference is normalized before hashing so concurrent case variants use
 * the same transaction-scoped PostgreSQL lock. */
export async function lockPaymentReference(tx: Prisma.TransactionClient, reference: string | null | undefined) {
  const normalized = reference?.trim().toUpperCase();
  if (!normalized) return;
  // pg_advisory_xact_lock returns PostgreSQL `void`; $queryRaw cannot decode
  // that scalar. $executeRaw executes the lock without trying to deserialize it.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${normalized}, 0))`;
}
