# PaisaPay implementation plan

## Phase 1 result: repository inspection

This document records the implementation plan requested in Phase 1. No application source, database, or dependency files were changed during this inspection; only this plan was added.

### Current workspace

The current workspace already contains a substantial **JavaScript demo**, but it does not yet match the requested production-oriented TypeScript monorepo:

- `mobile/App.js` is a large single-file React Native app with demo screens and local state.
- `mobile/src/api.js` is a small JavaScript fetch helper.
- `mobile/app.json` uses the demo Android ID `com.paisapay.demo`.
- `mobile/package.json` is Expo SDK 54 / React Native 0.81, with Expo Go and EAS config. `mobile/package-lock.json` exists, but there is no root workspace lockfile.
- `backend/server.js` is a single Express JavaScript file with in-memory demo records.
- `backend/schema.sql` is a PostgreSQL schema starter, but the API does not connect to it.
- `admin/src/main.jsx` and `admin/src/style.css` are a read-only Vite/React JavaScript demo.
- `docs/API.md`, `docs/BUILD_PLAN.md`, and `docs/TESTING_CHECKLIST.md` describe current demo endpoints and limitations.
- Root `README.md` contains demo setup instructions. `.gitignore` excludes dependencies, secrets, signing keys, and generated builds.
- `mobile/node_modules/` and `mobile/.expo/` are local generated folders and must not be treated as source files or included in a release archive.

The workspace has no Git metadata, so there is no commit history or tracked/untracked diff to consult. Avoid destructive moves until a source snapshot or Git baseline has been made.

### Attached ZIP inspection

`paisapay_original_app_starter.zip` contains a second, smaller JavaScript starter under `paisapay_original/`: `mobile/App.js`, Expo package/app configuration, `backend/src/server.js`, a backend environment example, `database/schema.sql`, a root README, and an admin README. It has no TypeScript, Expo Router, Prisma migrations, OpenAPI document, or implemented authentication/payment integrations.

The ZIP is reference material, not a second instruction source. Its useful project facts are the original Android package ID `in.paisapay.app`, its initial color direction, and its statement that real payments are disabled. The current workspace has already evolved beyond the ZIP in demo screens and API surface. Do not overwrite the current app with the smaller archive version. Before release, choose the permanent Android package ID; changing it after publication would break normal app updates.

## File-by-file implementation plan

“Create” means a planned file for a later implementation phase. “Migrate” means first port the behavior, then retain the old file until the new path works.

| Current or planned path | Planned action | Main contents / reason |
|---|---|---|
| `README.md` | Update | Beginner setup for the monorepo, exact Node/Expo/PostgreSQL prerequisites, environment setup, migration/seed commands, tests, Expo Go, staging, and APK workflow. Clearly label provider-dependent steps. |
| `.gitignore` | Keep and review | Continue excluding `.env`, `node_modules`, Expo output, Prisma secrets, APKs, and keystores. Never ignore `.env.example`. |
| `package.json` (root, create) | Create | npm workspaces for `mobile`, `server`, and `admin`; shared scripts for install, dev, lint, typecheck, test, and build. |
| `package-lock.json` (root, create) | Generate once package versions are chosen | One reproducible lockfile for the workspace. Do not copy `node_modules` from the ZIP or current local folder. |
| `.env.example` (root, create) | Create | Safe placeholders for API/database URLs, session signing, OTP sandbox, CORS, and provider integration flags; no secrets. Add per-service examples only if they make local setup clearer. |
| `mobile/package.json` | Migrate | TypeScript, Expo Router, Expo-compatible versions, navigation-safe dependencies, and scripts. Resolve and pin versions as a compatible set, then regenerate the root lockfile. |
| `mobile/app.json` | Update | Adopt the final app name, splash/icon configuration, Android package ID, permissions, and version metadata. The archive suggests `in.paisapay.app`; confirm it is available and keep it stable before release. |
| `mobile/eas.json` | Keep and update | Preserve preview APK support. Keep production signing/release commands documented, but do not claim a release until a signed build is actually produced and verified. |
| `mobile/App.js` | Migrate, then remove only after parity | Move the current demo screens into Expo Router route files. Preserve working demo flows and their safety labels while replacing local financial fallbacks with backend-backed data. |
| `mobile/src/api.js` | Migrate | Replace with typed API client, request/response schemas, server error handling, access-token attachment, and session-expiry handling. |
| `mobile/app/_layout.tsx` (create) | Create | Expo Router root layout, theme, safe-area handling, session gate, and loading/error boundaries. |
| `mobile/app/index.tsx` (create) | Create | Startup/update information check and authenticated/unauthenticated route decision. No silent APK install. |
| `mobile/app/(auth)/login.tsx`, `otp.tsx`, `register.tsx` (create) | Create | Mobile entry, OTP request/verify, registration, resend cooldown, validation, and explicit sandbox behavior when no approved SMS credentials exist. |
| `mobile/app/(tabs)/_layout.tsx` and `index.tsx` (create) | Create | Five-tab navigation and Home dashboard. |
| `mobile/app/(tabs)/deposit/` (create) | Create | Amount entry, server-created order, provider/sandbox state, status and history. Sandbox must remain pending/failed and never fabricate a successful payment. |
| `mobile/app/(tabs)/wallets/` (create) | Create | MobiKwik, Paytm, PhonePe, and Navi display with the specified eligibility and honest connection status. Personal credentials are never collected. |
| `mobile/app/(tabs)/orders/` (create) | Create | Buy/Sell lists, order detail, countdown/expiry, payment submission, status timeline, and dispute reporting. Reservation and settlement decisions remain server-side. |
| `mobile/app/(tabs)/team/` and referral routes (create) | Create | Direct/indirect members, referral code/share/QR, and eligibility disclosures backed by API data. |
| `mobile/app/(tabs)/mine/` and profile/security routes (create) | Create | Profile, balance/history links, withdrawal, PIN/password controls, sessions, notices, legal documents, support, and account deletion request. |
| `mobile/src/components/` (create) | Create | Shared fields, buttons, cards, loading/error/empty states, confirmation dialogs, and accessible labels. |
| `mobile/src/theme/` (create) | Create | Shared colors, spacing, typography, and layout tokens. |
| `mobile/src/lib/money.ts` (create) | Create | INR paise parsing/formatting with integer-only calculations and no floating-point balance math. |
| `server/package.json` (create) | Create | TypeScript Express service, Prisma client, validation, logging, security middleware, OpenAPI, and test scripts. |
| `server/tsconfig.json` (create) | Create | Strict TypeScript settings for the API. |
| `server/src/app.ts` and `server/src/index.ts` (create) | Create | Express app construction separate from listener startup for integration testing. |
| `server/src/config/` (create) | Create | Validated environment loading; fail startup on missing required production configuration. |
| `server/src/routes/v1/` (create) | Create | Versioned auth, profiles, wallet config, deposits, orders, withdrawals, ledger, referrals/rewards, notifications, support, and admin routes. |
| `server/src/middleware/` (create) | Create | Authentication, role checks, validation, rate limits, request IDs, idempotency, consistent errors, and audit capture. |
| `server/src/services/` (create) | Create | Business rules and Prisma transactions; route handlers must not write balances directly. |
| `server/src/providers/otp/` and `server/src/providers/payments/` (create) | Create | Provider adapters behind interfaces. Sandbox adapters must not fake verified success. Real adapters require approved provider contracts and server-held credentials. |
| `server/src/openapi.ts` and `server/openapi.yaml` (create) | Create | Swagger/OpenAPI schema, request/response formats, auth requirements, error codes, and sandbox limitations. |
| `server/src/tests/` (create) | Create in the testing phase | Unit, API integration, authorization, idempotency, concurrent reservation, ledger invariants, and security-abuse coverage. |
| `backend/server.js`, `backend/package.json` | Migrate, retain during transition | Port the useful demo API and health/config behavior into the new typed server. Remove the legacy folder only after commands/docs point to `server/` and behavior is covered. |
| `backend/schema.sql` | Use as reference; do not apply blindly | Compare its tables and constraints with both the ZIP schema and current database schema, then move the agreed model into Prisma migrations. |
| `database/schema.sql` from ZIP | Use as reference; do not overwrite newer work | Reconcile its minimal user/order/ledger model with the more extensive current schema and normalize into Prisma. |
| `database/prisma/schema.prisma` (create) | Create | Users, OTP challenges, sessions, accounts, deposits, provider events, orders/history/reservations, withdrawals/payouts, double-entry ledger, referrals/rewards/VIP, support, admin roles/audit, idempotency, reconciliation, and app releases. |
| `database/prisma/migrations/` (create) | Create | Ordered, reviewable PostgreSQL migrations with constraints, unique keys, and indexes. Do not edit settled ledger rows; corrections use reversal transactions. |
| `database/prisma/seed.ts` (create) | Create | Seed only clearly labelled non-financial configuration and test users; never create fake real-money records. |
| `database/README.md` (create) | Create | Local PostgreSQL setup, migration/seed/backup guidance, and safe staging reset procedure. |
| `admin/package.json` | Migrate | Pin React/Vite/TypeScript dependencies and add typecheck/build/test commands. |
| `admin/src/main.jsx` and `admin/src/style.css` | Migrate, then remove after parity | Convert the existing read-only dashboard to TypeScript and shared API types while keeping demo/production status clear. |
| `admin/src/main.tsx`, `admin/src/App.tsx` (create) | Create | Typed admin shell, authenticated route protection, navigation, and API error states. |
| `admin/src/features/` (create) | Create | Users, deposits, orders/disputes, withdrawals, ledger/reconciliation, wallet status, reward configuration, support, announcements, audit, and health views. |
| `admin/src/auth/` (create) | Create | Strong admin sign-in/MFA handoff and session handling; permission checks are enforced by the server too. |
| `admin/README.md` (create) | Create | Local setup and access model; explicitly state that hiding a page is not authorization. |
| `docs/API.md` | Replace/expand | Document actual versioned OpenAPI endpoints and sandbox/production differences. |
| `docs/BUILD_PLAN.md` | Update | Track completed phase and remaining work without calling placeholders production-ready. |
| `docs/TESTING_CHECKLIST.md` | Expand | Add staging, concurrency, ledger, security review, backup/restore, provider reconciliation, and release acceptance lists. |
| `docs/DEPLOYMENT.md` (create) | Create | HTTPS API/database deployment, secret management, monitoring, migrations, backups, EAS signed APK, checksum, official-site hosting, and safe updates. |
| `docs/SECURITY_AND_COMPLIANCE.md` (create) | Create | Threat model and launch gates; mark legal/provider determinations as requiring qualified review and actual approvals. |
| `docs/PRIVACY_POLICY.md`, `docs/TERMS.md`, `docs/RISK_DISCLOSURE.md` (create) | Create drafts only | Provide implementation placeholders for owner/legal review, not claims that legal compliance is established. |

## Implementation sequence after Phase 1

1. **Mobile/navigation:** preserve the existing UI and move it route by route into Expo Router/TypeScript; establish loading, empty, and error states.
2. **Database:** model the relational data in Prisma and generate the first PostgreSQL migration. Review ledger constraints before implementing money operations.
3. **Backend foundation/auth:** typed Express app, OpenAPI, input validation, provider interface, OTP/session flows, and role-based middleware.
4. **Ledger and payment workflows:** deposits, order reservations/status history, withdrawal holds, provider event deduplication, and reconciliation in database transactions. Keep payment verification disabled until an approved provider is configured.
5. **Admin and rewards:** authenticated least-privilege operations, audited reviews, support, and only funded/configured reward rules.
6. **Testing and deployment:** run the requested unit/integration/security tests, address failures, then document staging and signed APK steps. Do not publish an APK or enable live money movement before approvals and security review.

## Phase 1 acceptance

- Existing workspace and attached ZIP inspected.
- Differences and reusable project material recorded above.
- File-by-file implementation plan written to this document.
- No current application/database source was removed or rewritten during this phase.
- No tests were run because Phase 1 is repository inspection and planning only.
