# PaisaPay

PaisaPay is an INR-only Expo app connected to a TypeScript/Express API backed by PostgreSQL and Prisma. In this machine's current `server/.env`, `OTP_PROVIDER=renflair-v1`; Android SMS Gateway settings are present but are not selected. No real OTP delivery test has been confirmed. Verified payment automation, payouts, and production financial operations are not available. Production SMS and financial features need approved providers and operational controls.

## Project folders

- `mobile/` — Expo Go React Native app. It calls the API for sign-in, profile, balance, deposits, wallet references, orders, withdrawals, ledger history, and support tickets.
- `server/` — TypeScript/Express API, Prisma schema, initial SQL migration, seed script, and tests.
- `admin/` — live manual-payment reconciliation console. It uses PaisaPay password login and backend Finance/Admin role checks; do not expose it publicly without HTTPS and access controls.
- `backend/` — original demo backend and schema kept for reference. Use `server/` for the new API.
- `docs/` — API reference, implementation plan, and testing checklist.

## Run the backend

Use Node 22.18 or newer. Install and configure PostgreSQL, then follow [the backend setup guide](server/README.md). The short command sequence is:

```powershell
cd C:\paisapay_starter\server
npm ci
npm run db:generate
cd ..\backend
npm start
```

The backend always uses port 4000 by default. Configure `server/.env` and apply the database migration by following [the backend setup guide](server/README.md). Check `http://localhost:4000/health`, `http://localhost:4000/ready`, and `http://localhost:4000/api/v1/docs`. Health can be green without a database; readiness correctly returns 503 until PostgreSQL connects. The old demo server is only available with `npm run demo:start` from `backend/` and is not used by the app.

## Run in Expo Go

1. In `mobile/.env`, set `EXPO_PUBLIC_API_URL` to your computer's LAN IPv4 address, for example `http://192.168.1.20:4000`. Replace the sample IP with your actual address.
2. Keep the phone and computer on the same Wi-Fi network. A phone's `localhost` is the phone itself. If needed, allow TCP port 4000 through the computer firewall.
3. In another PowerShell window:

```powershell
cd C:\paisapay_starter\mobile
npm ci
npx expo start --lan
```

4. Scan the QR code from Expo Go. OTP requests use the server-side provider selected by `OTP_PROVIDER` (`renflair-v1` in the current local setup). The Android gateway is used only after selecting `android-gateway` in `server/.env`; credentials stay on the backend. Provider acceptance or an OTP status response is not proof of handset delivery. OTP challenges and sessions require PostgreSQL.

For production, set the app API URL to a deployed HTTPS service. Never ship a local IP or secrets in the app bundle.

## Checks

From `server/`, run `npm run typecheck`, `npm run build`, and `npm test`. `npm run db:generate` does not require database credentials. Migration and seed commands need a real PostgreSQL login.

## Not ready for a real-money launch

No automatic MobiKwik integration, production payment/payout provider, verified MobiKwik webhook, or admin-role provisioning flow is included. Manual reconciliation is available to an already-authorized Finance/Admin user, but it requires independent review of merchant records. Deposits stay pending until verified, withdrawals remain unavailable, and order payment confirmation cannot succeed automatically. Review [the API reference](docs/API.md) and [the backend setup and limits](server/README.md) before connecting external services.

## UPI setup and manual payment review

The authenticated app can save or remove a UPI ID at `/api/v1/users/me/upi`. The API checks only its format and always labels it unverified; it does not prove ownership or enable collections. With no approved MobiKwik payment API, creating a MobiKwik deposit creates only a `PENDING_PAYMENT` request and starts no payment. A user may submit a transaction reference for review, but the reference is an unverified claim. An existing Finance/Admin account can review it in `admin/` and credit the ledger only after independently confirming the exact transaction, INR amount, and merchant receipt. This manual workflow is audited and idempotent; it does not provide automatic MobiKwik verification or merchant payment instructions.

Run the reconciliation console locally in another terminal:

```powershell
cd C:\paisapay_starter\admin
npm install
npm run dev
```

Only a user already present in the backend `admin_users` table with Finance/Admin/Super Admin role can review claims. This project does not provide a public admin-role provisioning endpoint.

The original `/v1` versus `/api/v1` route mismatch and remaining setup checklist are documented in [the project inspection](docs/INSPECTION.md).

Production deployment preparation: see [docs/PRODUCTION_DEPLOYMENT.md](docs/PRODUCTION_DEPLOYMENT.md).
