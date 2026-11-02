# PaisaPay API

Base URL in local development: `http://localhost:4000`. Private endpoints use `Authorization: Bearer <accessToken>`. Money inputs and outputs use integer paise; currency is INR only. Error responses use `{ "error": { "code": "...", "message": "..." } }`.

Interactive Swagger reference: `GET /api/v1/docs`.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Public | Process health |
| GET | `/ready` | Public | Checks PostgreSQL connectivity |
| GET | `/api/v1/config` | Public | INR currency, provider configuration, operational availability, and method eligibility |
| POST | `/api/v1/auth/request-otp` | Public | Create hashed OTP challenge and ask the configured server-side Android SMS gateway to queue it |
| GET | `/api/v1/auth/otp-status/:challengeId` | Public, opaque challenge UUID | Read gateway status only; does not return phone number or SMS body |
| POST | `/api/v1/auth/verify-otp` | Public | Verify OTP, create user/session, and report development welcome-bonus result |
| POST | `/api/v1/auth/forgot-password/request-otp` | Public, disabled | Returns `503 PASSWORD_RESET_TEMPORARILY_DISABLED`; does not send OTP |
| POST | `/api/v1/auth/password/reset` | Public, disabled | Returns `503 PASSWORD_RESET_TEMPORARILY_DISABLED`; does not change password |
| POST | `/api/v1/auth/refresh` | Public | Rotate refresh session token |
| POST | `/api/v1/auth/logout` | Token or refresh token | Revoke session |
| GET/PATCH | `/api/v1/users/me` | User | Read/update own profile |
| GET/PATCH/DELETE | `/api/v1/users/me/upi` | User | Manage own UPI ID; format is checked but ownership stays unverified |
| GET | `/api/v1/users/me/balance` | User | Read ledger-derived INR balance |
| GET | `/api/v1/users/me/transactions` | User | Read own ledger entries |
| GET | `/api/v1/users/me/referrals` | User | Read own referral code and masked direct/indirect member list |
| GET/POST | `/api/v1/deposits` | User | Read history/create an order; MobiKwik requests remain pending and do not start payment; Cashfree is sandbox-only if configured |
| GET | `/api/v1/deposits/:id` | User | Read own deposit |
| POST | `/api/v1/deposits/:id/manual-verification` | User | Submit an unverified transaction-reference claim; deposit remains pending |
| GET | `/api/v1/wallet-methods` | User | Read backend-derived method eligibility and payment availability |
| GET | `/api/v1/wallet-links` | User | Read MobiKwik link status; no other provider is offered for linking |
| POST | `/api/v1/wallet-links/mobikwik` | User | Validate a mobile number and report `INTEGRATION_UNAVAILABLE` until approved authorization is configured |
| GET/POST | `/api/v1/wallet-references` | User | Read/save UPI reference only; not a connection |
| GET/POST | `/api/v1/orders` | User | Read available orders/create a Sell listing |
| GET | `/api/v1/orders/:id` | User | Read allowed order details |
| POST | `/api/v1/orders/:id/reservations` | User | Atomically reserve an available order |
| POST | `/api/v1/orders/:id/cancel` | User | Cancel own available order |
| POST | `/api/v1/orders/:id/payment-submission` | User | Explicitly unavailable until payment adapter exists |
| GET/POST | `/api/v1/withdrawals` | User | Read withdrawals; creation refuses without payout provider |
| GET | `/api/v1/notifications` | User | Read own notifications |
| GET/POST | `/api/v1/support/tickets` | User | Read/create support tickets |
| GET | `/api/v1/support/tickets/:id` | User | Read own support ticket |
| POST | `/api/v1/webhooks/payments/:provider` | Provider (not configured) | Returns unavailable; does not credit funds |
| GET | `/api/v1/admin/overview` | Admin | Minimal protected counts, when admin provisioning exists |
| GET | `/api/v1/admin/reconciliation/claims` | Finance/Admin/Super Admin | List manual claims; customer phone is masked |
| POST | `/api/v1/admin/reconciliation/claims/:claimId/review` | Finance/Admin/Super Admin | Reject or approve after matching transaction reference, exact INR amount, receiver receipt, and internal evidence reference |

Financial writes require an `Idempotency-Key` header for deposit, withdrawal, order creation, and order reservation requests. MobiKwik real payment initiation and automatic verification remain unavailable. A MobiKwik deposit request only creates a pending record; it does not open an app, send money, or credit a balance. Manual approval uses an authorized reviewer and a balanced idempotent ledger transaction only after external merchant records confirm the transaction. Cashfree sandbox is not redeemable balance. Payout processing and automatic MobiKwik payment detection remain unavailable.

Payment method responses separate `buyEnabled`/`sellEnabled` eligibility rules from actual `available` state. A method is available only if its configuration is enabled, its provider approval is recorded, provider credentials are configured, and an operational provider adapter exists. The current local configuration disables all payment methods; MobiKwik also has no approved account-linking or transaction-status adapter. The response includes `status` and `availabilityMessage` for the mobile UI.

## Android SMS gateway OTP

The gateway API is called only by the backend. Configure `SMS_GATEWAY_URL` and `SMS_GATEWAY_API_KEY` in `server/.env`; neither value is sent to the mobile client. `POST /api/v1/auth/request-otp` generates the code on the server, stores only its HMAC hash in PostgreSQL, and sends a JSON request to the gateway's `POST /api/send` endpoint using the `X-API-Key` header. The gateway's documented successful response has `success: true` and `status: "PENDING"`, which means the SMS was queued. PaisaPay reports `deliveryState: "ACCEPTED"`; it does not claim carrier delivery. `GET /api/v1/auth/otp-status/:challengeId` asks the gateway's `/api/status?request_id=...` endpoint and returns the gateway's current `PENDING`, `SENT`, `DELIVERED`, `FAILED`, or `UNKNOWN` status without returning the SMS body.

The Android gateway uses plain HTTP by default. Use it only on a trusted development LAN, keep its port off the public internet, and do not configure it for production hosting. Real production OTP delivery needs an approved provider and applicable Indian SMS registration/template controls. No real OTP SMS has been sent as part of code verification; tests mock the gateway.

## Development welcome bonus

When enabled by the backend's development-only environment settings, successful OTP verification can return `welcomeBonus: { status: "CREDITED", amountPaise: 9900 }`. The response is `DISABLED`, `NOT_ELIGIBLE`, or `FUNDING_REQUIRED` with zero amount for those outcomes. A `CREDITED` award is also included in the authenticated balance and transaction history. The local seeded pool is finite and explicitly non-redeemable test accounting; the app never determines eligibility or changes a balance. Production cannot enable this promotion in the current build.
