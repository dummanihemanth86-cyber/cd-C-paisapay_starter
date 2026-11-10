# PaisaPay API security audit

**Scope:** Express backend in `server/src`, Prisma/PostgreSQL access paths, middleware, payment adapters, and existing automated tests. Static source review plus the test/build commands recorded in `API_TEST_REPORT.md`; no production database or credentials were used.

## Verified controls

| Area | Result | Evidence |
|---|---|---|
| Authentication | PASS | `requireAuth` hashes bearer tokens before session lookup and rejects missing, revoked, expired, suspended, and closed-account sessions. Password-reset revokes active sessions. |
| Admin boundary | PASS for route-level authentication; role controls present | Admin router requires both `requireAuth` and an `AdminUser` record. Sensitive data/actions include role checks. Admin login is separate and does not create users or wallets. |
| OTP | PASS in code/tests | Codes are HMAC-hashed at rest, short-lived, attempt-limited, delivery-gated, and protected by IP/phone rate limits. OTP codes are not returned or logged. |
| Token handling | PASS in code/tests | Opaque random access/refresh tokens are stored as keyed hashes; refresh rotates atomically and rejects replay. |
| SQL injection | PASS in reviewed query patterns | Database access uses Prisma filters and parameterized tagged raw SQL; no string-built SQL was found in reviewed backend routes. |
| Payment verification | PASS: fail-closed behavior | Production config requires `PAYMENT_PROVIDER=disabled`; app returns provider-unavailable for unsupported integrations. UPI screenshot/UTR claims do not by themselves credit wallets. |
| UPI/bank claims | PASS: correctly limited | UPI syntax is distinguished from ownership verification. Bank-account numbers are encrypted at rest, masked in API responses, and do not enable payout. |
| Financial idempotency/concurrency | PASS in covered P2P flows | Ledger rows use idempotency keys and DB transactions; matching uses row locks/atomic updates. Existing tests cover duplicate credit prevention, partial matching and concurrent buyers. |
| Logging | PASS in reviewed logging setup | Pino HTTP redacts `Authorization`; app code logs provider state/error codes rather than OTPs or request bodies. |
| Error handling | PASS for common response paths | Zod, HTTP, oversized body, invalid JSON, duplicate key and unknown-route errors receive controlled JSON responses. |

## Findings and risks

### PASS — API route coverage and request schema presence

The current route-to-spec regression test finds **0 undocumented router method/path pairs** across 99 source declarations; the specification contains 98 operations, including its documented compatibility entries. JSON body schemas are asserted for all 38 unique `req.body` handler operations, and documented protected operations declare bearer authentication. See `API_ENDPOINT_INVENTORY.md` and `API_OPENAPI_AUDIT.md`.

### Low — explicit JSON fields remain intentionally open

The built OpenAPI spec has 97 total 2xx responses (96 with bodies and one intentional bodyless 204), 0 generic whole-response `ApiJsonObject` fallbacks, 0 flexible array-item object schemas, and 4 flexible response fields. The four response fields are persisted JSON (`RewardRule.eligibility` and `AuditLog.metadata`, including audit metadata in P2P order timelines); the matching reward-rule request JSON is also open because validation accepts arbitrary record keys. Runtime contract tests validate successful responses across authenticated user/finance modules using in-memory Prisma mocks and validate populated deposit, P2P order, support-ticket and notification rows. They do not establish PostgreSQL-backed behavior; three database integration suites remain skipped with `DATABASE_URL` blank.

### Medium — live payment/payout verification is unavailable by design

Production startup rejects enabled production payment providers in this build. Therefore live deposits, UPI verification, and payouts are not production-capable; manual claims remain unverified until authorized Finance reconciliation. This is a deployment dependency, not a code path that should be bypassed.

### Low — overlapping legacy withdrawal router

`support/routes.ts` defines legacy `/withdrawals` handlers, including a POST that always fails closed. The P2P router is mounted earlier at the same effective path and handles those method/path pairs first. This is confusing/dead implementation surface and should be removed or isolated in a separately approved cleanup after clients are checked.

## Areas not fully verified

- **BLOCKED / NOT TESTED:** real SMS delivery, real payment-provider verification/payout, and real push delivery require provider credentials and external Android devices. Unit/adapter tests do not prove a production provider is operational.
- **NOT TESTED:** production traffic rate-limit behavior, penetration testing, external dependency vulnerability assessment, and live Render/Neon behavior.
- **NOT TESTED:** every route's full positive/negative response schema. Existing integration tests cover critical auth, payment, referral, UPI, and P2P workflows, not every query/filter/role combination.

## Recommended actions

1. Keep the dynamic JSON fields documented as such; if reward eligibility or audit metadata becomes a versioned schema, constrain its validator and OpenAPI schema together and add a regression test.
2. Add integration tests for cross-user IDOR on support, deposit, order, bank-account, and claim/evidence resources, plus expired/revoked access tokens and role-denied actions for each admin role.
3. Keep payment/payout features disabled until an authorized production provider and independent verification are configured and tested.
4. Remove or isolate the shadowed legacy withdrawal router in a separate reviewed change.
