# PaisaPay Safe Non-Payment Deployment Checklist

**Reviewed:** 2026-11-03
**Repository:** `C:\paisapay_starter`
**Scope:** Safe deployment of non-payment API functionality. This checklist does not authorize a deployment, database migration, payment, payout, or production-data access.

## Staging-only deployment sequence

Use this sequence only for a separate staging service and a disposable staging PostgreSQL database. Never reuse the production Render service's environment group, production Neon branch, or production connection strings.

1. Create or select a dedicated staging Neon project/branch and database. Use isolated test data and a role limited to this staging database. Keep the pooled runtime URL in `DATABASE_URL` and the direct migration URL in `DIRECT_DATABASE_URL`; verify both identify the staging project/branch in the Neon dashboard before saving them to Render. Do not print either connection string.
2. Create a separate Render staging web service from the repository. Before its first deploy, set the environment variables listed below and confirm `FINANCIAL_OPERATIONS_ENABLED=false`, `PAYMENT_PROVIDER=disabled`, `UPI_DEPOSIT_REWARD_ENABLED=false`, `WELCOME_BONUS_ENABLED=false`, and leave `DEPOSIT_RECEIVER_UPI_ID` unset. Do not copy production secrets into staging; create separate session/encryption secrets and use an approved staging OTP credential.
3. Review the service commands before deploying. `buildCommand` runs `npm ci --include=dev && npm run build`; `startCommand` runs `npm start`. Render's `preDeployCommand` is `npm run db:deploy` and **will apply pending migrations on every staging deploy**. Before allowing the first staging deploy, point `DIRECT_DATABASE_URL` only at the disposable staging database, inspect all pending migration SQL and the staging migration status, and take a staging snapshot if the database contains anything to preserve. This audit does not run or approve migrations.
4. Deploy only the separate staging service after confirming the target values and expected migration set. Check Render build, migration, start, and runtime logs for errors without exposing environment values.
5. Smoke-check `https://<staging-service-host>/health` (process response), `/ready` (database connectivity), `/api/v1/openapi.json` (OpenAPI JSON), and `/api/v1/docs/` (Swagger UI). These source routes are covered by tests; their live staging availability has not been verified here.
6. Verify financial requests in staging return HTTP 503 and `FINANCIAL_OPERATIONS_DISABLED`; confirm profile, support, notifications, configuration, and authentication remain usable. Test OTP delivery with the staging provider account. `/ready` checks PostgreSQL only; it does **not** verify OTP provider connectivity or SMS delivery. Do not submit real payments, use real user data, or manually enable financial operations.
7. Record the deployed commit, migration IDs, `/health` and `/ready` results, OTP delivery result, and financial-gate smoke-test result. Keep the service marked staging/non-payment.

### Staging environment requirements

Required server settings: `NODE_ENV=production`, Render-managed `PORT`, `HOST=0.0.0.0`, staging-only `DATABASE_URL`, staging-only `DIRECT_DATABASE_URL`, unique staging `SESSION_HASH_SECRET` (at least 32 characters), unique staging `BANK_ACCOUNT_ENCRYPTION_KEY` (64 hex characters), `OTP_PROVIDER=renflair-v1`, and a valid authorized staging `RENFLAIR_API_KEY`. `APP_ORIGIN` may be blank for native-only clients; if a browser client is used, set exact HTTPS staging origins. Set `PAYMENT_PROVIDER=disabled`, `FINANCIAL_OPERATIONS_ENABLED=false`, `UPI_DEPOSIT_REWARD_ENABLED=false`, and `WELCOME_BONUS_ENABLED=false`. Leave `DEPOSIT_RECEIVER_UPI_ID` unset. Configure `EXPO_PUBLIC_API_URL` only in each staging EAS app environment if testing mobile clients; it must point to the staging HTTPS origin and contains no secret.

**Do not continue** if either database URL points to production, the migration target cannot be established confidently, the required staging OTP credentials are unavailable, or the Render service is not separate from production.

## Decision

- **Isolated staging / non-payment validation:** suitable after setting staging-only secrets and connecting only an isolated staging database.
- **Customer-facing production advertised as non-payment:** the API now defaults the centralized `FINANCIAL_OPERATIONS_ENABLED` gate to false and returns HTTP 503 `FINANCIAL_OPERATIONS_DISABLED` on covered financial operations. Production startup rejects attempts to enable the flag in this build. Staging/deployment verification is still required before calling a deployment ready.
- **Real-money payments and payouts:** **BLOCKED**. Keep `PAYMENT_PROVIDER=disabled`; no authorized production payment/payout provider is implemented.

## Source checks

- [x] Production config enforces `PAYMENT_PROVIDER=disabled`.
- [x] Production welcome bonus and UPI deposit reward are disabled.
- [x] No default UPI recipient is present in server or Public App source.
- [x] Blank/missing `DEPOSIT_RECEIVER_UPI_ID` is treated as unavailable. UPI deposit creation returns HTTP 503 before deposit lookup/write; the Public App does not show payment, QR, or copy instructions without a server-provided recipient.
- [x] UTR and screenshot submission creates an unverified claim; it does not automatically credit a wallet. Finance review still has a ledger-credit path after a reviewer supplies a receiver-confirmation assertion and evidence fields. The server has no authorized production payment-provider connection to independently validate that assertion.
- [x] Payment-provider webhook route fails closed while no provider is configured.
- [x] No database schema or migration changes are part of the current working diff.
- [x] The existing `server/tsconfig.build.json` change is preserved.
- [x] No staged changes or new commit were present during this review. Example environment files contain placeholders only; populated `.env` files are ignored by `.gitignore`.
- [x] Secret pattern scan found only placeholder PostgreSQL URLs in example configuration/documentation; no private keys or common live provider tokens in changed/untracked files. No values were printed. This is not a full Git-history secret scan.

## Deployable non-payment subset

These improvements can be exercised in an isolated staging deployment, subject to the environment and migration checks below:

- Health/readiness and API documentation.
- Authentication/session endpoints after live OTP configuration has been independently validated.
- Profile, UPI profile, support, notification and other non-financial API behavior.
- OpenAPI contract, authorization, and regression-test improvements.
- Admin reporting/read-only features, subject to server-side role checks and production secrets.

This list does not mean every endpoint has been tested against PostgreSQL or a real Android device. The 52 database integration tests remain skipped in the current local run.

## Required blocker before calling production “non-payment”

- [x] Add a centralized server-side gate, default false, with a stable 503 error for non-payment deployments.
- [x] Gate P2P offers/matching/orders, payment claims, Finance claim review and evidence access, deposit create/cancel, legacy order mutations, payment webhook processing, and commission/reward configuration mutations.
- [x] Guard financial expiry/reservation workers, GET-triggered P2P cleanup, deposit expiry, Cashfree status verification, welcome bonus credits, and direct P2P/reward/referral/expiry service entry points when the gate is disabled.
- [x] Add tests for stable disabled responses, route-manifest coverage, OpenAPI 503 schemas, no database writes while gated (including direct service calls), auth-before-gate behavior, and availability of profile/config/notifications/support reads.
- [ ] Run PostgreSQL integration suites against a disposable isolated test database; local database suites are skipped when `DATABASE_URL` is blank.
- [ ] Verify whether public/admin apps hide or clearly disable the same actions when the server reports non-payment mode. Backend rejection remains authoritative.

Do not resolve this blocker by relying on `PAYMENT_PROVIDER=disabled`, missing UPI VPA, UI hiding, zero balances, or an assumption that no one will call the routes.

## Environment and deployment checklist

- [ ] Use a separate staging Neon branch/database for staging; never copy production credentials into app builds.
- [ ] Set `NODE_ENV=production`, Render-managed `PORT`, and `HOST=0.0.0.0`.
- [ ] Set pooled TLS `DATABASE_URL` and direct TLS `DIRECT_DATABASE_URL` in Render private environment settings; confirm target project/branch before any migration.
- [ ] Set a unique private `SESSION_HASH_SECRET` (at least 32 characters) and a separate 32-byte hex `BANK_ACCOUNT_ENCRYPTION_KEY` (64 hex characters). Do not print or commit either value.
- [ ] Use `OTP_PROVIDER=renflair-v1` and `RENFLAIR_API_KEY` only after validating the approved provider account, sender setup and live OTP delivery. OTP is not a payment feature, but production login depends on it.
- [x] Keep `PAYMENT_PROVIDER=disabled`.
- [x] Set `FINANCIAL_OPERATIONS_ENABLED=false`; production startup rejects `true` until an authorized provider and verification path are implemented.
- [x] Keep `UPI_DEPOSIT_REWARD_ENABLED=false` and `WELCOME_BONUS_ENABLED=false`.
- [ ] Leave `DEPOSIT_RECEIVER_UPI_ID` blank/unset for a non-payment deployment. If later enabling UPI instructions, independently verify the merchant recipient and reconciliation process first; a syntactically valid VPA is not ownership verification.
- [ ] Set `APP_ORIGIN` only to exact HTTPS browser origins if a browser client is used. Native apps normally do not send a browser Origin.
- [ ] Set `EXPO_PUBLIC_API_URL` separately in both EAS projects. It is public configuration, never a place for secrets.
- [ ] Confirm Render's `preDeployCommand: npm run db:deploy` target and inspect pending migration SQL and backup/restore readiness before deployment. No migration was run in this review.
- [ ] Deploy staging first; confirm `/health`, `/ready`, logs, auth, authorization and non-payment flows against staging only.
- [ ] Do not promote to customer-facing production while the financial-feature gate is absent or staging database/API verification is incomplete.

## Verification run for this review

The requested checks were run from `server/` with `DATABASE_URL` blank, so the tests could not connect to Neon or another database:

```powershell
cd C:\paisapay_starter\server
$env:DATABASE_URL = ''
npm test
npm run build
cd C:\paisapay_starter
git diff --check
```

| Check | Result |
|---|---|
| `npm test` | PASS — latest run: 15 files passed, 3 skipped; 137 passed, 52 skipped (189 total). The skips are database integration tests because `DATABASE_URL` was blank. Gate tests cover every route in the gate manifest, production fail-closed config, OpenAPI 503 responses, no writes while disabled (including direct service calls), authorization precedence, and allowed non-financial reads. |
| `npm run build` | PASS — Prisma Client generated locally; strict production TypeScript build completed. |
| `git diff --check` | PASS — no whitespace errors; Git reported line-ending conversion warnings only. |
| `node --check mobile/App.js` | PASS. |
| staged/secret-file review | PASS for current working changes — no staged files; local `.env` paths are ignored; only example env templates are modified. This is a working-tree review, not a full Git-history secret scan. |

A Prisma client generation during build is local code generation and does not apply migrations or connect to the database. The gate verification used in-memory/unit test infrastructure; no database connection was configured.

## Remaining requirements

1. Run PostgreSQL integration suites using a disposable, isolated test database.
2. Configure and test production OTP credentials without exposing them.
3. Verify Render/Neon target and migration plan before any deployment; this review did not access either service.
4. Keep real-money payments and payouts blocked until an authorized provider, independent verification, payout confirmation, and audited end-to-end tests exist.

## Financial gate implementation notes

- `FINANCIAL_OPERATIONS_ENABLED` defaults to `false` in every environment and is explicitly set to `false` in `render.yaml` and the production example environment file.
- In this build, production startup rejects `FINANCIAL_OPERATIONS_ENABLED=true`; the currently mandated `PAYMENT_PROVIDER=disabled` means no safe production financial configuration exists yet. The flag can be explicitly enabled only in non-production for an approved isolated test setup.
- Disabled financial endpoints return HTTP 503 with `{ error: { code: "FINANCIAL_OPERATIONS_DISABLED", message: "Financial operations are disabled on this server. No financial change was made." } }`.
- Public P2P list routes are gated too because they currently perform expiry and reservation maintenance during GET requests. Payment claim queue and evidence access are unavailable while disabled. Profile, config, notification, support and other non-financial APIs remain outside the gate.
- Expiry/reservation workers, GET-triggered cleanup, Cashfree status reconciliation, welcome-bonus helper, and direct financial service helpers do not mutate financial state while disabled.
- No migration, database connection, payment verification, wallet credit, deployment, commit or push was performed.

No commit, push, deployment, production database access, or migration was performed as part of this review.

## Staging preflight verification — 2026-11-03

**Verdict: SOURCE READY, STAGING DEPLOYMENT BLOCKED pending isolated environment setup and live smoke checks.** This repository has not been deployed to a staging service in this review.

- `FINANCIAL_OPERATIONS_ENABLED` defaults to false; a production-config process rejects `true`. Render explicitly sets it to false, and `PAYMENT_PROVIDER` is set to `disabled`.
- The gate regression iterates every entry in `FINANCIAL_OPERATION_ROUTE_MANIFEST` and expects JSON HTTP 503 with `FINANCIAL_OPERATIONS_DISABLED`; production startup rejection and route/service bypass tests pass. Profile/config/notification/support routes are asserted outside the gate.
- OTP config is validated at startup: production requires `OTP_PROVIDER=renflair-v1` and a non-empty `RENFLAIR_API_KEY`. This verifies presence/config shape only; it does not contact Renflair. `/ready` checks PostgreSQL only, not OTP availability or delivery.
- Health (`/health`), database readiness behavior (`/ready`), Swagger HTML/assets (`/api/v1/docs/`) and OpenAPI JSON (`/api/v1/openapi.json`) have local automated tests. The `/ready` integration test accepts its expected unconfigured-database response locally. No live staging endpoint was contacted.
- Render specifies `npm ci --include=dev && npm run build`, `npm start`, `/ready`, and `preDeployCommand: npm run db:deploy`. The latter is an automatic migration action at deployment; no migration command was run during this preflight. Staging deployment must be a separate service pointed only at a disposable staging database after pending migrations are reviewed.
- Environment parsing enforces production database/TLS, secrets, OTP provider, disabled payments and financial gate. UPI recipient has no fallback and remains unset in the staging runbook. Reward switches remain off.
- Modified/untracked-file review found no high-confidence private-key/token patterns or populated secret environment assignments. Environment templates contain placeholders only; test fixtures contain dummy values. `.gitignore` ignores local environment files, Neon linkage, keys, signing files and backups. This is not a historical Git secret scan. No changes are staged.
- `server/tsconfig.build.json` remains present with its existing user change; it was not changed by this staging-preflight update.

| Verification | Result |
|---|---|
| `npm test` with `DATABASE_URL` blank | PASS — 15 files passed, 3 skipped; 137 passed, 52 skipped (189 total). Skipped suites require a database. |
| `npm run build` | PASS — Prisma Client generated locally; strict production TypeScript build succeeded. No migration was run. |
| `git diff --check` | PASS — no whitespace errors; Git emitted line-ending conversion warnings only. |
| Live Render/Neon/OTP/Android staging verification | NOT TESTED — no service credentials or staging deployment was used. |

### Staging blockers before deployment

1. Create a separate staging Render service and disposable staging Neon database/branch; verify both configured database URLs target that staging database before the Render pre-deploy migration runs.
2. Provide valid staging-only Renflair credentials and verify OTP delivery after staging starts. Do not interpret `/ready` as an OTP health check.
3. Review the exact pending staging migration SQL and migration status; deployment will run `npm run db:deploy`. This checklist update does not authorize that operation.
4. Run live staging smoke checks for health, readiness, Swagger/OpenAPI, financial 503 behavior, allowed non-financial flows, and app connectivity. Keep actual payment and payout disabled.
