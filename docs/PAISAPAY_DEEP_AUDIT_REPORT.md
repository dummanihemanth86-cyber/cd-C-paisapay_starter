# PaisaPay Deep Audit — Staging Scope

Audit date: 2026-11-08  
Repository branch: `codex/admin-wallet-credit-staging`  
Local HEAD: `deeb950d45bd6bb08b7246f8116433f368255be6`  
Deployment boundary: staging only. No commit, push, Render deploy, database access, SMS send, wallet credit, or production request was performed.

## Summary

The current working tree contains substantial pre-existing changes. They were preserved and not staged. This pass made a small set of local changes: fail-closed Renflair response diagnostics, an explicit staging API profile for customer Android releases, production/staging host validation tests, and a distinct Admin logo/splash identity. The current deployment still runs commit `deeb950`; none of the local uncommitted changes are live.

The repository is not ready for a claim of complete end-to-end release verification. Backend unit/API contract tests, both Admin test suites, customer app tests, web build, backend typecheck/build, Prisma schema validation, and Android JavaScript bundle exports passed. This continuation freshly confirmed staging health/readiness/version. Real Renflair handset delivery, signed APK generation, a physical device, authenticated staging Admin APIs, and database-backed integration tests remain unverified.

## Repository and deployment

- Local branch and HEAD were inspected. Unrelated modified and untracked files remain in place.
- Staging API version metadata previously returned build ID `deeb950d45bd6bb08b7246f8116433f368255be6` and environment `staging` in a read-only check recorded earlier in this session.
- Fresh read-only staging checks returned `GET /health` **200** (`{"ok":true,"service":"paisapay-api"}`), `GET /ready` **200** with database `ready`, and `GET /api/v1/admin/app-version` **200** with environment `staging` and build ID `deeb950d45bd6bb08b7246f8116433f368255be6`. This confirms the service response and deployed build ID; the Render dashboard itself was not inspected.
- Production was not contacted. `render.yaml` was not modified. No Render configuration was changed and no deployment was triggered.
- Prisma schema has 28 migration directories. Schema validation passed. Migration status/application was not queried because there was no explicitly supplied isolated database connection; no migration command was run.
- An existing untracked owner bootstrap guide describes a production Neon recovery procedure. It was not executed or changed. Treat that document as a separately reviewed, production-only operator procedure; it is outside this staging audit.

## Backend and authentication

- Backend TypeScript typecheck and production build passed. Prisma Client generation completed.
- Full backend suite: **249 passed, 56 skipped, 0 failed** across 32 files. Tests ran with `NODE_ENV=test`, demo OTP, payment and financial flags disabled, no database URL, and a placeholder-only SMS gateway configuration. The 56 skips are database-dependent integration tests; no production or staging database was accessed.
- Focused Renflair and password-reset challenge tests: **10 passed**.
- Existing reset flow checks active Admin status, phone, challenge purpose, provider acceptance state, expiry, single-use, maximum attempts, OTP hash, password hashing, session revocation, and audit behavior. Invalid OTP does not bypass verification.
- Current Renflair V1 adapter uses the configured HTTPS V1 endpoint, sends `API`, `PHONE`, and `OTP` query parameters, and defaults to a 5-second timeout. New local diagnostics log request ID, HTTP status, coarse provider status/error categories, and timeout only; OTP, phone, API key, and full request URL are excluded.
- The published Renflair V1 example does not define a response schema or delivery receipt. The adapter now fails closed on malformed, rejected, or unrecognized responses. Recognized provider acceptance remains only a provider response, not proof of delivery to a handset.
- No real OTP SMS was requested. Root cause of a specific missing staging SMS cannot be attributed to balance, template, sender ID, route, credentials, provider rejection, or delivery without the staging provider’s sanitized response/console and a controlled test phone.
- No authorized staging Admin session or credentials were available in the current environment. Admin login, `/api/v1/admin/me`, password reset challenge state, and protected diagnostics could not be verified. The current process had no `RENFLAIR_API_KEY` or `OTP_PROVIDER` environment variable set; Render staging secrets/configuration could not be inspected from an available Render connector/session. No OTP request was sent because that would trigger an SMS and no explicit send authorization was given.

## ADMIN OTP SMS ROOT CAUSE

### Confirmed code paths and root causes

- Admin native UI uses the staging API default `https://paisapay-api-staging.onrender.com`, sends `POST /api/v1/admin/auth/forgot-password/request-otp` with `{ phoneE164: "+91" + 10 digits }`, and sends `{ phoneE164, challengeId, code, newPassword }` to `POST /api/v1/admin/auth/password/reset`. The API client parses JSON errors and displays them. The reset-request screen displays the server's generic “If an active Admin account exists…” message; it does not claim delivery based on 202.
- **A 202 can intentionally mean no SMS was attempted.** The route checks exact `phoneE164`, `status === ACTIVE`, and the existence of an `adminRole`. If any check fails, it returns HTTP 202 with a random decoy `challengeId`; it does not persist that challenge or call Renflair. A subsequent reset then returns 401 because the challenge does not exist. This is the strongest code-level explanation for “202, no SMS, then reset 401,” but the staging DB was not available to verify whether this account took that branch.
- If the account qualifies, `createOtpChallenge` persists an `ADMIN_PASSWORD_RESET` row before sending, with a six-digit cryptographically generated code hash, five-minute expiry and 60-second resend delay. It invokes the provider, then persists `ACCEPTED` or a failure/unknown state. Password reset locks the challenge row, validates phone/purpose/expiry/consumption/attempts/provider state/hash, rechecks the active Admin, hashes the new password, consumes open reset challenges, revokes the Admin's sessions, and audits the reset.
- **A staging IP-rate-limit configuration bug is confirmed and fixed locally.** Render traffic includes proxy forwarding headers, while this Express app leaves `trust proxy` at its default. `express-rate-limit` therefore keys the IP limit on the proxy address and can apply the 10-per-15-minute reset-request limit globally to unrelated visitors. The phone limit remains separately enforced at 5 requests/hour. The change uses Cloudflare's edge-overwritten `CF-Connecting-IP` only when the service is explicitly identified as `paisapay-api-staging`; production and local behavior do not trust that header. It retains IPv6 subnet normalization and does not disable rate limits. This explains possible 429s; it does not prove why a particular accepted-looking request delivered no SMS. Render describes the proxy path and `X-Forwarded-For` behavior, `express-rate-limit` documents the global-limit failure mode when proxy trust is unset, and Cloudflare documents that `CF-Connecting-IP` is overwritten at its edge ([Render web services](https://render.com/docs/web-services), [express-rate-limit proxy troubleshooting](https://github.com/express-rate-limit/express-rate-limit/wiki/Troubleshooting-Proxy-Issues), [Cloudflare headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)).
- Previously a rate-limit 429 was not logged with a specific limit label, and the Admin route did not log whether a generic 202 came from a persisted challenge/provider attempt or the decoy branch. Local code now emits request-correlated, non-PII eligibility/persistence/provider-attempt and rate-limit diagnostics. Renflair logs include HTTP status, response classification, error category, duration, environment label, safe endpoint path and delivery-receipt capability; they do not log phone, OTP, API key, request URL query, raw provider message, or unsupported provider reference IDs.

### Renflair contract and actual delivery status

- Official Renflair V1 example uses HTTPS `GET https://sms.renflair.in/V1.php` with query parameters `API`, `PHONE`, and `OTP`; the phone example is the 10-digit national number. Local code uses `RENFLAIR_V1_API_URL` (defaulting to that endpoint), requires `RENFLAIR_API_KEY`, accepts only `+91` plus ten digits, and sends the ten digits after `+91`. There is no `RENFLAIR_API_BASE_URL` variable in this implementation. The published V1 example JSON-decodes the response but does not specify a response schema, error codes, provider request ID, or delivery-receipt API ([Renflair SMS Gateway documentation](https://renflair.in/sms-gateway.php)).
- The adapter fails closed on HTTP failures, malformed JSON, unrecognized shapes/status, explicit failures and timeouts. A recognized provider acceptance is recorded only as acceptance, not delivery. This is safer than treating arbitrary HTTP 200 as a send, but actual compatibility with the account's response shape cannot be verified without its sanitized response. Do not loosen acceptance parsing based on guesses.
- A prior staging GET check returned health 200, ready 200/database ready, and app-version 200 for build `deeb950d45bd6bb08b7246f8116433f368255be6`; that remains the last observed deployed build and predates these local uncommitted fixes. A fresh retry in this pass failed DNS resolution (`No such host is known`) for all three staging endpoints. No Render environment values or deploy logs were available for inspection. The request returning 202 and its Renflair response were not observed in this session.

### Verification classifications

| Status | Result |
| --- | --- |
| CODE FIXED | **Local only** — staging-specific IP key correction, decoy-vs-real-path diagnostics, correlated/sanitized provider logs, provider response classification, placeholder-key configuration rejection, and database-state persistence error handling are implemented; not deployed |
| PROVIDER REQUEST VERIFIED | **No** — mock adapter tests pass; no real staging request sent |
| PROVIDER ACCEPTED | **No** — no actual staging response/log available |
| SMS DELIVERY CONFIRMED | **No** — no authorized SMS sent and no delivery receipt exists in documented V1 API |
| OTP VERIFIED | **No** — no real OTP received or submitted |
| PASSWORD RESET VERIFIED | **No** — no staging password changed |

### Staging requirements and next operator action

- Staging must have `OTP_PROVIDER=renflair-v1`, non-placeholder `RENFLAIR_API_KEY`, stable `SESSION_HASH_SECRET`, and the existing isolated staging `DATABASE_URL`. The adapter URL override is `RENFLAIR_V1_API_URL` if needed; it is not `RENFLAIR_API_BASE_URL`. Check presence/rotation in Render without revealing secret values. A changed environment requires a staging restart/redeploy.
- Before one real send, confirm the registered staging user is `ACTIVE` and has an Admin role, confirm the account phone is the same E.164 number used by the app, and confirm both rate limits have cooled down (10 per shared staging client-IP bucket per 15 minutes before this fix; 5 per phone per hour). Do not retry repeatedly.
- After this local fix is reviewed and approved for staging, deploy it only to `paisapay-api-staging`, then filter logs using the response `requestId`/challenge correlation. `eligibleActiveAdmin=false` means intentional decoy/no send. For an eligible account, logs distinguish challenge persisted, provider attempted, HTTP/provider classification and persistence status. Use the Renflair account console/support to check the actual response/error and delivery report; the API does not expose an independent delivery receipt.
- To prove end-to-end reset, an operator must explicitly authorize one OTP to the controlled registered staging Admin phone, observe actual handset delivery, submit that OTP once, then verify login with the new password and old-session revocation. This was not performed.

## Financial services and rewards

- Financial flags default false in backend configuration. None were changed by this pass. No wallet credit, deposit, withdrawal, payout, or payment was submitted.
- Wallet code uses integer paise and unique idempotency keys on ledger models; the app/API test suites include disabled-gate, role policy, replay, and safe retry coverage. No live balance or ledger result was tested.
- Welcome bonus is disabled by default and restricted to development/test. The existing test rule is ₹99 (9,900 paise) from `DEVELOPMENT_TEST_FUND`, with a unique `WELCOME_BONUS:<userId>` idempotency key. This is not an approved production welcome reward.
- Referral code uses 40 bps direct and 10 bps indirect rates; milestone eligibility remains pending review. These values were found in code, not independently confirmed as a current approved business policy. Do not treat them as authorization to fund or pay rewards.
- The ₹99 welcome bonus is explicitly a development/test-only rule. `grantWelcomeBonus` uses 9,900 paise from `DEVELOPMENT_TEST_FUND`, requires the development/test gate and available seeded test-fund ledger balance, locks the fund account, atomically flips the one-time eligibility flag, and writes a double-entry transaction (test-fund debit and user available-wallet credit) with unique `WELCOME_BONUS:<userId>` idempotency key. The unique key plus locked eligibility protects replay/concurrent duplication. Existing DB-backed tests assert one transaction and a 9,900-paise user balance after a repeated/concurrent verification; those tests were skipped in the no-DB run, so this is code/test inspection rather than a fresh database execution. The implementation’s paired equal-value entries are code-verified; a live ledger reconciliation was not run.
- Before any non-test welcome reward can be enabled, an authorized product/finance owner must approve: the reward amount and currency; eligibility (including KYC/account-state and referral rules); when it becomes spendable; the legitimate funding source and accounting treatment; expiry/reversal/fraud rules; and customer terms/communications. The ₹99 development value is not that approval. The referral rates and milestone thresholds/payout policy also require explicit business/finance approval before becoming funded rewards.
- Payment provider is disabled in current code paths until an authorized provider is implemented and verified. No payment/deposit success is simulated.
- Production and staging financial flag values were not read from Render in this pass. Do not infer that any live financial feature is enabled.

## Customer app

- Customer branding now has separate original SVG/PNG emblem and horizontal splash artwork, distinct from the Admin shield/control identity. The new customer artwork is integrated in the Android launcher/adaptive icon, splash, sign-in screen, top navigation, and home dashboard. Earlier user-provided images remain untouched.
- Customer API configuration now has an explicit `staging` EAS profile pinned to `https://paisapay-api-staging.onrender.com`; non-development builds require the explicit staging marker and exact staging origin. Production EAS profiles remain pinned to the production origin and are unchanged in destination.
- Added automated API-origin tests covering staging, production, empty/unknown hosts, paths, unknown environments, and local development URLs.
- The Security screen’s password reset action now signs out locally and opens the existing SMS OTP reset flow. The misleading transaction PIN and session manager buttons were removed; “sign out this device” invokes the actual logout handler.
- Customer API retry, financial fallback, session persistence, API-origin, password-reset UI, and branding wiring tests: **21 passed**. Bird assistant tests: **7 passed**.
- Customer Android JavaScript bundle exported successfully with staging environment variables after the Security screen and branding changes.
- The customer bytecode contains the production origin as a host allowlist constant as well as the staging origin; the explicit staging build marker selects the staging URL at runtime. This is a validation string, not a second configured request destination. The Admin bytecode scan contained staging only.
- A native Gradle APK was not built. The wrapper’s configured Gradle distribution was unavailable because this environment could not resolve `services.gradle.org`; the default shared cache was also write-protected. No ADB/device test was attempted.
- The app is JavaScript, with no project TypeScript configuration. Expo export was used as a bundle check, not represented as a device build.

## Admin app and browser dashboard

- Admin native test suite: **37 passed**. Admin browser dashboard tests: **27 passed**. Vite production build passed.
- Admin Expo public config resolves to package `com.paisapay.admin`, version `1.0.3`, and the new Admin icon/splash assets.
- The Admin app previously reused customer artwork for its launcher/splash. New independent `paisapay-admin-emblem` and `paisapay-admin-brand` SVG/PNG assets use a dark navy security/control motif and are wired into the Expo config. Customer art was not overwritten.
- The browser Admin header now uses the Admin emblem and labels the app “PaisaPay Admin”; its separate PNG is served from the Admin public assets directory.
- The Vite Admin dashboard was built with the staging API origin and scanned: staging host present, production host and server credential names absent.
- Android release manifests previously requested overlay, write-storage, and (customer) audio permissions that app code does not use. These are now removed from release manifests and blocked in Expo config; customer image-library read access remains for its receipt picker. The React Native debug manifests still contain their development overlay permission.
- Expo documents `android.blockedPermissions` as the supported way to remove merged package permissions; both app configs and current release manifests were checked [Expo permissions guide](https://docs.expo.dev/guides/permissions/).
- Admin Android JavaScript bundle exported successfully with the staging API configured. The exported Admin bundle contains the staging host and no production API host or server credential names in the byte scan.
- Current UI intentionally disables payment/payout/wallet controls unless server capability and role checks permit them. The app’s presence of a screen is not evidence that a backend financial action is authorized or operational.
- No authenticated staging Admin token/session was present for read-only `/api/v1/admin/me`, readiness, user, ledger, or reports checks. Those routes were not called.

## Build, checks, and security

| Check | Result |
| --- | --- |
| Backend `npm test` | PASS — 259 passed, 56 skipped (29 files passed, 4 files skipped); database URLs explicitly empty and financial flags false |
| Focused Admin rate-limit, Renflair adapter, TLS/configuration, and financial gate tests | PASS — 44 passed |
| Backend typecheck | PASS |
| Backend build | PASS |
| Prisma schema validation | PASS |
| Admin native test suite | PASS — 37 passed |
| Admin browser tests | PASS — 27 passed |
| Admin Vite build | PASS |
| Admin staging web bundle host/credential scan | PASS — staging host present; production host and credential names absent |
| Customer/Admin Expo config and release manifest permission checks | PASS — only needed customer media-read permission remains; Admin media access removed |
| Customer integration/API-origin tests | PASS — 21 passed |
| Customer bird tests | PASS — 7 passed |
| Offline npm audit (server runtime, customer app, Admin app, Admin web) | PASS — 0 reported vulnerabilities in each available lockfile audit |
| Customer staging Android JS export | PASS |
| Admin staging Android JS export | PASS |
| Customer release APK | BLOCKED — Gradle 8.14.3 downloaded, but build dependency resolution failed because Java could not resolve `plugins.gradle.org` |
| Admin staging APK | BLOCKED — separate build reached the same `plugins.gradle.org` dependency DNS failure |
| APK files produced by this continuation | FAIL — none; pre-existing customer/Admin release APKs are dated Nov 3 and Nov 7 respectively and are not evidence of this build |
| Last known online staging GET checks | PASS — prior check returned health 200, ready 200/database ready, app-version 200/build `deeb950d45bd6bb08b7246f8116433f368255be6` |
| Fresh online staging GET retry | BLOCKED — DNS resolution failed for `paisapay-api-staging.onrender.com`; no current response confirmed |
| Authenticated Admin/password-reset checks | BLOCKED — no authorized session/account credentials; OTP send requires explicit authorization |
| Renflair staging configuration/delivery | NOT VERIFIED — Render configuration and sanitized runtime logs unavailable; no OTP sent or handset delivery tested |
| `git diff --check` | One existing warning: extra blank line at EOF in `STAGING_SETUP_GUIDE.md`; other reviewed new/edited code had no whitespace error |

No lint script is configured for the server, customer app, Admin app, or browser Admin package. A separate static security scanner was not available in the installed toolchain; source and bundle scans were performed as described above.

No credential values were added to the files changed in this pass. Secret-name scans found only example placeholders, variable names, and a deployment workflow security scan; no API key/password/database URL value was included in the generated bundles. The production owner bootstrap guide mentioned above is pre-existing untracked content and was not copied into this report.

## Files changed by this pass

- `server/src/integrations/sms/renflairV1.ts`
- `server/src/config/env.ts`
- `server/src/modules/admin/routes.ts`
- `server/src/modules/admin/passwordResetRateLimit.ts`
- `server/src/modules/auth/routes.ts`
- `server/src/tests/adminPasswordResetRateLimit.test.ts`
- `server/src/tests/databaseTlsConfiguration.test.ts`
- `server/src/tests/financialOperationsGate.test.ts`
- `server/src/tests/renflairV1.test.ts`
- `mobile/src/apiEnvironment.cjs`
- `mobile/src/apiEnvironment.test.cjs`
- `mobile/src/api.js`
- `mobile/App.js`
- `mobile/app.json`
- `mobile/eas.json`
- `mobile/package.json`
- `mobile/src/securityPasswordResetUi.test.cjs`
- `mobile/src/customerBranding.test.cjs`
- `mobile/assets/paisapay-customer-emblem.svg`
- `mobile/assets/paisapay-customer-emblem.png`
- `mobile/assets/paisapay-customer-brand.svg`
- `mobile/assets/paisapay-customer-brand.png`
- `mobile/src/UltraHome.js`
- `apps/admin-app/assets/paisapay-admin-emblem.svg`
- `apps/admin-app/assets/paisapay-admin-emblem.png`
- `apps/admin-app/assets/paisapay-admin-brand.svg`
- `apps/admin-app/assets/paisapay-admin-brand.png`
- `apps/admin-app/app.json`
- `apps/admin-app/App.js`
- `apps/admin-app/tests/branding.test.cjs`
- `admin/src/main.jsx`
- `admin/public/paisapay-admin-emblem.png`
- `docs/PAISAPAY_DEEP_AUDIT_REPORT.md`

The Android `app/src/main/AndroidManifest.xml` files under both app folders are ignored by the repository's existing `android/` ignore rule. Their local release manifests were inspected/adjusted for this audit, but the durable permission configuration is in each tracked `app.json` via `android.blockedPermissions`; Expo applies it when regenerating native projects. The debug manifests retain the development overlay permission.

## Continuation: staging, rewards, APK, and working-tree review

- Network access was retried. A prior staging GET check had succeeded, but the latest retry could not resolve the staging hostname; no production hostname or service was requested.
- Both APK tasks were retried with `EXPO_PUBLIC_API_URL=https://paisapay-api-staging.onrender.com` and a project-local Gradle cache. The pinned Gradle 8.14.3 distribution downloaded successfully. Customer `assembleRelease` then failed resolving Kotlin/Gson/Guava and related plugin classpath artifacts because the Java process could not resolve `plugins.gradle.org`; the Admin staging `assembleRelease` failed at the same dependency resolution stage. HTTP reachability via curl to the plugin portal/Maven Central does not establish that Gradle’s Java resolver can reach it. No APK was produced by these runs and no device test occurred. No TLS checks or build security guards were disabled.
- Reward source review found the tests for duplicate/replay/concurrent welcome awards and the balanced 9,900-paise posting described above. The integration tests require a configured test PostgreSQL database and were skipped; there was no database connection or data mutation.
- Working-tree review: the requested **57 original status entries** were categorized into the groups below. During the two APK attempts, two additional untracked project-local Gradle cache directories were created; the previous count was **24 modified tracked paths and 35 untracked paths (59 total entries)**. The current status is **66 entries** after adding this OTP investigation's tracked edits and two new focused Admin reset-rate-limit files; no original file was removed or overwritten. Everything remains unstaged; nothing was committed, pushed, or deployed. Paths fall into these groups:
  - Customer app/API/UI/release configuration: `mobile/App.js`, `mobile/app.json`, `mobile/eas.json`, `mobile/package.json`, `mobile/src/DepositHistory.js`, `mobile/src/DepositScreen.js`, `mobile/src/ToastNotice.js`, `mobile/src/UltraHome.js`, `mobile/src/WithdrawalScreen.js`, `mobile/src/api.js`, `mobile/src/apiEnvironment.cjs`, `mobile/src/apiEnvironment.test.cjs`, `mobile/src/apiRetry.cjs`, `mobile/src/apiRetry.test.cjs`, `mobile/src/financialApiFallback.cjs`, `mobile/src/financialApiFallback.test.cjs`, `mobile/src/sessionPersistence.cjs`, `mobile/src/sessionPersistence.test.cjs`, `mobile/src/securityPasswordResetUi.test.cjs`, `mobile/src/customerBranding.test.cjs`, `mobile/RELEASE_NOTES_1.0.0.md`, `mobile/assets/paisapay-app-icon.png`, and the four `mobile/assets/paisapay-customer-*` SVG/PNG files.
  - Admin UI/branding: `admin/src/main.jsx`, `admin/public/paisapay-admin-emblem.png`, `apps/admin-app/App.js`, `apps/admin-app/app.json`, `apps/admin-app/tests/branding.test.cjs`, and four `apps/admin-app/assets/paisapay-admin-*` SVG/PNG files.
  - Backend OTP/financial/reward/test/build changes: `server/src/integrations/sms/renflairV1.ts`, `server/src/modules/payments/depositExpiry.ts`, `server/src/modules/payments/depositReward.ts`, `server/src/modules/users/referralCommission.ts`, `server/src/modules/users/welcomeBonus.ts`, `server/src/tests/demoOtp.test.ts`, `server/src/tests/p2pMatching.integration.test.ts`, `server/src/tests/renflairV1.test.ts`, `server/src/tests/upiManualReview.integration.test.ts`, and `server/tsconfig.build.json`.
  - Staging/deployment/audit documents: `STAGING_SETUP_GUIDE.md`, `SAFE_DEPLOYMENT_CHECKLIST.md`, `audit-reports/API_ENDPOINT_INVENTORY.md`, `audit-reports/API_OPENAPI_AUDIT.md`, `audit-reports/API_SECURITY_AUDIT.md`, `audit-reports/API_TEST_REPORT.md`, `audit-reports/FINAL_RELEASE_READINESS_REPORT.md`, `audit-reports/FRONTEND_BACKEND_INTEGRATION_AUDIT.md`, and this report.
  - Separate Admin bootstrap material: `docs/OWNER_ADMIN_BOOTSTRAP.md`, `server/scripts/ownerAdminBootstrap.ts`, and `server/src/tests/adminOwnerBootstrap.test.ts`. The guide was already identified as a production-owner recovery procedure; its script was not executed and these files were left unchanged by this continuation. They require a separate authorization/safety review before any use.
  - Two newly generated build-cache entries: `mobile/.gradle-audit-cache/` and `apps/admin-app/.gradle-audit-cache/`.
- The code-path grouping identifies scope, not authorship; no baseline snapshot existed to attribute every pre-existing working-tree change to a particular contributor. `git diff --check` still reports only the existing EOF blank line in `STAGING_SETUP_GUIDE.md`.
- A high-confidence literal-secret pattern scan over the 57 original text changes found no private-key block, common live-key token, or literal assignment to the listed database/session/OTP secret variables. The scan deliberately excluded generated Gradle cache binaries. This is a targeted scan, not a guarantee against every secret format.

No existing user modifications were reverted. No files were staged, committed, or pushed.

## Remaining blockers and exact next steps

1. Re-run staging `GET /health`, `/ready`, and `/api/v1/admin/app-version` from a network that can resolve the Render host; confirm the deployed build ID before any release claim.
2. Confirm Renflair’s authorized staging API key, SMS route/template approval, and provider account balance directly in Render/provider console. Then request OTP only to a controlled staging test phone and confirm receipt; never use an OTP from logs.
3. Provide an authenticated staging Admin session for read-only checks. Do not send credentials or tokens in chat.
4. Set up a safe database-backed test only with the isolated staging database and explicit operator approval; then validate migrations, persisted reset challenge, and relevant admin read APIs.
5. Restore Gradle distribution/network access (or use an existing local Gradle installation/cache) and build each APK. Verify manifest/package/signing. Real-device testing requires a connected, authorized device.
6. Review business approval for welcome/referral amounts before enabling any reward program. Keep all production financial gates off until policy, funded sources, reconciliation, independent authorization, and provider controls are independently verified.
7. Review the separately existing production owner-bootstrap document before any operator acts on it. This audit did not execute it.

No deployment is recommended from this audit until staging URL checks and a real controlled OTP delivery are confirmed. The local changes remain uncommitted and can be reviewed before a later staging-only deployment.

## Continuation: Android Gradle network and APK verification (2026-11-09)

This section supersedes the earlier Android build note above.

- The saved Gradle daemon log records the concrete failure as “No such host is known (plugins.gradle.org)” while Gradle attempted normal HTTPS HEAD requests for plugin classpath artifacts, including Kotlin stdlib 2.1.20, Gson 2.8.9, Guava 31.0.1-jre, JavaPoet 1.13.0, and Kotlin serialization JSON. The failure was DNS resolution from the Gradle process, not a repository configuration error.
- On retry, Windows DNS resolution and HTTPS HEAD to the official Gradle Plugin Portal succeeded. OpenJDK 21.0.8 also resolved plugins.gradle.org and repo.maven.apache.org; Java HTTPS HEAD returned 303 from the plugin portal and 200 from Maven Central. No HTTP(S) proxy variables, Gradle proxy overrides, Windows Internet Settings proxy, TLS bypass, or third-party mirror were used. The earlier network failure is not currently reproducible; a permanent network fix is not established.
- Customer staging debug build completed at mobile/android/app/build/outputs/apk/debug/app-debug.apk: modified 2026-11-08 23:56:14 +05:30; 177,142,504 bytes; SHA-256 86B05DCFE05B406623EA47BEC09E69BD3D18201AE864BCCC04FF57BF77F33347; package com.paisapay.app; version 1.0.0 / code 1; APK signature verification passed (debug signer SHA-256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c). The API resolver returned exactly https://paisapay-api-staging.onrender.com for the explicit staging profile, and its four tests passed. The raw JS bundle contains the production host string because the source retains a production-origin constant for environment validation; the selected staging profile resolves only to the staging origin. A Customer release APK was not built because release-signing settings are absent; no key was created or guard bypassed.
- Admin signed release build completed using the existing private signing configuration at apps/admin-app/android/app/build/outputs/apk/release/app-release.apk: modified 2026-11-09 00:06:13 +05:30; 90,370,545 bytes; SHA-256 94540D67E6A21AA3EDD9F16BA1F58770C93F1C171B30180DC86B9B75E1D27658; package com.paisapay.admin; version 1.0.3 / code 4; bundle contains the staging hostname and not the production hostname; APK signature verification passed (signer certificate SHA-256 045714bc744847c601334d50b5898453cd35c7b29ff529252b84c9e96d414ca5). Signing material was not displayed or regenerated.
- An Admin debug APK also exists at apps/admin-app/android/app/build/outputs/apk/debug/app-debug.apk (2026-11-08 23:40:45 +05:30; 156,597,066 bytes; package com.paisapay.admin; version 1.0.3 / code 4; staging hostname present, production hostname absent; debug signer SHA-256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c). The release APK uses a different signer from that debug APK, so it cannot update an installation signed with the debug certificate in place.
- Temporary build-only edits to generated, ignored Android app/build.gradle files were restored to their inspected original contents after debug builds. No tracked Android Gradle configuration was changed for these builds.
- No ADB command, installation, launch, or physical-device test was performed. No production endpoint/configuration, financial setting, database, or balance was accessed or changed. Nothing was staged, committed, pushed, or deployed.
