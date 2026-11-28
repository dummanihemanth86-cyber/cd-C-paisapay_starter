import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { REWARD_FUND_ACCOUNT_ID, REWARD_LIABILITY_ACCOUNT_ID } from './rewardWallet.js';
import { summarizeRewardReserve } from './rewardSafety.js';

export async function inspectRewardReserve(db: Pick<Prisma.TransactionClient, '$queryRaw'>) {
  const mappedAccountId = env.p2pOrderRewardFundAccountId;
  const accountId = mappedAccountId || REWARD_FUND_ACCOUNT_ID;
  const rows = await db.$queryRaw<Array<{
    id: string | null; type: string | null; currency: string | null; balance: bigint | null;
    allCredits: bigint; allDebits: bigint; recordedFunding: bigint; fundingCredits: bigint;
    rewardDebits: bigint; liabilityCredits: bigint; fundingMismatchCount: number; rewardMismatchCount: number;
    walletAvailable: bigint; ledgerAvailable: bigint; walletPending: bigint; ledgerPending: bigint;
    walletReserved: bigint; ledgerReserved: bigint;
  }>>`
    SELECT a.id::text AS id, a.type::text AS type, a.currency,
      COALESCE((SELECT SUM(e.credit_paise - e.debit_paise) FROM ledger_entries e WHERE e.account_id = a.id), 0)::bigint AS balance,
      COALESCE((SELECT SUM(e.credit_paise) FROM ledger_entries e WHERE e.account_id = a.id), 0)::bigint AS "allCredits",
      COALESCE((SELECT SUM(e.debit_paise) FROM ledger_entries e WHERE e.account_id = a.id), 0)::bigint AS "allDebits",
      COALESCE((SELECT SUM(r.amount_paise) FROM reward_fund_funding_records r), 0)::bigint AS "recordedFunding",
      COALESCE((SELECT SUM(e.credit_paise) FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id WHERE e.account_id = a.id AND t.event_type = 'REWARD_FUNDING'), 0)::bigint AS "fundingCredits",
      COALESCE((SELECT SUM(e.debit_paise) FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id WHERE e.account_id = a.id AND t.event_type = 'P2P_ORDER_REWARD'), 0)::bigint AS "rewardDebits",
      COALESCE((SELECT SUM(e.credit_paise) FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id WHERE e.account_id = ${REWARD_LIABILITY_ACCOUNT_ID}::uuid AND t.event_type = 'P2P_ORDER_REWARD'), 0)::bigint AS "liabilityCredits",
      COALESCE((SELECT SUM(w.available_paise) FROM reward_wallets w), 0)::bigint AS "walletAvailable",
      COALESCE((SELECT SUM(e.available_delta_paise) FROM reward_ledger_entries e), 0)::bigint AS "ledgerAvailable",
      COALESCE((SELECT SUM(w.pending_paise) FROM reward_wallets w), 0)::bigint AS "walletPending",
      COALESCE((SELECT SUM(e.pending_delta_paise) FROM reward_ledger_entries e), 0)::bigint AS "ledgerPending",
      COALESCE((SELECT SUM(w.reserved_paise) FROM reward_wallets w), 0)::bigint AS "walletReserved",
      COALESCE((SELECT SUM(e.reserved_delta_paise) FROM reward_ledger_entries e), 0)::bigint AS "ledgerReserved",
      (SELECT COUNT(*)::int FROM reward_fund_funding_records r
        LEFT JOIN ledger_transactions t ON t.id = r.ledger_transaction_id
        WHERE t.id IS NULL OR t.event_type <> 'REWARD_FUNDING'
          OR COALESCE((SELECT SUM(e.credit_paise - e.debit_paise) FROM ledger_entries e WHERE e.transaction_id = t.id AND e.account_id = a.id), 0) <> r.amount_paise
          OR COALESCE((SELECT SUM(e.debit_paise - e.credit_paise) FROM ledger_entries e JOIN ledger_accounts c ON c.id = e.account_id WHERE e.transaction_id = t.id AND c.type = 'SETTLEMENT_CASH' AND c.currency = 'INR'), 0) <> r.amount_paise) AS "fundingMismatchCount",
      (SELECT COUNT(*)::int FROM ledger_transactions t
        WHERE t.event_type = 'P2P_ORDER_REWARD' AND (
          t.reference_type <> 'P2P_DEPOSIT_ORDER'
          OR COALESCE((SELECT SUM(e.debit_paise - e.credit_paise) FROM ledger_entries e WHERE e.transaction_id = t.id AND e.account_id = a.id), 0) <= 0
          OR COALESCE((SELECT SUM(e.credit_paise - e.debit_paise) FROM ledger_entries e WHERE e.transaction_id = t.id AND e.account_id = ${REWARD_LIABILITY_ACCOUNT_ID}::uuid), 0)
             <> COALESCE((SELECT SUM(e.debit_paise - e.credit_paise) FROM ledger_entries e WHERE e.transaction_id = t.id AND e.account_id = a.id), 0))) AS "rewardMismatchCount"
    FROM ledger_accounts a WHERE a.id = ${accountId}::uuid
  `;
  const row = rows[0];
  const accountStatus = !row?.id ? 'MISSING'
    : row.type !== 'REWARD_FUND' || row.currency !== 'INR' ? 'INVALID' : 'PROVISIONED';
  return summarizeRewardReserve({
    configuredAccountId: mappedAccountId,
    sourceConfigured: env.p2pOrderRewardFundingSource === 'DEDICATED_REWARD_FUND',
    accountStatus,
    balancePaise: row?.balance ?? 0n,
    allCreditsPaise: row?.allCredits ?? 0n,
    allDebitsPaise: row?.allDebits ?? 0n,
    recordedFundingPaise: row?.recordedFunding ?? 0n,
    fundingJournalCreditPaise: row?.fundingCredits ?? 0n,
    rewardFundDebitPaise: row?.rewardDebits ?? 0n,
    rewardLiabilityCreditPaise: row?.liabilityCredits ?? 0n,
    rewardWalletAvailablePaise: row?.walletAvailable ?? 0n,
    rewardLedgerAvailablePaise: row?.ledgerAvailable ?? 0n,
    rewardWalletPendingPaise: row?.walletPending ?? 0n,
    rewardLedgerPendingPaise: row?.ledgerPending ?? 0n,
    rewardWalletReservedPaise: row?.walletReserved ?? 0n,
    rewardLedgerReservedPaise: row?.ledgerReserved ?? 0n,
    fundingJournalMismatchCount: row?.fundingMismatchCount ?? 0,
    rewardJournalMismatchCount: row?.rewardMismatchCount ?? 0,
  });
}
