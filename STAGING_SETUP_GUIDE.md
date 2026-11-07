# PaisaPay Staging Infrastructure Setup Guide

**Project:** `C:\paisapay_starter`
**Purpose:** isolated, non-payment staging only
**Status:** instructions only; no cloud resource, database, migration, or deployment was created or accessed while preparing this guide.

## Safety boundary

Staging must use a separate Render service and a dedicated Neon project/database containing only disposable staging data. Do not reuse the production Render service, Render environment group, Neon project/branch, connection string, OTP credential, or app build environment. Keep `PAYMENT_PROVIDER=disabled`, `FINANCIAL_OPERATIONS_ENABLED=false`, rewards disabled, and `DEPOSIT_RECEIVER_UPI_ID` unset. The server rejects attempts to enable financial operations in production mode; financial endpoints return HTTP 503 with `FINANCIAL_OPERATIONS_DISABLED`.

If the two database URLs cannot be positively identified as staging-only, or if staging OTP credentials and a controlled test phone are unavailable, stop before deploying.

## 1. Create a separate Neon staging database

1. Sign in to Neon and create a new project named clearly, for example `paisapay-staging`. Prefer a separate project rather than a branch of production so staging cannot inherit production data.
2. Choose a region close to the Render Singapore service if available. Create a dedicated staging database and a least-privilege application role. Do not use the production role or a personal superuser.
3. In Neon connection details, obtain:
   - A **pooled** connection URL for application runtime (`DATABASE_URL`).
   - A **direct/unpooled** connection URL for Prisma migrations (`DIRECT_DATABASE_URL`).
4. Confirm in the Neon dashboard that both connections belong to the new staging project, database, and intended staging branch/endpoint. Ensure TLS is enabled (`sslmode=require` or stricter). Record the project/branch name and host separately; never paste full URLs in chat, source, tickets, or logs.
5. Keep the database empty before the first staging migration. If it is not empty or already contains data, stop and determine who owns it; do not reset or drop it.

### Verify the staging target without printing credentials

In Render, store each URL as a secret environment variable. Compare the URL host shown by the Neon dashboard with the host in the matching Render value without printing the entire URL. If using a local staging-only PowerShell session, a URI host can be inspected like this (set the variables from staging values only; do not import production values):

```powershell
$runtimeUri = [Uri]$env:DATABASE_URL
$migrationUri = [Uri]$env:DIRECT_DATABASE_URL
$runtimeUri.DnsSafeHost
$migrationUri.DnsSafeHost
```

Both hosts must match the staging endpoint details provided by Neon. The app's Prisma config prefers `DIRECT_DATABASE_URL`, then `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`; the runtime Prisma client uses `DATABASE_URL`. Render does not display or log these values in this guide. Keep staging and production Render services in different environment groups so production values cannot be inherited accidentally.

## 2. Configure the Render staging service

Create a **new Web Service** in Render from the PaisaPay repository. Do not modify or reuse the existing production service. Use these settings based on the current root `render.yaml`:

| Render setting | Staging value |
|---|---|
| Service name | `paisapay-api-staging` |
| Runtime | Node |
| Region | Singapore (or the nearest supported region to the staging Neon project) |
| Plan | Starter, subject to Render's current pre-deploy command availability |
| Root directory | `server` |
| Branch | A dedicated staging branch or the exact reviewed source branch; never allow unreviewed pushes to production service |
| Build command | `npm ci --include=dev && npm run build` |
| Pre-deploy command | `npm run db:deploy` — runs migrations; see the migration safeguards below |
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
| `DATABASE_URL` | Staging Neon pooled TLS URL only. |
| `DIRECT_DATABASE_URL` | Staging Neon direct TLS URL only; Prisma migration config prefers this. |
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

Render's configured `preDeployCommand: npm run db:deploy` executes `prisma migrate deploy`. This applies checked-in pending migrations as part of deployment; it is not a read-only check. Prisma client generation during `npm run build` does not apply migrations.

Before the first staging deploy:

1. Confirm both Render database URLs target the disposable staging database by matching the host/project/branch in Neon. Verify the migration connection is direct/unpooled.
2. Review the exact checked-in migration files in `server/prisma/migrations/` and the Git diff. Confirm each migration is expected and safe for a fresh staging database.
3. Using **staging URLs only**, check migration state from `C:\paisapay_starter\server`:

   ```powershell
   npx prisma migrate status --config prisma.config.ts
   ```

   This contacts the configured database to inspect migration state; ensure environment variables point to staging before running it. This guide itself did not execute it.
4. If staging contains data worth preserving, take a Neon staging snapshot/branch and confirm restore access. Prefer a fresh disposable database.
5. Only after reviewing the target and migration set should an authorized operator deploy the staging service and permit Render's `db:deploy` pre-deploy step.
6. Review Render's migration log and verify expected migration IDs afterwards. Never use `prisma migrate reset`, `db push`, `migrate dev`, or seed commands against production. Do not treat rollback of application code as rollback of database schema.

## 7. Staging deployment sequence

1. Complete separate Neon project/database creation and save the staging-only connection URLs in the staging Render service.
2. Complete all environment settings above; verify payment and financial flags are false/disabled and no deposit recipient is configured.
3. Review the exact source commit, migration SQL, service root, commands, and host/project IDs. Confirm the Render service is `paisapay-api-staging` and separate from production.
4. Trigger the staging deploy. Render should install dependencies, build the app, run the pre-deploy migration, then start the already-built API. Monitor each phase; do not copy logs containing environment values.
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
4. Restore a Neon snapshot only for the staging database, only after evaluating data created since the snapshot and confirming the restore target. Restore may discard later staging data. Never restore a staging snapshot over production.
5. Recheck `/health`, `/ready`, docs, OTP and gate behavior after recovery before resuming staging tests.

## Current verification status

This document is a setup guide, not a deployment. Source configuration currently defines the Render build/start/health/pre-deploy commands above. Financial operations are fail-closed and production startup rejects enabling them. Local validation reported `npm test`: 137 passed and 52 database tests skipped with `DATABASE_URL` blank; `npm run build`: passed; `git diff --check`: passed with line-ending warnings only. No Neon/Render resource, database, migration, live OTP, or Android staging flow was accessed or tested for this guide. Staging remains blocked until a separate service/database and staging OTP credential are configured and the live checks above pass.
