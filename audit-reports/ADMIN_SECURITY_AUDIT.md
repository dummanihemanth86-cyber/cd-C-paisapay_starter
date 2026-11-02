# Admin Security Audit

Audit date: 2026-11-01.

## Controls verified from source

| Control | Evidence | Status |
|---|---|---|
| Separate admin sign-in | `server/src/modules/admin/routes.ts` has `/admin/auth/login`; requires an existing user and `AdminUser` record; does not create user/admin/wallet | PASS – source verified; actual credential login NOT TESTED |
| Login rate limiting | Login limits 8/15 minutes by request plus hashed phone key | PASS – source verified |
| Admin route auth | `adminRouter.use(requireAuth, requireAdmin)`; P2P admin routes use `requireAdmin` after global P2P `requireAuth` | PASS – source verified |
| Server-side role checks | `requireRole()` used for Finance, Operations, Support, Admin and Super Admin actions | PASS – source verified |
| Anonymous access blocked | no-token requests to overview/users/deposits/health/P2P orders returned HTTP 401 | PASS – runtime checked |
| Public user denied Admin | `requireAdmin` rejects accounts without `AdminUser` with 403 | PASS – code path verified; ordinary-user token 403 NOT TESTED |
| Token storage | Admin app uses Expo SecureStore; access/refresh values not written to logs | PASS – source verified |
| Token revocation/logout | calls logout, removes local tokens; unregisters device token when present | NOT TESTED – no signed-in session |
| Audit records | status changes, configuration, notification and financial review actions write audit rows | PASS – source verified; mutation audit retrieval NOT TESTED |
| Error logging | authorization header is redacted; API errors return request ID without sensitive details | PASS – source verified |
| Evidence access | secure authenticated evidence route and protected claim flow exist | NOT TESTED – no authorized Admin session |
| CSV injection mitigation | CSV cells quote and escape formula-leading values; sensitive field keys excluded | PASS – source verified; no CSV UI test |

## Findings

- No admin registration or silent wallet balance-edit endpoint found in the Admin route set.
- Admin UI permission filtering uses `allowedSections`, but backend role checks remain the actual security control.
- `DetailFields` hides password/OTP/token/secret/API-key/private-key and raw evidence fields; claim evidence is displayed through the dedicated evidence flow.
- Sensitive bank/KYC docs and full PII exposure were not tested against live records.
- `.env` and secrets were not copied into audit reports. Admin app API origin is public configuration; no credentials belong in Expo public environment variables.
- Active session expiration/revocation was not exercised.

## Open security/operations risks

- Least privilege is route-specific but several high-level read endpoints intentionally allow multiple roles; live role matrix was not tested with each role.
- Push lock-screen text contains claim reference/amount but no UTR or full account details. Device display was not verified.
- Financial approval requires human/backend evidence checks; a submitted UTR/screenshot remains a claim. Local config reports no operational automatic provider.
