import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';

// Fixed system ledger accounts are created only by the explicitly development-only seed.
export const DEVELOPMENT_REWARD_FUND_ACCOUNT_ID = '00000000-0000-4000-8000-000000000099';
export const DEVELOPMENT_SETTLEMENT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000098';

export type WelcomeBonusResult = 'DISABLED' | 'NOT_ELIGIBLE' | 'FUNDING_REQUIRED' | 'ALREADY_GRANTED' | 'CREDITED';

/** Grant the configured welcome credit from the seeded test pool, exactly once. */
export async function grantWelcomeBonus(tx: Prisma.TransactionClient, userId: string): Promise<WelcomeBonusResult> {
  if (!env.financialOperationsEnabled || !env.welcomeBonusEnabled) return 'DISABLED';

  // Serialize claims against the shared reward pool before computing its balance.
  const fundAccount = await tx.ledgerAccount.findUnique({ where: { id: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID }, select: { id: true } });
  const settlementAccount = await tx.ledgerAccount.findUnique({ where: { id: DEVELOPMENT_SETTLEMENT_ACCOUNT_ID }, select: { id: true } });
  if (!fundAccount || !settlementAccount) return 'FUNDING_REQUIRED';
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${DEVELOPMENT_REWARD_FUND_ACCOUNT_ID}::uuid FOR UPDATE`;
  const [fund] = await tx.$queryRaw<Array<{ balance: bigint | null }>>`
    SELECT COALESCE(SUM(le.credit_paise - le.debit_paise), 0)::bigint AS balance
    FROM ledger_entries le WHERE le.account_id = ${DEVELOPMENT_REWARD_FUND_ACCOUNT_ID}::uuid`;
  const amount = BigInt(env.welcomeBonusAmountPaise);
  if (!fund || (fund.balance ?? 0n) < amount) return 'FUNDING_REQUIRED';

  const claimed = await tx.user.updateMany({ where: { id: userId, welcomeBonusEligible: true }, data: { welcomeBonusEligible: false } });
  if (claimed.count !== 1) return 'NOT_ELIGIBLE';

  const idempotencyKey = `WELCOME_BONUS:${userId}`;
  const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey }, select: { id: true } });
  if (existing) return 'ALREADY_GRANTED';

  const userAccount = await tx.ledgerAccount.findUnique({ where: { userId_type_currency: { userId, type: 'AVAILABLE', currency: 'INR' } }, select: { id: true } });
  if (!userAccount) throw new Error('User available ledger account is missing.');
  await tx.ledgerTransaction.create({
    data: {
      eventType: 'WELCOME_BONUS',
      referenceType: 'USER',
      referenceId: userId,
      idempotencyKey,
      actorUserId: userId,
      metadata: { amountPaise: env.welcomeBonusAmountPaise, currency: 'INR', fundingSource: env.welcomeBonusFundingSource, developmentOnly: true },
      entries: { create: [
        { accountId: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID, debitPaise: amount },
        { accountId: userAccount.id, creditPaise: amount },
      ] },
    },
  });
  return 'CREDITED';
}
