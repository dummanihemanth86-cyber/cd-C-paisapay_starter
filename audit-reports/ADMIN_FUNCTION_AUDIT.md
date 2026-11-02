# Admin Function Audit

Audit date: 2026-11-01. Function inventory covers every named function/hook and the inline data flows in the Android Admin source (`apps/admin-app/App.js`) plus its helper module.

| Function | Purpose / input | API or state effects | Findings / verification |
|---|---|---|---|
| `request(path, {token,method,body})` | Authenticated JSON fetch | Adds Bearer header, parses error envelope | Correct token wiring; no abort timeout or retry. Network error text is clear. Connection failure UX NOT TESTED. |
| `Button({title,onPress,disabled,secondary})` | Shared action control | Calls supplied press handler | Nested Text and accessibility role present; PASS source/build. |
| `AppBody()` | Admin app controller/screen tree | Owns all auth, pages, API state and actions | 20 section branches; compilation PASS; complete interaction NOT TESTED. |
| `loadSection(key, token)` | Fetch current page; query/status filters and paging params | Calls one or more Admin API routes; stores normalized payload | **Fixed:** refresh retry previously fetched only `NAV[key]`, bypassing P2P/reports composite loaders and dropping filter suffix. It now reuses the same section loader for first request and refreshed token. Expo export/build PASS; authenticated expiration scenario NOT TESTED. |
| `loadMoreDeposits()` | Fetch next deposit page | GET deposits with page/pageSize/q/status | Array normalization and guards present. Does not rotate expired session; NOT TESTED. |
| `signOut()` | Revoke push device, call auth logout, clear SecureStore | DELETE push device, POST logout | Local cleanup occurs even if server logout fails; logout not tested with credentials. |
| bootstrap `useEffect` | Restore access/refresh tokens and call `/admin/me` | Token refresh if old access token; load dashboard | Clears credentials on any bootstrap error without showing a reason; does not cancel async work on unmount. NOT TESTED. |
| `login()` | Validate ten-digit phone/password and sign in | POST admin auth login, save tokens in SecureStore, GET `/admin/me` | Server-side AdminUser required; no public admin creation. Actual login NOT TESTED (no credentials supplied for this audit). |
| `openPushClaim(claimId)` | Load exact claim on notification tap | GET claim; refresh token once; fetch P2P; set review modal | Permission checked in app and backend; uses latest server claim. Device notification tap BLOCKED by no device/EAS ID. |
| `registerPushDevice(adminAccess)` | Register Android Expo token | POST admin push device | Guards Expo Go, non-Android, simulator and absent project ID. EAS project ID absent in local Admin `.env`; push registration BLOCKED. |
| notification-response handler | Reads notification claim ID and navigates | Calls `openPushClaim` | Fetches latest data rather than trusting financial payload. Device test BLOCKED. |
| `closeModal()` | Reset decision/evidence/amount/confirmation state | Clears modal fields | Local state only; code path compiled. |
| `changeUserStatus()` | Suspend/reactivate with minimum reason | POST user status then reload list | Server validates role/reason, prevents self-status change and writes audit. Mutation NOT TESTED. |
| `reviewClaim()` | Review ordinary UPI reconciliation claim | POST review with decision/reason/evidence/verification values | Frontend requires verified receiver, amount, transaction ref on approval. Backend independently validates. Financial action intentionally NOT TESTED. |
| `reviewP2pClaim()` | Review buyer P2P payment claim | POST claim review | Requires reason/evidence; rejection requires recipient-side non-receipt confirmation; approval requires ref/amount/VPA/receiver confirmation. No real payment accepted. |
| `sendAnnouncement()` | Create in-app announcement | POST notification and reload | Confirmation required for all-active audience; no SMS/push claimed. Send NOT TESTED. |
| `updateReward(rule)` | Modify reward rule configuration | PATCH reward rule | Integer paise conversion, reason required; UI explicitly says configuration does not credit. Mutation NOT TESTED. |
| `exportCsv(name,data)` | Share up to first 100 server records | Android Share sheet | Escapes formula-leading cell values, excludes sensitive key names. Device share sheet NOT TESTED. |
| `safeKey(key)` / `csvCell(value)` | CSV column filter and formula/quote escaping | Used by `exportCsv` | Static review only; no CSV fixture test. |
| `openSupportTicket(row)` | Fetch ticket detail | GET ticket detail and normalize messages | Correct normalization; NOT TESTED with backend records. |
| `sendSupportReply()` | Reply with audit reason | POST reply, GET ticket, reload | Validation and error handling present; mutation NOT TESTED. |
| `setSupportStatus(status)` | Change support ticket state | PATCH status, GET ticket, reload | Reason required; mutation NOT TESTED. |
| `useMemo(sections)` | Filter nav by server permission list | Uses `allowedSections` | UI visibility only; backend RBAC remains authoritative. |
| section `useEffect` | Load section on navigation/token/profile change | Calls `loadSection` | Dependency includes section/access/profile; no direct query-trigger effect, Search button submits. |
| P2P polling `useEffect` | Refresh P2P every 4 seconds while idle | Calls `loadSection('p2p')` | Clears interval on cleanup and skips while busy; live-device timing NOT TESTED. |
| `DetailFields({value,depth})` | Safe recursive record display | No API call; masks token/password/OTP/secret fields | JSX parser/raw-text scan PASS; unbounded deep/large payload cost remains a defensive concern. |
| response helper functions | Normalize arrays/objects and validate response | Called by `request` and section loaders | 3 unit tests pass. |

## Explicitly absent functions

No Admin Android function exists for KYC decisions, dispute resolution, admin-role mutation, payout initiation/confirmation, PDF export, joke management, or direct wallet adjustments. These remain unimplemented rather than no-op controls.
