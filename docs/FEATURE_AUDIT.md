# PaisaPay feature audit

Inspected the current workspace and completed the first requested implementation phase. The mobile project is Expo/React Native JavaScript, not Flutter. The TypeScript/Express API in `server/` on port 4000 is the mobile backend. `backend/server.js` is a separate in-memory demo API on port 3000, and the existing React admin panel talks to that legacy demo API.

## Feature status

| Feature | Status | Source findings |
| --- | --- | --- |
| Phone OTP login and registration | PARTIAL | `server/src/modules/auth/routes.ts` creates OTP challenges and sessions. Local OTP is disabled until a rotated NinzaSMS API key and confirmed endpoint/auth mode are configured. Profile completion is separate. |
| Session refresh/logout | IMPLEMENTED | Server-backed token hashes, rotation and revocation exist in auth routes. |
| Profile and referral code | PARTIAL | Profile read/update and self-referral checks exist. No referral reward engine exists. |
| Balance and transaction history | PARTIAL | Balance is derived from integer-paise ledger entries. The `WELCOME_BONUS` posting is now visible through transaction history and the mobile Bills & transactions list. |
| ₹99 welcome bonus | IMPLEMENTED — DEVELOPMENT ONLY | New accounts can receive one 9,900-paise double-entry credit after OTP verification when explicitly enabled and funded by the labelled local test pool. Existing accounts default ineligible; unique user eligibility and ledger idempotency prevent duplicate awards. Production startup rejects enabling this unfinished promotion. |
| UPI/payment-method screen | PARTIAL | API/database models exist, but mobile displayed a hardcoded status. Method configuration is disabled/unapproved, `PAYMENT_PROVIDER=disabled`, and no provider adapter exists. No real payment can safely be enabled yet. |
| Deposit initiation and verification | DISABLED | The API refuses new deposits unless the payment method is operational. No provider initiation or verification exists, so it returns unavailable without creating an order or crediting balance. Payment webhook returns unavailable. |
| Buy/Sell orders | PARTIAL | Order records, reservations, expiry and status history exist. Listings/order creation require enabled+approved configuration; payment settlement is unavailable without an adapter. |
| Commission engine | MISSING | Data models exist for commission entries, but no rules or calculation/posting service exists. |
| Team/referrals | PARTIAL | Referral code, attribution and member list exist. Qualifying reward logic is missing. |
| VIP 1–10 | MISSING | Model exists, but no configured levels or backend progress calculation exists. |
| Daily tasks/rewards | MISSING | Reward-rule storage exists; no task progress or claim API exists. |
| Share and earn | PARTIAL | Referral code can be shared; no public link or funded reward tracking exists. |
| Bills | MISSING | No biller/payment provider integration or bill API exists. |
| Withdrawals | DISABLED | Listing and balance checks exist; creation correctly returns unavailable without a payout provider. No payout is sent or marked complete. |
| Notifications/support | PARTIAL | User notification listing and support ticket create/read exist. Transaction/order event delivery and admin responses are incomplete. |
| Admin panel | DISABLED/PARTIAL | React page is read-only demo UI backed by the legacy port-3000 API. The TypeScript API has only a protected overview endpoint; management APIs, role provisioning, and audit workflows are missing. |
| PostgreSQL/schema/migrations | IMPLEMENTED/PARTIAL | Prisma schema and migrations exist. Phase 1 adds `users.welcome_bonus_eligible` with a false default; the additive migration has been applied to the configured local database. |

## Phase 1 scope

This change implements the explicitly requested one-time ₹99 development bonus in the backend ledger, adds concurrency/idempotency coverage, and ensures repeated login cannot credit it again. The promotion is disabled by default in `.env.example` and rejected in production. The local `.env` enables a finite, clearly labelled, non-redeemable test pool created by the development seed. It is test accounting data, not cash or a production reward fund.

Real provider integrations, commissions, payouts, bill payments, reward campaigns, VIP rules, and a secured admin console remain later phases and require the business rules, provider approvals, credentials, and operational controls described in the master prompt.
