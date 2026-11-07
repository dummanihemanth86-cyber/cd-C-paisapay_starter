# PaisaPay API (development foundation)

This is the TypeScript/Express backend. It stores account and order records in PostgreSQL through Prisma. It never stores payment-app passwords or OTPs, and it never credits deposits or completes payouts without an approved provider confirmation.

## Requirements

- Node.js 22.18 or newer (this workspace uses Node 22.22.2).
- PostgreSQL 15 or newer, running locally or hosted.
- npm.

## Start PostgreSQL and configure the connection

Install PostgreSQL using its Windows installer or the official package for your operating system. During setup, note the database administrator password and port. Create a database and application login from `psql` or pgAdmin. Example SQL, run as a PostgreSQL administrator:

```sql
CREATE ROLE paisapay_app LOGIN PASSWORD 'choose-a-private-password';
CREATE DATABASE paisapay OWNER paisapay_app;
```

Copy `server/.env.example` to `server/.env` and replace the `DATABASE_URL` password with the password you chose. Keep `.env` private and never put it in the mobile app. The URL format is:

```text
postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

The local project currently has a PostgreSQL connection configured and `/ready` reports whether it can reach the database. On another computer, copy the example values and configure your own database credentials; never copy or publish private `.env` values.

## Install, migrate, seed, and run

From PowerShell:

```powershell
cd C:\paisapay_starter\server
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

`db:migrate` applies local database migrations. `db:seed` adds disabled payment-method rows. In the checked-in local `.env`, the development welcome test promotion is enabled, so the seed also creates a finite, clearly marked, non-redeemable test reward pool. This pool is test data, not real money. `.env.example` keeps the bonus disabled. For a deployed server use `npm run db:deploy` instead of `db:migrate`. Production startup rejects an enabled welcome bonus in this build. `npm start` builds the TypeScript API and then starts it on port 4000 by default.

## Account authentication

The mobile app signs in at `POST /api/v1/auth/password/login`. Registration requests a code at `POST /api/v1/auth/register/request-otp` and creates the account only after `POST /api/v1/auth/register/verify-otp` verifies the code. Forgot Password requests its own six-digit, five-minute challenge through the configured server-side SMS provider; the OTP is stored only as a hash, is never returned by the API, expires after five minutes, and is single-use with attempt and resend limits. Unknown phone numbers receive a non-usable decoy challenge so the request response does not reveal account existence. Resetting a password revokes all existing sessions. Passwords are never stored on the phone. Login, registration, and password-reset OTPs use the same provider adapter and security controls.

The additive migration `20261019090000_auth_registration_reset` adds OTP purpose and password login lockout fields. Apply it with `npm run db:deploy` for an existing database or `npm run db:migrate` for local development; it does not reset user data.

Newly registered users receive a server-generated numeric PaisaPay ID (8–10 digits). It is separate from the internal UUID and protected by a database unique constraint. Existing users receive an ID the next time they authenticate; apply migration `20261020100000_numeric_public_user_id` first.

Check these URLs in a browser:

- `http://localhost:4000/health` — process health.
- `http://localhost:4000/ready` — process plus PostgreSQL readiness.
- `http://localhost:4000/api/v1/config` — public INR method rules.
- `http://localhost:4000/api/v1/docs` — Swagger API reference.

Unknown paths return a JSON 404. The API defaults to port 4000 and listens on `0.0.0.0` for local phone testing. For Expo Go on an Android phone, set `EXPO_PUBLIC_API_URL` in `mobile/.env` to `http://YOUR_PC_IPV4:4000`, keep both devices on the same Wi-Fi, and allow that port through the PC firewall. A phone's `localhost` points to the phone itself.

Renflair V1 OTP is supported through a server-only adapter. Keep `OTP_PROVIDER=disabled` until a newly rotated key is configured in `RENFLAIR_API_KEY`; then set `OTP_PROVIDER=renflair-v1` and `RENFLAIR_V1_API_URL=https://sms.renflair.in/V1.php` in `server/.env`. The V1 API key is necessarily included in the provider URL query string per the supplied PHP sample. PaisaPay does not log that URL, but query strings may be retained in provider infrastructure logs. Keep the key out of mobile code and rotate any key previously pasted into chat.

## Android SMS gateway for development OTPs

Set `OTP_PROVIDER=android-gateway`, `SMS_GATEWAY_URL` to the Android phone's current local address, such as `http://192.168.1.50:8080`, and `SMS_GATEWAY_API_KEY` to the key configured in the Android SMS Gateway app. The gateway and backend computer must be able to reach each other on a trusted LAN. Keep the key only in `server/.env`; never add it to `mobile/.env`. The backend posts to `/api/send` with the documented `X-API-Key` header and `phone_number`, `message`, and `request_id` JSON fields. Keep the Android API port off the public internet.

The gateway's immediate `PENDING` response means accepted/queued only. The mobile app can check the status through PaisaPay's `/api/v1/auth/otp-status/:challengeId` endpoint; the backend then reads `PENDING`, `SENT`, `DELIVERED`, `FAILED`, or `UNKNOWN` from the gateway status API. The app never receives the gateway key or calls the gateway directly. OTPs are generated securely, expire after five minutes, and only their HMAC hash is stored in PostgreSQL. OTP values, full phone numbers, and gateway keys are not written to PaisaPay logs.

The API is plain HTTP in the provided gateway project, so this integration is for local development on a trusted network only. Do not use the Android gateway as a public production OTP service. Production use needs an approved SMS provider and applicable Indian sender/template registration. Automated tests mock gateway requests; they do not send a real SMS.

## Renflair V1 OTP

PaisaPay keeps OTP generation, six-digit validation, hashing, expiry, attempt limits, and verification on the backend. It calls `GET https://sms.renflair.in/V1.php` with query parameters `API`, `PHONE` (ten digits without `+91`), and `OTP`, following the supplied V1 PHP sample. The key and OTP are query parameters because that is how the supplied endpoint accepts them; the request URL is never written to PaisaPay logs. Provider-side web server logs may still record query strings, so use a rotated key and confirm the provider's key-handling policy before production.

The supplied sample only calls `json_decode($resp)` and does not define response fields or a delivery-status endpoint. PaisaPay treats an HTTP 2xx response with parseable JSON and no obvious failure field as a provider request acknowledgement only. It cannot confirm SMS delivery to the phone, and `/api/v1/auth/otp-status/:challengeId` reports status as unavailable. Do not interpret this acknowledgement as proof of handset delivery. A timeout or malformed response leaves the challenge unusable; request a new OTP instead of assuming the first SMS was sent.

The key pasted into chat is exposed. Revoke/rotate it with Renflair and place only the replacement in `RENFLAIR_API_KEY` in `server/.env`. Set `OTP_PROVIDER=renflair-v1` only after configuring that key, then restart the backend. Automated tests mock the provider and do not send SMS.

OTP requests are unavailable when `OTP_PROVIDER=disabled`, when the selected provider is not configured, or when PostgreSQL is unavailable. The `console` setting is recognized for local development but currently refuses OTP requests because exposing OTPs in logs or API responses is prohibited; there is no arbitrary/fixed accepted OTP. Login requires PostgreSQL because OTP challenges and sessions are stored there. If console output is needed for development, choose an explicit local-only exception to the no-OTP-logging rule before enabling it.

The fixed-code demo login has been removed from the local configuration and mobile login screen. The legacy deterministic OTP fixture is allowed only when automated tests run; it is rejected in development and production. The app now starts login through the SMS OTP flow only.

For temporary testing of one number, set `OTP_RATE_LIMIT_BYPASS_PHONE=+91...` in `server/.env` using that number in E.164 format, then restart the backend. For an exact match, this skips the per-phone hourly cap, resend cooldown, and OTP-route request cap. The general auth API rate limit and OTP verification attempt limits remain enabled. Remove the value after testing; the setting is rejected in production.

## Development welcome bonus

Local `.env` can enable the one-time ₹99 test promotion with `WELCOME_BONUS_ENABLED=true`, `WELCOME_BONUS_AMOUNT_PAISE=9900`, and `WELCOME_BONUS_FUNDING_SOURCE=DEVELOPMENT_TEST_FUND`. The configured test pool is capped by `WELCOME_BONUS_TEST_FUND_PAISE`; run `npm run db:seed` to add that explicitly non-redeemable test pool. It does not represent cash and must not be used for real users. A new user created while the rule is enabled is eligible once; existing database rows stay ineligible. `POST /api/v1/auth/verify-otp` grants from the pool only after valid OTP verification, in a database transaction with balanced ledger entries and the unique key `WELCOME_BONUS:<userId>`. Repeated login does not add another credit. Production launch requires approved eligibility terms and genuine funding and is disabled by startup validation until that work is complete.

## Cashfree sandbox checkout (development only)

The project includes a Cashfree sandbox adapter for testing the checkout-to-status workflow. It is off by default. The adapter creates an order using Cashfree's server API, opens the native Cashfree checkout from the mobile app, then checks the order and payments again through Cashfree's server API. A client callback or webhook alone never proves a payment. Sandbox-confirmed deposits are marked `PAYMENT_VERIFIED` for test visibility but are deliberately not credited to the PaisaPay wallet ledger.

To try it, get Cashfree sandbox credentials for a merchant account that is permitted to test this checkout, then set `PAYMENT_PROVIDER=cashfree-sandbox`, `CASHFREE_CLIENT_ID`, and `CASHFREE_CLIENT_SECRET` in `server/.env`. Apply migrations with `npm run db:deploy`. A privileged operator must explicitly enable the `CASHFREE` row in `payment_method_configurations` (`enabled=true` and `provider_approved=true`); the row is inserted disabled and unapproved by migration. Once configured, `GET /api/v1/wallet-methods` reports the sandbox method as available, while `livePaymentsEnabled` remains false. Do not set this provider in production: startup rejects it.

The mobile Cashfree SDK is a native module and cannot run in Expo Go. Install dependencies, then use `cd C:\paisapay_starter\mobile; npm run prebuild:android; npm run android:dev` to create and run a custom Android development build (Android Studio/SDK and a connected emulator/device are required). Later starts can use `npm start -- --dev-client`. Set `EXPO_PUBLIC_API_URL` to the backend host reachable from the Android device. The checkout uses the SDK's sandbox environment. The SDK can only be verified on a development build, not by the Expo Go preview or a static JS export.

The supplied payment starter is not copied wholesale: its in-memory order store, development user header, and expected `payment_link` response are not used. Cashfree's documented Create Order API returns a `payment_session_id`, which this backend uses with the official React Native SDK. For production, a merchant agreement, enabled production credentials, an approved use case, HTTPS webhook setup, settlement/reconciliation, payout integration, legal review, and security review remain necessary. No production payment is enabled.

Wallet linking and MobiKwik integration have been removed from the PaisaPay mobile UI and API. Existing MobiKwik enum values and historical rows stay in PostgreSQL so migration does not delete user data; new deposits, links, order methods, and status checks cannot use that provider. Saving a UPI ID at `/api/v1/users/me/upi` is format validation only; it does not verify ownership or enable a payment.

The standard UPI Add Money estimate uses `UPI_DEPOSIT_REWARD_PERCENT_BPS` (default `1700`, or 17%). The current local development `.env` enables this only against `DEVELOPMENT_TEST_FUND`; a reward may be posted to the local development ledger after Finance independently verifies the receipt, only while that finite test pool has funds. This is test configuration, not a production promotion or a guaranteed/cash payout. The checked-in `.env.example` keeps the reward disabled. Quick Deposit/P2P uses a separate 6% estimate and the same development test pool. Production promotional rewards need explicit funding, eligibility/terms, and audited idempotent payout handling before they can be enabled.

## UPI manual reconciliation

UPI deposits require the server-only `DEPOSIT_RECEIVER_UPI_ID` setting. Configure it only after independently confirming the merchant recipient and reconciliation process; the application has no built-in recipient fallback, and a syntactically valid VPA is not proof of ownership. If the setting is absent, `POST /api/v1/deposits` with method `UPI` returns HTTP 503 before creating a deposit. When configured, the endpoint creates an idempotent `PENDING_PAYMENT` request and returns the configured receiver plus a unique merchant reference. Android can open a standard `upi://pay` intent; the app chooser decides which installed UPI application can handle it. QR/copy and manual-reference submission are fallbacks. A UPI-app return, screenshot or user-entered UTR never credits the wallet. The deposit stays pending until Finance independently checks merchant-side receipt and approves its claim. Limits are controlled by `MIN_DEPOSIT_PAISE` and `MAX_DEPOSIT_PAISE`; the receiver cannot be supplied by a mobile client. Production must keep `PAYMENT_PROVIDER=disabled` until an authorized provider integration is implemented and approved.

Bank-account management is available at `GET/POST /api/v1/users/me/bank-accounts` and `PATCH/DELETE /api/v1/users/me/bank-accounts/:id`. The account number is stored with AES-256-GCM encryption; only the last four digits are returned. Set a private 32-byte hexadecimal `BANK_ACCOUNT_ENCRYPTION_KEY` in `server/.env`. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` in a secure local terminal, paste it directly into `.env`, and back it up securely. Do not rotate or lose this key without a controlled data re-encryption plan. Existing local development `.env` now has a generated key; its value is intentionally not printed here. Saved records remain `UNVERIFIED`; `POST /api/v1/users/me/bank-accounts/:id/verify` returns `BANK_ACCOUNT_VERIFICATION_UNAVAILABLE` until a bank ownership/penny-drop provider is approved.

Withdrawals remain unavailable. `POST /api/v1/withdrawals` performs a balance/limit precheck and returns `PAYOUT_PROVIDER_UNAVAILABLE` without creating a withdrawal or reserving funds. A production payout needs an authorized payout provider, verified own-account beneficiary, KYC/risk policy, callbacks/status reconciliation, and funding/settlement controls. No UPI ownership lookup or real bank payout adapter is present.

Migration `20261024120000_upi_manual_reconciliation` adds the user's UPI reference fields and an auditable manual payment claim table. It has been applied to the configured local database using `npm run db:deploy`; on another environment, run the same command after reviewing the additive SQL. It does not reset or delete existing rows.

Migration `20261030120000_upi_deposit_intent` adds the UPI payment-method enum value and encrypted bank-account table. It has been applied to the configured local PostgreSQL database. It is additive and does not reset or delete existing records. Apply it in another environment with `npm run db:deploy`, then run `npm run db:generate`.

The app creates pending UPI requests only when an explicit server receiver is configured; request creation does not confirm payment. A user can submit a transaction reference and image using `POST /api/v1/deposits/:id/manual-verification`; the deposit remains `PENDING_PAYMENT`. An existing Finance/Admin/Super Admin role can review claims in the local admin console or through `/api/v1/admin/reconciliation/claims`. Approval requires an exact transaction reference and amount, `INR`, an affirmative receiver-receipt check, an internal evidence reference, and a reason. The database transaction records audit and reconciliation rows and posts balanced, idempotent ledger entries. Reviewers must inspect the merchant/bank records independently; a screenshot or sender-side success message is not sufficient. Admin-role provisioning is deliberately not exposed by an API.

To run the local console, use a second terminal: `cd C:\paisapay_starter\admin; npm install; npm run dev`. The session token remains in page memory. Do not publish the console to the internet.

## Commands

- `npm run dev` — reloadable development server.
- `npm start` — build and start `dist/src/server.js` on port 4000 by default.
- `npm run build` — compile TypeScript.
- `npm run typecheck` — check TypeScript.
- `npm test` — API smoke tests.
- `npm run db:generate` — generate the Prisma client; does not need a running database.
- `npm run db:migrate` — development migration; needs PostgreSQL credentials.
- `npm run db:deploy` — apply committed migrations in deployment.
- `npm run db:seed` — add disabled payment configuration rows and, only when enabled in development/test, a labelled test reward pool; needs PostgreSQL.

## Current implementation scope

Implemented endpoints cover health/readiness, public config, OTP challenge/session flows, profile and UPI reference management, ledger-derived balance/history, pending deposit requests, manual payment claim submission and protected reconciliation review, wallet references, Sell order listing/reservation, withdrawal availability checks, support tickets, notifications, and a minimal admin-protected overview. Swagger is available under `/api/v1/docs`.

Still unimplemented: approved production SMS service, production payment and payout integrations, automatic deposit verification, funded deposit rewards, UPI ownership lookup, bank account verification, legacy bank-payout settlement, P2P dispute resolution/refund reversals, admin-role provisioning, and referral/reward/VIP APIs. Manual deposit crediting exists only after Finance review of real receiver-side records. The Android gateway must be configured and tested on the phone before claiming real SMS delivery.

## P2P quick deposit and withdrawal offers

P2P quick-match, marketplace, withdrawal-offer reservation, cancellation, expiry, payment claims, dispute recording, and admin review APIs are implemented on the existing ledger. The mobile Deposit screen offers exact-amount matching and marketplace browsing; Withdrawal creates divisible-by-₹100 offers and displays offer history. Admins can search P2P offers and matched orders and review submitted payment claims. Matching is oldest-first, excludes the buyer's own offers, and locks rows to prevent duplicate buyers. Offer expiry uses an explicit UTC timestamp and application-supplied current time.

Creating or paying a P2P offer is not currently available for real money because no authorized UPI ownership-verification provider is configured. The backend refuses to create offers for unverified UPI IDs and hides stale offers if ownership verification is removed. A buyer's UPI handoff and submitted transaction reference are not proof of payment; the order remains pending until Finance independently confirms exact seller-side receipt in bank records. There is no automatic P2P payment verification or payout integration. Do not enable real-money P2P until UPI ownership verification, payment reconciliation controls, KYC/AML and legal review, and production operational safeguards are approved.

Production deployment preparation: see [PRODUCTION_DEPLOYMENT.md](../docs/PRODUCTION_DEPLOYMENT.md).

