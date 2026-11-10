# PaisaPay Prioritized Audit TODO

## P0 — before any real-money release

- [ ] Keep production and staging financial gates disabled until approved payment collection, independent payment verification, payout, funding, reconciliation, ledger accounting and authorization controls are ready.
- [ ] Configure/confirm the intended UPI receiver only after receiver ownership and Finance reconciliation are verified; currently public config has no recipient.
- [ ] Establish a disposable isolated PostgreSQL test database and run all 56 skipped DB-backed tests plus concurrency/idempotency suites; do not point test jobs at production.
- [ ] Build the User release APK after the owner supplies the approved signing configuration. Admin release APK builds successfully; compare signer to distribution certificate before installation. Do not uninstall or clear app data.
- [ ] Wake and unlock the connected Xiaomi device, then repeat visual launch, login/session restore, navigation, financial-disabled UI, network failure/recovery and background/restart tests without real financial actions.

## P1 — OTP reliability and operations

- [ ] Create/activate a staging Admin only through the documented owner-approved bootstrap path, then verify the eligible Admin phone using an approved real SMS test. Do not weaken the generic anti-enumeration response.
- [ ] For customer registration OTP, trigger one approved real staging request and correlate backend structured logs with Renflair dashboard records. Record HTTP status/category/duration only; never record key, OTP, full phone or raw query URL.
- [ ] Ask Renflair to confirm response JSON schema, explicit error/success codes, request reference, balance and whether a sent/delivered status API or callback exists. Do not equate HTTP 200 or acceptance with handset delivery.
- [ ] Confirm staging `OTP_PROVIDER`, `RENFLAIR_API_KEY` presence (without revealing its value), `RENFLAIR_V1_API_URL`, timeout and vendor account route/balance in Render and Renflair dashboards. Keep secrets in Render, not source or chat. SSH host verification prevented the runtime presence check in Phase 2.
- [ ] Review vendor/network retention of GET query parameters because the documented API carries the API key, phone and OTP in the URL query.

## P2 — project correctness and maintainability

- [ ] Resolve the duplicate Render main-branch `paisapay-api1` service and document one authoritative production service before any deployment changes.
- [ ] Review production/staging commit skew: production runs `10da4d3`, staging/local branch runs `cecfb8c`; deploy only after reviewed change approval and the migration/backout procedure.
- [x] Remove the overlapping legacy support withdrawal route; P2P `/withdrawals` is now the sole handler and duplicate router declarations are regression-tested.
- [ ] Add PostgreSQL-backed tests for IDOR/resource ownership, every Admin role/action, referral attribution/self-referral, reward funding/duplicate claims, OTP/session revocation and all payout/deposit state transitions.
- [ ] Tighten flexible persisted JSON request/response schemas where fields can be versioned; keep audit metadata extensible only with documented constraints.
- [ ] Add a safe deployment-time capability/config smoke check so UI and backend version skew is visible before release.
- [x] Make Admin release API selection fail closed on missing/wrong environment and lock production to the exact approved API origin.
- [x] Apply a successful wallet balance response independently of failures in parallel dashboard reads.

## P3 — final user-facing verification

- [ ] After device unlock, capture real User/Admin screen states for loading, error, empty and success pages with personal details obscured.
- [ ] Validate notification permission/registration and push delivery separately from API notifications.
- [ ] Complete role-specific Admin workflow checks with staging fixtures only; use maker-checker and never create unfunded ledger entries.

## Phase 2 release status

- [x] Commit and push reviewed source fixes to the staging branch (`739afbd9c7609e666fdffc0b4f89ad6fd664ce70`).
- [ ] Deploy and verify the staging service. Auto-deploy is disabled in `render.staging.yaml`; Render API/staging DNS access failed during verification. Inspect isolated DB target and pending migrations before triggering deploy.
- [ ] Finish Admin/User device tests after ADB reconnects and the device is awake/unlocked; no app data was cleared.
- [ ] Build the User release APK after approved signing secrets are supplied. An existing APK artifact is not certified as this pass's fresh build.
- [ ] Run 56 skipped DB-backed tests against an isolated disposable PostgreSQL database.
- [ ] Confirm OTP request/provider response/delivery with safe Render and Renflair diagnostics and an approved real-phone staging test.
