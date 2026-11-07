# SUPER_ADMIN wallet credit release

## Current release state

The maker-checker implementation and additive migration are local changes only. They have not been deployed or applied to production. No production wallet credits, funding journal, account changes, or gate changes were made. Keep these values false in production:

```dotenv
FINANCIAL_OPERATIONS_ENABLED=false
WALLET_ADJUSTMENTS_ENABLED=false
ADMIN_WALLET_FUNDING_ENABLED=false
ADMIN_WALLET_CREDITS_ENABLED=false
ADMIN_WALLET_PRODUCTION_APPROVED=false
ADMIN_WALLET_EXTERNAL_RECONCILIATION_VERIFIED=false
```

The global financial gate stays off because the production payment provider is disabled. Dedicated Admin wallet controls are independently gated. This source version permits them only with the full dedicated gate bundle, a separate production approval, and a separate external bank reconciliation attestation. The last two settings are operator attestations; the API cannot prove that a real bank statement or cleared receipt exists. Keep them false until retained finance/security approvals and evidence exist.

No real ledger transaction has been verified for this implementation. Do not represent production credits as operational until a controlled, explicitly authorized real transaction has been posted and reconciled.

## Implemented workflow

1. An active SUPER_ADMIN maker submits a ₹100–₹10,000 request for a revalidated active non-admin user. The request requires a reason and idempotency key and creates no ledger entries.
2. A different active SUPER_ADMIN checker approves or rejects with a reason. Self-approval is denied. Approval runs serializably and posts the user `AVAILABLE` credit, `ADMIN_ADJUSTMENT_FUND` debit, request status, and audit data in one transaction. Rejection posts no ledger entry.
3. The separate funding workflow records a source label, date, evidence reference/digest and bank-reference digest. A different checker attests to checking the original statement and cleared receipt. Approval journals `SETTLEMENT_CASH` debit and `ADMIN_ADJUSTMENT_FUND` credit atomically. It cannot create an opening balance without an approved evidence request.
4. The readiness diagnostic checks migration status, account presence, total/per-transaction ledger balancing, approved request-to-journal links, adjustment-fund funding provenance, active checker count, approved funding history, and positive ledger fund balance. It fails closed on query errors.
5. The external bank-to-ledger reconciliation remains a finance control outside the API. The explicit environment attestation does not replace retained statement/bank evidence or independent review.
6. A target user snapshot (public ID, account UUID, masked phone, current available balance) is rechecked at submission and approval. Changed details return a conflict; no optimistic UI balance is shown.

## Remaining release blockers

- The migration is not applied to any verified staging or production database.
- A dedicated isolated staging Render service/database, controlled OTP credential and synthetic admin/user accounts must be prepared.
- Staging must prove the migration, role enforcement, independent maker-checker, idempotency replay, rejection-no-ledger behavior, funding journal, underfunded rejection, target snapshot conflict, and audit/ledger atomicity against its disposable database. Use only clearly labeled staging funds there.
- Production `ADMIN_ADJUSTMENT_FUND` presence and balance, cleared legal source funds, bank-to-ledger reconciliation, and current approval separation have not been verified in this local work.
- At least two distinct, active human SUPER_ADMINs and independent access/audit controls must be confirmed. A database count alone cannot prove distinct people.
- No production deployment or successful authenticated production Settings/reconciliation response was performed in this turn.
- No real credit ledger transaction has been verified.

## Safe local checks

Use PowerShell from `C:\paisapay_starter\server`. Blank the local database connection variables so tests cannot use a `.env` database connection. These checks do not apply migrations or connect to production:

```powershell
$env:DATABASE_URL = ''
$env:DIRECT_DATABASE_URL = ''
npm run db:generate
npx prisma validate --config prisma.config.ts
npm test
npm run typecheck
npm run build
```

Review the test summary and ensure all DB URLs are blank before invoking commands that can contact a database. Do not run `db:deploy` locally without first identifying and confirming the target staging service/database.

## Staging release procedure

1. Follow `STAGING_SETUP_GUIDE.md` to create a separate Render service and separate Neon project/database. Confirm both pooled and direct URLs belong to the staging endpoint without printing them. Do not reuse production secrets, DB, environment group, or payment credentials.
2. Keep `PAYMENT_PROVIDER=disabled`, `FINANCIAL_OPERATIONS_ENABLED=false`, no deposit receiver, and all wallet/reconciliation/production approval settings false for initial deployment. Use `NODE_ENV=production` so production validation and security behavior are exercised.
3. Review the exact commit and migration SQL. Back up disposable staging data if it has any value. In the staging Render service only, the pre-deploy migration runs `npm run db:deploy`. Confirm migration ID `20261107100000_admin_wallet_credit_maker_checker` is applied and `/ready` is healthy.
4. With gates off, verify authenticated SUPER_ADMIN reads for `/api/v1/admin/me`, `/api/v1/admin/settings`, `/api/v1/admin/wallet/credits/requests`, `/api/v1/admin/wallet/funding/requests`, and `/api/v1/admin/wallet/reconciliation`. Verify unauthorized/non-SUPER_ADMIN responses are denied and mutation attempts return 503 without writes. Retired direct adjustment routes must return 409.
5. For end-to-end staging workflow tests, use only a disposable staging database and funds actually cleared into an isolated staging bank account, reconciled by finance and explicitly designated for testing. Record the staging bank evidence through the same funding maker-checker workflow; never seed ledger balances or fabricate evidence. Use two separate test SUPER_ADMIN identities. Test request, approval, rejection, idempotency replay, insufficient fund, reconciliation, and audit trail. Never perform this test on production.
6. Disable staging gates again after testing and retain the results. No production flags are changed by this staging procedure.

## Production approval and release checklist

Do not enable any production wallet setting until each item is independently documented and approved:

1. Code review and security/finance review approve the maker-checker, migration, audit retention, limits, incident procedure, and segregation of duties.
2. Back up the correct production PostgreSQL database and confirm the owning Render service. Apply only the reviewed additive migration through the production release migration process; verify the exact migration status and `/ready` before app traffic.
3. Authenticated Settings/reconciliation responses confirm the expected `ADMIN_ADJUSTMENT_FUND` and `SETTLEMENT_CASH` accounts, balanced ledger, reconciled request links, clean funding provenance, and at least two active SUPER_ADMIN accounts. Investigate every discrepancy; do not waive a failed check.
4. Finance deposits legitimate business funds through the normal bank process. An independent checker verifies the cleared receipt and original statement. Finance reconciles actual bank balance/statement to `SETTLEMENT_CASH` and `ADMIN_ADJUSTMENT_FUND` and retains evidence outside the app. No SQL seeding or manual ledger edits.
5. The owner/finance/security approvers document explicit production authorization and the external bank reconciliation attestation. Only then, in a separately reviewed change window, set all three dedicated gates true plus `ADMIN_WALLET_EXTERNAL_RECONCILIATION_VERIFIED=true` and `ADMIN_WALLET_PRODUCTION_APPROVED=true`. Keep `FINANCIAL_OPERATIONS_ENABLED=false` and `PAYMENT_PROVIDER=disabled` unless separate payment/payout approval and implementation occur.
6. Restart/deploy the service and verify it is Live, `/ready` is healthy, and authenticated Settings reports no code/database blockers. Verify maker and checker identities are distinct. Perform a real credit only after explicit authorization using a real user and legitimate funded source. Reconcile its balanced ledger entries, idempotency record, request status, audit trail, target wallet, and remaining fund. No synthetic production credit.
7. If any control fails, immediately turn off all three dedicated gates and both approval attestations, confirm startup is healthy and the UI/API report disabled, investigate, and use the incident/accounting process. Disabling gates does not reverse a posted ledger transaction.

No action in this repository or this task enables production settings, applies a production migration, or changes production balances.

## Relevant endpoints

All endpoints are under `/api/v1` and require an authenticated Admin session. Wallet credit, funding, and reconciliation endpoints require SUPER_ADMIN server-side; mutations additionally require their dedicated gates and runtime readiness.

| Method/path | Purpose |
|---|---|
| `GET /admin/me` | Role/capabilities and blockers |
| `GET /admin/settings` | Read-only safety/readiness diagnostic |
| `GET /admin/users`, `GET /admin/users/:id` | Search/details and current ledger-derived balance |
| `GET /admin/users/:id/wallet/credits` | User credit request and posted history |
| `GET /admin/wallet/credits/requests` | Request queue/history |
| `POST /admin/wallet/credits/requests` | Idempotent maker request; no ledger posting |
| `POST /admin/wallet/credits/requests/:id/decision` | Independent checker decision; approval posts atomic journal |
| `GET /admin/wallet/funding/requests` | Funding request queue/history |
| `POST /admin/wallet/funding/requests` | Funding evidence submission; no ledger posting |
| `POST /admin/wallet/funding/requests/:id/decision` | Independent verified-funds decision and accounting journal |
| `GET /admin/wallet/reconciliation` | Ledger balances, integrity and request-link checks |
| `POST /admin/users/:id/wallet/credit`, `POST /admin/wallet-adjustments` | Retired direct writes; 409 `MAKER_CHECKER_REQUIRED` |
