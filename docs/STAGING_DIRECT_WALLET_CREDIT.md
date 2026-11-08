# Staging direct wallet credits

## Scope and gate

Direct credits are implemented only for the existing Render service paisapay-api-staging. The backend requires all of:

- NODE_ENV=production
- PAISAPAY_DEPLOYMENT_ENV=staging
- Render's RENDER=true
- Render's RENDER_SERVICE_NAME=paisapay-api-staging
- ADMIN_STAGING_DIRECT_CREDITS_ENABLED=true

The new flag defaults to false; it is not enabled by code, tests, or deployment changes. Startup rejects the flag on the production service, another Render service, or a non-Render environment. FINANCIAL_OPERATIONS_ENABLED, payment/deposit flags, and production maker-checker controls are not changed by this feature.

## Direct-credit safeguards

The authenticated endpoint is POST /api/v1/admin/wallet/credits/direct. It requires an active SUPER_ADMIN, an idempotency UUID, an active non-admin target, a verified user ID/public ID/masked phone/current ledger balance, an integer amount from ₹100 to ₹10,000, and a reason of 8–500 characters.

The request, ledger posting, and audit records share one serializable database transaction. The ledger debits the pre-existing ADMIN_ADJUSTMENT_FUND and credits the user's AVAILABLE account. The existing fund lock and balance check prevent spending more than the cleared posted balance. Idempotency replays return the prior ledger transaction; a reused key with changed request details is rejected. A corresponding approved credit record remains linked to the ledger so the existing ledger and funding-provenance diagnostics continue to reconcile. Its checker is null and a separate ADMIN_STAGING_DIRECT_WALLET_CREDIT audit action records that the explicitly gated staging path was used.

Before accepting a credit, readiness must confirm the maker-checker migration, both accounting accounts, balanced ledger, reconciled credit and funding links, reconciled adjustment-fund provenance, at least one independently approved funding record, and a positive adjustment-fund balance. The direct path does not require a second active SUPER_ADMIN; a separate checker is still required for funding approval. Database-level balance checks run again inside the credit transaction.

The Admin UI shows the Direct credit action only when /api/v1/admin/me reports the staging-specific capability as enabled and ready. It re-fetches and confirms identity and balance before submission. The production maker-checker request/decision routes remain unchanged; the retired per-user direct-credit route continues to return 409.

## Operator steps

1. Review /api/v1/admin/settings with an authenticated staging SUPER_ADMIN. Confirm the isolated staging database, approved cleared funding, positive adjustment-fund balance, and all direct-credit readiness diagnostics.
2. In Render, verify the exact existing service is paisapay-api-staging, the production service is untouched, and the staging database is paisapay_staging.
3. Only after a staging owner explicitly approves the immediate-credit risk, set ADMIN_STAGING_DIRECT_CREDITS_ENABLED=true in the staging service's Environment page. Leave production configuration and all payment settings unchanged.
4. Deploy the staging branch and verify startup, /ready, authenticated /api/v1/admin/me, and Settings diagnostics. The direct capability should remain false if any readiness blocker remains.
5. Use only a dedicated staging test user and a controlled SUPER_ADMIN account. Confirm the returned UUID, public ID, masked phone, and current balance. Submit the smallest permitted amount with a clear reason and a fresh idempotency UUID.
6. Verify the returned ledger transaction ID and balance, then read the user's wallet detail, credit history, ledger entries, and audit logs. Confirm the adjustment fund debit and user available-wallet credit are equal, the transaction balances, and settings reconciliation remains green.
7. Do not infer success from the HTTP response alone. If the response is lost, repeat only with the same idempotency UUID and inspect the ledger before trying anything else.
8. After the controlled verification, disable ADMIN_STAGING_DIRECT_CREDITS_ENABLED manually in Render and redeploy. This leaves the Admin maker-checker credit workflow available according to its separate gates.

## Local validation

Run focused backend tests from server:

    npm test -- --run src/tests/stagingDirectWalletCredit.test.ts src/tests/financialOperationsGate.test.ts src/tests/openapiAuthenticatedResponses.test.ts
    npm run typecheck
    npm run build

These tests do not contact staging, create test credentials, or post wallet credits. No actual staging balance change is claimed until the operator completes the staging verification steps and confirms both the balance and ledger evidence.
