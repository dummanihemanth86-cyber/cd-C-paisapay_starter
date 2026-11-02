# PaisaPay Wallet Marketplace Audit

## Current provider state

The mobile app is Expo / React Native. The API is TypeScript, Express, Prisma, and PostgreSQL.

| Provider | Present in project | App rule | Authorized connection/payment/payout flow |
| --- | --- | --- | --- |
| MobiKwik | Yes | Buy and Sell rules | Not implemented; unavailable |
| Paytm | Yes | Buy and Sell rules | Not implemented; unavailable |
| PhonePe | Yes | Sell rule | Not implemented; unavailable |
| Navi | Yes | Sell rule | Not implemented; unavailable |
| Freecharge, Moneyview, Super Money, Airtel | No | No rule/model | Not supported by this build |

The rules above describe PaisaPay's intended eligibility only. They are not proof of provider approval. `GET /api/v1/wallet-methods` reports a method available only when its database configuration is enabled and approved, server credentials are configured, and an operational provider adapter exists. This codebase has no payment, external wallet authorization, or payout adapter, so the methods remain unavailable and the API does not initiate transactions.

## Wallet references and activation

`POST /api/v1/wallet-references` saves a user-entered UPI ID as a reference only. It does not authenticate with the payment app, inspect transactions, make the provider online, or permit payouts. The wallet marketplace displays it as “not connected.”

`GET /api/v1/wallet-methods` returns a per-user `walletActivation` summary. Only a backend status of `AUTHORIZED_CONNECTED` is counted. No current route can set this status because no provider authorization flow is implemented. The booster is explicitly unconfigured, and the API returns no invented target or progress percentage.

No database migration is required for this UI and summary change. The existing `WalletAccount` model holds reference-only records; existing payment configuration and order/deposit/withdrawal models are preserved.

## Why the screenshot's credential form is not reproduced

The screenshots ask for a provider trading password and provider OTP. PaisaPay must not collect those credentials. Until the selected provider supplies a documented merchant/partner authorization route for this exact use, the three-step details view explains that phone/OTP/authorization is unavailable and cannot claim an account is connected.

## Required external setup for a real flow

Select a provider and obtain its written merchant/partner approval and sandbox credentials, plus the provider's current server API, authorization method, signed callback/status-query requirements, payout permissions (if needed), and production onboarding. A provider must confirm that this business model and the desired payment direction are permitted. Configure the secrets privately on the backend, implement that provider's documented adapter, and pass sandbox callback/reconciliation tests before enabling it. The existing Android SMS gateway sends OTP SMS only; it is not a payment provider.

## Local checks

From `server/`:

```powershell
npm run typecheck
npm run build
npm test
```

From `mobile/`:

```powershell
npx expo export --platform android
npm start
```

