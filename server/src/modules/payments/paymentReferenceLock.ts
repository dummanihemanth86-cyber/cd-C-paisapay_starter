import type { Prisma } from '../../generated/prisma/client.js';
import { createHash } from 'node:crypto';

/** Serializes UPI reference checks across all manual payment tables.
 * The reference is normalized before hashing so concurrent case variants use
 * the same transaction-scoped PostgreSQL lock. */
export async function lockPaymentReference(tx: Prisma.TransactionClient, reference: string | null | undefined) {
  const normalized = reference?.trim().normalize('NFKC');
  if (!normalized) return;
  // pg_advisory_xact_lock returns PostgreSQL `void`; $queryRaw cannot decode
  // that scalar. $executeRaw executes the lock without trying to deserialize it.
  // Match the exact-reference lock used by legacy funding review, and also
  // serialize case-insensitive duplicate payment references.
  const lockHashes = [...new Set([normalized, normalized.toUpperCase()])]
    .map((value) => createHash('sha256').update(value).digest('hex'))
    .sort();
  for (const referenceHash of lockHashes) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${referenceHash}))`;
  }
}

/** Hashes the same normalized form used by the lock for global duplicate checks. */
export function paymentReferenceHash(reference: string): string {
  return createHash('sha256').update(reference.trim().normalize('NFKC').toUpperCase()).digest('hex');
}
