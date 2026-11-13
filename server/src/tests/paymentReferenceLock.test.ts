import { describe, expect, it, vi } from 'vitest';
import { lockPaymentReference } from '../modules/payments/paymentReferenceLock.js';
import type { Prisma } from '../generated/prisma/client.js';

describe('payment reference advisory lock', () => {
  it('executes the transaction lock without decoding PostgreSQL void', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryRaw = vi.fn();
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await lockPaymentReference(tx, '  123456789012  ');

    expect(executeRaw).toHaveBeenCalledOnce();
    expect(String(executeRaw.mock.calls[0]?.[0])).toContain('pg_advisory_xact_lock');
    expect(executeRaw.mock.calls[0]?.[1]).toBe('123456789012');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('skips the lock for an empty reference', async () => {
    const executeRaw = vi.fn();
    const tx = { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;

    await lockPaymentReference(tx, '  ');

    expect(executeRaw).not.toHaveBeenCalled();
  });
});
