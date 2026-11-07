# PaisaPay fresh production deployment preparation

This repo is prepared for a new Render API service, a new Neon PostgreSQL database, and separate EAS Android builds. Nothing in this guide deploys the apps or server. Do not point production commands at the existing local database.

## Architecture found

```text
PaisaPay Public Android (mobile/) ─┐
                                  ├─ HTTPS EXPO_PUBLIC_API_URL → Render Node API (server/)
PaisaPay Admin Android (apps/admin-app/) ─┘                         │
                                                                   └─ Prisma 7 + pg adapter → Neon PostgreSQL
```

`server/` is the active TypeScript/Express API (`src/server.ts`) and Prisma schema/migration owner. `backend/` is a legacy/demo API; `admin/` is a separate legacy web admin/dev proxy. The mobile app and separate Android Admin app are Expo SDK 54. Use only `server/` for this deployment. Both apps require the same public HTTPS API origin, supplied at build time as `EXPO_PUBLIC_API_URL`.

## Important production blockers

- The current production payment adapter is intentionally unavailable: keep `PAYMENT_PROVIDER=disabled`. Real-money UPI verification, wallet credit on payment, and payout cannot be called production-ready until an approved provider integration is implemented and tested.
- Live OTP requires a valid Renflair V1 account/key. Server production startup now fails unless `OTP_PROVIDER=renflair-v1` and that key is configured. Confirm vendor approval, delivery, sender setup and account limits before launch.
- Provision the first administrator through the existing secure server bootstrap procedure; never add credentials to either app or a public registration route.
- Configure an HTTPS admin web origin in `APP_ORIGIN` if using the web admin. Native Android requests normally do not send a browser Origin, but the value must not be localhost in production.
- Configure EAS projects and production API URL independently for the Public App and Admin App. Push notifications additionally require each app's EAS project setup and Android credentials.
- Render pre-deploy commands require a paid web service. `render.yaml` uses the Starter plan so the migration command runs before deploy.

## 1. Create a new Neon database

**Current workspace status:** The PaisaPay production Neon database is already provisioned and connected, and the repository's 25 Prisma migrations have been applied. Do not create a duplicate database for this deployment. The steps below describe setup for a separate fresh environment.

1. Create a Neon project and a fresh production branch/database. Choose a region close to the Render Singapore service when available.
2. Create/use a least-privilege application role, not a personal/admin database role.
3. In Neon connection details, copy the pooled connection string for runtime and the direct connection string for migrations. Add `sslmode=require` to both if it is absent. Do not paste either URL into chat, source control, or an Expo app.
4. Keep the database empty before the first migration. The initial deployment uses the repository's checked-in Prisma migration history; do not run seed scripts against production.

When using the Neon CLI, `neon env pull --services postgres` writes the pooled URL as `DATABASE_URL` and the direct URL as `DATABASE_URL_UNPOOLED`. Keep the generated local `.env.local` file private and ignored by Git. For Render, configure `DATABASE_URL` with the pooled URL and `DIRECT_DATABASE_URL` with the unpooled URL in the service's private environment settings. The Prisma CLI also accepts Neon's `DATABASE_URL_UNPOOLED` directly; the Express runtime continues to use only pooled `DATABASE_URL`.

## 2. Prepare the source repository

Render and EAS build from the source checkout. A local Git repository is initialized in this workspace, but it is not connected to GitHub yet. Create a new **private** GitHub repository in your account, then from PowerShell run:

```powershell
cd C:\paisapay_starter
gh auth login
git add -A
git status --short
git diff --cached --name-only
git check-ignore .env.local server/.env apps/admin-app/.env .neon apps/admin-app/android/app/debug.keystore backup/pg_hba.conf.backup
```

Before committing, confirm there is no `.env`, backup, database dump, signing key, or QR screenshot in the staged list. The ignore rules exclude local credentials and generated Expo/Android folders. After reviewing the filenames and ignore checks, commit and create/push the private repository:

```powershell
git commit -m "Prepare PaisaPay production deployment"
gh repo create paisapay-starter --private --source . --remote origin --push
```

Do not paste a GitHub token or credential in chat. `render.yaml` is at repository root and selects `server/` as its service root. EAS can then link each app folder as a separate Expo project.

## 3. Create the Render API service

1. In Render, create a Blueprint from the private repository and review `render.yaml` before applying it.
2. Set the prompted private environment values:
   - `APP_ORIGIN`: optional for the two native Android apps. Leave it blank if no browser admin is deployed. If a browser admin is deployed, use its exact HTTPS origin(s), comma-separated, with no path or trailing slash. Do not add a guessed domain.
   - `DATABASE_URL`: Neon pooled runtime URL.
   - `DIRECT_DATABASE_URL`: Neon direct URL for Prisma migration execution.
   - `SESSION_HASH_SECRET`: generate privately, e.g. `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
   - `BANK_ACCOUNT_ENCRYPTION_KEY`: generate a distinct 32-byte key, e.g. `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
   - `RENFLAIR_API_KEY`: active production key from the OTP provider.
   - `DEPOSIT_RECEIVER_UPI_ID`: leave unset unless UPI instructions are intentionally enabled. If set, use only a merchant VPA independently confirmed through the authorized account owner and a tested Finance reconciliation process. Do not treat format validation or a user-entered name as proof of ownership. If unset, UPI deposit creation returns HTTP 503 before writing a deposit; no default receiver is used.
3. Render sets `PORT`; the API binds to `0.0.0.0` and honors that port. Do not hardcode a Render port. The blueprint health check is `/ready`, which checks PostgreSQL as well as the server process.
4. Review build and pre-deploy logs. The build runs `npm ci`, `npm run db:generate`, and `npm run build`; pre-deploy runs `npm run db:deploy`; start runs `node dist/src/server.js`.
5. After deployment, verify `https://YOUR-SERVICE.onrender.com/health` and `/ready`. `/health` only means the process responds; `/ready` must report the database ready.

### Manual migration safety procedure

The first database must be a new, empty Neon database. Verify the Render `DIRECT_DATABASE_URL` points to that new database, then run the configured `npm run db:deploy`. It applies only checked-in pending migrations and does not seed sample rows. Before any later production schema change, take/verify a Neon backup or branch, inspect the migration SQL, and deploy additively. Never run `prisma migrate reset`, `migrate dev`, or seed against production. If adopting an already-populated database, stop and reconcile `prisma migrate status` and the `_prisma_migrations` table before applying anything.

## 4. Configure EAS for both Android apps

Create/link a separate EAS project from each app folder and set the `EXPO_PUBLIC_API_URL` variable in that project's **production** EAS environment to the Render HTTPS origin (no `/api/v1` suffix). Expo's current CLI command is `env:set`; it creates or updates the variable:

```powershell
cd C:\paisapay_starter\mobile
npx eas-cli login
npx eas-cli init
npx eas-cli env:set --name EXPO_PUBLIC_API_URL --value https://YOUR-SERVICE.onrender.com --environment production --visibility plaintext
npx eas-cli build --platform android --profile production-apk
```

Then do the separate Admin App project:

```powershell
cd C:\paisapay_starter\apps\admin-app
npx eas-cli login
npx eas-cli init
npx eas-cli env:set --name EXPO_PUBLIC_API_URL --value https://YOUR-SERVICE.onrender.com --environment production --visibility plaintext
npx eas-cli build --platform android --profile production-apk
```

`production-apk` creates an installable APK for private device testing, using the production API URL; it does not make payments safe or the service production-ready. `production` separately creates an Android App Bundle (`.aab`) for store distribution. `EXPO_PUBLIC_*` values are embedded in the client bundle and are public; never put database credentials, OTP keys, push access tokens or other secrets in either app. For the Admin App, `eas init` should link its EAS project; verify `npx expo config --json` contains `extra.eas.projectId` (or configure `EXPO_PUBLIC_EAS_PROJECT_ID` in that app's EAS production environment) so push token registration can identify the project.

For internal device testing, use each app's `preview` profile and configure the EAS `preview` environment with the same HTTPS API variable:

```powershell
npx eas-cli build --platform android --profile preview
```

For production-connected APKs specifically, use `--profile production-apk` from each app folder as shown above. For Play Store AABs, use `--profile production`.

## 5. Production environment variable reference

| Variable | Where | Purpose |
|---|---|---|
| `NODE_ENV=production` | Render | Enables production safeguards. |
| `PORT` | Render-managed | Listening port. |
| `HOST=0.0.0.0` | Render | Public service interface binding. |
| `APP_ORIGIN` | Render if browser admin is deployed | Allowed HTTPS browser origins; native-only deployments can leave it empty. |
| `DATABASE_URL` | Render secret | Neon runtime PostgreSQL URL with TLS. |
| `DIRECT_DATABASE_URL` | Render secret | Neon direct database URL used by Prisma migrations. |
| `SESSION_HASH_SECRET` | Render secret | Server session/token hashing secret. |
| `BANK_ACCOUNT_ENCRYPTION_KEY` | Render secret | 64 hex characters (32 random bytes) for encrypted bank data. Back it up securely; rotating it without a re-encryption plan may make saved bank data unreadable. |
| `OTP_PROVIDER=renflair-v1` | Render | Required supported live OTP adapter. |
| `RENFLAIR_API_KEY` | Render secret | OTP provider credential. |
| `PAYMENT_PROVIDER=disabled` | Render | Required until an approved production payment adapter exists. |
| `DEPOSIT_RECEIVER_UPI_ID` | Render secret/private setting, conditional | Explicit receiver for manual UPI instructions only after merchant ownership and reconciliation are confirmed. If unset, UPI deposit creation returns HTTP 503. Does not enable automatic payment verification or wallet credit. |
| `UPI_DEPOSIT_REWARD_ENABLED=false` | Render | Prevents unapproved client-side reward funding. |
| `WELCOME_BONUS_ENABLED=false` | Render | Development-only feature; must stay off. |
| `EXPO_PUSH_ACCESS_TOKEN` | Render secret, optional | Authenticated Expo push delivery, if enabled. |
| `EXPO_PUBLIC_API_URL` | EAS production env, per app | Public HTTPS API origin embedded into each Android app. |

`server/.env.production.example` contains placeholders only. Never copy it with placeholder values into a live service.

## 6. Local verification commands

From PowerShell, these checks do not deploy or change database data:

```powershell
cd C:\paisapay_starter\server
npm ci
npm run db:generate
npm run typecheck
npm test
npm run build
```

To inspect migration status safely, only set `DATABASE_URL` to the intended disposable/local test database first, then run `npm run db:deploy` (for production this is Render's pre-deploy step). Do not run migrations against the current local database merely to prepare this guide.

Expo dependency checks and Android builds:

```powershell
cd C:\paisapay_starter\mobile
npx expo-doctor
npx eas-cli build --platform android --profile production

cd C:\paisapay_starter\apps\admin-app
npx expo-doctor
npx eas-cli build --platform android --profile production
```

Production EAS builds cannot succeed at runtime until the EAS production variable is set to the deployed HTTPS origin. These build commands are intentionally not started by this preparation task.

## Current deployment readiness

- Render deployment configuration: prepared, not deployed.
- Neon production database: connected; all 25 checked-in Prisma migrations have been applied and Prisma reports the schema up to date.
- API `PORT`/host and health/readiness: implemented in the active server; needs cloud smoke test after provisioning.
- App production API configuration: environment-driven and requires HTTPS; needs separate EAS env values.
- OTP: blocked on real provider account/key and delivery test.
- Real-money deposit/payment/payout: blocked; production payment provider is intentionally unavailable.
- Admin account and push delivery: require secure admin provisioning, app-specific EAS project IDs, and a real device delivery check.
- Financial production readiness: not certified by this setup. Obtain required provider approvals, legal/compliance review, operational reconciliation, backups, monitoring, and security review before accepting customer funds.
