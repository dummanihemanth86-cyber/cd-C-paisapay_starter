# Admin Financial Flow Audit

Audit date: 2026-11-01. No real payment or balance mutation was performed.

## Database and backend safeguards

- Prisma money fields use integer paise (`BigInt`); P2P/admin service code uses transactional operations, unique references/idempotency and audit history.
- Wallet accounts, ledger accounts/transactions/entries, reservations, deposits, withdrawals, P2P offers/orders/payment claims, rewards and commissions are separate models.
- P2P backend contains row-locking/atomic allocation and business status logic in `server/src/modules/p2p/service.ts` and routes; integration tests exist for matching/evidence/manual review.
- Admin reconciliation and P2P claim review have server-side role checks, validated reasons/evidence, transaction references, amount/recipient verification fields, and ledger processing in backend review services.
- Screenshot/UTR input does not independently prove payment. Local `/api/v1/config` reported `automaticVerificationAvailable:false`, `verificationMode:MANUAL_RECONCILIATION`, `livePaymentsEnabled:false`, and no operational approved payment provider. Thus automatic settlement is BLOCKED for real payments.
- Withdrawal admin response reports payout integration unavailable. A P2P seller settlement is not proof an external bank transfer occurred.

## Screen action audit

| Financial screen/action | Control | Test result |
|---|---|---|
| Deposit queue/read | `GET /admin/deposits`, search/status/pagination | Route/query source verified; signed-in data NOT TESTED |
| Manual UPI reconciliation | Role-guarded queue and review endpoint, review reason/evidence reference | Source/test coverage exists; real admin decision NOT TESTED |
| P2P claim approval | Requires evidence reference, receiver confirmation, INR amount, unique transaction reference; backend remains authority | Unit/integration suite passes; real provider receipt NOT TESTED/BLOCKED |
| P2P claim rejection | Requires reason and affirmative recipient-side non-receipt confirmation; backend controls reservation/ledger state | Source/test coverage exists; no real order mutated |
| Withdrawal monitoring | Read-only queue; explicit unavailable payout integration | Live provider unavailable; payout cannot be tested |
| Wallet ledger | Read-only list; no direct balance edit route | Route exists; no-token unauthorized checked; signed-in data NOT TESTED |
| Reward settings | Amount/eligibility config only, audited; UI says not a credit | Mutation NOT TESTED |
| CSV exports | Reads first 100 records per category; no balance mutation | Export UI NOT TESTED |

## Current local configuration observation

The live local config endpoint returned deposit reward `1700` basis points (17%) enabled from a local reward pool, but also reported no approved operational provider and `livePaymentsEnabled:false`. That is the runtime configuration observed for this audit only; it does not establish that the reward is payable or that any customer payment succeeded. Admin displays configured rules but does not approve transactions automatically from UI callbacks.

## PASS/FAIL boundaries

- Backend automated financial-related suite: **PASS**, because 139 tests across 16 files completed successfully.
- Actual money movement / independent recipient verification / bank payout: **BLOCKED**, no authorized operational provider and no live transaction test permitted.
- No production balance, order, migration or financial row was modified by this audit.
