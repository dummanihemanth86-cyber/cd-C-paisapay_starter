# MobiKwik Link & Pay Readiness

## Findings

PaisaPay currently has no MobiKwik or PayU API adapter. The backend payment provider is disabled, payment availability is fail-closed, and the existing `WalletAccount` rows can save only a reference; they do not contain an authorized MobiKwik link or token. There is no MobiKwik sandbox transaction or merchant authorization configured in this project.

PayU publishes a MobiKwik Link & Pay integration for merchants. Its documentation describes:

1. A wallet-link/balance check through `POST https://test.mobikwik.com/userbalance` (production URL in the guide: `https://api.mobikwik.com/userbalance`) with `mid`, the user's `cell`, `msgcode=CHECK_BALANCE`, and an HMAC-SHA256 checksum.
2. Payment initiation through `POST https://test.payu.in/v2/payments` (production URL: `https://api.payu.in/v2/payments`) with PayU merchant fields, `bankcode=MOBIKWIK`, a SHA-512 hash, and success/failure return URLs. The sample response is still `pending` and contains a redirect URL; it is not proof of payment.
3. A MobiKwik token-generation endpoint at `/tokengenerate`, with a `WALLET_LINK` token type and an HMAC-SHA256 checksum. The published S2S guide requires the MobiKwik OTP to be submitted to this endpoint. Such a flow must only be enabled under PaisaPay's actual partner contract and security approval; PaisaPay must never collect a trading password, UPI PIN, or unrelated OTP.
4. A separate PayU Check Status API and PayU refund mechanism. The integration must verify the current authenticated status/checksum rules and merchant/order/amount/currency before any ledger settlement. A browser redirect or initiation response cannot settle an order.

References:

- [PayU MobiKwik Link & Pay integration](https://docs.payu.in/docs/mobikwik-link-pay-integration)
- [PayU Link & Pay API steps](https://docs.payu.in/docs/steps-to-integrate-mobikwik-link-pay)
- [PayU Add Money to Wallet and Debit API reference](https://docs.payu.in/reference/add-money-to-wallet-and-debit-api-mobikwik)
- [MobiKwik Merchant Terms](https://www.mobikwik.com/termsandconditions/merchants/)

## Business-model blocker

MobiKwik's merchant terms describe wallet payments from a customer to a merchant for the merchant's goods/services, and require merchant eligibility/contracting. The terms also state restrictions on transferability and cash withdrawal/redemption from wallet balances. PaisaPay's proposed user-to-user buy/sell marketplace and payout to an individual seller must be expressly reviewed and approved in writing by MobiKwik/PayU and qualified legal/compliance advisers before using this payment product. A generic merchant account or a successful sandbox checkout does not itself approve that business model.

## Required before implementation can be activated

- Written approval for PaisaPay's exact marketplace business model, including the user-to-user seller settlement flow.
- Executed MobiKwik merchant/partner terms and PayU onboarding/product enablement for MobiKwik Link & Pay.
- Separate test and production merchant credentials supplied through a private server-side secret manager. The app must not receive these values.
- Provider-confirmed hosted/redirect UX, wallet-link consent, token storage/rotation/revocation, callback and status-query authentication, refund/reversal, and reconciliation procedures.
- HTTPS API deployment. The local HTTP development API must not receive provider authorization OTPs or long-lived wallet tokens.
- An approved design for storing any provider token. No token should be persisted until its allowed scope, encryption/key management, retention, and revocation process are confirmed.

No provider secrets or speculative `MOBIKWIK_*` environment variables have been added. No database migration was created: storing an unapproved token or marking a wallet linked would be unsafe. The wallet-linking API lists MobiKwik as the only wallet provider and returns `INTEGRATION_UNAVAILABLE` with the onboarding reason `MERCHANT_ONBOARDING_REQUIRED`. The existing payment-method API remains separate and retains its existing provider configuration. Real payments, wallet linking, and settlement remain disabled.

## Current API/UI behavior

- `GET /api/v1/wallet-methods` reports wallet-link readiness separately from payment eligibility.
- `GET /api/v1/wallet-links` reports MobiKwik link status. It returns `LINKED` only if a backend-verified `AUTHORIZED_CONNECTED` record exists and the provider integration is available.
- `POST /api/v1/wallet-links/mobikwik` validates an Indian mobile number and returns `503 INTEGRATION_UNAVAILABLE` until the real authorization integration is implemented. It does not persist, log, or forward the number.
- The mobile Add Wallet selector displays only MobiKwik. It shows the onboarding blocker and never requests the provider's password or OTP.
- The Buy Orders screen shows MobiKwik under Active Wallets only when both backend authorization and payment availability are verified. Today it displays `INTEGRATION_UNAVAILABLE`.
- A saved UPI ID remains reference-only and does not count as linked.
- No buy-order payment is initiated, no wallet token is stored, and no ledger entry is made from a provider redirect or client status.

