# One-time single SUPER_ADMIN bootstrap for staging

This procedure creates exactly one `SUPER_ADMIN` role for an existing, active user in the isolated PaisaPay Render staging database. It is intended for initial staging access when the database has no Admin rows. It does not create a user, call production, change production controls, or perform wallet/payment operations.

## Required prerequisites

- Confirm the existing Render service is `paisapay-api-staging` and the database resource is `paisapay-admin-staging-db`.
- The staging database must already contain the target user as `ACTIVE`, and `admin_users` must contain zero rows. This script never creates an account or adds a second Admin.
- Register the user using a controlled staging phone and the actual staging registration API/provider; verify the real OTP. Within 15 minutes before running bootstrap, complete a real login OTP verification as well. The script checks for a consumed `LOGIN` or `REGISTER` challenge for the same phone from the previous 15 minutes.
- Obtain the exact user UUID from the successful staging OTP verification response. Do not guess or use an ID from another environment.
- Confirm staging financial/payment gates are off. This command requires `PAYMENT_PROVIDER=disabled`, `FINANCIAL_OPERATIONS_ENABLED=false`, and all configured financial/reward gates false.
- Obtain the operator identifier from the approved staging owner process. It is only an audit label; database credential access and out-of-band owner approval are the authorization controls.
- Use a private, non-transcribed terminal. Never paste database credentials, password, OTP, or session token into chat or source files.

## PowerShell commands

Run from `C:\paisapay_starter\server`:

```powershell
Set-Location C:\paisapay_starter\server
$ErrorActionPreference = 'Stop'
$env:PAISAPAY_ENVIRONMENT = 'staging'
$env:NODE_ENV = 'production'
$env:PAYMENT_PROVIDER = 'disabled'
$env:FINANCIAL_OPERATIONS_ENABLED = 'false'
$env:PAISAPAY_STAGING_PROVISIONED_BY = '<approved operator identifier>'
$env:ADMIN_WALLET_CREDITS_ENABLED = 'false'
$env:ADMIN_WALLET_FUNDING_ENABLED = 'false'
$env:WALLET_ADJUSTMENTS_ENABLED = 'false'
$env:WELCOME_BONUS_ENABLED = 'false'
$env:UPI_DEPOSIT_REWARD_ENABLED = 'false'

# Secure prompt hides the URL while typing. It is temporarily present in this
# PowerShell process environment so the child process can connect.
$secureDatabaseUrl = Read-Host 'Staging paisapay_staging URL with sslmode=verify-full' -AsSecureString
$env:PAISAPAY_STAGING_ADMIN_DATABASE_URL = [System.Net.NetworkCredential]::new('', $secureDatabaseUrl).Password

try {
  $dbUrl = [Uri]$env:PAISAPAY_STAGING_ADMIN_DATABASE_URL
  $sslModes = [System.Web.HttpUtility]::ParseQueryString($dbUrl.Query).GetValues('sslmode')
  if ($dbUrl.DnsSafeHost -ne 'dpg-dbnnr3jl550s73fnn4f0-a.oregon-postgres.render.com' -or
      $dbUrl.AbsolutePath.TrimStart('/') -ne 'paisapay_staging' -or
      @($sslModes).Count -ne 1 -or $sslModes[0] -ne 'verify-full') {
    throw 'Refusing: database URL is not the approved staging target with verify-full TLS.'
  }

  # Replace the placeholder with the UUID returned by staging OTP verification.
  npm run admin:bootstrap:staging:single -- '<EXISTING_ACTIVE_STAGING_USER_UUID>'
  if ($LASTEXITCODE -ne 0) { throw 'Bootstrap stopped; inspect staging state and do not retry blindly.' }
} finally {
  Remove-Item Env:PAISAPAY_STAGING_ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:PAISAPAY_ENVIRONMENT, Env:NODE_ENV, Env:PAYMENT_PROVIDER,
    Env:FINANCIAL_OPERATIONS_ENABLED, Env:PAISAPAY_STAGING_PROVISIONED_BY,
    Env:ADMIN_WALLET_CREDITS_ENABLED, Env:ADMIN_WALLET_FUNDING_ENABLED,
    Env:WALLET_ADJUSTMENTS_ENABLED, Env:WELCOME_BONUS_ENABLED,
    Env:UPI_DEPOSIT_REWARD_ENABLED -ErrorAction SilentlyContinue
  $secureDatabaseUrl.Dispose()
  $secureDatabaseUrl = $null
}
```

Replace both placeholders locally with the approved operator identifier and the UUID returned by staging. The script validates the exact host/database/TLS again, requires typing `BOOTSTRAP ONE STAGING SUPER_ADMIN <UUID>`, and prompts twice for a 12–128 character password without echo. It hashes using the existing scrypt method.

## Transaction and protections

The transaction uses the same staging advisory lock as the existing two-admin bootstrap. It locks the target user, rechecks that there are zero Admin rows, verifies the account is active and has recent consumed real OTP evidence, sets the password, assigns exactly one `SUPER_ADMIN`, revokes existing sessions, and writes `STAGING_SUPER_ADMIN_BOOTSTRAPPED` audit data. Any failure rolls back. A repeated or concurrent bootstrap sees the Admin row and stops. Production maker-checker and authorization code are unchanged.

After successful bootstrap, verify login against `https://paisapay-api-staging.onrender.com/api/v1/admin/auth/login`, then read `GET /api/v1/admin/me` using the returned access token. Verify the returned role is `SUPER_ADMIN`; do not test against production. With only one Admin, independent maker-checker approvals cannot be performed until a second authorized checker is provisioned through an approved process. Keep financial operations disabled.
