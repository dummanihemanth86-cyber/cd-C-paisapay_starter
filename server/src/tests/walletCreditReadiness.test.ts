import { describe, expect, it } from 'vitest';
import { readWalletCreditReadiness } from '../modules/admin/walletCreditReadiness.js';
import { ADMIN_ADJUSTMENT_FUND_ID, ADMIN_SETTLEMENT_CASH_ID } from '../modules/admin/walletCreditWorkflow.js';

function readinessDb({ migrationApplied = true, fundBalance = 500_000n, activeAdmins = 2, approvedFunding = 1 } = {}) {
  const db = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM (SELECT id FROM ledger_accounts')) return [
        { id: ADMIN_ADJUSTMENT_FUND_ID, balance: fundBalance },
        { id: ADMIN_SETTLEMENT_CASH_ID, balance: 500_000n },
      ];
      if (sql.includes('migration_name =')) return [{ applied: migrationApplied }];
      if (sql.includes('WITH per_transaction')) return [{ debits: '500000', credits: '500000', unbalanced: 0n }];
      if (sql.includes('actualFund')) return [{ actualFund: String(fundBalance), expectedFund: String(fundBalance), actualCash: '500000', expectedCash: '500000', unexpectedFundTransactions: 0n }];
      return [{ count: 0n }];
    },
    adminUser: { count: async () => activeAdmins },
    adminWalletFundingRequest: { count: async () => approvedFunding },
  };
  return db as never;
}

describe('wallet credit readiness diagnostic', () => {
  it('reports ready only when migration, ledger, provenance, funding, and checker prerequisites are satisfied', async () => {
    const result = await readWalletCreditReadiness(readinessDb());
    expect(result).toMatchObject({ migration: 'APPLIED', ledgerIntegrity: 'BALANCED', creditRequestLedgerLinks: 'RECONCILED', fundingRequestLedgerLinks: 'RECONCILED', fundingProvenance: 'RECONCILED', activeSuperAdminCount: 2, approvedFundingCount: 1 });
    expect(result.adjustmentFundAccount).toEqual({ status: 'PROVISIONED', balancePaise: '500000' });
    expect(result.creditBlockers).toEqual([]);
    expect(result.fundingBlockers).toEqual([]);
  });

  it('fails closed when migration, positive funding, and an independent checker are missing', async () => {
    const result = await readWalletCreditReadiness(readinessDb({ migrationApplied: false, fundBalance: 0n, activeAdmins: 1, approvedFunding: 0 }));
    expect(result.creditBlockers).toEqual(expect.arrayContaining([
      'Maker-checker migration is missing',
      'Fewer than two active SUPER_ADMIN accounts are available for maker-checker separation',
      'No independently approved funding request is recorded',
      'ADMIN_ADJUSTMENT_FUND has no positive posted ledger balance',
    ]));
    expect(result.fundingBlockers).toContain('Maker-checker migration is missing');
  });
});
