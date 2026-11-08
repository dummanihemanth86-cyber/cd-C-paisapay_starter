# Staging-only SUPER_ADMIN provisioning

This procedure provisions exactly two SUPER_ADMIN accounts for the isolated Render staging service and database. It does not create user accounts, send OTPs, create ledger accounts, write ledger transactions, or enable any financial feature. It does not modify or call `scripts/ownerAdminBootstrap.ts`, the production Neon project, or the production API.

## Security design

- The separate CLI accepts only the dedicated `PAISAPAY_STAGING_ADMIN_DATABASE_URL` variable. It never falls back to `DATABASE_URL`, `DIRECT_DATABASE_URL`, `DATABASE_URL_UNPOOLED`, or a `.env` file.
- It requires `PAISAPAY_ENVIRONMENT=staging`, `NODE_ENV=production`, `PAYMENT_PROVIDER=disabled`, and an explicit `FINANCIAL_OPERATIONS_ENABLED=false`. It also rejects any configured wallet, bonus, reward, production-approval, or reconciliation-attestation flag that is not `false`.
- It pins the database to Render resource `dpg-dbnnr3jl550s73fnn4f0-a`, external TLS hostname `dpg-dbnnr3jl550s73fnn4f0-a.oregon-postgres.render.com`, database `paisapay_staging`, and exactly one `sslmode=verify-full`. Neon and other hosts, database names, duplicate TLS parameters, and disabled TLS are rejected before connecting.
- It only promotes two different, already-active staging users with a real LOGIN or REGISTER OTP consumed within the previous 15 minutes. It never creates a user or fabricates OTP evidence. A fresh OTP check confirms current phone control rather than relying on old evidence.
- It refuses to run if any Admin account already exists or either target already has an Admin role. Provisioning is a one-time, empty-Admin-table operation. It does not add extra admins on rerun.
- The operator must type the environment-specific action and both target UUIDs. Passwords are entered with terminal echo disabled, confirmed twice, must be 12–128 characters, and must differ. Only scrypt hashes are stored. Passwords and OTPs are never printed or included in audit data.
- A single Serializable transaction takes a staging-specific advisory lock, locks both users, rechecks all preconditions, sets the two passwords, assigns SUPER_ADMIN, revokes their active sessions, and writes one audit record per account. Any failure rolls back the operation.
- The script rejects enabled financial flags and insecure TLS overrides. It has no code path for deposits, withdrawals, wallet balances, credits, funding, or ledger transactions.

Because this is a one-time privilege bootstrap, run it from a reviewed local checkout under an approved staging operator account. Confirm that the two accounts belong to different authorized testers. The script cannot determine whether two phone numbers belong to two different people.

The operator identifier is an audit label, not proof of identity. Restrict access to the staging database credential and require the staging owner to approve the two target account UUIDs out of band before running the CLI. Do not rely on the typed confirmation alone as the authorization control.

## Prepare the two staging accounts

1. Use two different team-controlled phone numbers approved for the staging Renflair account.
2. Register each account through the staging app or the real registration OTP API. Complete the OTP verification from each handset. Do not use demo OTP, guessed codes, test bypasses, or production SMS credentials.
3. Confirm both accounts are `ACTIVE`. Within 15 minutes of provisioning, request and verify a real OTP for each through `POST /api/v1/auth/request-otp` and `POST /api/v1/auth/verify-otp` using the controlled phone, returned `challengeId`, and handset code. The verification response includes `user.id`; the provisioning tool independently checks for that recent consumed LOGIN proof before writing. No OTP value is printed by the tool.
4. Sign out the temporary user sessions with `POST /api/v1/auth/logout` using their refresh tokens. Keep account IDs private and do not copy session tokens into logs. The tool revokes any remaining sessions for both users as part of the role/credential change.

If a target user is missing, inactive, lacks consumed OTP evidence, already has an Admin role, or any Admin row already exists, stop. Do not edit the database manually to bypass a failed preflight.

## Run the staging-only tool

Run in PowerShell from the backend directory. Before starting, independently verify in the existing `paisapay-api-staging` Render Environment page that all financial flags and production wallet approval attestations are false. The local process guards below do not inspect or alter Render settings. Obtain the database URL only from the existing `paisapay-admin-staging-db` resource in Render. The tool accepts only that resource's external URL and verifies its hostname, database name, and TLS mode. Do not use a Neon URL or a production connection string.

```powershell
Set-Location C:\paisapay_starter\server
$env:PAISAPAY_ENVIRONMENT = 'staging'
$env:NODE_ENV = 'production'
$env:PAYMENT_PROVIDER = 'disabled'
$env:FINANCIAL_OPERATIONS_ENABLED = 'false'
$env:PAISAPAY_STAGING_PROVISIONED_BY = 'approved-operator-id'
$env:ADMIN_WALLET_CREDITS_ENABLED = 'false'
$env:ADMIN_WALLET_FUNDING_ENABLED = 'false'
$env:WALLET_ADJUSTMENTS_ENABLED = 'false'
$env:WELCOME_BONUS_ENABLED = 'false'
$env:UPI_DEPOSIT_REWARD_ENABLED = 'false'
$secureDatabaseUrl = Read-Host 'Paste the staging paisapay_staging external URL with sslmode=verify-full' -AsSecureString
$env:PAISAPAY_STAGING_ADMIN_DATABASE_URL = [System.Net.NetworkCredential]::new('', $secureDatabaseUrl).Password
try {
  npm exec -- tsx scripts/stagingSuperAdminProvision.ts '<REPLACE_WITH_STAGING_USER_UUID_1>' '<REPLACE_WITH_STAGING_USER_UUID_2>'
  if ($LASTEXITCODE -ne 0) { throw 'Staging Admin provisioning stopped; inspect the safe error message and do not retry blindly.' }
} finally {
  Remove-Item Env:PAISAPAY_STAGING_ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:PAISAPAY_ENVIRONMENT, Env:NODE_ENV, Env:PAYMENT_PROVIDER, Env:FINANCIAL_OPERATIONS_ENABLED, Env:PAISAPAY_STAGING_PROVISIONED_BY, Env:ADMIN_WALLET_CREDITS_ENABLED, Env:ADMIN_WALLET_FUNDING_ENABLED, Env:WALLET_ADJUSTMENTS_ENABLED, Env:WELCOME_BONUS_ENABLED, Env:UPI_DEPOSIT_REWARD_ENABLED -ErrorAction SilentlyContinue
  $secureDatabaseUrl.Dispose()
  $secureDatabaseUrl = $null
}
```

The secure URL prompt will not echo the connection string, but PowerShell must temporarily hold the decrypted URL in the child process environment. Use a private, non-transcribed terminal. Never paste the URL into a command, source file, ticket, or chat. The script prompts separately for two distinct passwords without echo and never accepts them as command-line arguments.

The script prints only the staging host/database, operation ID, masked phone/public account identifier, role, and revoked-session count. It verifies both stored scrypt hashes and roles before reporting success. If the transaction commits but post-write verification fails, do not rerun: inspect the staging audit log and Admin records first.

## Verify each staging Admin through the API

Use a private PowerShell session without transcript logging. This function keeps tokens in variables, prints only the verified role/account ID, and revokes its temporary session even if the role check fails. Run it once for each tester with that account's phone and password. The password prompt is hidden.

```powershell
$base = 'https://paisapay-api-staging.onrender.com'
function Test-StagingSuperAdmin([string]$phoneE164) {
  $secret = Read-Host 'Admin password (hidden)' -AsSecureString
  $password = [System.Net.NetworkCredential]::new('', $secret).Password
  $login = $null
  try {
    $body = @{ phoneE164 = $phoneE164; password = $password } | ConvertTo-Json -Compress
    $login = Invoke-RestMethod -Method Post -Uri "$base/api/v1/admin/auth/login" -ContentType 'application/json' -Body $body
    $me = Invoke-RestMethod -Method Get -Uri "$base/api/v1/admin/me" -Headers @{ Authorization = "Bearer $($login.accessToken)" }
    if ($me.role -ne 'SUPER_ADMIN') { throw 'The authenticated staging role is not SUPER_ADMIN.' }
    [pscustomobject]@{ UserId = $me.userId; Role = $me.role; FinancialOperationsEnabled = $me.financialOperationsEnabled }
  } finally {
    if ($login.refreshToken) {
      try { Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/logout" -ContentType 'application/json' -Body (@{ refreshToken = $login.refreshToken } | ConvertTo-Json -Compress) | Out-Null } catch { }
    }
    $password = ''
    $login = $null
    $secret.Dispose()
  }
}
Test-StagingSuperAdmin '+91XXXXXXXXXX'
Test-StagingSuperAdmin '+91YYYYYYYYYY'
```

Confirm the two returned `UserId` values differ and both roles are `SUPER_ADMIN`. Confirm `FinancialOperationsEnabled` is `false` for each. For read-only maker-checker access, use each verified access token to call `GET /api/v1/admin/wallet/credits/requests` and `GET /api/v1/admin/wallet/funding/requests`; do not submit or decide requests. No credit, funding, deposit, withdrawal, or other financial mutation is part of this verification.

## Recovery and audit

Each successful account change writes `STAGING_SUPER_ADMIN_PROVISIONED` to `audit_logs`, with a shared operation ID, approved operator handle, target staging user ID, provisioning method, and number of revoked sessions. The audit record does not contain passwords, OTPs, database URLs, or session tokens. The tool is intentionally not an HTTP endpoint. If it reports an error, preserve the error and staging audit state for review; do not bypass the guard or change the production bootstrap utility.
