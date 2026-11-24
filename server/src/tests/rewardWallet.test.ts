import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { releaseRewardOffer } from '../modules/payments/rewardWallet.js';
import { createWithdrawalOffer, reserveOfferFunds } from '../modules/p2p/service.js';

const userId = '00000000-0000-4000-8000-000000000301';
const actorId = '00000000-0000-4000-8000-000000000302';
const offer = { id: '00000000-0000-4000-8000-000000000303', userId };

function legacyReservedRewardTx() {
  const wallet = { id: 'reward-wallet-id', userId, availablePaise: 5_000n, pendingPaise: 0n, reservedPaise: 10_000n, totalEarnedPaise: 15_000n };
  const entries = new Map<string, any>([[`P2P_REWARD_WITHDRAWAL_RESERVED:${offer.id}`, { id: 'legacy-reservation' }]]);
  const update = vi.fn(async ({ data }: any) => {
    for (const field of ['availablePaise', 'pendingPaise', 'reservedPaise', 'totalEarnedPaise']) {
      if (data[field]?.increment !== undefined) wallet[field] += data[field].increment;
      if (data[field]?.decrement !== undefined) wallet[field] -= data[field].decrement;
    }
    return wallet;
  });
  const entryCreate = vi.fn(async ({ data }: any) => {
    const entry = { id: `entry-${entries.size + 1}`, ...data };
    entries.set(data.idempotencyKey, entry);
    return entry;
  });
  const tx = {
    rewardWallet: { upsert: vi.fn(async () => wallet), findUniqueOrThrow: vi.fn(async () => wallet), update },
    rewardLedgerEntry: { findUnique: vi.fn(async ({ where }: any) => entries.get(where.idempotencyKey) ?? null), create: entryCreate },
    $queryRaw: vi.fn(async () => []),
  } as unknown as Prisma.TransactionClient;
  return { tx, wallet, update, entryCreate };
}

describe('promotional reward withdrawal safety', () => {
  it('never creates a P2P buyer cash offer from non-cash reward value', async () => {
    const oldManualGate = env.manualUpiOperationsEnabled;
    const oldRewardGate = env.p2pOrderRewardEnabled;
    try {
      env.manualUpiOperationsEnabled = true;
      env.p2pOrderRewardEnabled = true;
      await expect(createWithdrawalOffer({ userId, amountPaise: 10_000, idempotencyKey: 'reward-payout-disabled', fundingSource: 'REWARD' }))
        .rejects.toMatchObject({ statusCode: 503, code: 'REWARD_WITHDRAWAL_PAYOUT_UNAVAILABLE' });
    } finally {
      env.manualUpiOperationsEnabled = oldManualGate;
      env.p2pOrderRewardEnabled = oldRewardGate;
    }
  });

  it('never reserves reward value for P2P cash matching', async () => {
    const oldManualGate = env.manualUpiOperationsEnabled;
    try {
      env.manualUpiOperationsEnabled = true;
      await expect(reserveOfferFunds({} as Prisma.TransactionClient, { ...offer, amountPaise: 10_000n, fundingSource: 'REWARD' }, userId))
        .rejects.toMatchObject({ statusCode: 503, code: 'REWARD_WITHDRAWAL_PAYOUT_UNAVAILABLE' });
    } finally {
      env.manualUpiOperationsEnabled = oldManualGate;
    }
  });

  it('releases a legacy reward reservation once without changing earned total', async () => {
    const fixture = legacyReservedRewardTx();
    await expect(releaseRewardOffer(fixture.tx, { ...offer, amountPaise: 10_000n }, actorId, 'P2P_WITHDRAWAL_CANCELLED', 10_000n, offer.id)).resolves.toBe(true);
    await expect(releaseRewardOffer(fixture.tx, { ...offer, amountPaise: 10_000n }, actorId, 'P2P_WITHDRAWAL_CANCELLED', 10_000n, offer.id)).resolves.toBe(false);
    expect(fixture.wallet).toMatchObject({ availablePaise: 15_000n, reservedPaise: 0n, totalEarnedPaise: 15_000n });
    expect(fixture.entryCreate).toHaveBeenCalledOnce();
  });
});
