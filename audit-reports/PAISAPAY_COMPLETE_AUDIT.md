# PaisaPay Complete Project Audit

**Audit date:** 2026-11-10 (Asia/Kolkata)  
**Workspace:** `C:\paisapay_starter`  
**Branch / HEAD:** `codex/admin-wallet-credit-staging` / `cecfb8c`  
**Production API:** `https://paisapay-api.onrender.com`  
**Staging API:** `https://paisapay-api-staging.onrender.com`

## Executive result

**Not ready for real-money or end-to-end mobile sign-off.** The API and client code build, covered local tests pass, and the deployed staging API reports healthy with a ready database. Production and staging both report payment features disabled and no UPI recipient. No wallet or account data was read or changed, no OTP/payment was requested, no migration was applied, and no service was deployed.

The Admin password-reset request is intentionally anti-enumerating: it sends no SMS unless the phone belongs to an eligible active Admin. The owner previously confirmed staging had zero eligible active Admins. That is the confirmed cause of *Admin Forgot Password* OTP suppression in staging. Current Render logs returned no matching Admin or customer OTP endpoint records in the queried window, so they provide no Renflair response to diagnose. Customer registration/login SMS and handset delivery remain unverified.

Renflair’s official V1 page specifies an HTTPS `GET` to `/V1.php` with uppercase `API`, `PHONE` and `OTP` query parameters and shows JSON decoding, but does not define a response schema or a delivery receipt. The current adapter uses that request shape and only treats recognized explicit provider success markers as request acceptance. A successful HTTP response or provider acceptance is **not SMS sent or delivered**. See [Renflair SMS Gateway documentation](https://renflair.in/sms-gateway.php).

## Preservation and repository state

- Local modifications and untracked files were preserved. No reset, clean, commit, push, merge, or branch switch was done.
- GitHub branch `codex/admin-wallet-credit-staging` points to `cecfb8c07a1acf325238e6088112af2204be3879`, matching local HEAD. GitHub `main` points to `10da4d35a470e78f715b81dfee378bb40dfbfe25`.
- The working tree already contained 28 modified tracked files and numerous untracked files at audit start. The main tracked diff is 879 insertions / 1,782 deletions; it includes User App, Admin, API availability, OpenAPI, configuration and test changes. New report files and device captures are also untracked. Review `git status --short` before staging anything.
- The existing untracked `paisapay-device-log.txt` was not opened. Environment files and secret values were not printed.
- No schema or migration files were changed in the working tree. The repository contains 28 migration directories. Prisma schema validation and client generation passed; database migration status was not queried and no database migration command was run.

## Modules inspected and status

| Area | Inspection / verification | Result |
|---|---|---|
| User registration, OTP login, password reset, session refresh/logout | Auth routes, OTP challenge handling, request limits, token/session handling, client API and reset UI tests | Source uses hashed OTPs, expiry, attempt limits, provider gating and session revocation. Automated tests pass; real SMS and PostgreSQL-backed behavior not verified. |
| Admin login, OTP and password reset | Admin auth route/service, eligible-account lookup, challenge persistence/verification, UI and API contract tests | Requests for a phone with no active Admin are suppressed while keeping the response generic. On reset, challenge is consumed and active sessions revoked. No real OTP request was sent. |
| Home, profile/settings, wallet display/history, support, notifications, referrals/rewards/VIP | User App screen/API mappings and existing route/security audit artifacts | Code and selected contracts reviewed; no authenticated user session was used, so real account data, persistence, refresh and full screen interactions were not exercised. |
| Add Money, Standard/Quick Deposit, withdrawals, P2P matching | Availability configuration, financial gate middleware, payment and P2P route declarations, mobile capability fallbacks and regression tests | Fail-closed controls remain in place. Production and staging public config show live/sandbox payments off and no deposit recipient. No transaction was created. |
| Admin dashboard, search, user details, ledger, approvals, reconciliation, roles and settings | Admin route inventory, authentication/role middleware, app tests and existing API security/OpenAPI audits | Routes and role checks are present; Admin test suite passes. No Admin login or mutating action was performed. Every role/action combination was not live-tested. |
| Backend/API, Prisma, middleware, errors, OpenAPI | All module/router inventory, configuration, auth/session/financial middleware, migration count, prior API contract/security artifacts | Typecheck/build/schema validation pass. Representative tests pass; database integration tests are skipped without a disposable DB. Existing review notes one shadowed legacy withdrawal router and dynamic JSON fields. |
| SMS and payment integrations | Renflair adapter/config, OTP request paths, provider status persistence, public payment configuration, Renflair official docs | Renflair is request-acceptance only in V1 as documented; handset receipt cannot be confirmed. Payments/payouts are unavailable by configuration. |
| Android User and Admin apps | Installed package metadata, ADB launch attempt, device power/keyguard state and crash-log scan | Packages are installed and activities can be started, but the phone was asleep and keyguard-locked. Captures are black because the display was asleep; visual UI interaction is inconclusive. No clear-data or uninstall was done. |
| Render / GitHub | Render service/deployment metadata, read-only health/config requests, GitHub branch refs | Staging is on current HEAD; production remains on older main commit. A duplicate `paisapay-api1` service exists and its latest update failed. No deploy was triggered. |

## OTP flow trace and diagnosis

### Customer registration/login

`POST /api/v1/auth/register/request-otp` and the login OTP request route validate the phone and rate limits, create an OTP challenge, hash the code at rest, then dispatch via the configured provider. OTP verification locks the challenge row, checks purpose/phone/expiry/attempts/hash, and consumes it when successful. The request response represents a challenge/provider state; it must not be interpreted as handset delivery.

The deployed staging and production Render log queries returned no matching records for OTP endpoints during the queried period (`2026-11-08 00:00Z` to `2026-11-10 10:00Z` for staging; the equivalent later-window query for the production Admin endpoint). No provider HTTP status or Renflair rejection was therefore available to identify. This does not prove prior requests never happened outside that window.

### Admin Forgot Password

`POST /api/v1/admin/auth/forgot-password/request-otp` uses a generic response to prevent account enumeration. The password-reset service verifies that the phone maps to an ACTIVE user with an Admin role before dispatching. Ineligible/no Admin account means **no challenge/provider SMS dispatch**, by design. Staging was previously confirmed to have zero eligible active Admins. No Admin account was created or activated during this audit.

After a qualifying challenge, reset verifies the exact phone, challenge, purpose, expiration and OTP; enforces attempt limits; hashes the new password with the existing password hashing code; consumes outstanding matching reset challenges; revokes the user's sessions; and writes an audit log, transactionally.

### Provider and configuration

- Staging was reported by the owner to have `RENFLAIR_API_KEY` configured. The secret itself was not read or printed. Public API config does not disclose whether it is present; Render CLI available here does not provide a safe names-only environment inspection command.
- Source defaults `RENFLAIR_V1_API_URL` to `https://sms.renflair.in/V1.php`, requires HTTPS and the exact Renflair host/path, and requires `OTP_PROVIDER=renflair-v1` plus a non-placeholder `RENFLAIR_API_KEY` at server startup.
- Request shape matches the vendor page: HTTPS GET, query fields `API`, `PHONE` (10-digit Indian number) and `OTP`. No authentication header is documented. Query fields are URL encoded by `URLSearchParams`.
- The Renflair page shows JSON decoding only. It does not specify success/error fields, status-code semantics, message IDs, sender configuration, delivery receipts, balance lookup, or DLT/template enforcement. Its marketing page claims no DLT/header/content approval hassle, but this does not establish the account's active balance or routes.
- The adapter rejects non-2xx, explicit error markers, invalid JSON/shape and unrecognized success responses; timeout/transport errors become explicit failures. Structured logs include correlation/challenge IDs, environment/provider, endpoint path (not query), HTTP status, response category and duration, and omit API key, OTP and full phone. A generic response still cannot show SMS delivered.
- Do not log or export provider response bodies without a redaction review: a provider may echo submitted query data.

## Production and staging status

Read-only `GET` results on both APIs:

| Endpoint | Production | Staging |
|---|---|---|
| `/health` | HTTP 200, `ok: true` | HTTP 200, `ok: true` |
| `/ready` | HTTP 200, database `ready` | HTTP 200, database `ready` |
| `/api/v1/config` | HTTP 200; live and sandbox payments false; UPI recipient absent; payment providers unavailable | HTTP 200; live and sandbox payments false; UPI recipient absent; payment providers unavailable |

The deployed production service `paisapay-api` is live on commit `10da4d35a470e78f715b81dfee378bb40dfbfe25` (older than staging/local `cecfb8c`). Production `/api/v1/admin/app-version` returned 404, confirming its running route set is older than current local source. The latest staging deployment is live on `cecfb8c07a1acf325238e6088112af2204be3879`. A second main-branch service named `paisapay-api1` is present with an `update_failed` deployment. This duplicate service should be clarified with the owner before changing it.

No staging or production setting was modified. No deployment or migration was triggered.

## Financial integrity and eligibility

- Public production and staging config indicate no live or sandbox payment provider, no UPI receiver, and no automatic verification. A user cannot create a funded UPI deposit through this configuration.
- `FINANCIAL_OPERATIONS_ENABLED` defaults false; financial route middleware fails closed while disabled. Mobile capability logic requires authoritative server availability and the local UI tests check Add Money, Withdraw, Quick Deposit and P2P remain disabled on unavailable/contradictory responses.
- P2P/payment settlement paths require server-side Finance confirmation in the reviewed code; claims/screenshots alone are not verified payment. Existing security audit documents idempotent ledger updates and row locking for covered P2P paths. PostgreSQL integration suites were not run here.
- Welcome/referral rewards have funding/eligibility gates in source; production rewards remain disabled or pending without approved funding. No bonus or wallet credit was issued.
- Withdrawals do not have an approved bank payout adapter; they cannot be claimed as a live payout service. Admin wallet credits remain gated and maker/checker controls must not be bypassed.

## Security findings and limitations

**Verified in source/tests:** bearer tokens are hashed for session lookup; revoked/expired/suspended sessions are rejected; reset revokes sessions; OTPs are hashed, short-lived, attempt/rate limited and not returned/logged; Admin routes require an Admin record and role policy; sensitive payment endpoints fail closed; payment callbacks without an adapter cannot credit funds; HTTP logging redacts Authorization.

**Open issues / incomplete verification:**

1. Real SMS is not confirmed. Admin OTP suppression in staging is explained by the zero-active-Admin prerequisite. Customer OTP failure cannot be assigned a provider-side root cause from the available logs because no matching request/provider records were found.
2. Renflair accepts credentials in the GET URL query by documented contract. The app does not log query strings, but URL-bearing network infrastructure/provider logs may still contain that query; confirm vendor retention/access controls and ask Renflair whether a POST/header option exists before changing the contract.
3. 56 database-backed tests were skipped. No isolated disposable PostgreSQL instance was available; production/staging databases were not touched.
4. Existing static security review notes a legacy support withdrawal handler overlapping the P2P route and flexible persisted JSON fields. These are cleanup/contract-hardening candidates, not changed during this audit.
5. No authenticated real user/Admin session was used, so screen state, actual DB persistence, exact profile/wallet refresh and role-by-role operations remain partly unverified.

## Tests, validation and builds

Commands were run with `DATABASE_URL` and `DIRECT_DATABASE_URL` blank for backend tests/build/typecheck; no DB writes were possible through those processes.

| Check | Result |
|---|---|
| Backend full Vitest suite | **PASS:** 31 test files passed, 4 skipped; 295 passed, 56 skipped, 0 failed (351 total) |
| Admin Node test suite | **PASS:** 43 passed, 0 failed |
| User App integration suite | **PASS:** 25 passed, 0 failed |
| User App bird feature suite | **PASS:** 7 passed, 0 failed |
| Prisma generation | **PASS:** client generated locally |
| Prisma schema validation | **PASS** |
| Backend TypeScript typecheck | **PASS** |
| Backend production TypeScript build | **PASS** |
| User App Android Expo bundle, production environment | **PASS:** bundle contains `https://paisapay-api.onrender.com`; local `192.168.1.4:4000` origin is absent |
| `git diff --check` | **PASS with warning:** existing `STAGING_SETUP_GUIDE.md` has an extra blank line at EOF; line-ending warnings in existing modified files |
| First backend test attempt in restricted process | **ENVIRONMENT FAILURE:** 103 loopback HTTP tests got `EACCES`; rerun with local loopback permission passed. |

Admin **debug APK** build succeeded: `apps/admin-app/android/app/build/outputs/apk/debug/app-debug.apk` (155,083,680 bytes; SHA-256 `A223F1A931E0721428F0F6192DCB6B215B16488FF04B20E4B83526704BAB8A7F`), package `com.paisapay.admin`, version 1.0.3/code 4, Android Debug signer SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, matching the installed Admin signer. It contains no embedded JS bundle, so its API origin cannot be verified from the APK alone; it was not installed. No signed release APK was built. The previous User release APK attempt in this conversation was blocked because release signing settings were missing in the build process: `PAISAPAY_RELEASE_STORE_FILE`, `PAISAPAY_RELEASE_STORE_PASSWORD`, `PAISAPAY_RELEASE_KEY_ALIAS`, and `PAISAPAY_RELEASE_KEY_PASSWORD`. Existing APK artifacts were not treated as products of this audit. The installed packages were inspected only: User `com.paisapay.app` version 1.0.0/code 1; Admin `com.paisapay.admin` version 1.0.3/code 4. User installed signer is `CN=hemanth...` SHA-256 `7cb4a8834ed05cca27f2e1ae94d5270ad927393d2c30527ade0f4792b84c2236`; Admin installed signer is the Android Debug certificate listed above.

## Physical Android device

- ADB serial `c843d7a11022`; Xiaomi `22111317PI`; Android 14 / API 34.
- ADB is connected. Production hostname resolved and ICMP responded from the device.
- Both installed packages could be launched by ADB. No `FATAL EXCEPTION` was seen in the inspected logcat window.
- At capture time Android reported `mWakefulness=Asleep`, keyguard `showing=true`, and the Notification Shade focused. Captured screens were entirely black; they are not evidence of a blank app page. No unlock attempt was made. No screen UI, login, navigation, API calls from the app, session restore, background/foreground, input validation, or failure recovery was tested. The phone needs to be awake and unlocked for those tests.
- Captures: `audit-reports/device-screenshots/user-app.png`, `admin-app.png`, `user-app-recheck.png`, `admin-app-recheck.png`.

## Completion and deployment decision

- **Production changed:** No.
- **Staging changed/deployed:** No.
- **Database/migration changed or applied:** No.
- **Wallet/account/OTP/payment changed:** No.
- **Android:** Admin debug APK built; neither APK was installed. User production-configured JavaScript bundle exported successfully, but a signed User release APK remains blocked by missing release-signing settings.
- **Git commit/push:** No. Local HEAD matches the staging GitHub branch; existing local uncommitted work remains preserved.
- **SMS delivery:** Not confirmed. No real SMS sent. Admin staging request suppression is expected with zero active Admins. Customer SMS provider result is unknown.
- **Financial availability:** Correctly blocked. Do not enable until provider setup, funding, verification, reconciliation and approval are established.
- **Overall:** Local code checks are green, but real-mobile tests, DB integration, signed APK build/install, customer SMS diagnosis, provider receipt verification, and full live financial operations remain blocked/unverified. See [prioritized TODO](PAISAPAY_PRIORITIZED_TODO.md).

## Phase 2 follow-up — 2026-11-10

### Fixes made

- **Wallet refresh:** the User App now applies a valid server wallet balance as soon as that request succeeds, even when an unrelated dashboard request fails. Invalid/negative available-balance data is rejected. Added three regression tests.
- **Overlapping withdrawals routes:** removed the unreachable legacy withdrawal router from the support module and app mount. P2P `/withdrawals` is now the only active route implementation. Route contract test now fails if two source routers declare the same method/path.
- **Admin API environment safety:** removed the implicit staging fallback from the Admin app. Release builds now require explicit `EXPO_PUBLIC_ADMIN_DEPLOYMENT_ENV` and the matching exact approved staging/production API origin. EAS profiles and local release scripts set both values. Added tests for production/staging origins, trailing-slash normalization, invalid hosts/paths and development origins.
- No code change enabled payment, payout, wallet-credit, reward or OTP dispatch flags.

### Phase 2 verification

| Check | Result |
|---|---|
| Backend full suite | **PASS:** 295 passed, 56 skipped, 0 failed; 4 database-dependent files skipped |
| Focused backend regression suite | **PASS:** 108 passed (HTTP route uniqueness, referral, availability and Admin credit workflow) |
| Admin suite | **PASS:** 50 passed, including new API-origin tests |
| User App integration suite | **PASS:** 28 passed, including balance refresh regressions |
| User App feature suite | **PASS:** 7 passed |
| Prisma validation / client generation | **PASS** |
| Backend typecheck / production build | **PASS** |
| User App production-configured Android bundle | **PASS:** production origin present, local development origin absent |
| Admin production APK | **PASS:** release APK built with explicit production marker and exact production origin; debug signer mismatch with installed debug app means it was not installed |
| User production APK | **BLOCKED:** build safely fails because the four approved User release-signing environment variables are not present; unsigned release was not produced |

Admin production APK details: `apps/admin-app/android/app/build/outputs/apk/release/app-release.apk`; version `1.0.3` / code `4`; SHA-256 `0FC631F0742653D9BA752F0E6FBBAB92A2BCFC4332236930FB06F5A85358A414`; signer `CN=PaisaPay Admin Release, OU=Mobile, O=PaisaPay`, SHA-256 `045714bc744847c601334d50b5898453cd35c7b29ff529252b84c9e96d414ca5`. This certificate differs from the installed Admin debug signer, so `adb install -r` was not attempted. The new test suite validates the exact production API origin; the APK bundle contains both production and staging origin constants because staging is also an explicitly supported environment, while the build used the production profile/marker.

### Remaining blockers and deployment state

- The User production APK cannot be signed until the owner supplies the existing approved signing configuration. Required variable names are `PAISAPAY_RELEASE_STORE_FILE`, `PAISAPAY_RELEASE_STORE_PASSWORD`, `PAISAPAY_RELEASE_KEY_ALIAS`, and `PAISAPAY_RELEASE_KEY_PASSWORD`. Their values are not in this report.
- Staging still has no eligible active Admin, so Admin password-reset OTP is correctly suppressed. No real SMS or password reset was triggered. Render SSH host verification blocked a names-only runtime configuration check; no key was printed. The owner had previously reported that the staging key is configured, but effective runtime/provider acceptance and handset delivery remain unconfirmed.
- The phone remains asleep/keyguard-locked. No APK was installed, no app data was changed, and login/navigation could not be interactively tested.
- 56 database-backed tests remain skipped. No staging or production migration was run by this process; no migration/schema file changed. Production remains on its existing older commit and was untouched.
- Production and staging financial flags remain disabled. Deposits, payouts, P2P settlement, credit posting and reward credits are not enabled or verified.
- The Phase 2 source and report changes have not yet been committed or pushed. Staging deployment is pending the explicitly requested clean release commit/push and Render auto-deploy verification. Production deployment is not authorized or planned.
