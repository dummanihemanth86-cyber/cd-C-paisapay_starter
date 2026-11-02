# PaisaPay Admin Page Inventory

Audit date: 2026-11-01  
Workspace: `C:\paisapay_starter`  
Primary Android admin source: `apps/admin-app/App.js` (single 379-line screen/controller module)

## Project architecture discovered (Phase 1)

```text
C:\paisapay_starter\
├── apps\admin-app\       Expo/React Native Android Admin App
├── admin\                Vite browser admin UI (separate from Android app)
├── mobile\               Expo public/customer app
├── server\               Primary TypeScript/Express API + Prisma/PostgreSQL
├── backend\              Legacy wrapper; scripts delegate to ../server,
│                         except demo:start -> backend/server.js
├── docs\                 Project documentation
├── backup\               Existing backup materials
└── _inspect_mobikwik_status_starter\  Existing inspection material
```

The active server start/build/test/database scripts are in `server/package.json`. The root has no package.json. `backend/package.json` forwards dev/build/typecheck/test/start commands to `server` but retains a separate demo server command. Avoid starting `backend demo:start` when the primary server already owns port 4000.

### Admin Android files

| Path | Role |
|---|---|
| `apps/admin-app/App.js` | Login/session, API client, navigation, 20 sections, forms/modals, inline components/styles |
| `apps/admin-app/responseHelpers.cjs` | API object/list normalization |
| `apps/admin-app/tests/responseHelpers.test.cjs` | Three helper regression tests |
| `apps/admin-app/app.json`, `app.config.js` | Expo app identity/runtime config and EAS project ID overlay |
| `apps/admin-app/eas.json` | Build profiles |
| `apps/admin-app/package.json`, `package-lock.json` | Scripts and dependencies |
| `apps/admin-app/.env.example` | Public API origin/EAS project ID examples; no secrets expected |
| `apps/admin-app/PUSH_NOTIFICATIONS.md`, `README.md` | Build/use notes |
| `apps/admin-app/assets/paisapay-admin-icon.png` | App icon asset |
| `apps/admin-app/android/**` | Generated/native Android project, manifest, Gradle config and resources |

No screen, navigation, API, hook, context, or component directories exist in the Android Admin source. Generated `.expo*`, `dist`, Gradle `.cxx`, node_modules, binaries and lockfile internals are not hand-audited as application logic; source/config files are inventoried above.

### Additional admin/public/backend sources

- Browser admin: `admin/src/main.jsx`, `admin/src/style.css`, `admin/src/live-reconciliation.css`, `admin/vite.config.js`.
- Public mobile app: `mobile/App.js`, `mobile/src/**`.
- Primary backend: `server/src/app.ts`, `server/src/server.ts`, `server/src/modules/**`, `server/src/middleware/auth.ts`, `server/src/lib/**`, `server/src/integrations/**`.
- Database: `server/prisma/schema.prisma`, 25 migrations under `server/prisma/migrations/**`.

## Android Admin page/section inventory

Every section is selected by `section` state and rendered conditionally in `apps/admin-app/App.js`; visibility is controlled by server-provided `profile.allowedSections`.

| Key / visible title | API/data route | Implemented actions | Verification |
|---|---|---|---|
| `overview` / Dashboard | `GET /api/v1/admin/overview` | KPI cards navigate to records; daily/weekly/monthly chart selector; pull-to-refresh | Route and DB queries exist. Live read requires admin session. NOT TESTED with signed-in account. |
| `users` / Users | `GET /api/v1/admin/users`; details endpoint exists | Search/status filter, record details modal, suspend/reactivate with reason | Backend read/status action exist; user detail screen currently uses list record, does not fetch `/users/:id`. Admin action NOT TESTED. |
| `deposits` / Deposits | `GET /api/v1/admin/deposits` | Search/status filter, details modal, paginated load-more | Route exists; pagination only wired for this section. NOT TESTED signed in. |
| `withdrawals` / Withdrawals | `GET /api/v1/admin/withdrawals` | Search/status filter, record details | View-only; no payout action by design because provider unavailable. NOT TESTED signed in. |
| `p2p` / Quick Deposit / P2P | `GET /api/v1/admin/p2p/offers`, `/orders`, `/overview`, `/claims`; claim detail/evidence/review | 4-second polling, proof details, accept/reject with reason and evidence/recipient confirmations | Backend routes and review service exist. Actual trusted settlement not run. |
| `alerts` / Admin Alerts | `GET /api/v1/admin/push-events` | Durable alert list; tap opens current claim via authenticated API | Route exists. Push/device delivery not tested on device. |
| `transactions` / Transactions | `GET /api/v1/admin/transactions` | Search/status filter, details modal | Read-only route; signed-in read NOT TESTED. |
| `ledger` / Wallet Ledger | `GET /api/v1/admin/wallets/ledger` | Search/status filter, details modal | Read-only; no balance edit endpoint. NOT TESTED signed in. |
| `providers` / Payment Providers | `GET /api/v1/admin/providers` | View method/config availability | Backend reports actual availability; local public config reports provider methods disabled. |
| `commissions` / Commissions | `GET /api/v1/admin/commissions` | Paginated list/details | Read-only. NOT TESTED signed in. |
| `referrals` / Referral & Team | `GET /api/v1/admin/referrals` | Relationship/earnings view | Backend exists; signed-in read NOT TESTED. |
| `rewardRules` / Reward Rules | `GET /api/v1/admin/reward-rules`, `PATCH /:id` | Configure eligibility amount/rule with reason; no reward payout | Config-only API; requires authorized role. NOT TESTED mutation. |
| `notifications` / Announcements | `GET/POST /api/v1/admin/notifications` | Target active users or IDs; confirmation and reason for all-active send | Backend persists in-app notices, not broadcast push/SMS. Send not tested. |
| `reports` / CSV Reports | Composite reads of transactions/deposits/withdrawals/commissions | Export first 100 rows of each to Android share sheet; formula escaping and sensitive-key filtering | Backend routes exist; export not device-tested. PDF unavailable. |
| `disputes` / Disputes | `GET /api/v1/admin/disputes` | View-only details | No resolve/reject action endpoint in this admin module. NOT TESTED signed in. |
| `support` / Support | `GET /api/v1/admin/support/tickets`, details, reply, status | Open ticket, reply with reason, update status with reason | Backend routes exist; actions not tested against records. |
| `reconciliation` / Reconciliation | `GET /api/v1/admin/reconciliation/claims`; detail/evidence/review APIs | Finance manual claim review/accept/reject with evidence reference | Backend review exists; no real financial approval executed. |
| `admins` / Admin Roles | `GET /api/v1/admin/admins` | View administrators/roles | Admin role mutation is unavailable; read NOT TESTED signed in. |
| `audit` / Audit Logs | `GET /api/v1/admin/audit-logs` | Search/view audit rows | Read-only, restricted role. NOT TESTED signed in. |
| `health` / System Health | `GET /api/v1/admin/system-health` | Live API/DB/provider/worker status | **Fixed in this audit:** the page now renders the live response and separately labels unsupported integrations. Signed-in UI not manually exercised. |

## Missing pages/capabilities found

KYC review, Bird Assistant/joke management, provider payouts, dispute resolution, admin-role changes, PDF reports, admin forgot-password/MFA, and full admin profile/change-password workflows are not implemented in the Android app/backend API. They are not marked as active controls or simulated. See `ADMIN_FINAL_AUDIT.md`.
