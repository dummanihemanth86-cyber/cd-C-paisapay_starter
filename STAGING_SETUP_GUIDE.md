# PaisaPay Staging Infrastructure Setup Guide

**Project:** `C:\paisapay_starter`
**Purpose:** isolated, non-payment staging only
**Status (2026-11-08):** isolated Render project and free PostgreSQL database are provisioned. No API service exists, no migration has run, and no deploy is active. The database expires on 2026-12-08 unless upgraded.

## Safety boundary

Staging must use the isolated Render project/database described below and a separate Render API service containing only disposable staging data. Do not reuse the production Render service, database, environment group, connection string, OTP credential, or app build environment. Keep `PAYMENT_PROVIDER=disabled`, `FINANCIAL_OPERATIONS_ENABLED=false`, rewards disabled, and `DEPOSIT_RECEIVER_UPI_ID` unset. The server rejects attempts to enable financial operations in production mode; financial endpoints return HTTP 503 with `FINANCIAL_OPERATIONS_DISABLED`.

If the two database URLs cannot be positively identified as staging-only, or if staging OTP credentials and a controlled test phone are unavailable, stop before deploying.

## 1. Confirm the isolated Render staging database

The database has already been created in Render; do not create another one or use a production database.

| Resource | Confirmed value |
|---|---|
| Render project | `PaisaPay Admin Staging` (`prj-dbnnpo2jnfac73ct66f0`) |
| Environment | `Staging` (`evm-dbnnpo2jnfac73ct66fg`) |
| PostgreSQL service | `paisapay-admin-staging-db` (`dpg-dbnnr3jl550s73fnn4f0-a`) |
| Database | `paisapay_staging` |
| Region / plan | Oregon / Free |
| Current status | Available; expires 2026-12-08 unless upgraded |

The staging Blueprint links this exact Render database to the staging API; it does not accept an arbitrary database URL. Render's generated internal URL has no query parameters by default, so before any deployment add `?sslmode=require` to the linked `DATABASE_URL` in the staging service's Environment page. If a URL already has query parameters, append `&sslmode=require`. Replace any existing weaker `sslmode` value. Do the same for any configured `DIRECT_DATABASE_URL` or `DATABASE_URL_UNPOOLED`. The API and migration config validate TLS before use; Prisma migrations prefer `DIRECT_DATABASE_URL`, then `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`. Keep the database empty before the first migration; do not reset or drop it if it unexpectedly contains data. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` or use `sslmode=disable`.

### Verify the staging target without printing credentials

In Render, link the database to the staging service so Render supplies its connection values. Confirm the database resource ID above in the project. Never print the full URL. If an authorized operator needs to inspect a URL host in a private staging-only PowerShell session, use staging values only (never import production values):

```powershell
$runtimeUri = [Uri]$env:DATABASE_URL
$migrationUri = [Uri]$env:DIRECT_DATABASE_URL
$runtimeUri.DnsSafeHost
$migrationUri.DnsSafeHost
```

Both hosts must identify the Render staging database above. The app's Prisma config prefers `DIRECT_DATABASE_URL`, then `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`; the runtime Prisma client uses `DATABASE_URL`. Keep staging and production Render services in different environments so production values cannot be inherited accidentally.

## 2. Configure the Render staging service

Create a staging-only Blueprint from `render.staging.yaml` in the PaisaPay repository. In the Blueprint setup, select this file explicitly; the existing root `render.yaml` describes the other API service and must not be synced for staging. The staging Blueprint pins the branch, staging project/environment, Oregon region, service name, database link and financial-off settings:

| Render setting | Staging value |
|---|---|
| Service name | `paisapay-api-staging` |
| Runtime | Node |
| Region | Oregon, matching the existing staging database |
| Plan | Free to avoid creating a recurring charge; it may sleep between requests. Do not upgrade without approval. |
| Root directory | `server` |
| Branch | `codex/admin-wallet-credit-staging` |
| Build command | `npm ci --include=dev && npm run db && npm run build` |
| Pre-deploy command | None on Free tier; `npm run db` applies migrations during the build. |
| Start command | `npm start` (`node dist/src/server.js`) |
| Health check path | `/ready` |

The checked-in Blueprint currently names the service `paisapay-api`. If using a separate Render Blueprint instead of a manually created service, first configure a separate staging blueprint/service name and confirm that it will not update or replace the production service. Do not apply the current Blueprint to production as part of this setup guide.

## 3. Required staging environment variables

Set these in the **staging service's private Render Environment settings**. Never add them to app source, EAS, Git, or public logs.

| Key | Staging value / rule |
|---|---|
| `NODE_VERSION` | `22.22.2` (matches current Render config) |
| `NODE_ENV` | `production` (production-mode validation also protects the staging service) |
| `HOST` | `0.0.0.0` |
| `PORT` | Let Render set it; do not hardcode a port. |
| `DATABASE_URL` | Blueprint-linked URL for `paisapay-admin-staging-db`; manually append `sslmode=require` before deploying. |
| `DIRECT_DATABASE_URL` | Optional direct Render staging migration URL with `sslmode=require`; if set, it must point to the same staging database. |
| `DATABASE_URL_UNPOOLED` | Optional migration URL with `sslmode=require`; if set, it must point to the same staging database. |
| `SESSION_HASH_SECRET` | New random staging-only secret; at least 32 characters. |
| `BANK_ACCOUNT_ENCRYPTION_KEY` | New random staging-only 32-byte key encoded as 64 hex characters. |
| `OTP_PROVIDER` | `renflair-v1` |
| `RENFLAIR_API_KEY` | Authorized staging/test credential from Renflair, stored as a secret. |
| `RENFLAIR_V1_API_URL` | Leave unset to use the validated default `https://sms.renflair.in/V1.php`; only use this supported endpoint. |
| `APP_ORIGIN` | Blank for native-only clients. If staging web clients are used, exact HTTPS staging origins, comma-separated, no path/trailing slash. |
| `PAYMENT_PROVIDER` | `disabled` |
| `FINANCIAL_OPERATIONS_ENABLED` | `false` |
| `WALLET_ADJUSTMENTS_ENABLED` | `false` |
| `ADMIN_WALLET_FUNDING_ENABLED` | `false` |
| `ADMIN_WALLET_CREDITS_ENABLED` | `false` |
| `ADMIN_WALLET_PRODUCTION_APPROVED` | `false` |
| `ADMIN_WALLET_EXTERNAL_RECONCILIATION_VERIFIED` | `false` |
| `UPI_DEPOSIT_REWARD_ENABLED` | `false` |
| `WELCOME_BONUS_ENABLED` | `false` |
| `DEPOSIT_RECEIVER_UPI_ID` | Leave unset. No recipient means the API provides no UPI deposit instructions. |
| `EXPO_PUSH_ACCESS_TOKEN` | Optional only if staging push delivery is separately configured; never put this in EAS client variables. |

Do not set Cashfree/payment credentials, OTP bypass numbers, demo credentials, local SMS gateway variables, or payment secrets for this non-payment staging service. The app's environment validator requires the Renflair key when `OTP_PROVIDER=renflair-v1`; production-mode startup also requires the database URL, session secret, and bank encryption key, rejects local database hosts/non-TLS URLs, rejects `PAYMENT_PROVIDER` other than `disabled`, and rejects `FINANCIAL_OPERATIONS_ENABLED=true`. Keep all dedicated wallet and approval/reconciliation gates false during initial staging deployment. Any isolated staging workflow test that deliberately enables its dedicated gates must use disposable staging data and be disabled again after testing.

## 4. Generate staging secrets safely on Windows

Run these commands in a private PowerShell window. They place each generated value on the clipboard and do not print it. Paste directly into the corresponding Render **secret** value field, save it, then clear the clipboard. Do not reuse production secrets.

```powershell
# SESSION_HASH_SECRET: 48 random bytes encoded as 96 hex characters
$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
Set-Clipboard -Value ([BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
$rng.Dispose()
# Clear the local byte buffer.
[Array]::Clear($bytes, 0, $bytes.Length)
# Paste into Render's SESSION_HASH_SECRET field, then:
Set-Clipboard -Value ''

# BANK_ACCOUNT_ENCRYPTION_KEY: 32 random bytes encoded as 64 hex characters
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
Set-Clipboard -Value ([BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
$rng.Dispose()
# Clear the local byte buffer.
[Array]::Clear($bytes, 0, $bytes.Length)
# Paste into Render's BANK_ACCOUNT_ENCRYPTION_KEY field, then:
Set-Clipboard -Value ''
```

Store recovery copies in the organization's approved password/secret manager. Losing or rotating the encryption key without a re-encryption plan can make encrypted bank details unreadable. Do not save these values in `.env`, PowerShell history, screenshots, or build logs.

## 5. Configure staging OTP delivery with Renflair

1. Ask Renflair for an approved staging/test API credential and sender/template configuration. Confirm which test recipients are permitted, whether messages incur cost, and the provider's staging rate limits.
2. Store the staging credential only as `RENFLAIR_API_KEY` in the staging Render service. Do not use a production key unless the provider explicitly authorizes it for isolated staging and controlled recipients.
3. Keep `OTP_PROVIDER=renflair-v1`; the API URL defaults to the supported fixed HTTPS endpoint. The server does not support an arbitrary Renflair URL override.
4. The app's config validator confirms the key is present; it does not perform provider connectivity checks during `/ready`.
5. If Renflair cannot provide a safe staging credential or an authorized test number, leave staging deployment blocked rather than using console OTP, demo login, or the production SMS credential.

## 6. Migration review and execution safeguards

Prisma is configured in `server/prisma.config.ts` with schema `prisma/schema.prisma` and migrations under `prisma/migrations`. Migration connection selection is `DIRECT_DATABASE_URL` → `DATABASE_URL_UNPOOLED` → `DATABASE_URL`. Runtime data access uses the pooled `DATABASE_URL`.

`npm run db` is an alias for `npm run db:deploy`, which executes `prisma migrate deploy`. It applies checked-in pending migrations and is not a read-only check. The staging Blueprint runs it in the build command, as requested; the existing root `render.yaml` uses a separate pre-deploy command for its own service. Prisma client generation during `npm run build` does not apply migrations. In production mode, `prisma.config.ts` validates every configured database URL and stops before migration if TLS is missing/disabled or no database URL is present.

Before the first staging deploy:

1. Confirm the Blueprint-linked `DATABASE_URL` identifies service `dpg-dbnnr3jl550s73fnn4f0-a` and database `paisapay_staging`; confirm it includes `sslmode=require`. Any separate migration URL must resolve to that same database and include `sslmode=require` or `verify-full`.
2. Review the exact checked-in migration files in `server/prisma/migrations/` and the Git diff. Confirm each migration is expected and safe for a fresh staging database.
3. Using **staging URLs only**, check migration state from `C:\paisapay_starter\server`:

   ```powershell
   npx prisma migrate status --config prisma.config.ts
   ```

   This contacts the configured database to inspect migration state; ensure environment variables point to staging before running it. This guide itself did not execute it.
4. If staging contains data worth preserving, take a Render staging backup/snapshot and confirm restore access. The newly created database should otherwise remain disposable and empty.
5. Only after reviewing the target and migration set should an authorized operator deploy the staging service and permit its configured `db:deploy` step. On the selected Free tier this runs in the build command, not a pre-deploy phase.
6. Review Render's migration log and verify expected migration IDs afterwards. Never use `prisma migrate reset`, `db push`, `migrate dev`, or seed commands against production. Do not treat rollback of application code as rollback of database schema.

## 7. Staging deployment sequence

1. Use `render.staging.yaml` and select the staging Render project/environment; verify its `fromDatabase` reference points to `paisapay-admin-staging-db`.
2. Complete all environment settings above; verify payment and financial flags are false/disabled and no deposit recipient is configured.
3. Review the exact source commit, migration SQL, service root, commands, and host/project IDs. Confirm the Render service is `paisapay-api-staging` and separate from production.
4. Before triggering a deploy, manually add `sslmode=require` to the service's linked `DATABASE_URL` and set the two required secret values. Render should install dependencies, validate and apply the reviewed migration against the linked staging database during the build command, build the app, then start the API. Monitor each phase; do not copy logs containing environment values. The TLS guard in `npm run db` must fail before contacting PostgreSQL if TLS is absent or disabled.
5. If build or migration fails, stop and inspect the staging logs. Do not retry against another database until the configured target has been positively confirmed.
6. Proceed to smoke checks only after deploy succeeds.

## 8. Post-deployment health and documentation checks

Replace the placeholder with the actual staging service hostname from Render; do not guess a URL. In PowerShell:

```powershell
$base = 'https://<actual-staging-service-host>'
Invoke-RestMethod "$base/health"
Invoke-RestMethod "$base/ready"
Invoke-WebRequest "$base/api/v1/docs/" | Select-Object -ExpandProperty StatusCode
Invoke-RestMethod "$base/api/v1/openapi.json" | Select-Object -ExpandProperty openapi
```

Expected: `/health` returns HTTP 200 and `ok=true`; `/ready` returns HTTP 200 with `dependencies.database=ready`; Swagger HTML returns HTTP 200; OpenAPI JSON returns HTTP 200 and OpenAPI version `3.0.3`. A readiness failure means stop and fix staging DB connectivity. `/ready` checks only database connectivity; it does not test OTP provider delivery, payment services, workers, or external push delivery.

Check Render startup logs for successful bind on Render's assigned port and no configuration errors. Never expose credentials while diagnosing.

## 9. OTP delivery smoke test

Use a phone number controlled by the team and authorized for the Renflair staging account. Do not test against arbitrary users or repeatedly request OTPs. With `$base` set to the actual staging origin and the controlled E.164 number entered locally:

```powershell
$phoneE164 = Read-Host 'Controlled staging test phone in E.164 format'
$body = @{ phoneE164 = $phoneE164 } | ConvertTo-Json
$otpRequest = Invoke-RestMethod -Method Post `
  -Uri "$base/api/v1/auth/request-otp" `
  -ContentType 'application/json' `
  -Body $body
$otpRequest | Select-Object challengeId, expiresInSeconds, resendAfterSeconds, deliveryState, gatewayStatus, message
```

Confirm the SMS arrives on that controlled device and that `deliveryState`/`gatewayStatus` is consistent with provider delivery. Do not expect the OTP in the API response or logs. Complete the supported verification flow manually using the received OTP and the issued challenge ID, then confirm a session can be created and revoked. Keep the value private; do not include the OTP in this guide, a ticket, or logs. If the provider reports a failure, check its dashboard and server logs without printing API keys. A successful HTTP response alone is not proof that the carrier delivered the message.

## 10. Functional and safety smoke checks

- With an authenticated staging user, check profile, notification, support, and `/api/v1/config` routes.
- Confirm financial routes return HTTP 503 with code `FINANCIAL_OPERATIONS_DISABLED`, including withdrawal offer/matching and deposit/payment claim operations. Use only a staging account/token; do not attempt payment.
- Confirm the unauthenticated financial request still returns authentication failure before financial-gate response where auth is required.
- Confirm `PAYMENT_PROVIDER=disabled`, reward flags false, and no `DEPOSIT_RECEIVER_UPI_ID` in the Render staging environment. Never try to enable finance in production mode.
- For staging mobile builds, configure `EXPO_PUBLIC_API_URL` in each app's staging EAS environment to the actual staging HTTPS origin. This value is public. Keep all private credentials on the server.

Record the commit, staging database project/branch identifier (not connection strings), applied migration IDs, health/readiness results, OTP delivery result, and gate test result in the deployment record.

## 11. Rollback

1. If the API fails after a deploy, use Render's dashboard to disable/stop the **staging service** or roll back to the last known-good staging deployment. Do not touch the production service.
2. An application rollback does not reverse database migrations. Do not run `migrate reset`, manually drop tables, or edit `_prisma_migrations` to force a rollback.
3. If a migration is additive and compatible with the old app version, roll back the app only after confirming compatibility. Otherwise keep staging unavailable and prepare a reviewed forward-fix migration.
4. Restore a Render snapshot only for the staging database, only after evaluating data created since the snapshot and confirming the restore target. Restore may discard later staging data. Never restore a staging snapshot over production.
5. Recheck `/health`, `/ready`, docs, OTP and gate behavior after recovery before resuming staging tests.

## Current verification status

This guide records a Render staging project and an available, isolated free PostgreSQL database. No staging API service, migration, authenticated API read, live OTP, or maker-checker ledger workflow has yet been deployed or tested. Staging is blocked until a dedicated staging Renflair key and controlled test phone, two separate staging SUPER_ADMIN identities, and a new staging API service are configured. End-to-end funding/credit testing additionally requires cleared funds received into a separately designated staging bank account. Existing local tests and builds passed as recorded in `audit-reports/ADMIN_REPAIR_REPORT.md`; they do not verify deployment or real ledger posting.
