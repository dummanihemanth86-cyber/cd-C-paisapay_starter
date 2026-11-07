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
- Final release build after Expo prebuild: `apps/admin-app/android/app/build/outputs/apk/release/app-release.apk`; package `com.paisapay.admin`; version `1.0.1`, versionCode `2`, min SDK `24`, target SDK `36`. APK signature verification passed. Signer certificate SHA-256: `045714bc744847c601334d50b5898453cd35c7b29ff529252b84c9e96d414ca5`. APK SHA-256: `C0D5C8E79FDB2E63E54B5D50D4CC9082685BF0087598DD283104A523800A0F2E`.
- The signer differs from the earlier debug-signed APK. Because ADB could not start, the installed app certificate could not be read; install-over compatibility with that installation is not confirmed. Do not treat the APK as a compatible update until the installed certificate is compared or the existing installation is replaced through the intended migration path.
- Current test results: Admin app 26/26 (including release-signing plugin fail-closed/idempotency checks); reporting + wallet credit service 13/13; authenticated response/role contracts 12/12. Wallet/idempotency and role tests use local mocks. No production customer record was read and no production wallet balance changed.
