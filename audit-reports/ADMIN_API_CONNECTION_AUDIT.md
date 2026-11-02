# Admin API Connection Audit

Audit date: 2026-11-01. Backend base origin is `EXPO_PUBLIC_API_URL`; Android emulator fallback in `App.js` is `http://10.0.2.2:4000`. `.env.example` documents a LAN IPv4 origin for a physical phone and HTTPS for production. No device was connected, so phone-to-PC reachability is NOT TESTED.

## Android Admin page → endpoint map

All protected routes mount under `/api/v1/admin` (except auth refresh/logout). Client adds `Authorization: Bearer <access token>` on authenticated calls. Backend returns JSON envelopes and frontend normalizes list fields.

| Page/action | Method and endpoint | Backend route/source | Status |
|---|---|---|---|
| Login | POST `/api/v1/admin/auth/login` | `adminAuthRouter.post('/login')`, `server/src/modules/admin/routes.ts` | Route exists; login NOT TESTED with account |
| Session/me | GET `/api/v1/admin/me` | Admin routes | Authenticated session NOT TESTED |
| Session refresh | POST `/api/v1/auth/refresh` | `server/src/modules/auth/routes.ts` | Route exists; refreshed-section regression fixed; live token refresh NOT TESTED |
| Logout | POST `/api/v1/auth/logout` | Auth routes | Route exists; actual logout NOT TESTED |
| Overview | GET `/api/v1/admin/overview` | Admin routes, PostgreSQL/Prisma aggregates and SQL charts | No-token request returned 401; signed-in response NOT TESTED |
| Users | GET `/api/v1/admin/users` | Admin routes, paginated/filter query | No-token request returned 401 |
| User details | GET `/api/v1/admin/users/:id` | Admin routes | Exists but Android list-detail action does not call it |
| Suspend/reactivate | POST `/api/v1/admin/users/:id/status` | Admin routes, audited transaction | Frontend/backend contract exists; mutation NOT TESTED |
| Deposits | GET `/api/v1/admin/deposits` | Admin routes, page/status/search | No-token request returned 401; signed-in pagination NOT TESTED |
| Withdrawals | GET `/api/v1/admin/withdrawals` | Admin routes; explicit payoutIntegration unavailable | Route exists; actual payout unavailable |
| Transactions | GET `/api/v1/admin/transactions` | Admin routes, union of deposit/withdrawal/P2P order data | Route exists; signed-in read NOT TESTED |
| Wallet ledger | GET `/api/v1/admin/wallets/ledger` | Admin routes | Route exists; no direct balance mutation endpoint found |
| P2P offers/orders | GET `/api/v1/admin/p2p/offers`, `/orders` | `server/src/modules/p2p/routes.ts` (mounted under `/api/v1`) | Both protected with requireAuth + requireAdmin; signed-in read NOT TESTED |
| P2P overview/claims | GET `/api/v1/admin/p2p/overview`, `/claims`, `/claims/:id` | Admin and P2P routes | Role-gated; signed-in read NOT TESTED |
| P2P evidence/review | GET `/api/v1/admin/p2p/claims/:id/evidence`; POST `/claims/:id/review` | P2P routes, finance verification/ledger transaction | Contract exists; financial mutation not executed |
| Admin alerts/devices | GET `/api/v1/admin/push-events`; POST/DELETE `/admin/push-devices` | Admin routes + outbox module | Routes exist; phone push delivery blocked |
| Providers | GET `/api/v1/admin/providers` | Admin routes + payment availability service | Live `/api/v1/config` confirms no active provider; admin endpoint requires session |
| Commissions | GET `/api/v1/admin/commissions` | Admin routes | Exists, signed-in read NOT TESTED |
| Referrals | GET `/api/v1/admin/referrals` | Admin routes | Exists, signed-in read NOT TESTED |
| Referral configuration | GET/PATCH `/api/v1/admin/referrals/config`; PATCH `/milestones/:key` | Admin routes, audited config update | Roles/reason validated; mutation NOT TESTED |
| Reward rules | GET `/api/v1/admin/reward-rules`; PATCH `/reward-rules/:id` | Admin routes, audited config | Exists; config is not payout; mutation NOT TESTED |
| Announcements | GET/POST `/api/v1/admin/notifications` | Admin routes, in-app notifications | Exists; no push/SMS campaign; send NOT TESTED |
| CSV reports | Composite GET transactions/deposits/withdrawals/commissions | Existing list routes, 100 rows per category | Routes exist; device share action NOT TESTED |
| Disputes | GET `/api/v1/admin/disputes` | Admin routes, view-only | No resolution mutation route found |
| Support | GET tickets/details; POST reply; PATCH status | Admin routes | Routes exist; writes require reason/audit; not executed |
| Reconciliation | GET claims; GET evidence; POST review | Payment/admin routes | Exists; no real review action executed |
| Admin roles | GET `/api/v1/admin/admins` | Admin routes | Read-only; role mutation unavailable |
| Audit logs | GET `/api/v1/admin/audit-logs` | Admin routes | Exists, role-gated |
| System health | GET `/api/v1/admin/system-health` | Admin routes | **UI rendering bug fixed**; route itself reports API/DB/payments/worker state |

## Request/response checks

- `request()` sends JSON `Accept`, conditional `Content-Type`, and Bearer authorization; no access token is printed.
- Non-2xx responses use `error.message`; network errors produce a connection guidance message.
- Successful response must be a JSON object (`ensureApiObject`); invalid/empty JSON is an explicit error.
- Lists normalize to arrays before `.length`/`.map` usage; covered by 3 passing unit tests.
- Server uses Zod validation and consistent `{error:{code,message}}` errors; `app.ts` error handler handles validation, HTTP, payload size, JSON parse, duplicate conflicts.
- **Remaining:** no explicit fetch timeout/retry policy. Search is manual (button/keyboard), not debounced. Most sections request page 1/pageSize 50 but Admin Android has next-page controls only for deposits; reports are fixed to first 100 rows.
- `.env` was not printed or copied into the report. The source environment example shows emulator/LAN/HTTPS forms.

## Runtime checks

- `GET http://localhost:4000/ready` returned HTTP 200 with database `ready`.
- No-token GET `/admin/overview`, `/admin/users`, `/admin/deposits`, `/admin/system-health`, and `/admin/p2p/orders` returned HTTP 401 `AUTH_REQUIRED`.
- Authenticated admin API payload compatibility, CORS from the Admin app, user-role 403 responses and full screen actions are NOT TESTED because no device/session was used.
