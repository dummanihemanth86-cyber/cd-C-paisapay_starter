# PaisaPay workflow and implementation status

This document describes the checked source tree as of 17 October 2026. The current backend is a development foundation, not a production payment system.

## Findings for the reported problems

- The UPI wallet screen in `mobile/App.js` always rendered `Unavailable`, regardless of the API response. The backend's public config also contained static method rules instead of reporting operational availability.
- The PostgreSQL payment-method rows are disabled and unapproved. `PAYMENT_PROVIDER=disabled` is set in `server/.env`. There is no payment adapter in this source tree. These are the correct reasons real UPI payments cannot be offered today.
- The newly requested ₹99 bonus now runs only as a development/test promotion. A new account created while it is enabled becomes eligible; a transaction after successful OTP verification debits the finite test reward pool and credits the user's available account exactly once. Existing users default to ineligible. Repeated logins and parallel attempts cannot create a second award.
- The additive migration `20261017090000_welcome_bonus_eligibility` has been applied to the configured local PostgreSQL database. `npm run db:seed` created the clearly labelled non-redeemable local test pool. It is not real money and must never be used as production funding.

## Workflow map

| Workflow | API / source | Database | Current status |
| --- | --- | --- | --- |
| App launch | Expo entry `mobile/App.js`; API client `mobile/src/api.js` | SecureStore session | Splash waits briefly, restores a stored session, and loads private data. It does **not** call `/health` on launch. A failed session refresh clears the session. |
| Backend health | `GET /health`, `GET /ready` in `server/src/app.ts` | `/ready` runs `SELECT 1` | Implemented. Health reports process status; readiness checks PostgreSQL. |
| Mobile API address | `mobile/src/api.js`, `mobile/.env` | — | Expo public URL currently targets the PC's LAN address on port 4000. Production builds require HTTPS. |
| OTP request | `POST /api/v1/auth/request-otp`; `server/src/modules/auth/routes.ts` | `otp_challenges` | Implemented. Current local setting uses demo OTP `123456`, stores an HMAC hash and five-minute expiry, and sends no SMS. The Android gateway adapter is available for trusted-LAN development when selected and configured. |
| OTP status | `GET /api/v1/auth/otp-status/:challengeId` | `otp_challenges` | Implemented. Demo challenges report `NOT_SENT`; gateway status comes from the gateway. |
| OTP verification/session | `POST /api/v1/auth/verify-otp`; `server/src/modules/auth/routes.ts` | `otp_challenges`, `users`, `sessions`, `ledger_accounts`, ledger tables | Implemented for development. A valid one-time OTP upserts a user, creates INR ledger accounts, attempts the configured one-time welcome grant in the same database transaction, and creates a server session. Concurrent challenge use is locked; bonus eligibility and a unique ledger idempotency key prevent duplicate grants. |
| Profile | `GET/PATCH /api/v1/users/me`; `server/src/modules/users/routes.ts` | `users`, `referrals` | Implemented. Profile completion and optional referral assignment are server-side. Referral rewards are not implemented. |
| Balance | `GET /api/v1/users/me/balance`; `server/src/modules/users/routes.ts` | `ledger_accounts`, `ledger_entries` | Implemented as a sum of integer-paise ledger entries. When the development test promotion is enabled, a recorded test ledger credit contributes to the server-derived balance. |
| Welcome bonus | OTP verification; `server/src/modules/users/welcomeBonus.ts` | `users.welcome_bonus_eligible`, `ledger_accounts`, `ledger_transactions`, `ledger_entries` | Implemented for development only. New accounts may receive 9,900 paise once after OTP verification, funded from a finite seeded test pool. `WELCOME_BONUS` is recorded with a balanced debit/credit and idempotency key, and appears in transaction history and the mobile Bills & transactions list. Existing users default ineligible. Production configuration rejects enabling the bonus until funding and terms are approved. |
| UPI availability | `GET /api/v1/config` (public), `GET /api/v1/wallet-methods` (authenticated); `server/src/modules/payments/availability.ts` | `payment_method_configurations` | Implemented as a fail-closed status calculation. A method is available only when its DB row is enabled and approved, provider credentials are configured, and an adapter is operational. No adapter exists, so all methods correctly remain unavailable. |
| Wallet reference | `POST/GET /api/v1/wallet-references`; `server/src/modules/payments/routes.ts` | `wallet_accounts` | Saves a UPI identifier as a reference only. It does not connect the payment app or read its transaction history. |
| Deposit | `POST/GET /api/v1/deposits`; `server/src/modules/payments/routes.ts` | `deposits`, idempotency key | Read history is implemented. New deposit creation now returns 503 unless the selected method is truly available; with no operational adapter, it creates no misleading pending order and makes no ledger credit. |
| Payment verification | `POST /api/v1/webhooks/payments/:provider`; `server/src/modules/payments/routes.ts` | `payment_provider_events`, `deposits`, ledger tables exist | Disabled. The endpoint returns 503 and never trusts client claims or callbacks. There is no selected provider API or valid merchant setup to mock as a real integration. |
| Orders | `GET/POST /api/v1/orders`, reservation and cancellation routes; `server/src/modules/orders/routes.ts` | `orders`, `order_status_history`, `idempotency_keys`, `payment_method_configurations` | Existing order lifecycle and reservation logic are present. Listings and new Sell orders now require an available payment method. With no adapter, payment orders remain unavailable. Payment evidence cannot settle an order. |
| Withdrawal | `GET/POST /api/v1/withdrawals`; `server/src/modules/support/routes.ts` | `withdrawals`, ledger tables | Listing is implemented. Creation validates available balance and returns 503 because no payout provider or authorized review workflow exists; no withdrawal is created or completed. |
| Transaction history | `GET /api/v1/users/me/transactions`; `server/src/modules/users/routes.ts` | `ledger_transactions`, `ledger_entries` | Returns the authenticated user's ledger entries. Deposits and withdrawals are shown separately by their history endpoints. |
| Support/notifications | `/api/v1/support/tickets`, `/api/v1/notifications`; `server/src/modules/support/routes.ts` | `support_tickets`, `support_messages`, `notifications` | User-owned ticket creation/list/read and notification listing are implemented. |
| Admin | `GET /api/v1/admin/overview` in `server/src/app.ts`; React app in `admin/src/main.jsx` | `admin_users`, `audit_logs`, related tables | Backend has only a protected overview endpoint. The existing React dashboard is a read-only demo wired to the legacy port-3000 in-memory API; it has no real admin authentication or management actions. It is not a production admin panel. |
| Database/migrations | `server/prisma/schema.prisma`, `server/prisma/migrations/` | PostgreSQL | Initial schema, OTP status migration, and welcome bonus eligibility migration exist. `npm run db:seed` always writes disabled/unapproved payment methods; with the development promotion enabled it also creates a labelled test pool. |
| Backend startup | `server/package.json`; wrapper `backend/package.json` | — | `cd C:\paisapay_starter\server; npm start` builds and runs port 4000. Or `cd C:\paisapay_starter\backend; npm start` delegates to the TypeScript server. `backend\server.js` is a separate legacy demo server on port 3000 (`npm run demo:start`), not the mobile API. |
| Mobile startup | `mobile/package.json` | — | Expo SDK 54 / React Native 0.81 / JavaScript. Run `cd C:\paisapay_starter\mobile; npm start`, then scan with Expo Go on the same Wi-Fi. |

## Payment availability rules

The four method rows currently have `enabled=false` and `providerApproved=false`. Their buy/sell eligibility is only a PaisaPay rule, not a provider approval. In particular, MobiKwik/Paytm buy-and-sell and PhonePe/Navi sell-only permissions do not make their payment rails live.

To enable any real route, first select a provider, obtain its merchant approval and credentials, implement its documented initiation and authenticated status/webhook verification, reconcile provider events idempotently, and validate the operational health. Until then `available` stays false and the mobile app explains why.

## Bonus policy

The local `server/.env` currently enables a development-only ₹99 test promotion. `.env.example` keeps it disabled. The seed pool is explicitly marked non-redeemable test accounting, and the server refuses to enable this promotion in production. Before any real-user offer, define and approve eligibility and terms and provide genuine promotional funding; changing an environment flag is not enough.

## Restart and verification

```powershell
cd C:\paisapay_starter\server
npm run db:deploy
npm run db:seed
npm run typecheck
npm test
npm start
```

Keep the backend running in one terminal. In another terminal, start Expo with `cd C:\paisapay_starter\mobile; npm start`. `EADDRINUSE` on port 4000 means another API already owns the port; do not start a second copy. Check `http://localhost:4000/health`, `http://localhost:4000/ready`, and `http://localhost:4000/api/v1/config`. The config should report `livePaymentsEnabled: false` until a real approved adapter is operational.

To verify the local test promotion, create a new phone account in demo mode with OTP `123456`, then inspect `GET /api/v1/users/me/balance` and `GET /api/v1/users/me/transactions`. The new account should show `availablePaise: 9900` and one `WELCOME_BONUS` credit. Log out and sign in again: balance stays 9900 and history still contains exactly one welcome entry. Existing accounts remain ineligible. Automated PostgreSQL integration tests cover first login, repeat login/logout, ineligible users, duplicate verification, and simultaneous logins.
