import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http.js';
import { env } from '../../config/env.js';

type Tx = Prisma.TransactionClient;

/** General-ledger liability counterpart for balances held in RewardWallet. */
export const REWARD_LIABILITY_ACCOUNT_ID = '00000000-0000-4000-8000-000000000104';
/** Stable reserve bucket; it starts at zero and is funded only by verified receipts. */
export const REWARD_FUND_ACCOUNT_ID = '00000000-0000-4000-8000-000000000103';

export type RewardBalance = {
  id: string;
  userId: string;
  availablePaise: bigint;
  pendingPaise: bigint;
  reservedPaise: bigint;
  totalEarnedPaise: bigint;
};

async function lockRewardWallet(tx: Tx, userId: string): Promise<RewardBalance> {
  const wallet = await tx.rewardWallet.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  await tx.$queryRaw`SELECT id FROM reward_wallets WHERE id = ${wallet.id}::uuid FOR UPDATE`;
  return tx.rewardWallet.findUniqueOrThrow({ where: { id: wallet.id } });
}

type EntryInput = {
  walletId: string;
  eventType: string;
  referenceType: string;
  referenceId: string;
  amountPaise: bigint;
  availableDeltaPaise?: bigint;
  pendingDeltaPaise?: bigint;
  reservedDeltaPaise?: bigint;
  idempotencyKey: string;
  metadata?: Prisma.InputJsonObject;
};

async function appendEntry(tx: Tx, input: EntryInput) {
  return tx.rewardLedgerEntry.create({ data: {
    walletId: input.walletId,
    eventType: input.eventType,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    amountPaise: input.amountPaise,
    availableDeltaPaise: input.availableDeltaPaise ?? 0n,
    pendingDeltaPaise: input.pendingDeltaPaise ?? 0n,
    reservedDeltaPaise: input.reservedDeltaPaise ?? 0n,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata ?? {},
  } });
}

/**
 * Book a non-cash promotional entitlement. It is not added to the cash wallet.
 * It remains non-withdrawable until a genuine payout path is implemented and
 * independently verifiable.
 */
export async function grantReward(
  tx: Tx,
  input: { userId: string; eventType: string; amountPaise: bigint; referenceType: string; referenceId: string; idempotencyKey: string; metadata: Prisma.InputJsonObject },
) {
  if (!env.rewardFundFundingEnabled) {
    throw new HttpError(503, 'REWARD_FUNDING_DISABLED', 'Reward funding is disabled. No reward was credited.');
  }
  if (input.referenceType === 'P2P_DEPOSIT_ORDER' || input.eventType.startsWith('P2P_ORDER_REWARD')) {
    if (!env.p2pOrderRewardEnabled) throw new HttpError(503, 'P2P_REWARD_DISABLED', 'P2P order rewards are disabled. No reward was credited.');
    throw new HttpError(403, 'P2P_REWARD_SERVICE_REQUIRED', 'P2P rewards must use the verified settlement and funded reserve workflow.');
  }
  if (input.amountPaise <= 0n) return false;
  const wallet = await lockRewardWallet(tx, input.userId);
  const existing = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (existing) return false;
  await tx.rewardWallet.update({ where: { id: wallet.id }, data: {
    availablePaise: { increment: input.amountPaise },
    totalEarnedPaise: { increment: input.amountPaise },
  } });
  await appendEntry(tx, { ...input, walletId: wallet.id, availableDeltaPaise: input.amountPaise });
  return true;
}

/** Record an eligible reward that is not yet backed by a cleared reserve. */
export async function queuePendingReward(
  tx: Tx,
  input: { userId: string; eventType: string; amountPaise: bigint; referenceType: string; referenceId: string; idempotencyKey: string; metadata: Prisma.InputJsonObject },
) {
  if (!env.rewardFundFundingEnabled) {
    throw new HttpError(503, 'REWARD_FUNDING_DISABLED', 'Reward funding is disabled. No pending reward was recorded.');
  }
  if (input.referenceType === 'P2P_DEPOSIT_ORDER' || input.eventType.startsWith('P2P_ORDER_REWARD')) {
    if (!env.p2pOrderRewardEnabled) {
      throw new HttpError(503, 'P2P_REWARD_DISABLED', 'Reward funding or P2P reward posting is disabled. No pending reward was recorded.');
    }
    if (input.eventType !== 'P2P_ORDER_REWARD_PENDING' || input.referenceType !== 'P2P_DEPOSIT_ORDER'
      || input.metadata.fundingSource !== 'DEDICATED_REWARD_FUND' || input.metadata.cashEquivalent !== false) {
      throw new HttpError(403, 'P2P_REWARD_SERVICE_REQUIRED', 'P2P reward entries must be created by the verified funded reward workflow.');
    }
  }
  if (input.amountPaise <= 0n) return false;
  const wallet = await lockRewardWallet(tx, input.userId);
  const existing = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (existing) return false;
  await tx.rewardWallet.update({ where: { id: wallet.id }, data: { pendingPaise: { increment: input.amountPaise } } });
  await appendEntry(tx, { ...input, walletId: wallet.id, pendingDeltaPaise: input.amountPaise });
  return true;
}

/** Move a pending reward to available only after the reserve debit commits. */
export async function releasePendingReward(
  tx: Tx,
  input: { userId: string; referenceType: string; referenceId: string; pendingIdempotencyKey: string; idempotencyKey: string; eventType: string; metadata: Prisma.InputJsonObject; reserveJournalTransactionId?: string },
) {
  if (!env.rewardFundFundingEnabled) {
    throw new HttpError(503, 'REWARD_FUNDING_DISABLED', 'Reward funding is disabled. No pending reward was released.');
  }
  const isP2pIntent = input.referenceType === 'P2P_DEPOSIT_ORDER' || input.eventType.startsWith('P2P_ORDER_REWARD');
  if (isP2pIntent && !env.p2pOrderRewardEnabled) {
    throw new HttpError(503, 'P2P_REWARD_DISABLED', 'P2P order rewards are disabled. No pending reward was released.');
  }
  const existing = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (existing) return 0n;
  const pending = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: input.pendingIdempotencyKey }, select: { amountPaise: true, eventType: true, referenceType: true, referenceId: true, metadata: true } });
  if (!pending) return 0n;
  const amountPaise = pending.amountPaise;
  const isP2pPending = pending.referenceType === 'P2P_DEPOSIT_ORDER' || pending.eventType.startsWith('P2P_ORDER_REWARD');
  if (isP2pIntent || isP2pPending) {
    const pendingMetadata = pending.metadata as Record<string, unknown>;
    const qualifyingAmount = BigInt(String(pendingMetadata.qualifyingAmountPaise ?? '0'));
    const percentageBps = Number(pendingMetadata.percentageBps ?? 0);
    if (pending.eventType !== 'P2P_ORDER_REWARD_PENDING' || pending.referenceType !== 'P2P_DEPOSIT_ORDER'
      || pending.referenceId !== input.referenceId || !env.p2pOrderRewardFundAccountId
      || input.referenceType !== 'P2P_DEPOSIT_ORDER' || input.eventType !== 'P2P_ORDER_REWARD'
      || input.reserveJournalTransactionId === undefined || input.idempotencyKey !== `P2P_ORDER_REWARD:${input.referenceId}`
      || input.pendingIdempotencyKey !== `P2P_ORDER_REWARD_PENDING:${input.referenceId}`
      || pendingMetadata.fundingSource !== 'DEDICATED_REWARD_FUND' || pendingMetadata.cashEquivalent !== false
      || pendingMetadata.status !== 'PENDING_FUNDING' || pendingMetadata.amountPaise !== amountPaise.toString()
      || !Number.isInteger(percentageBps) || percentageBps <= 0 || qualifyingAmount <= 0n
      || amountPaise !== qualifyingAmount * BigInt(percentageBps) / 10_000n
      || env.p2pOrderRewardFundingSource !== 'DEDICATED_REWARD_FUND') {
      throw new HttpError(409, 'P2P_REWARD_RESERVE_JOURNAL_REQUIRED', 'A matching reserve debit and reward-liability journal is required before a P2P pending reward can be released.');
    }
    const [proof] = await tx.$queryRaw<Array<{ valid: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM ledger_transactions t
        WHERE t.id = ${input.reserveJournalTransactionId}::uuid
          AND t.idempotency_key = ${input.idempotencyKey}
          AND t.event_type = 'P2P_ORDER_REWARD'
          AND t.reference_type = 'P2P_DEPOSIT_ORDER'
          AND t.reference_id = ${input.referenceId}
          AND (SELECT COALESCE(SUM(e.debit_paise - e.credit_paise), 0) FROM ledger_entries e WHERE e.transaction_id = t.id AND e.account_id = ${env.p2pOrderRewardFundAccountId}::uuid) = ${amountPaise}
          AND (SELECT COALESCE(SUM(e.credit_paise - e.debit_paise), 0) FROM ledger_entries e WHERE e.transaction_id = t.id AND e.account_id = ${REWARD_LIABILITY_ACCOUNT_ID}::uuid) = ${amountPaise}
      ) AS valid
    `;
    if (!proof?.valid) throw new HttpError(409, 'P2P_REWARD_RESERVE_JOURNAL_REQUIRED', 'The reserve debit and reward-liability journal does not match this pending reward.');
  } else if (pending.eventType !== input.eventType || pending.referenceType !== input.referenceType || pending.referenceId !== input.referenceId) {
    throw new HttpError(409, 'REWARD_PENDING_REFERENCE_MISMATCH', 'The pending reward does not match the requested release reference.');
  }
  const wallet = await lockRewardWallet(tx, input.userId);
  if (await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } })) return 0n;
  if (wallet.pendingPaise < amountPaise) throw new HttpError(409, 'REWARD_PENDING_BALANCE_MISMATCH', 'Pending reward ledger does not reconcile to its reward wallet. No reward was released.');
  await tx.rewardWallet.update({ where: { id: wallet.id }, data: {
    availablePaise: { increment: amountPaise },
    pendingPaise: { decrement: amountPaise },
    totalEarnedPaise: { increment: amountPaise },
  } });
  await appendEntry(tx, {
    walletId: wallet.id, eventType: input.eventType, referenceType: input.referenceType,
    referenceId: input.referenceId, amountPaise, availableDeltaPaise: amountPaise,
    pendingDeltaPaise: -amountPaise, idempotencyKey: input.idempotencyKey, metadata: input.metadata,
  });
  return amountPaise;
}

/** Reversal affects the separate reward wallet only; customer cash is untouched. */
export async function reverseAvailableReward(
  tx: Tx,
  input: { userId: string; referenceType: string; referenceId: string; idempotencyKey: string; reason: string; actorUserId: string },
) {
  const wallet = await lockRewardWallet(tx, input.userId);
  const existing = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (existing) return { reversedPaise: 0n, replayed: true };
  const original = await tx.rewardLedgerEntry.findFirst({ where: { referenceType: input.referenceType, referenceId: input.referenceId, eventType: input.referenceType === 'P2P_DEPOSIT_ORDER' ? 'P2P_ORDER_REWARD' : 'UPI_DEPOSIT_REWARD' }, select: { amountPaise: true }, orderBy: { createdAt: 'asc' } });
  if (!original || original.amountPaise <= 0n) return { reversedPaise: 0n, replayed: false };
  if (wallet.availablePaise < original.amountPaise) throw new HttpError(409, 'REWARD_BALANCE_ALREADY_SPENT', 'The reward wallet no longer contains the full reward. No customer principal was debited and no reversal was posted.');
  await tx.rewardWallet.update({ where: { id: wallet.id }, data: { availablePaise: { decrement: original.amountPaise } } });
  await appendEntry(tx, {
    walletId: wallet.id,
    eventType: 'P2P_ORDER_REWARD_REVERSED', referenceType: input.referenceType,
    referenceId: input.referenceId, amountPaise: original.amountPaise,
    availableDeltaPaise: -original.amountPaise, idempotencyKey: input.idempotencyKey,
    metadata: { originalAmountPaise: original.amountPaise.toString(), reason: input.reason, actorUserId: input.actorUserId, customerPrincipalTouched: false },
  });
  return { reversedPaise: original.amountPaise, replayed: false };
}

export async function releaseRewardOffer(
  tx: Tx,
  offer: { id: string; userId: string },
  actorUserId: string | null,
  event: 'P2P_WITHDRAWAL_CANCELLED' | 'P2P_WITHDRAWAL_EXPIRED',
  amountPaise: bigint,
  releaseReferenceId: string,
) {
  if (amountPaise <= 0n) return false;
  const reservationKey = `P2P_REWARD_WITHDRAWAL_RESERVED:${offer.id}`;
  if (!await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: reservationKey }, select: { id: true } })) return false;
  const idempotencyKey = `${event}:REWARD:${offer.id}:${releaseReferenceId}`;
  if (await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey }, select: { id: true } })) return false;
  const wallet = await lockRewardWallet(tx, offer.userId);
  if (wallet.reservedPaise < amountPaise) throw new HttpError(409, 'REWARD_RESERVATION_MISMATCH', 'Reward withdrawal reservation no longer covers the amount; Finance review is required.');
  await tx.rewardWallet.update({ where: { id: wallet.id }, data: {
    availablePaise: { increment: amountPaise },
    reservedPaise: { decrement: amountPaise },
  } });
  await appendEntry(tx, {
    walletId: wallet.id,
    eventType: `${event}_REWARD_RELEASE`,
    referenceType: 'P2P_WITHDRAWAL_OFFER',
    referenceId: offer.id,
    amountPaise,
    availableDeltaPaise: amountPaise,
    reservedDeltaPaise: -amountPaise,
    idempotencyKey,
    metadata: { actorUserId, releaseReferenceId, fundingSource: 'REWARD' },
  });
  return true;
}
