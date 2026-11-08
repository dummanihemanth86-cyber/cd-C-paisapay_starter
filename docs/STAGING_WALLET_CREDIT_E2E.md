# Staging wallet credit end-to-end test

This test performs **one real ₹100 credit** to a designated staging test account. It is skipped during ordinary test runs. It must only be run after an authorized finance/operator review confirms a legitimate, cleared source in the isolated staging account. It does not create funding, turn on flags, reset users, or contact production.

## Preconditions

- Use only `https://paisapay-api-staging.onrender.com` and the isolated `paisapay_staging` database.
- Keep `PAYMENT_PROVIDER=disabled` and `FINANCIAL_OPERATIONS_ENABLED=false`. Do not enable payment/deposit/reward controls.
- A separately authorized operator has configured the dedicated Admin credit/funding gates for this test. The test aborts before creating a request unless maker capability and the authenticated readiness diagnostics are green.
- The database has the maker-checker migration applied, balanced and reconciled ledger/funding history, at least ₹200 in `ADMIN_ADJUSTMENT_FUND` backed by real cleared staging funds, and two different active SUPER_ADMIN users. The ₹200 minimum leaves the fund positive after the test credit so the duplicate-approval check reaches the already-decided guard.
- Maker and checker access tokens were obtained through the existing staging Admin login flow. Use a private terminal; never paste tokens in chat, source, command arguments, or logs.
- The target is a dedicated non-admin staging test account whose display name contains `STAGING CREDIT TEST`. Verify its UUID and public ID before starting. The test always requests exactly ₹100 and leaves the posted credit and audit trail in place.

## Run

From `C:\paisapay_starter\server`, set these only in a private PowerShell process. Do not print the token variables:

```powershell
$env:PAISAPAY_STAGING_CREDIT_MAKER_ACCESS_TOKEN = Read-Host 'Maker staging access token (private)' -AsSecureString | ForEach-Object { [System.Net.NetworkCredential]::new('', $_).Password }
$env:PAISAPAY_STAGING_CREDIT_CHECKER_ACCESS_TOKEN = Read-Host 'Checker staging access token (private)' -AsSecureString | ForEach-Object { [System.Net.NetworkCredential]::new('', $_).Password }
$env:PAISAPAY_STAGING_CREDIT_TARGET_USER_ID = Read-Host 'Dedicated staging test account UUID'
$env:PAISAPAY_STAGING_CREDIT_TARGET_PUBLIC_ID = Read-Host 'Confirm its public user ID'
$env:PAISAPAY_STAGING_WALLET_CREDIT_E2E = 'I_CONFIRM_100_INR_STAGING_CREDIT'
try {
  npm test -- --run src/tests/stagingWalletCredit.e2e.test.ts
} finally {
  Remove-Item Env:PAISAPAY_STAGING_CREDIT_MAKER_ACCESS_TOKEN, Env:PAISAPAY_STAGING_CREDIT_CHECKER_ACCESS_TOKEN, Env:PAISAPAY_STAGING_CREDIT_TARGET_USER_ID, Env:PAISAPAY_STAGING_CREDIT_TARGET_PUBLIC_ID, Env:PAISAPAY_STAGING_WALLET_CREDIT_E2E -ErrorAction SilentlyContinue
}
```

For an Admin APK that targets staging, use the dedicated `staging-apk` EAS profile or run `npm run build:android:staging` from `C:\paisapay_starter\apps\admin-app`. The existing production profiles and production API URL remain unchanged.

The test checks both distinct SUPER_ADMIN roles, readiness and funding before posting. It verifies target identity, one pending request, idempotent replay, unchanged balance before approval, independent approval, one user credit ledger entry, the exact ₹100 balance increase, request history, ledger reconciliation, and rejection of a duplicate approval. It never retries a failed mutation automatically. If a failure happens after approval, inspect the request/history and ledger before any further action; do not rerun blindly.

## Normal CI/local tests

Without the exact opt-in value above, the staging E2E test is skipped and makes no network calls. Unit tests remain safe to run without staging credentials or a database.
