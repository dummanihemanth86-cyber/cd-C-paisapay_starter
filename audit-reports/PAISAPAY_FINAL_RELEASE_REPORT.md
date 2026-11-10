# PaisaPay Final Release Report

**Date:** 2026-11-10 (Asia/Kolkata)  
**Workspace:** `C:\paisapay_starter`  
**Branch:** `codex/admin-wallet-credit-staging`  
**Source release commit:** `739afbd9c7609e666fdffc0b4f89ad6fd664ce70`  
**Production API:** `https://paisapay-api.onrender.com`  
**Staging API:** `https://paisapay-api-staging.onrender.com`

## Release summary

- Reviewed the prior complete audit and prioritized TODO before continuing.
- Fixed User App wallet balance refresh so a successful authoritative balance response updates the displayed balances even if another parallel dashboard request fails; added malformed/negative balance guards and regression tests.
- Removed the unreachable duplicate legacy withdrawal route. The P2P route is now the sole `/withdrawals` handler, and route-uniqueness regression coverage was added.
- Made Admin API environment selection fail closed: release builds must explicitly select staging or production and use that environment's exact approved API origin. Added coverage for exact origins, slash normalization, invalid hosts/paths, and EAS/script configuration.
- The prior audit's user-facing availability, payment-state, retry, session persistence, OTP UI, and Admin maker-checker changes remain in the reviewed source and tests. No financial gate, balance, account, password, OTP, or provider credential was changed.
- Created and pushed staging source commit `739afbd9c7609e666fdffc0b4f89ad6fd664ce70` to GitHub branch `codex/admin-wallet-credit-staging`. Push was a normal fast-forward; no force push.
- Production was not deployed or modified.

## Tests and builds

Results captured after source fixes:

| Check | Result |
|---|---|
| Backend full Vitest suite | PASS: 295 passed, 56 skipped, 0 failed; 4 DB-dependent test files skipped |
| Focused backend regression suite | PASS: 108 passed |
| Admin app tests | PASS: 50 passed |
| User App integration tests | PASS: 28 passed |
| User App feature tests | PASS: 7 passed |
| Prisma client generation | PASS |
| Prisma schema validation | PASS |
| Backend TypeScript typecheck | PASS |
| Backend production build | PASS |
| User App production-configured Expo Android export | PASS; production API origin present, local development origin absent |
| Admin production APK | PASS; release APK built with explicit production marker and exact production origin |
| User production APK fresh signed build | BLOCKED; approved User release signing variables were unavailable, so no new signed APK was claimed |

The backend suite was run with `DATABASE_URL` and `DIRECT_DATABASE_URL` blank. The 56 skipped tests require a disposable isolated PostgreSQL database. No staging or production database was used by tests, no migration was applied locally, and no new migration file is in this release.

## Android artifacts and device

### Admin

- APK: `apps/admin-app/android/app/build/outputs/apk/release/app-release.apk`
- SHA-256: `0FC631F0742653D9BA752F0E6FBBAB92A2BCFC4332236930FB06F5A85358A414`
- Package/version: `com.paisapay.admin`, version `1.0.3`, versionCode `4`
- Signing certificate: `CN=PaisaPay Admin Release, OU=Mobile, O=PaisaPay`
- Certificate SHA-256: `045714bc744847c601334d50b5898453cd35c7b29ff529252b84c9e96d414ca5`
- Not installed: installed Admin is debug-signed and has a different certificate. No uninstall or app-data clearing was attempted.

### User

- A file exists at `mobile/android/app/build/outputs/apk/release/app-release.apk`, SHA-256 `B256E5707663F23300DC2253485A225E42F5609A254EC415EE918C3F25A8F8C9`; package `com.paisapay.app`, version `1.0.0`, versionCode `1`, signer SHA-256 `7cb4a8834ed05cca27f2e1ae94d5270ad927393d2c30527ade0f4792b84c2236`.
- This existing file is not reported as a fresh Phase 2 build: the release task stopped at the approved signing-variable check. The signed APK's production API origin was not independently verified inside this existing artifact.
- Required User signing variables are `PAISAPAY_RELEASE_STORE_FILE`, `PAISAPAY_RELEASE_STORE_PASSWORD`, `PAISAPAY_RELEASE_KEY_ALIAS`, and `PAISAPAY_RELEASE_KEY_PASSWORD`. Supply them through the approved local/CI secret mechanism; do not put values in Git or chat.

### Device

- Earlier inspection identified Xiaomi `22111317PI`, Android 14/API 34, serial `c843d7a11022`; the device had been asleep and locked. It was not unlocked or interacted with.
- At final verification, ADB could not start its local server (`could not read ok from ADB Server`), so device connectivity was not available and neither APK was installed/launched. No app data was changed.

## API, database, OTP and finance

### Staging deployment

- The source commit was pushed to the staging branch. This is **not confirmation that Render deployed it**.
- The checked-in `render.staging.yaml` has `autoDeployTrigger: 'off'`. Current attempts to reach the Render API and the staging API failed at DNS resolution, so deployment history, effective Render configuration, and the updated `/health`, `/ready`, `/api/v1/config`, and app-version endpoints could not be verified.
- No manual deploy was triggered. The staging manifest includes a database migration command; the effective staging database target and pending migration status could not be confirmed during this run. No migrations were changed or manually applied.
- Next staging step: restore Render API/network access, confirm the service is the staging service attached only to the isolated staging database, inspect its pending migration state, then trigger the staging deploy and verify health/readiness and deployed commit. Production must not be selected.

### OTP

- No real SMS request was sent. No OTP was logged or exposed.
- Staging Admin forgot-password OTP remains intentionally suppressed while there are zero eligible active Admin accounts; the generic anti-enumeration behavior was not modified.
- The customer OTP provider-side root cause remains unconfirmed. The owner previously reported that the staging Renflair key is configured, but effective runtime configuration, provider acceptance, and phone delivery were not verified in this run. HTTP success/acceptance must not be described as handset delivery.
- Delivery status: **not confirmed**. No distinction between provider acceptance, SMS send, and handset delivery can be asserted without provider evidence/receipt and a real approved handset test.

### Financial operations and database

- Production/staging public config was previously observed with financial/payment gates off and no UPI receiver. Latest API health/config checks could not complete due DNS failure.
- Deposits, withdrawals, Quick Deposit, P2P settlement, admin credit posting, referral commissions, and welcome/VIP rewards remain blocked or unverified behind funding/provider/verification/reconciliation/authorization requirements. No gate was enabled and no wallet balance was changed.
- Database: no migration file changed, no migration command was run by this process, and the 56 DB-backed tests remain skipped pending an isolated disposable DB.

## Git and preserved work

- Source commit `739afbd9c7609e666fdffc0b4f89ad6fd664ce70` is pushed to `origin/codex/admin-wallet-credit-staging`.
- Production bootstrap/password-reset utilities, local Gradle audit caches, device logs, and black/locked-device screenshots were excluded from the release commit and remain local/untracked. No local changes were discarded.
- No production commit, deployment, database migration, financial setting, balance, account, or password was changed.

## Exact next actions

1. In Render, confirm the staging service uses only the isolated staging database and inspect pending migrations; deploy commit `739afbd9c7609e666fdffc0b4f89ad6fd664ce70` to **staging only**.
2. Confirm `/health`, `/ready`, `/api/v1/config`, and deployed build/commit from the staging hostname.
3. Use an approved active staging Admin/customer and an explicitly approved real-phone test; correlate redacted backend diagnostics with Renflair's provider status. Never share the OTP or provider key.
4. Provide the existing approved User release-signing secrets to the build environment, rebuild the User APK, verify the embedded production origin and signer against the installed distribution certificate, then install only with compatible signing while preserving app data.
5. Reconnect/wake/unlock the Android device and perform the real UI/login/navigation checks; do not conduct financial transactions.
6. Provision an isolated disposable PostgreSQL database to run the 56 skipped integration tests.
7. Keep financial features disabled until payment/payout provider readiness, funding, reconciliation, and independent authorization are documented and approved.

## Final status

**Local source fixes/tests:** complete for the fixable, safely verifiable work in this pass.  
**Staging source push:** complete.  
**Staging deployment/API verification:** pending, blocked by Render/DNS access and the migration preflight.  
**Production:** unchanged.  
**Android:** Admin release APK built but not installed; fresh User release APK blocked by missing signing configuration; device unavailable at final ADB check.  
**OTP delivery:** not confirmed.  
**Financial operations:** intentionally unavailable pending legitimate provider/funding/reconciliation/approval readiness.
