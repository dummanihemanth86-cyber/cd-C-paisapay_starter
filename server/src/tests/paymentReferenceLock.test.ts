import { describe, expect, it, vi } from 'vitest';
import { lockPaymentReference } from '../modules/payments/paymentReferenceLock.js';
import type { Prisma } from '../generated/prisma/client.js';
import { createHash } from 'node:crypto';

describe('payment reference advisory lock', () => {
  it('executes the transaction lock without decoding PostgreSQL void', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryRaw = vi.fn();
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await lockPaymentReference(tx, '  123456789012  ');

    expect(executeRaw).toHaveBeenCalledOnce();
    expect(String(executeRaw.mock.calls[0]?.[0])).toContain('pg_advisory_xact_lock');
    expect(executeRaw.mock.calls[0]?.[1]).toBe(createHash('sha256').update('123456789012').digest('hex'));
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('serializes differently-cased references in a stable lock order', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const tx = { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;
    await lockPaymentReference(tx, ' abcd12345678 ');
    const hashes = executeRaw.mock.calls.map((call) => call[1]);
    expect(hashes).toHaveLength(2);
    expect(hashes).toEqual([...hashes].sort());
  });

  it('skips the lock for an empty reference', async () => {
    const executeRaw = vi.fn();
    const tx = { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;

    await lockPaymentReference(tx, '  ');

    expect(executeRaw).not.toHaveBeenCalled();
  });
});
