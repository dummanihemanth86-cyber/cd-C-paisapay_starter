# Admin Backend and Database Audit

Audit date: 2026-11-01.

## Architecture and routing

- `server/src/server.ts` starts `server/src/app.ts`, schedules P2P/deposit expiry and Admin push outbox batches every 5 seconds.
- `server/src/app.ts` applies Helmet, CORS, JSON size limit, request IDs, redacted authorization logging and an API route allow-list; then mounts auth, user, payment, P2P, order, withdrawal, notification, support and admin routers.
- Admin auth is mounted at `/api/v1/admin/auth`; the authenticated router is mounted at `/api/v1/admin` and runs `requireAuth` then `requireAdmin`.
- Primary DB client is Prisma/PostgreSQL in `server/src/lib/db.ts`.
- `backend` is a compatibility wrapper for the primary `server`, with a separate demo JS server. The root has no package.json.

## Database model inventory (relevant)

`server/prisma/schema.prisma` defines: `User`, `OtpChallenge`, `Session`, `AdminUser`, `LedgerAccount`, `LedgerTransaction`, `LedgerEntry`, `WalletAccount`, `Deposit`, `ManualPaymentClaim`, `PaymentProviderEvent`, `Order`, `OrderStatusHistory`, `Withdrawal`, `P2pWithdrawalOffer`, `P2pDepositOrder`, `P2pPaymentClaim`, `BankAccount`, `Referral`, `CommissionEntry`, `ReferralProgramConfig`, `ReferralMilestoneRule`, `RewardRule`, `SupportTicket`, `SupportMessage`, `Notification`, `AdminPushDevice`, `AdminPushEvent`, `AdminPushDelivery`, `AuditLog`, `IdempotencyKey`, `ReconciliationRecord`, `VipLevel`, `PaymentMethodConfiguration` plus enums.

Admin push tables include unique Expo token/event key and delivery uniqueness/state fields; proof claims include unique transaction references and evidence bytes/MIME type. Financial values use `BigInt` paise in Prisma models; some API DTOs convert to JavaScript numbers for display, so clients must not use them to perform authoritative calculations.

## Migration status

- 25 Prisma migrations discovered under `server/prisma/migrations`.
- `npx prisma migrate status` connected to local PostgreSQL database `paisapay`, schema `public`, and reported **Database schema is up to date!**
- `GET /ready` returned `{ok:true, dependencies.database:'ready'}`.
- No migration was applied by this audit.

## Admin route/service trace

Admin reports, dashboards, users, deposits, withdrawals, transactions, ledger, referrals, commissions, providers, audit, health, support, notifications and rewards are implemented in `server/src/modules/admin/routes.ts`. P2P offer/order/claim/evidence/review behavior is in `server/src/modules/p2p/routes.ts` and `server/src/modules/p2p/service.ts`. Regular deposit reconciliation is in `server/src/modules/payments/routes.ts` and manual review/evidence services. Auth is in `server/src/modules/auth/routes.ts` and `server/src/middleware/auth.ts`.

Implementation verified by static trace and backend test suite. The report does not assert a live signed-in screen-to-row database read because no admin session was used.

## Backend issues and disposition

1. **Fixed in Android UI:** refresh retry path did not preserve specialized P2P/reports fetches. Retry now executes the same composite loader with the rotated token.
2. **Fixed in Android UI:** live System Health payload was fetched but not rendered.
3. **Open, Medium:** no explicit timeout in Android `request()`; a stalled fetch may leave the shared busy indicator active.
4. **Open, Medium:** admin user details endpoint exists, but Android row tap opens the selected list row rather than fetching `/users/:id`.
5. **Open, Medium:** all Admin list screens except deposits lack page navigation. UI requests 50 rows for most categories.
6. **Backend limitation:** disputes and admin records are read-only in current Admin APIs; KYC, Admin role mutation, provider payouts and joke management have no complete backend workflows.

No SQL raw admin query was changed. No database schema/data was modified.
