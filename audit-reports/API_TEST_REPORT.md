# PaisaPay API automated test report

## Latest isolated verification

Commands run from `C:\paisapay_starter\server` with `$env:DATABASE_URL=''`:

```powershell
$env:DATABASE_URL=''
npm test
npm run build
git diff --check
```

Results:

- `npm test`: **PASS** — 14 test files passed, 3 database integration files skipped; 128 tests passed, 52 skipped, 180 total. Runtime duration: 18.72s.
- `npm run build`: **PASS** — Prisma Client 7.10.1 generated and TypeScript production build completed.
- `git diff --check`: **PASS** — no whitespace errors.
- OpenAPI built-spec inspection: **PASS** — 98 operations; all 99 route declarations covered; 0 generic `ApiJsonObject` fallback references; 96 body-bearing 2xx responses and one intentional bodyless 204; 0 flexible array-item schemas; 4 flexible response fields and 1 flexible request field, all matching JSON fields in the Prisma/API model.
- No production or local database connection, migration, or write was performed. Database integration suites were deliberately skipped because `DATABASE_URL` was blank.

## Runtime OpenAPI validation coverage

`src/tests/app.test.ts` plus `src/tests/openapiAuthenticatedResponses.test.ts` and `src/tests/support/openapiRuntimeValidator.ts` validate Supertest responses against their operation schemas for:

- Public config success (`GET /config`), including nested payment-method data, nullability and array-item shapes.
- Invalid password-login body (`POST /auth/password/login`, HTTP 400).
- Successful session refresh and successful authenticated response bodies across user/profile, UPI, bank accounts, wallet, transactions, deposits, orders/P2P, withdrawals, referrals/VIP, notifications, support and admin endpoints. These use in-memory mocked Prisma delegates; populated fixtures include deposit records, a matched P2P order with a claim, support tickets and notifications.
- Missing-auth responses (HTTP 401) for 18 routes across user profile, UPI, bank accounts, wallet/methods/references, transactions, orders, deposits, referrals, notifications, support, and admin endpoints.

Checks include status code, response content type, required fields, primitive types, nullable values, enum membership, array item schemas, and rejection of extra properties on closed objects. Authenticated success tests do not connect to PostgreSQL; they validate handler responses against the mocked Prisma return shapes. They do not prove database integration behavior.

## Remaining limitations

- **PASS with documented JSON flexibility:** 4 response fields remain open JSON (`RewardRule.eligibility`, `AuditLog.metadata` and their response projections); 0 flexible array-item schemas. One request `eligibility` field remains open JSON, matching current validation and storage.
- **NOT TESTED:** the three PostgreSQL integration test files were skipped because `DATABASE_URL` was set blank. This avoids connecting to either the configured local database or Neon; mocked runtime tests cover response contracts only.
- **BLOCKED / NOT TESTED:** production provider credentials, live SMS, live payment/payout, push delivery, and Android notification handling.

No failures in the final test/build run. Dynamic JSON fields and skipped database integration tests are described in `API_OPENAPI_AUDIT.md`.
