import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { DEVELOPMENT_REWARD_FUND_ACCOUNT_ID } from '../users/welcomeBonus.js';
import { assertFinancialOrManualUpiOperationsEnabled } from '../../middleware/financialOperations.js';

export const P2P_ORDER_REWARD_PERCENT_BPS = 620;

/** Credit a verified UPI deposit reward from the funded development pool once. */
export async function grantVerifiedUpiDepositReward(
  tx: Prisma.TransactionClient,
  input: { depositId: string; userId: string; actorUserId: string; amountPaise: bigint },
): Promise<bigint> {
  assertFinancialOrManualUpiOperationsEnabled();
  if (!env.upiDepositRewardEnabled || env.upiDepositRewardPercentBps <= 0) return 0n;

  const rewardPaise = input.amountPaise * BigInt(env.upiDepositRewardPercentBps) / 10_000n;
  if (rewardPaise <= 0n) return 0n;
  const idempotencyKey = `UPI_DEPOSIT_REWARD:${input.depositId}`;
  if (await tx.ledgerTransaction.findUnique({ where: { idempotencyKey }, select: { id: true } })) return 0n;

  const fund = await tx.ledgerAccount.findUnique({ where: { id: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID }, select: { id: true } });
  if (!fund) return 0n;
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${fund.id}::uuid FOR UPDATE`;
  const [balance] = await tx.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(credit_paise - debit_paise), 0)::bigint AS balance
    FROM ledger_entries WHERE account_id = ${fund.id}::uuid`;
  if (!balance || balance.balance < rewardPaise) return 0n;

  const available = await tx.ledgerAccount.findUnique({
    where: { userId_type_currency: { userId: input.userId, type: 'AVAILABLE', currency: 'INR' } },
    select: { id: true },
  });
  if (!available) throw new Error('User available ledger account is missing for verified deposit reward.');

  await tx.ledgerTransaction.create({
    data: {
      eventType: 'UPI_DEPOSIT_REWARD',
      referenceType: 'DEPOSIT',
      referenceId: input.depositId,
      idempotencyKey,
      actorUserId: input.actorUserId,
      metadata: {
        amountPaise: rewardPaise.toString(),
        depositAmountPaise: input.amountPaise.toString(),
        percentageBps: env.upiDepositRewardPercentBps,
        currency: 'INR',
        fundingSource: env.upiDepositRewardFundingSource,
        developmentOnly: true,
      },
      entries: { create: [
        { accountId: fund.id, debitPaise: rewardPaise },
        { accountId: available.id, creditPaise: rewardPaise },
      ] },
    },
  });
  await tx.auditLog.create({
    data: {
      actorId: input.actorUserId,
      action: 'UPI_DEPOSIT_REWARD_GRANTED',
      target: `DEPOSIT:${input.depositId}`,
      reason: 'Configured development UPI deposit reward funded from the test reward pool.',
      metadata: { amountPaise: rewardPaise.toString(), currency: 'INR', percentageBps: env.upiDepositRewardPercentBps, fundingSource: env.upiDepositRewardFundingSource },
    },
  });
  return rewardPaise;
}

/** Grant each buyer order's 6.2% P2P reward once, only from the funded test pool. */
export async function grantVerifiedP2pOrderReward(
  tx: Prisma.TransactionClient,
  input: { orderId: string; userId: string; actorUserId: string; amountPaise: bigint },
): Promise<bigint> {
  assertFinancialOrManualUpiOperationsEnabled();
  if (!env.upiDepositRewardEnabled) return 0n;
  const rewardPaise = input.amountPaise * BigInt(P2P_ORDER_REWARD_PERCENT_BPS) / 10_000n;
  if (rewardPaise <= 0n) return 0n;
  const idempotencyKey = `P2P_ORDER_REWARD:${input.orderId}`;
  if (await tx.ledgerTransaction.findUnique({ where: { idempotencyKey }, select: { id: true } })) return 0n;

  const [fund, available] = await Promise.all([
    tx.ledgerAccount.findUnique({ where: { id: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID }, select: { id: true } }),
    tx.ledgerAccount.findUnique({ where: { userId_type_currency: { userId: input.userId, type: 'AVAILABLE', currency: 'INR' } }, select: { id: true } }),
  ]);
  if (!fund || !available) return 0n;
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id IN (${fund.id}::uuid, ${available.id}::uuid) ORDER BY id FOR UPDATE`;
  const [balance] = await tx.$queryRaw<Array<{ balance: bigint }>>`
    SELECT COALESCE(SUM(credit_paise - debit_paise), 0)::bigint AS balance
    FROM ledger_entries WHERE account_id = ${fund.id}::uuid`;
  if (!balance || balance.balance < rewardPaise) return 0n;

  await tx.ledgerTransaction.create({ data: {
    eventType: 'P2P_VERIFIED_ORDER_REWARD', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: input.orderId,
    idempotencyKey, actorUserId: input.actorUserId,
    metadata: { amountPaise: rewardPaise.toString(), orderAmountPaise: input.amountPaise.toString(), percentageBps: P2P_ORDER_REWARD_PERCENT_BPS, currency: 'INR', fundingSource: env.upiDepositRewardFundingSource, developmentOnly: true },
    entries: { create: [ { accountId: fund.id, debitPaise: rewardPaise }, { accountId: available.id, creditPaise: rewardPaise } ] },
  } });
  await tx.auditLog.create({ data: {
    actorId: input.actorUserId, action: 'P2P_VERIFIED_ORDER_REWARD_GRANTED', target: `P2P_DEPOSIT_ORDER:${input.orderId}`,
    reason: 'P2P buyer reward was granted after independently verified receipt, funded from the configured development reward pool.',
    metadata: { amountPaise: rewardPaise.toString(), percentageBps: P2P_ORDER_REWARD_PERCENT_BPS, currency: 'INR', fundingSource: env.upiDepositRewardFundingSource },
  } });
  return rewardPaise;
}
