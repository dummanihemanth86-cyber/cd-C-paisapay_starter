import type { PrismaClient } from '../../generated/prisma/client.js';
import { ADMIN_ADJUSTMENT_FUND_ID, ADMIN_SETTLEMENT_CASH_ID } from './walletCreditWorkflow.js';

export type WalletCheckStatus = 'APPLIED' | 'MISSING' | 'CHECK_FAILED' | 'BALANCED' | 'IMBALANCED' | 'RECONCILED' | 'DISCREPANCY' | 'VERIFIED';

export async function readWalletCreditReadiness(db: PrismaClient) {
  let adjustmentFundAccount: { status: 'PROVISIONED' | 'MISSING' | 'CHECK_FAILED'; balancePaise: string | null };
  let settlementCashAccount: { status: 'PROVISIONED' | 'MISSING' | 'CHECK_FAILED'; balancePaise: string | null };
  try {
    const rows = await db.$queryRaw<Array<{ id: string | null; balance: bigint | null }>>`
      SELECT a.id::text AS id,
             CASE WHEN a.type::text = 'SETTLEMENT_CASH' THEN COALESCE(SUM(e.debit_paise - e.credit_paise), 0)::bigint
                  ELSE COALESCE(SUM(e.credit_paise - e.debit_paise), 0)::bigint END AS balance
        FROM (SELECT id FROM ledger_accounts WHERE (id = ${ADMIN_ADJUSTMENT_FUND_ID}::uuid AND type::text = 'ADMIN_ADJUSTMENT_FUND') OR (id = ${ADMIN_SETTLEMENT_CASH_ID}::uuid AND type::text = 'SETTLEMENT_CASH')) expected
        LEFT JOIN ledger_accounts a ON a.id = expected.id
        LEFT JOIN ledger_entries e ON e.account_id = a.id
       GROUP BY a.id`;
    const fund = rows.find((row) => row.id === ADMIN_ADJUSTMENT_FUND_ID);
    const cash = rows.find((row) => row.id === ADMIN_SETTLEMENT_CASH_ID);
    adjustmentFundAccount = fund ? { status: 'PROVISIONED', balancePaise: String(fund.balance ?? 0n) } : { status: 'MISSING', balancePaise: null };
    settlementCashAccount = cash ? { status: 'PROVISIONED', balancePaise: String(cash.balance ?? 0n) } : { status: 'MISSING', balancePaise: null };
  } catch {
    adjustmentFundAccount = { status: 'CHECK_FAILED', balancePaise: null };
    settlementCashAccount = { status: 'CHECK_FAILED', balancePaise: null };
  }

  const [migration, ledgerIntegrity, creditRequestLedgerLinks, fundingRequestLedgerLinks, fundingProvenance, activeAdmins, approvedFundingCount] = await Promise.all([
    db.$queryRaw<Array<{ applied: boolean }>>`SELECT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261107100000_admin_wallet_credit_maker_checker' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied`
      .then((rows): WalletCheckStatus => rows[0]?.applied === true ? 'APPLIED' : 'MISSING').catch((): WalletCheckStatus => 'CHECK_FAILED'),
    db.$queryRaw<Array<{ debits: string; credits: string; unbalanced: bigint }>>`
      WITH per_transaction AS (SELECT transaction_id, SUM(debit_paise) AS debits, SUM(credit_paise) AS credits FROM ledger_entries GROUP BY transaction_id)
      SELECT COALESCE((SELECT SUM(debit_paise) FROM ledger_entries), 0)::text AS debits,
             COALESCE((SELECT SUM(credit_paise) FROM ledger_entries), 0)::text AS credits,
             COALESCE((SELECT COUNT(*) FROM per_transaction WHERE debits <> credits), 0)::bigint AS unbalanced`
      .then((rows): WalletCheckStatus => rows[0] && rows[0].debits === rows[0].credits && rows[0].unbalanced === 0n ? 'BALANCED' : 'IMBALANCED').catch((): WalletCheckStatus => 'CHECK_FAILED'),
    db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM admin_wallet_credit_requests r LEFT JOIN ledger_transactions t ON t.id = r.ledger_transaction_id WHERE r.status::text = 'APPROVED' AND (t.id IS NULL OR t.reference_type <> 'ADMIN_ADJUSTMENT' OR t.event_type <> 'ADMIN_ADJUSTMENT' OR (SELECT COALESCE(SUM(e.credit_paise), 0) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id = t.id AND a.user_id = r.target_user_id AND a.type::text = 'AVAILABLE') <> r.amount_paise OR (SELECT COALESCE(SUM(e.debit_paise), 0) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id = t.id AND a.id = ${ADMIN_ADJUSTMENT_FUND_ID}::uuid) <> r.amount_paise`
      .then((rows): WalletCheckStatus => rows[0]?.count === 0n ? 'RECONCILED' : 'DISCREPANCY').catch((): WalletCheckStatus => 'CHECK_FAILED'),
    db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM admin_wallet_funding_requests r LEFT JOIN ledger_transactions t ON t.id = r.ledger_transaction_id WHERE r.status::text = 'APPROVED' AND (t.id IS NULL OR t.reference_type <> 'ADMIN_WALLET_FUNDING_REQUEST' OR t.reference_id <> r.id::text OR (SELECT COALESCE(SUM(e.debit_paise), 0) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id = t.id AND a.id = ${ADMIN_SETTLEMENT_CASH_ID}::uuid) <> r.amount_paise OR (SELECT COALESCE(SUM(e.credit_paise), 0) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id = t.id AND a.id = ${ADMIN_ADJUSTMENT_FUND_ID}::uuid) <> r.amount_paise`
      .then((rows): WalletCheckStatus => rows[0]?.count === 0n ? 'RECONCILED' : 'DISCREPANCY').catch((): WalletCheckStatus => 'CHECK_FAILED'),
    db.$queryRaw<Array<{ actualFund: string; expectedFund: string; actualCash: string; expectedCash: string; unexpectedFundTransactions: bigint }>>`
      SELECT
        (SELECT COALESCE(SUM(credit_paise - debit_paise), 0)::text FROM ledger_entries WHERE account_id = ${ADMIN_ADJUSTMENT_FUND_ID}::uuid) AS "actualFund",
        ((SELECT COALESCE(SUM(amount_paise), 0) FROM admin_wallet_funding_requests WHERE status::text = 'APPROVED') - (SELECT COALESCE(SUM(amount_paise), 0) FROM admin_wallet_credit_requests WHERE status::text = 'APPROVED'))::text AS "expectedFund",
        (SELECT COALESCE(SUM(debit_paise - credit_paise), 0)::text FROM ledger_entries WHERE account_id = ${ADMIN_SETTLEMENT_CASH_ID}::uuid) AS "actualCash",
        ((SELECT COALESCE(SUM(amount_paise), 0) FROM admin_wallet_funding_requests WHERE status::text = 'APPROVED') + (SELECT COALESCE(SUM(amount_paise), 0) FROM admin_phonepe_credit_requests WHERE status::text = 'COMPLETED'))::text AS "expectedCash",
        (SELECT COUNT(DISTINCT t.id)::bigint FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id AND e.account_id = ${ADMIN_ADJUSTMENT_FUND_ID}::uuid WHERE NOT EXISTS (SELECT 1 FROM admin_wallet_funding_requests f WHERE f.status::text = 'APPROVED' AND f.ledger_transaction_id = t.id) AND NOT EXISTS (SELECT 1 FROM admin_wallet_credit_requests c WHERE c.status::text = 'APPROVED' AND c.ledger_transaction_id = t.id) AND NOT EXISTS (SELECT 1 FROM admin_phonepe_credit_requests p WHERE p.status::text = 'COMPLETED' AND (p.funding_ledger_transaction_id = t.id OR p.ledger_transaction_id = t.id))) AS "unexpectedFundTransactions"`
      .then((rows): WalletCheckStatus => { const row = rows[0]; return row && row.actualFund === row.expectedFund && row.actualCash === row.expectedCash && row.unexpectedFundTransactions === 0n ? 'RECONCILED' : 'DISCREPANCY'; }).catch((): WalletCheckStatus => 'CHECK_FAILED'),
    db.adminUser.count({ where: { role: 'SUPER_ADMIN', user: { status: 'ACTIVE' } } })
      .then((count) => ({ status: 'VERIFIED' as const, count })).catch(() => ({ status: 'CHECK_FAILED' as const, count: 0 })),
    db.adminWalletFundingRequest.count({ where: { status: 'APPROVED' } }).catch(() => -1),
  ]);
  const activeSuperAdminCount = activeAdmins.count;
  const baseBlockers = [
    ...(migration !== 'APPLIED' ? [`Maker-checker migration is ${migration.toLowerCase()}`] : []),
    ...(adjustmentFundAccount.status !== 'PROVISIONED' ? [`ADMIN_ADJUSTMENT_FUND account is ${adjustmentFundAccount.status.toLowerCase()}`] : []),
    ...(settlementCashAccount.status !== 'PROVISIONED' ? [`SETTLEMENT_CASH account is ${settlementCashAccount.status.toLowerCase()}`] : []),
    ...(ledgerIntegrity !== 'BALANCED' ? [`Ledger integrity is ${ledgerIntegrity.toLowerCase()}`] : []),
    ...(creditRequestLedgerLinks !== 'RECONCILED' ? [`Credit request ledger links are ${creditRequestLedgerLinks.toLowerCase()}`] : []),
    ...(fundingRequestLedgerLinks !== 'RECONCILED' ? [`Funding request ledger links are ${fundingRequestLedgerLinks.toLowerCase()}`] : []),
    ...(fundingProvenance !== 'RECONCILED' ? [`ADMIN_ADJUSTMENT_FUND source-to-ledger provenance is ${fundingProvenance.toLowerCase()}`] : []),
    ...(activeAdmins.status !== 'VERIFIED' ? ['Active SUPER_ADMIN count could not be verified'] : activeSuperAdminCount < 2 ? ['Fewer than two active SUPER_ADMIN accounts are available for maker-checker separation'] : []),
  ];
  const adjustmentFundBalancePaise = BigInt(adjustmentFundAccount.balancePaise ?? '0');
  const fundingBlockers = [...baseBlockers, ...(approvedFundingCount < 0 ? ['Approved funding request history could not be checked'] : [])];
  const creditBlockers = [
    ...baseBlockers,
    ...(approvedFundingCount <= 0 ? ['No independently approved funding request is recorded'] : []),
    ...(adjustmentFundAccount.status !== 'PROVISIONED' || adjustmentFundBalancePaise <= 0n ? ['ADMIN_ADJUSTMENT_FUND has no positive posted ledger balance'] : []),
  ];
  const directCreditBlockers = [
    ...baseBlockers.filter((blocker) => !blocker.startsWith('Fewer than two active SUPER_ADMIN accounts')),
    ...(approvedFundingCount <= 0 ? ['No independently approved funding request is recorded'] : []),
    ...(adjustmentFundAccount.status !== 'PROVISIONED' || adjustmentFundBalancePaise <= 0n ? ['ADMIN_ADJUSTMENT_FUND has no positive posted ledger balance'] : []),
  ];
  return {
    adjustmentFundAccount, settlementCashAccount, migration, ledgerIntegrity, creditRequestLedgerLinks,
    fundingRequestLedgerLinks, fundingProvenance, activeSuperAdminCount, activeSuperAdminCountStatus: activeAdmins.status,
    approvedFundingCount, fundingBlockers, creditBlockers, directCreditBlockers,
    externalBankReconciliation: approvedFundingCount > 0 ? 'CHECKER_ATTESTED_REQUIRES_EXTERNAL_RECONCILIATION' : 'NOT_VERIFIED',
  };
}
