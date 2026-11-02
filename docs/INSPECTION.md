# Existing project inspection

The project already contained `mobile/`, `backend/`, `admin/`, and `docs/`. The mobile app was a single JavaScript Expo screen tree, the backend was a JavaScript in-memory demo server, and the admin panel was a demo read-only React page. There was no Prisma project or database connection in the original backend. Node 22.22.2 is installed.

The original backend registers routes such as `GET /v1/config`; it does not register `GET /api/v1/config`. Unknown requests fall through to the `Route not found` JSON handler. The mobile API base address also pointed to port 3000. This implementation adds a separate TypeScript backend in `server/` on port 4000 and connects the mobile API client to it. The original backend files remain in place for reference.

The computer has a PostgreSQL 18 Windows service running, but PostgreSQL command-line tools are not in PATH and no database URL or database credentials are configured in the project. For that reason the initial migration was generated, but it could not be applied and DB-backed tests could not run.

## Change checklist

- [x] Add TypeScript/Express server, validated configuration, rate limits, structured logging, OpenAPI docs, and health/readiness routes.
- [x] Add PostgreSQL Prisma schema, initial migration, and safe configuration-only seed.
- [x] Add OTP challenge/session code with an explicitly development-only console adapter.
- [x] Add user profile/balance/transactions, pending deposit, wallet-reference, order, withdrawal, support, notification, and minimal admin-overview routes.
- [x] Fix API paths and connect Expo login/session/data requests through a central API client with secure token storage.
- [x] Add smoke tests and beginner setup notes.
- [ ] Configure PostgreSQL credentials, apply migration, and run database-backed authentication and transaction tests.
- [ ] Implement approved SMS, payment, payout, admin operations, referral/reward, and ledger-settlement services.
- [ ] Connect and secure the existing admin dashboard and complete production security/compliance review.
