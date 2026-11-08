import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { runAdminPushOutboxBatch } from '../modules/admin/pushNotifications.js';
import { singleFlight } from '../lib/singleFlight.js';

afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('singleFlight', () => {
  it('prevents timer ticks from overlapping an in-flight worker and releases after completion', async () => {
    const gate = deferred<void>();
    const task = vi.fn(() => gate.promise);
    const run = singleFlight(task);

    const first = run();
    expect(await run()).toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);
    gate.resolve();
    await first;
    await run();
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe('admin push outbox worker', () => {
  it('uses bounded Prisma transaction wait/timeout and retries a transient P2028 before processing', async () => {
    const transactionOptions: Array<{ maxWait: number; timeout: number }> = [];
    let firstAttempt = true;
    const tx = {
      $queryRaw: vi.fn(async () => []),
      adminPushDevice: { findMany: vi.fn(async () => []) },
      adminPushDelivery: { updateMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn(async () => []) },
      adminPushEvent: { update: vi.fn(async () => ({})) },
    };
    const db = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>, options: { maxWait: number; timeout: number }) => {
        transactionOptions.push(options);
        if (firstAttempt) {
          firstAttempt = false;
          throw Object.assign(new Error('transaction start timeout'), { code: 'P2028' });
        }
        return operation(tx);
      }),
    } as unknown as PrismaClient;

    await expect(runAdminPushOutboxBatch(db)).resolves.toBe(0);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(transactionOptions.every((option) => option.maxWait >= 10_000 && option.timeout >= 20_000)).toBe(true);
  });

  it('does not retry a push when the provider outcome is ambiguous', async () => {
    const staleDeliveryUpdate = vi.fn(async () => ({ count: 0 }));
    const deliveryUpdate = vi.fn(async () => ({}));
    const eventRow = { id: 'event-1' };
    const delivery = {
      id: 'delivery-1',
      attemptCount: 1,
      event: { id: 'event-1', type: 'P2P_PAYMENT_REVIEW', title: 'Review', body: 'Review payment', claimId: 'claim-1' },
      device: { id: 'device-1', expoPushToken: 'ExponentPushToken[unit-test]' },
    };
    const tx = {
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) => String(parts[0]).includes('admin_push_events') ? [eventRow] : [{ id: delivery.id }]),
      adminPushDevice: { findMany: vi.fn(async () => [{ id: 'device-1' }]) },
      adminPushEvent: { update: vi.fn(async () => ({})) },
      adminPushDelivery: {
        updateMany: staleDeliveryUpdate,
        createMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [delivery]),
      },
    };
    const db = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
      adminPushDelivery: { update: deliveryUpdate },
    } as unknown as PrismaClient;
    const fetchMock = vi.fn(async () => { throw new Error('simulated response timeout'); });
    vi.stubGlobal('fetch', fetchMock);

    await expect(runAdminPushOutboxBatch(db)).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(staleDeliveryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'SENDING', lockedAt: expect.objectContaining({ lt: expect.any(Date) }) }),
      data: expect.objectContaining({ status: 'FAILED', lockedAt: null }),
    }));
    expect(deliveryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({ status: 'FAILED', lockedAt: null }),
    }));
    expect(deliveryUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RETRY' }) }));
  });
});
