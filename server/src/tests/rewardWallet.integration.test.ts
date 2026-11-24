import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/db.js';
import { grantReward } from '../modules/payments/rewardWallet.js';

const integration = describe.skipIf(!prisma);

integration('reward wallet PostgreSQL atomicity (isolated integration database)', () => {
  const db = prisma!;
  const testUsers: string[] = [];

  async function createTestUser() {
    const suffix = randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '4');
    const user = await db.user.create({
      data: { phoneE164: `+914${suffix}`, displayName: 'Reward Wallet Integration Test', status: 'ACTIVE' },
    });
    testUsers.push(user.id);
    return user.id;
  }

  async function removeTestUser(userId: string) {
    await db.$transaction(async (tx) => {
      await tx.rewardLedgerEntry.deleteMany({ where: { wallet: { userId } } });
      await tx.rewardWallet.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
    const index = testUsers.indexOf(userId);
    if (index >= 0) testUsers.splice(index, 1);
  }

  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    for (const userId of [...testUsers]) await removeTestUser(userId);
    await db.$disconnect();
  });

  it('rolls back both the reward wallet and reward ledger when its enclosing settlement transaction fails', async () => {
    const userId = await createTestUser();
    const idempotencyKey = `P2P_ORDER_REWARD:rollback-test:${randomUUID()}`;

    await expect(db.$transaction(async (tx) => {
      await grantReward(tx, {
        userId,
        eventType: 'P2P_ORDER_REWARD',
        amountPaise: 620n,
        referenceType: 'P2P_DEPOSIT_ORDER',
        referenceId: randomUUID(),
        idempotencyKey,
        metadata: { percentBps: 620, testFixture: true },
      });
      throw new Error('ROLLBACK_REWARD_SETTLEMENT_TEST');
    })).rejects.toThrow('ROLLBACK_REWARD_SETTLEMENT_TEST');

    expect(await db.rewardWallet.findUnique({ where: { userId } })).toBeNull();
    expect(await db.rewardLedgerEntry.findUnique({ where: { idempotencyKey } })).toBeNull();
    await removeTestUser(userId);
  });

  it('serializes concurrent duplicate reward grants to one ledger entry and one balance increment', async () => {
    const userId = await createTestUser();
    const idempotencyKey = `P2P_ORDER_REWARD:concurrency-test:${randomUUID()}`;
    const reward = {
      userId,
      eventType: 'P2P_ORDER_REWARD',
      amountPaise: 620n,
      referenceType: 'P2P_DEPOSIT_ORDER',
      referenceId: randomUUID(),
      idempotencyKey,
      metadata: { percentBps: 620, testFixture: true },
    } as const;

    const outcomes = await Promise.all([
      db.$transaction((tx) => grantReward(tx, reward)),
      db.$transaction((tx) => grantReward(tx, reward)),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);

    const wallet = await db.rewardWallet.findUniqueOrThrow({ where: { userId } });
    const entries = await db.rewardLedgerEntry.findMany({ where: { walletId: wallet.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amountPaise: 620n, availableDeltaPaise: 620n });
    expect(wallet).toMatchObject({ availablePaise: 620n, pendingPaise: 0n, reservedPaise: 0n, totalEarnedPaise: 620n });
    expect(entries.reduce((sum, entry) => sum + entry.availableDeltaPaise, 0n)).toBe(wallet.availablePaise);
    expect(entries.reduce((sum, entry) => sum + entry.amountPaise, 0n)).toBe(wallet.totalEarnedPaise);
    await removeTestUser(userId);
  });
});
