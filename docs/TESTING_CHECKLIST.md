# PaisaPay testing checklist

## Checks already run in this workspace

- [x] Prisma client generation without a database connection.
- [x] TypeScript type check and production compilation.
- [x] Ten API tests for health, readiness, config, docs, root, JSON 404, auth guard, invalid OTP payload, and unavailable payment webhook.
- [x] API process started with `npm start`; live HTTP checks returned the expected responses.
- [x] Expo SDK dependency compatibility check and Android JavaScript bundle export.
- [x] Server production dependency audit reported no known vulnerabilities.
- [ ] PostgreSQL migration and seed: blocked because no `DATABASE_URL` or database credentials are configured.
- [ ] Database-backed OTP/login, profile, orders, wallet references, and support integration: blocked until PostgreSQL is configured.
- [ ] Real SMS, payment, payout, reconciliation and production legal/security checks: not implemented or approved.
- [ ] Mobile npm audit: reports 35 transitive Expo/React Native toolchain advisories. `npm audit fix --force` proposes an incompatible Expo major downgrade, so it was not applied.

## Local PostgreSQL and Expo Go walkthrough

- [ ] Create a PostgreSQL login and database, set `server/.env`, run `npm run db:migrate`, and confirm `/ready` returns 200.
- [ ] Start the API and confirm `/health`, `/ready`, `/api/v1/config`, and `/api/v1/docs`.
- [ ] Set `mobile/.env` to the computer's LAN IPv4 address, start Expo with `npx expo start --lan`, and scan with Expo Go on the same Wi-Fi.
- [ ] On a trusted LAN, request a test OTP to your own phone. Confirm the response says `ACCEPTED`/`PENDING`, then check status for `SENT` or `DELIVERED` before treating it as delivered. Verify wrong, expired, throttled, and valid codes.
- [ ] Complete a profile, restart the app, confirm secure session restoration, refresh, and logout revocation.
- [ ] Confirm balances and transaction history come from the PostgreSQL ledger and do not show fabricated entries.
- [ ] Create a pending deposit request; verify the ledger remains unchanged and no payment is claimed.
- [ ] Confirm order listings remain unavailable unless an approved provider configuration is enabled; test reservation concurrency only after DB-backed test setup.
- [ ] Confirm wallet references are labelled not connected; no payment-app password or OTP is requested.
- [ ] Confirm withdrawal attempts never appear completed without an authorized payout confirmation.
- [ ] Create a support ticket and verify it is visible only to its owner.

## Before any production release

- [ ] Implement and approve the SMS, payment, and payout provider adapters; validate signatures and transaction status server-side.
- [ ] Add ledger posting with balanced entries, database-level invariants, locking, idempotency, reversals, and reconciliation tests.
- [ ] Implement complete admin RBAC, admin provisioning, audited actions, two-person approval for high-risk actions, and private deployment.
- [ ] Add database-backed unit/integration tests for authentication, payment duplication, concurrency, funds, withdrawals, referrals, and admin authorization.
- [ ] Complete security review, provider approvals, legal/compliance review, privacy policy, monitoring, backup, and incident response.
- [ ] Build a signed APK using the production HTTPS API, test it on supported devices, host it on the official site, and verify release signatures.
