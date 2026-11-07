# PaisaPay Admin Repair Report

Date: 2026-11-07 (Asia/Kolkata)

## Diagnosis

- The Admin app required `EXPO_PUBLIC_API_URL` at JavaScript startup and crashed when a build omitted it. The checked-in example was blank, and `app.config.js` did not provide a production API fallback.
- The production API is behind the workspace. Its live OpenAPI document omits current Admin screens and its route guard returns `404 ROUTE_NOT_FOUND` for `GET /admin/reports`, `GET /admin/settings`, and `GET /admin/users/:id/wallet/credits`.
- Super Admin credit service and routes existed in the workspace, but the Express route allow-list did not admit either wallet-credit route, so they returned 404 before authentication.
- The Admin app had no Super Admin wallet-credit screen even though `/admin/me` advertised a wallet-credit section. It also had a static “Features not available” list in system health.
- A TypeScript contract mismatch prevented the backend from building: the credit helper’s input type still required `targetPublicId` although the route uses the UUID `targetUserId`.

## Changes made

- The Admin app now defaults to `https://paisapay-api.onrender.com` and still accepts an explicit local/staging `EXPO_PUBLIC_API_URL` override.
- Added a Super Admin credit screen with user search by public ID, UUID, phone or name; masked account details; current ledger-derived available/reserved balances; recent credit history; amount bounds of ₹100–₹10,000; a required reason; confirmation; and a stable idempotency key across retries of the same request.
- Added the missing API route allow-list patterns. Credit creation remains restricted on the backend to `SUPER_ADMIN`, the financial-operations and wallet-credit flags, an active target account, an adequately funded adjustment account, and an idempotent balanced ledger transaction with an audit record. No direct balance update was added.
- User details now include ledger-derived balances and the latest 20 ledger entries. Wallet history and credit endpoints were added to local OpenAPI documentation and authenticated response contracts.
- Changed payout/provider availability labels to `NOT_CONFIGURED` where no approved integration exists. The Admin UI does not turn an unavailable payment or payout provider on.
- Removed the static unavailable-feature list from the health screen. Domain workflows still absent from this API (KYC, Bird Assistant/joke administration, dispute resolution, and Admin role changes) are documented below rather than represented as working.
- Updated the Admin setup notes and added this report.

## Admin feature and endpoint matrix

All paths below are relative to `/api/v1`. The local API requires an authenticated Admin session for protected routes. Financial credits and configuration mutations have additional backend checks.

| Admin feature | Endpoint(s) | State / backend authorization |
|---|---|---|
| Sign in / password reset | `POST /admin/auth/login`; `POST /admin/auth/forgot-password/request-otp`; `POST /admin/auth/password/reset` | Implemented; active provisioned Admin account required. Password was not reset. |
| Role and capabilities | `GET /admin/me` | Implemented; reports role, allowed sections, and read-only feature gates. |
| Dashboard / overview | `GET /admin/overview` | PostgreSQL counts, metrics, trends and recent records. |
| User search | `GET /admin/users?q=&status=&page=&pageSize=` | Search by public ID, UUID, name, or phone; masked phone and ledger-derived wallet summary. Finance/Operations/Admin/Super Admin roles. |
| User details and wallet history | `GET /admin/users/:id`; `GET /admin/users/:id/wallet/credits` | Profile, current/held balance and recent ledger rows; credit history is Super Admin only. |
| Account status | `POST /admin/users/:id/status` | Audited ACTIVE/SUSPENDED change with reason; Operations/Admin/Super Admin. |
| Deposits | `GET /admin/deposits`; `GET /admin/reconciliation/claims`; `GET /admin/reconciliation/claims/:claimId/evidence`; `POST /admin/reconciliation/claims/:claimId/review` | Read and evidence review supported. Approval requires independent receiver-side verification. |
| Withdrawals | `GET /admin/withdrawals` | Read-only request history. No payout processor is configured. |
| Transactions | `GET /admin/transactions` | Paginated deposit, withdrawal and P2P records from database. |
| Wallet ledger | `GET /admin/wallets/ledger` | Read-only ledger records. |
| Single-account wallet adjustment | `POST /admin/wallet-adjustments` | Existing separate configured-ADMIN flow; disabled unless server controls/funding permit it. |
| Super Admin wallet credit | `GET /admin/users/:id/wallet/credits`; `POST /admin/users/:id/wallet/credit` | ₹100–₹10,000, confirmation/reason, idempotency, balanced ledger + audit, Super Admin only. GET route presence/auth gate verified in production; no POST was sent. |
| P2P operations | `GET /admin/p2p/overview`; `GET /admin/p2p/offers`; `POST /admin/p2p/offers/:id/cancel`; `GET /admin/p2p/orders`; `GET /admin/p2p/claims`; `GET /admin/p2p/claims/:id`; `GET /admin/p2p/claims/:id/evidence`; `POST /admin/p2p/claims/:id/review` | Search/monitor and audited review. Financial decisions require server role and verification rules. |
| Payment providers | `GET /admin/providers` | Availability only; disabled or unapproved providers remain disabled. |
| Commissions / referrals | `GET /admin/commissions`; `GET /admin/referrals`; `GET/PATCH /admin/referrals/config`; `PATCH /admin/referrals/milestones/:key` | Reporting and audited configuration; payout is not implied. |
| Reward rules | `GET /admin/reward-rules`; `PATCH /admin/reward-rules/:id` | Super Admin updates are audited; rules do not credit funds. |
| Announcements | `GET/POST /admin/notifications` | Audited in-app notices only; no SMS/push delivery is claimed. |
| CSV reports | `GET /admin/reports` | Aggregate export; money reports remain subject to the financial-operations gate. Production route presence/auth gate verified; response data not read. |
| Disputes | `GET /admin/disputes` | View-only; dispute resolution workflow is not implemented. |
| Support | `GET /admin/support/tickets`; `GET /admin/support/tickets/:id`; `POST /admin/support/tickets/:id/reply`; `PATCH /admin/support/tickets/:id/status` | Audited ticket operations; replies create in-app notifications. |
| Admin alerts | `GET /admin/push-events`; `POST/DELETE /admin/push-devices` | Durable event list and device registration/revocation. Delivery depends on device/service configuration. |
| Admin directory | `GET /admin/admins` | Super Admin read-only directory; role changes are not implemented. |
| Audit logs | `GET /admin/audit-logs` | Searchable audit records, Operations/Admin/Super Admin. |
| Diagnostics / safe settings | `GET /admin/system-health`; `GET /admin/settings` | Database/provider health and non-secret flags. Production route presence/auth gate verified; settings response not read. |

## Pre-deployment production API verification

Read-only checks were made against `https://paisapay-api.onrender.com` without credentials. A `401 AUTH_REQUIRED` is the expected evidence that a protected route exists and authentication is enforced.

- `GET /api/v1/openapi.json` returned the production OpenAPI document. It is behind the workspace version and documents only a subset of Admin paths.
- Production returned `401 AUTH_REQUIRED` for `/admin/me`, `/admin/overview`, `/admin/users`, `/admin/deposits`, `/admin/withdrawals`, `/admin/transactions`, `/admin/wallets/ledger`, `/admin/providers`, `/admin/audit-logs`, `/admin/system-health`, `/admin/admins`, `/admin/p2p/overview`, `/admin/p2p/offers`, `/admin/p2p/orders`, `/admin/p2p/claims`, `/admin/reconciliation/claims`, `/admin/reconciliation/claims/:id/evidence`, `/admin/notifications`, `/admin/reward-rules`, `/admin/disputes`, `/admin/support/tickets`, and `/admin/support/tickets/:id`.
- Production returned `404 ROUTE_NOT_FOUND` for `GET /admin/reports`, `GET /admin/settings`, and `GET /admin/users/:id/wallet/credits`.
- No production wallet-credit POST was sent. The automatic safety review rejected an unauthenticated POST probe because it targeted a financial mutation endpoint. No production balances were changed.
- No Admin login, owner bootstrap, password reset, or financial mutation was performed during verification.

## Build and test results

| Check | Result |
|---|---|
| Admin unit tests (`npm test`) | Passed: 24/24. |
| Super Admin and general wallet adjustment unit tests | Passed: 8/8. Includes amount bounds, balanced ledger write and audit, plus existing idempotency checks. |
| Server production build (`npm run build`) | Passed after correcting the credit-helper TypeScript input contract. |
| Admin Android Metro export (`expo export --platform android --no-bytecode`) | Passed; Android JS bundle exported. |
| Standard Hermes bytecode export | Passed using a workspace-local temporary directory after the default Windows temp location denied writes. |
| Full server suite | Not verifiable in this environment: 110 failures were socket-access errors (`connect EACCES` to Supertest loopback ports or local PostgreSQL `127.0.0.1:5432`), 65 tests passed and 39 were skipped. No database connection was established. |
| Production mutation endpoint | Not probed; no wallet credit request was sent. |

## Status at initial repair commit

Workspace fixes and builds are complete, but the deployed Render API has not been updated. Its observed `404` responses mean that reports/settings and Super Admin credit history cannot work against production until the backend changes are deployed. The new credit screen also requires a rebuilt Admin app. Existing installed binaries cannot receive a JavaScript change that was not already bundled; the production URL fallback supports the next build. KYC, Bird Assistant/joke management, dispute resolution, provider payouts, and Admin role changes remain unavailable because this API has no approved complete workflows for them.

## Production deployment follow-up (2026-11-07)

- Pushed the repair to GitHub `main`. The resulting branch head is `b151d8b` (`Merge remote-tracking branch 'origin/main'`), containing Admin repair commit `5f6dbe6` and preserving the concurrent password-reset commit `f9b26b4`.
- Render is serving the new backend routes: `/ready` returned `200` with PostgreSQL `ready`; the production OpenAPI document now contains `/admin/reports`, `/admin/settings`, `/admin/users/{id}`, and `/admin/users/{id}/wallet/credits`. These four routes returned `401 AUTH_REQUIRED` without credentials instead of the pre-deployment `404` for missing routes.
- A read-only sweep of all 32 documented Admin GET routes returned `401 AUTH_REQUIRED`; none returned `404`. This confirms route presence and the authentication gate, not access to customer data or role-specific responses.
- No production Admin credentials were available. A successful Super Admin login, `SUPER_ADMIN`-specific `403`/`200` behavior, report/settings response contents, and real user detail/credit history data were therefore not verified. No password reset, bootstrap, credit POST, or other production write was attempted.
- No wallet credit was performed. Production balances remain untouched by this verification.
- The Admin release APK rebuilt successfully at `apps/admin-app/android/app/build/outputs/apk/release/app-release.apk`. It has package `com.paisapay.admin`, version `1.0.0` / versionCode `1`, min SDK `24`, target SDK `36`, and a valid APK signature. A companion Expo export built with `EXPO_PUBLIC_API_URL=https://paisapay-api.onrender.com` contains the production URL and not the local LAN URL.
- At the initial repair build, the Android Gradle release signing config used the debug key. That configuration was replaced in the verification follow-up below. ADB could not start in this environment, so installation on a device was not tested.
- At the initial verification, Admin-app tests passed 24/24; Admin reporting and wallet-ledger tests passed 12/12; `npm run build` passed. The Express `app.test.ts` suite could not run there because Supertest could not open local loopback sockets (`connect EACCES`).
- No payment provider was enabled. KYC, Bird Assistant/joke administration, dispute resolution, payout processing, Admin role changes, and push delivery remain unavailable until complete approved backend workflows and providers exist.

### Post-deployment endpoint check

All paths are relative to `/api/v1`; `401 AUTH_REQUIRED` below was observed with no credentials. This verifies routing and enforcement, not successful data reads.

| Feature | Production endpoint(s) checked | Result |
|---|---|---|
| Reports | `GET /admin/reports` | `401 AUTH_REQUIRED`; route exists; response data/role access not verified. |
| Safe settings | `GET /admin/settings` | `401 AUTH_REQUIRED`; route exists; safe response contents not verified. |
| User details | `GET /admin/users/:id` | `401 AUTH_REQUIRED`; route exists; no customer details fetched. |
| Credit history | `GET /admin/users/:id/wallet/credits` | `401 AUTH_REQUIRED`; route exists; no credit history fetched. |
| All documented Admin reads | 32 documented `GET /admin/...` routes, including overview, users, transactions, wallet ledger, audit, support, P2P, diagnostics, and alerts | All 32 returned `401 AUTH_REQUIRED`; no `404` responses. |
| Super Admin sign-in and authorization | `POST /admin/auth/login`; role-protected API routes | Not successfully verified: no existing Admin credentials were supplied; no login/password-reset attempt was made. |
| Wallet credit creation | `POST /admin/users/:id/wallet/credit` | Deliberately not sent; no production mutation. |

## Current verification update (2026-11-07)

- The verification changes are based on GitHub `main` head `4dcbcc7`. The release-signing setup, version bump, idempotency regression test, and this report update are local follow-up changes and have not been pushed; production remains on the already-deployed backend.
- No existing Admin login/password is present in the workspace environment, and no Admin web session or connected device was available. Therefore successful production `SUPER_ADMIN` login, authenticated PostgreSQL data reads, and role-specific production responses remain unverified. No guessed credentials, password reset, bootstrap, or credential sharing was used.
- Rechecked wallet credit bounds and idempotency with mock-database tests only. They confirm ₹100–₹10,000 bounds, no ledger/audit writes for rejected amounts, replay without duplicate ledger/audit rows, and idempotency conflicts; no production credit request was sent.
- Authenticated-response/role tests pass 12/12 against the mocked local database. These are code-level tests and do not establish a successful production `SUPER_ADMIN` session.
- A dedicated 4096-bit RSA Android release key was generated and validated. The PKCS#12 keystore is at `C:\Users\ops86\.gradle\paisapay-admin-signing\paisapay-admin-release.jks`; its folder and the user Gradle properties file are ACL-limited to the current Windows user, SYSTEM, and Administrators. Password property values are stored only in `C:\Users\ops86\.gradle\gradle.properties`, outside the repository, and are not included in this report or Git. Gradle now rejects release builds without those properties and never falls back to the debug signer.
- The production release script pins `EXPO_PUBLIC_API_URL=https://paisapay-api.onrender.com`; the final non-bytecode Expo export contains that URL and does not contain the local LAN API URL. A local Expo config plugin persists the protected signing configuration across Android prebuild and rejects unsigned/debug-signed release tasks when local signing properties are missing.
- The first signed release build after Expo prebuild was `1.0.1` / versionCode `2` with the dedicated signer, but it did not match the existing installation. It was superseded by the compatible device update below.
- Current test results: Admin app 26/26 (including release-signing plugin fail-closed/idempotency checks); reporting + wallet credit service 13/13; authenticated response/role contracts 12/12. Wallet/idempotency and role tests use local mocks. No production customer record was read and no production wallet balance changed.

## Android device installation follow-up (2026-11-07)

- The connected Android device was authorized for ADB. The installed app was confirmed as `com.paisapay.admin` version `1.0.0`, versionCode `1`.
- The installed app certificate matched the existing `apps/admin-app/android/app/debug.keystore` certificate exactly: SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. The existing key was reused; no signing key was exposed or regenerated.
- Built Admin version `1.0.2`, versionCode `3`, with min SDK `24`, target SDK `36`, using that matching existing signer for this compatibility update. The build’s companion bundle check found `https://paisapay-api.onrender.com` and no local LAN URL.
- `adb install -r` succeeded. A post-install APK pull confirmed version `1.0.2` and the same signer fingerprint. No uninstall or app-data clear was performed.
- Launched `com.paisapay.admin/.MainActivity`. UI inspection confirmed the Admin sign-in screen with password and secure sign-in controls visible. No login was attempted and no wallet credit or other financial action was performed.
- Final installed APK SHA-256: `192DADA392FF07377D8800CF16C409768D1DEC39BC7A7CD0D56F4C17EDA194BE`.

## Authenticated production safety review (2026-11-07, latest user evidence and local source review)

### Production access evidence and limits

- The owner reports that the installed Admin app now signs in successfully and screenshots show “Server Authorized”, the dashboard, and Super Admin Credits. This is user-provided visual evidence; this verification turn could not independently replay authenticated API requests because ADB currently lists no connected Android device. No access token was extracted or requested.
- Attempts to open the protected production API directly without the app session were inaccessible from the web verification tool. Protected endpoint data, role-specific responses, and live PostgreSQL records therefore remain unverified in this update. A successful login/dashboard screenshot does not by itself prove every protected data endpoint is returning records.
- No password reset, bootstrap, token extraction, production write, or wallet credit was attempted. No production balance was modified.

### Financial controls and adjustment funding findings

The current backend source has these controls:

| Requirement | Exact configuration / record | Finding |
|---|---|---|
| General financial operations | `FINANCIAL_OPERATIONS_ENABLED` | Production default/sample is `false`. The production config validator rejects `true` because an independently verified payment and payout provider is not implemented. |
| Manual wallet adjustments | `WALLET_ADJUSTMENTS_ENABLED` | Production default/sample is `false`. The production config validator rejects `true` until financial controls and adjustment funding are approved. |
| Designated adjustment operator | `WALLET_ADJUSTMENT_ADMIN_USER_ID` | Optional UUID. Unset in the sample. This is required only for the separate single-ADMIN adjustment screen; it is not the SUPER_ADMIN credit route's role check. Do not populate it merely to enable SUPER_ADMIN credits. |
| Payment provider | `PAYMENT_PROVIDER` | `disabled` in production sample; source rejects production startup with any provider other than disabled until an approved adapter exists. This is a blocker to enabling general financial operations. |
| Dedicated ledger funding account | `ledger_accounts.id = 00000000-0000-4000-8000-000000000101`, type `ADMIN_ADJUSTMENT_FUND`, currency `INR`, `user_id = NULL` | Migration `20261104120100_admin_wallet_adjustment_fund_account` provisions the account row only. It explicitly does not fund it. Whether this row exists in deployed PostgreSQL has not been independently queried in this update. |
| Adjustment funding balance | Net `SUM(ledger_entries.credit_paise - ledger_entries.debit_paise)` for that account | A newly provisioned account has no entries and therefore a zero balance. Credit requests check sufficient funds and use a balanced ledger transaction; there is no safe shortcut by directly editing a wallet or writing a made-up opening balance. Live balance is not verified here. |
| Audit and idempotency | `ledger_transactions` and `audit_logs` in the same transaction; UUID `Idempotency-Key`, advisory lock, serializable transaction | Present in source. Unit tests validate replay/no-duplicate and mismatch behavior. No production credit was sent. |
| Independent approval | No maker-checker / dual-approval wallet-credit workflow found | Missing. The credit UI's single confirmation and SUPER_ADMIN role do not constitute independent approval. A second approver and immutable approval record must be implemented before enabling. |

Do not turn either financial flag on or seed the adjustment account with an arbitrary ledger entry. A safe future configuration requires a documented and independently verified source of funds; accounting approval for the source and matching journal entries; reconciliation ownership and evidence; a maker-checker approval workflow; operational limits/monitoring; and a separately approved, deployed provider/control implementation. The current production validator intentionally blocks the necessary flags, so these findings are not instructions to enable them.

### Diagnostic improvement made locally (not yet deployed)

- `GET /api/v1/admin/settings` now has a local source change that reports only non-secret financial control state, whether the designated account exists, its read-only ledger balance, funding status, and whether credit prerequisites appear ready. The SQL is read-only and handles a missing account/schema by reporting `CHECK_FAILED` rather than pretending the account is funded.
- The Admin Settings page now renders this structured safety diagnostic. It cannot change settings or create funding entries.
- The API route remains behind `requireAuth` and `requireAdmin`, with ADMIN/SUPER_ADMIN role filtering. The source continues to reject production financial enablement. This change is not part of the already deployed production API or installed APK until separately built/deployed.

### API and feature verification matrix

| Feature | Endpoint(s) | Current classification |
|---|---|---|
| Admin sign-in / role session | `POST /api/v1/admin/auth/login`, then `GET /api/v1/admin/me` | User reports successful SUPER_ADMIN login and server authorization; screenshots are not authenticated response captures. Endpoint role claims are not independently rechecked in this turn. |
| Dashboard | `GET /api/v1/admin/overview` | Dashboard is reported visible. Live response/data completeness not independently queried now. |
| User search | `GET /api/v1/admin/users?page=…&pageSize=…&q=…` | Implemented in source against PostgreSQL for public ID, display name, phone, and UUID. SUPER_ADMIN is permitted by the operations-role gate. Live search result not independently verified now. |
| User details / balances / recent ledger | `GET /api/v1/admin/users/:id` | Implemented in source and reads account balances from ledger entries. Live user record not independently verified now. |
| Super Admin credit history | `GET /api/v1/admin/users/:id/wallet/credits` | SUPER_ADMIN-only, joins Admin adjustment ledger transactions with audit entries. Live history not independently verified now. |
| Reports | `GET /api/v1/admin/reports?report=…&from=…&to=…` | Read-only source implementation; financial reports are blocked while financial operations are disabled. Live response not independently verified now. |
| Safe settings | `GET /api/v1/admin/settings` | Existing deployed route was previously confirmed present but not response-tested with auth. New funding diagnostics are local/unreleased. |
| Wallet balances / ledger | `GET /api/v1/admin/wallets/ledger` | Read-only source implementation; live ledger records not independently verified now. |
| Audit logs | `GET /api/v1/admin/audit-logs` | Read-only source implementation; live audit records not independently verified now. |
| System diagnostics | `GET /api/v1/admin/system-health` | Read-only health endpoint reports API, DB probe, payment and payout provider state. Live authenticated response not independently verified now. |
| Wallet credit submission | `POST /api/v1/admin/users/:id/wallet/credit` | Unavailable by design: financial flags are off; account funding and dual approval are not evidenced; production backend source refuses enablement. No credit was attempted. |

### Current verification work results

- Admin app automated tests: 26/26 passed.
- Server Admin reporting and wallet-adjustment focused tests: 13/13 passed after adding coverage for the new safe funding diagnostic.
- Server production TypeScript build: passed.
- Production authenticated endpoint sweep: not performed in this turn because no authorized device/session was connected. Prior unauthenticated 401 route checks prove only that authentication is enforced, not that SUPER_ADMIN responses work.
- Production database account presence/funding: not independently verified. The local diagnostic endpoint should be deployed and queried with the authorized app session before asserting those facts about production.
- Production wallet credits: disabled and not used for testing.

### Latest read-only network and bundle checks (2026-11-07)

- Direct production `GET /ready` returned HTTP 200 with `database: ready`.
- Without credentials, direct requests to `GET /api/v1/admin/settings`, `/admin/me`, `/admin/reports`, `/admin/wallets/ledger`, `/admin/audit-logs`, and `/admin/users?q=` returned HTTP 401. This confirms those routes are present and protected; it does not verify authorized data results.
- ADB was rechecked and reports no connected device. The owner's successful login/screenshots remain user-reported evidence; there was no authenticated production session available to this verification process.
- The Admin JS production export completed successfully after explicitly setting `EXPO_PUBLIC_API_URL=https://paisapay-api.onrender.com`. Inspection found that URL in the bundle and did not find the workspace LAN URL. This verified an Expo JS export, not a signed APK build or install.
- The new diagnostics changes and report are local only. They have not been committed, pushed, deployed, or installed in the production APK. Consequently the current production API still cannot report the adjustment account's actual presence or ledger funding through the new diagnostic fields.
- Additional no-credential route checks: `GET /api/v1/admin/users/00000000-0000-4000-8000-000000000001`, the matching `/wallet/credits` path, and a valid-shape `/reports` query each returned 401. Placeholder UUID use did not request or reveal an actual customer record.

## Admin diagnostics deployment follow-up (2026-11-07)

- Reviewed and tested the local financial-safety diagnostics. The read-only settings endpoint reports `ADMIN_ADJUSTMENT_FUND` as `PROVISIONED`, `MISSING`, or `CHECK_FAILED`, and returns its net ledger balance in paise only when queryable. It explicitly reports that independent approval is not implemented and therefore `adminAdjustmentControlsReady` and `superAdminCreditPrerequisitesReady` remain false. `superAdminWalletCreditsEnabled` mirrors the two server financial flags; this diagnostic does not enable or edit them.
- The actual production fund-account row and balance are still unverified: this requires calling the new authenticated endpoint after deployment, and ADB currently reports no connected phone. The last directly observed production state was `/ready` HTTP 200/database ready; unauthenticated Admin reads returned 401. No production financial data was changed.
- App tests: 26/26 passed. Focused server tests: 13/13 passed. Server build passed.
- Built standalone APK `apps/admin-app/android/app/build/outputs/apk/release/app-release.apk`: package `com.paisapay.admin`, version `1.0.3`, versionCode `4`, min SDK 24, target SDK 36. APK signer SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, matching the previously verified 1.0.2 installation signer. This build used the existing debug keystore; it was not regenerated or included in Git. APK SHA-256 `B0145ACF35E7644769E0297756CEAFC84CDDBBB01AD9A50BD9F8AC7536144303`. APK inspection confirmed `https://paisapay-api.onrender.com` is bundled and no workspace LAN URL is present.
- Device update is pending: ADB currently lists no connected Android device. No install, uninstall, or app-data operation was performed; existing app data remains untouched.
- GitHub `main` was at `4dcbcc7` on fetch. Local `main` contained two prior Admin-only commits ahead of it. All unrelated mobile and server work remains unstaged and outside the diagnostic change set. GitHub push and Render deployment status will be recorded after the push/deployment checks.
