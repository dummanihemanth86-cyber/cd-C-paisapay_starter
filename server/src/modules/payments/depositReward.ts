import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/http.js';
import { assertFinancialOrManualUpiOperationsEnabled } from '../../middleware/financialOperations.js';

/** A single rate applies to every Finance-verified INR deposit, regardless of user account. */
export const VERIFIED_DEPOSIT_REWARD_PERCENT_BPS = 620;
/** Kept as an alias for clients/tests that still call this the P2P order rate. */
export const P2P_ORDER_REWARD_PERCENT_BPS = VERIFIED_DEPOSIT_REWARD_PERCENT_BPS;

type VerifiedDepositRewardInput = {
  source: 'UPI_DEPOSIT' | 'P2P_ORDER';
  referenceId: string;
  userId: string;
  actorUserId: string;
  amountPaise: bigint;
};

/**
 * Credit the same reward for every verified manual UPI or matched P2P deposit.
 * Principal approval and this balanced reward posting are called in the same
 * database transaction. When the reward program is enabled, the configured
 * dedicated REWARD_FUND must cover the complete reward or the enclosing
 * approval transaction must roll back, including principal settlement.
 */
export async function grantVerifiedDepositReward(
  tx: Prisma.TransactionClient,
  input: VerifiedDepositRewardInput,
): Promise<bigint> {
  assertFinancialOrManualUpiOperationsEnabled();
  if (!env.p2pOrderRewardEnabled || !env.p2pOrderRewardFundAccountId || env.p2pOrderRewardFundingSource !== 'DEDICATED_REWARD_FUND') return 0n;

  const rewardPaise = input.amountPaise * BigInt(VERIFIED_DEPOSIT_REWARD_PERCENT_BPS) / 10_000n;
  if (rewardPaise <= 0n) return 0n;

  const isP2p = input.source === 'P2P_ORDER';
  const idempotencyKey = isP2p
    ? `P2P_ORDER_REWARD:${input.referenceId}`
    : `UPI_DEPOSIT_REWARD:${input.referenceId}`;
  const eventType = isP2p ? 'P2P_VERIFIED_ORDER_REWARD' : 'UPI_DEPOSIT_REWARD';
  const referenceType = isP2p ? 'P2P_DEPOSIT_ORDER' : 'DEPOSIT';
  const auditAction = isP2p ? 'P2P_VERIFIED_ORDER_REWARD_GRANTED' : 'UPI_DEPOSIT_REWARD_GRANTED';
  const principalMetadata = isP2p ? { orderAmountPaise: input.amountPaise.toString() } : {};
  const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey }, select: { id: true } });
  if (existing) return 0n;

  const [fund, available] = await Promise.all([
    tx.ledgerAccount.findUnique({ where: { id: env.p2pOrderRewardFundAccountId }, select: { id: true, type: true, currency: true } }),
    tx.ledgerAccount.findUnique({ where: { userId_type_currency: { userId: input.userId, type: 'AVAILABLE', currency: 'INR' } }, select: { id: true } }),
  ]);
  if (!fund || fund.type !== 'REWARD_FUND' || fund.currency !== 'INR') {
    throw new HttpError(503, 'REWARD_FUND_NOT_READY', 'The verified-deposit reward fund is not ready. No deposit approval or wallet credit was made.');
  }
  if (!available) throw new HttpError(500, 'USER_WALLET_NOT_READY', 'The user wallet ledger is not ready. No deposit approval or wallet credit was made.');

  // Serialize all reward spends against the fund. Locking the user's available
  // account in the same deterministic order keeps the balanced post atomic.
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${fund.id}::uuid, ${available.id}::uuid) ORDER BY id FOR UPDATE`;
  const [balance] = await tx.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(credit_paise - debit_paise), 0)::bigint AS balance
    FROM ledger_entries WHERE account_id = ${fund.id}::uuid`;
  if (!balance || balance.balance < rewardPaise) {
    throw new HttpError(409, 'REWARD_FUND_INSUFFICIENT', 'The verified-deposit reward reserve cannot cover this reward. No deposit approval or wallet credit was made.');
  }

  await tx.ledgerTransaction.create({ data: {
    eventType,
    referenceType,
    referenceId: input.referenceId,
    idempotencyKey,
    actorUserId: input.actorUserId,
    metadata: {
      amountPaise: rewardPaise.toString(),
      depositAmountPaise: input.amountPaise.toString(),
      ...principalMetadata,
      percentageBps: VERIFIED_DEPOSIT_REWARD_PERCENT_BPS,
      currency: 'INR',
      rewardProgram: 'VERIFIED_DEPOSIT_REWARD',
      source: input.source,
      fundingSource: env.p2pOrderRewardFundingSource,
      rewardFundAccountId: fund.id,
    },
    entries: { create: [
      { accountId: fund.id, debitPaise: rewardPaise },
      { accountId: available.id, creditPaise: rewardPaise },
    ] },
  } });
  await tx.auditLog.create({ data: {
    actorId: input.actorUserId,
    action: auditAction,
    target: `${referenceType}:${input.referenceId}`,
    reason: 'A 6.2% reward was credited after independent receipt verification from the mapped, funded INR REWARD_FUND ledger account.',
    metadata: {
      amountPaise: rewardPaise.toString(),
      depositAmountPaise: input.amountPaise.toString(),
      ...principalMetadata,
      percentageBps: VERIFIED_DEPOSIT_REWARD_PERCENT_BPS,
      currency: 'INR',
      rewardProgram: 'VERIFIED_DEPOSIT_REWARD',
      source: input.source,
      fundingSource: env.p2pOrderRewardFundingSource,
      rewardFundAccountId: fund.id,
    },
  } });
  return rewardPaise;
}

/** Compatibility wrapper for the manual UPI verification route. */
export async function grantVerifiedUpiDepositReward(
  tx: Prisma.TransactionClient,
  input: { depositId: string; userId: string; actorUserId: string; amountPaise: bigint },
): Promise<bigint> {
  return grantVerifiedDepositReward(tx, { ...input, source: 'UPI_DEPOSIT', referenceId: input.depositId });
}

/** Compatibility wrapper for the P2P Finance approval route. */
export async function grantVerifiedP2pOrderReward(
  tx: Prisma.TransactionClient,
  input: { orderId: string; userId: string; actorUserId: string; amountPaise: bigint },
): Promise<bigint> {
  return grantVerifiedDepositReward(tx, { ...input, source: 'P2P_ORDER', referenceId: input.orderId });
}
