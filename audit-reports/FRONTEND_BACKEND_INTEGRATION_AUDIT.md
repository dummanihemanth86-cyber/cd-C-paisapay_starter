# PaisaPay Frontend–Backend Integration Audit

**Date:** 2026-11-03  
**Project:** `C:\paisapay_starter`  
**Verdict:** **READY WITH LIMITATIONS** for the integration paths inspected and code-level fixes below. This is not a production payment or device certification.

## Scope and method

Reviewed the Public Expo app in `mobile/`, the browser admin app in `admin/`, the native admin app in `apps/admin-app/`, backend routes/services in `server/src/`, the generated OpenAPI contract, and the prior endpoint/security/OpenAPI audit reports. `frontend/` is absent. `backend/` is a legacy wrapper; its normal scripts point at `server/` (its separate demo start is not the deployed API).

This audit compares frontend call sites, methods, request data and consumed response fields with registered Express routes and OpenAPI operations. Prior generated endpoint inventory reports **99 router declarations / 98 OpenAPI operations / 0 uncovered declarations**; two duplicate route declarations are legacy withdrawal routes, with the P2P router mounted first. Existing OpenAPI audit records all 38 JSON-body operations documented and four intentionally dynamic JSON response fields backed by JSON database columns.

## Architecture and API connection map

| Client | Entry/API layer | Base URL | Session/auth |
|---|---|---|---|
| Public Android/iOS app | `mobile/App.js`; `mobile/src/api.js` | `EXPO_PUBLIC_API_URL` | Bearer token added by API helper; session held in SecureStore according to remember-session setting; refresh is single-flight |
| Native Admin app | `apps/admin-app/App.js` | `EXPO_PUBLIC_API_URL` | Separate admin login/API namespace, secure token storage, startup session check |
| Browser Admin | `admin/src/main.jsx` (inline API helper) | `VITE_API_URL`; Vite dev proxy only in development | Separate admin login; browser tokens are memory-only |
| Backend | `server/src/app.ts`, module route files | Express `/api/v1` | Public and admin auth middleware/RBAC; PostgreSQL through Prisma |
| Contract/docs | `server/src/openapi.ts` | `/api/v1/openapi.json`, `/api/v1/docs` | OpenAPI bearer declarations correspond to protected handlers |

No `localhost`/LAN fallback is intended for production mobile API configuration: the Public and Native Admin apps validate the configured production URL as HTTPS. Browser Admin’s local proxy is development-only. Browser Admin production builds now fail fast unless `VITE_API_URL` is explicitly set to the deployed API origin; development continues to use the same-origin Vite proxy.

## Endpoint inventory and matching

All inventoried client endpoint families were matched to registered backend route/method declarations and the OpenAPI paths. Request shapes below were compared with the route validators/handlers, not inferred from UI labels.

| Feature | Frontend calls (representative paths/methods) | Match/result |
|---|---|---|
| Public auth/session | `POST /auth/password/login`, `/auth/request-otp`, `/auth/register/request-otp`, `/auth/register/verify-otp`, `/auth/verify-otp`, `/auth/forgot-password/request-otp`, `/auth/password/reset`, `/auth/refresh`, `/auth/logout`; `GET /auth/otp-status/:challengeId` | Match. OTP verification sends `challengeId`, `phoneE164`, `code`; password login sends `phoneE164`, `password`. |
| User/profile/UPI/bank | `GET/PATCH /users/me`; `GET /users/me/balance`, `/users/me/transactions`, `/users/me/vip`, `/users/me/referrals`; UPI and bank-account GET/POST/PATCH/DELETE/verify routes | Match. Profile and UPI payloads use fields accepted by current validators. |
| Deposits/wallet methods | `GET /wallet-methods`; `GET/POST /deposits`; `GET /deposits/:id`; cancel/manual-verification routes; wallet references | Route and method match. Deposit create uses `amountPaise`, `method`, and idempotency header. Actual payment availability remains subject to server configuration. |
| Quick Deposit/P2P/withdrawal | `GET/POST /withdrawals`; offer cancel; `POST /deposits/quick-match`; buyer order list/detail; confirm, handoff, payment-reference, cancel; legacy `/orders` detail/reservation/payment-submission/dispute | Route and method match. Quick match uses `amountPaise` and optional offer exclusions; mutation requests use idempotency where implemented. Safe financial gate returns `503 FINANCIAL_OPERATIONS_DISABLED` for protected operations. |
| Referrals/VIP | `GET /users/me/referrals`, `GET /users/me/vip` | Match; period query is passed where selected. |
| Notifications/support | `GET /notifications`; support ticket GET/POST/detail | Match. Support create sends `subject` and `message`. |
| Admin auth | `POST /admin/auth/login`, `GET /admin/me` | Native app matched. Browser app had a confirmed public-auth endpoint mismatch; fixed as detailed below. |
| Admin operational modules | `/admin/overview`, users, deposits, withdrawals, transactions, ledger, P2P offers/orders/claims, referrals/config/milestones, commissions, providers, rewards, notifications, disputes, support, push devices/events, reconciliation, audit logs and system health | Calls map to admin route handlers. Sensitive operations remain server-permission-controlled; UI hiding is not relied on for authorization. |

A route inventory is not a claim that every route was exercised against a live provider or every business workflow was performed. Request body and response schemas are cross-checked against handlers/OpenAPI; runtime contract tests use the existing test harness and mocked Prisma delegates for successful authenticated endpoint coverage.

## Confirmed integration defects fixed

1. **Browser Admin login used the Public login API.** `admin/src/main.jsx` called `/api/v1/auth/password/login`; the backend has a separate admin login at `/api/v1/admin/auth/login`. It could authenticate against the wrong account/session flow. Added `ADMIN_LOGIN_PATH` in `admin/src/apiContract.js` and switched the browser login call to the actual admin endpoint. Added a regression test.
2. **Safe financial-mode reads could fail the entire public session bootstrap.** Startup grouped profile and wallet reads with legacy order and withdrawal reads that correctly return `503 FINANCIAL_OPERATIONS_DISABLED`. A 503 rejected the whole bootstrap, masking available non-financial data. Added a narrowly scoped fallback that suppresses only that exact 503 code for the gated reads, reports those features as disabled, and rethrows network/auth/other server failures. The UI displays the disabled state and disables corresponding actions; the backend gate remains authoritative.
3. **The Home screen repeated a withdrawal read immediately after bootstrap.** Removed the redundant initial request; periodic refresh remains for an enabled state and is not run for a disabled feature.
4. **Production Browser Admin could silently target its static host when `VITE_API_URL` was unset.** Added `resolveAdminApiBaseUrl` to reject missing production API configuration while preserving the local Vite proxy fallback. Added a regression test.
5. **“Remember me” was lost on token refresh.** Refresh persistence defaulted to persistent storage regardless of the login choice. Added a session persistence policy so non-remembered sessions remain in memory after refresh, remembered sessions persist, and logout resets the policy. OTP login now propagates the selection too.

No backend route, financial business logic, provider integration, database schema, migration, or production setting was changed for these frontend fixes.

## Disabled financial operations and UI behavior

- Server gate is the source of truth. The Public app treats only HTTP `503` with code `FINANCIAL_OPERATIONS_DISABLED` as the expected unavailable state; unrelated errors are not swallowed.
- The app shows an unavailable banner/state and disables affected create/cancel/payment actions. Gated order/withdrawal reads do not block login/profile bootstrap or poll continuously in disabled mode.
- This is not a payment integration. No payment provider was enabled, and no screenshot/UTR is treated by this work as verified payment evidence or as authority to credit a wallet.
- **Partial UI scope:** this audit verified screens wired to the gated order/withdrawal reads and relevant actions; it does not certify every legacy deposit/withdrawal screen on a physical device.

## Authentication, base URLs, response and failure handling

- Public helper attaches Bearer credentials to protected requests; token refresh is single-flight and a refresh `401` clears the session. Non-401 refresh/network failures are surfaced rather than treated as logout.
- Browser Admin now uses the admin login endpoint. Browser sessions are memory-only; page reload requires login.
- Native Admin uses separate admin auth and secure storage; startup attempts session validation/refresh. Some per-screen calls still surface expired-session errors instead of globally refreshing. Browser Admin likewise has no general automatic refresh interceptor. This remains a known usability gap, not an authorization bypass.
- Mobile and admin API helpers parse backend error code/status. Financial-gate fallback is exact-code-specific, so an unrelated 503 remains visible as an error.
- Payload review found no further confirmed mismatch among audited calls. Existing OpenAPI request/response regression coverage remains in place; this task adds targeted regression tests for the defects above.
- Loading/empty/error behavior exists across audited screens, but real-world offline/retry timing and all race cases were not device-tested.

## Verification performed

| Check | Result |
|---|---|
| Existing endpoint inventory | **PASS:** 99 declarations, 98 operations, 0 undocumented declarations; 2 duplicate declarations explained in inventory |
| Public integration tests | **PASS:** `mobile`: `npm run test:integration` — 7 passed, 0 failed |
| Public Bird Assistant regressions | **PASS:** `mobile`: `npm run test:bird` — 7 passed, 0 failed (recorded in the task run) |
| Browser Admin regression | **PASS:** `admin`: `npm test` — 2 passed, 0 failed |
| Browser Admin build | **PASS:** `admin`: `npm run build` — Vite production bundle succeeded |
| Public Android JS bundle | **PASS:** `mobile`: `npx expo export --platform android` — Metro bundled 1,073 modules, export completed. This is a JS export, not an APK or physical-device test. |
| Backend test suite | **PASS:** `server`: `npm test` — 18 test files, 189 passed, 0 failed (recorded in the task run). Local configured DB integration fixtures were used; target was classified as local, not Neon/production. Test cleanup hooks were present. |
| Backend build | **PASS:** `server`: `npm run build` (Prisma client generation and `tsc -p tsconfig.build.json`) (recorded in the task run) |
| `git diff --check` | **PASS:** no whitespace errors; Git emitted line-ending normalization warnings only |
| Database migrations/production DB | **NOT RUN:** no migration command was run and no production database was accessed |
| Physical device / APK | **NOT TESTED:** export only; no device interaction in this audit |
| OTP/SMS delivery and push | **BLOCKED / NOT TESTED:** provider credentials and physical Android notification delivery were not validated |

The latest public Android export succeeded after removal of the duplicate Home request. An attempted `npm run export` was not a configured script and failed; the correct `npx expo export --platform android` command succeeded. The `server/tsconfig.build.json` change was preserved and not edited by this audit.

## Files changed for this integration audit

- `mobile/App.js`
- `mobile/package.json`
- `mobile/src/api.js`
- `mobile/src/UltraHome.js`
- `mobile/src/DepositScreen.js`
- `mobile/src/WithdrawalScreen.js`
- `mobile/src/financialApiFallback.cjs` (new)
- `mobile/src/financialApiFallback.test.cjs` (new)
- `mobile/src/sessionPersistence.cjs` (new)
- `mobile/src/sessionPersistence.test.cjs` (new)
- `admin/package.json`
- `admin/src/main.jsx`
- `admin/src/apiContract.js` (new)
- `admin/src/apiContract.test.mjs` (new)
- `audit-reports/FRONTEND_BACKEND_INTEGRATION_AUDIT.md` (this report)

The worktree already contained other user changes before/alongside this task. Do not interpret the complete `git status` output as this audit’s file list. In particular, `server/tsconfig.build.json` remains an existing uncommitted change and was preserved.

## Remaining issues and limitations

| Priority | Status | Issue |
|---|---|---|
| High | **BLOCKED** | OTP production delivery cannot be certified without the configured Renflair credentials/service and an authorized smoke-test account. |
| High | **NOT TESTED** | Push delivery, notification tap/deep-link routing, background/closed-app behavior require a physical Android Development Build and valid push configuration. |
| Medium | **NOT TESTED** | Native Admin and Public Admin workflows were not executed end-to-end on installed Android devices; only source-level and available tests/builds were checked. |
| Medium | **Known gap** | Browser Admin and most Native Admin requests do not use a shared global expired-session refresh/retry flow. They surface errors/re-login; browser reload loses its in-memory session. |
| Medium | **NOT TESTED** | Production HTTPS API reachability and separately hosted Browser Admin CORS/origin configuration need environment-specific verification. Configure `EXPO_PUBLIC_API_URL` for mobile apps and `VITE_API_URL` for browser Admin; this audit did not infer or set a production URL. |
| High | **BLOCKED** | Real-money payment verification, payout, and production financial operation readiness are outside scope and remain disabled pending authorized provider/reconciliation setup. |

## Final assessment

The confirmed browser login, session persistence, duplicate read, and safe-disabled bootstrap defects are fixed with regression tests. The inspected endpoint calls match backend paths/methods and the existing OpenAPI contract. The app can keep non-financial session bootstrap functional while the financial gate is disabled. Overall verdict is **READY WITH LIMITATIONS**: code-level integration checks and bundles pass, while provider, production deployment, push, device and live operational behavior remain unverified.


