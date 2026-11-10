# PaisaPay OpenAPI / Swagger audit

## Result: PASS for route/request coverage and mocked runtime contract checks; PARTIAL for explicit JSON-valued fields

The API serves OpenAPI JSON from `/api/v1/openapi.json` and Swagger UI from `/api/v1/docs`.

- **99** Express router declarations are covered by **98** OpenAPI operations; there are **0** undocumented registered method/path pairs.
- The built specification has **97** 2xx response entries: **96** with bodies and one intentional bodyless 204 (`POST /auth/logout`). There are **0 generic `ApiJsonObject` fallback references**.
- All **38** JSON-body operations have application/json request schemas and regression assertions.
- Protected operations declare bearer authentication; public auth/config/webhook exceptions remain explicit.
- Runtime responses are checked against actual OpenAPI operations for public `/config` and password-login validation, session refresh, missing-auth responses across 18 endpoints, and successful authenticated responses across user/profile, UPI, wallet, transactions, deposits, orders/P2P, withdrawals, referrals/VIP, notifications, support, and admin endpoints. Successful payloads use mocked Prisma delegates; populated fixtures exercise deposit/P2P-order, support-ticket and notification item schemas. No database was connected.
- The reusable validator checks documented status, JSON content type, required fields, primitive types, nullability, enums, array items, and closed-object extra keys.
- Handler-derived schemas now cover payment/deposit records, legacy orders, P2P orders/offers/claims, support, notifications, referral/commission rows, admin user/finance projections, and VIP levels. A response-type regression test also guards the VIP `activeLevels` integer count.

## Remaining nested schema gaps

The built OpenAPI document contains **4 flexible object-valued response fields** and **0 flexible array-item object schemas** (**4 flexible response nodes total**). Each is backed by a field whose source is explicitly JSON:

| Operation and field | Basis for flexibility |
|---|---|
| `GET /admin/reward-rules` → `rules[].eligibility` | Prisma `RewardRule.eligibility` is a JSON column; its record keys are configured per rule. |
| `PATCH /admin/reward-rules/{id}` → `rule.eligibility` | Same JSON column returned by the update handler. |
| `GET /admin/audit-logs` → `auditLogs[].metadata` | Prisma `AuditLog.metadata` is JSON event metadata with action-specific keys. |
| `GET /admin/p2p/orders` → `orders[].timeline[].metadata` | Same JSON audit metadata included in the order timeline. |

There is **1 flexible request field**, `PATCH /admin/reward-rules/{id}` → `eligibility`, matching the handler's `z.record(z.string(), z.unknown())` and Prisma JSON column. These dynamic fields are intentional; no generic response fallback or flexible array-item schema remains. Any stronger field contract would require restricting the existing JSON domain and would not reflect the current handlers.

Successful authenticated contracts are validated against mocked in-memory Prisma delegates, not the database. Three database integration files are deliberately skipped with `DATABASE_URL` blank to prevent any local/production connection. Those DB-backed workflows are therefore **NOT TESTED** by this isolated run.

## Out of scope / not a router operation

- `/`, `/health`, `/ready`, legacy `/v1/config`, Swagger UI assets, and the OpenAPI self-description route are framework endpoints, not mounted business-router declarations. The endpoint inventory lists these separately.
- Duplicate legacy withdrawal declarations remain noted in the endpoint inventory; the P2P router is mounted first.

No production or local database was accessed or modified during this run. Security and business logic were not weakened.
