# PaisaPay build plan and current status

## Current demo foundation

- Expo React Native app with a login preview and five-tab navigation.
- Demo screens for Home, deposits, payment references, Buy/Sell listings and sample Sell order creation, reservations, profile, history, withdrawals, team, referrals, VIP, tasks, support, security, and version center.
- Express demo API for configuration, demo balances, listings, demo reservations, deposit/withdrawal requests, payment references, support tickets, and activity.
- React admin dashboard showing demo configuration, listings, requests, and activity.
- PostgreSQL schema starter with paise amounts, core entities, ledger tables, unique references, and idempotency record design.

Data displayed in the app/API is demo data. The mobile app tries the configured API and uses sample-only local behavior for some interactions when the API is unavailable. The Express API stores data in memory, so records are lost when it restarts. The PostgreSQL schema is not connected to the API.

## Remaining phases

1. **Foundation hardening:** decide account and product requirements, use migrations, connect PostgreSQL, and add structured logging and configuration validation.
2. **Authentication:** integrate an approved mobile OTP provider, secure session tokens, recovery, rate limits, revocation, and device management.
3. **Financial ledger:** create server-only posting functions and DB transactions with locking and balanced-entry checks. Reconcile every funded credit and reversal.
4. **Admin:** build authenticated React routes and role-based server endpoints. Audit sensitive actions and protect the dashboard behind appropriate access controls.
5. **Payment and payouts:** verify that the business model is permitted; secure provider approvals; use signed callbacks or authenticated status checks; implement idempotency and reconciliation. No personal UPI scraping or screenshot/UTR-only payment approvals.
6. **Mobile production APIs:** replace local demo fallbacks, use real backend values for all financial data, and add accessible loading, error, offline, and session states.
7. **Security and release:** privacy/compliance review, abuse cases, device testing, monitoring, backups, signed APK release, HTTPS hosting, and signature-checked updates.

## Not implemented

The project does not yet provide real authentication, PostgreSQL-backed APIs, a production ledger, payment initiation or verification, payouts, real wallet connections, funded rewards, authenticated admin controls, or a production APK. Nothing in the demo should be used to accept or move money.
