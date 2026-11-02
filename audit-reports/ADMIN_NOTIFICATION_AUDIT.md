# Admin Notification Audit

Audit date: 2026-11-01.

## Source flow

1. Buyer submits a P2P payment claim in `server/src/modules/p2p/routes.ts`; transaction saves claim/order status, audit entry and unique `AdminPushEvent` (`eventKey` is based on claim ID) together.
2. `server/src/server.ts` calls the durable Admin push outbox worker at startup and every five seconds.
3. `server/src/modules/admin/pushNotifications.ts` prepares deliveries only for active devices owned by Finance/Admin/Super Admin; claims work with `FOR UPDATE SKIP LOCKED`; retries with backoff and max attempts; revokes `DeviceNotRegistered` tokens.
4. Push payload contains event type/event ID/claim ID, not UTR, screenshot or bank data.
5. Admin app registers token after login only in native Android builds and only when EAS project ID and notification permission are available. Expo Go/non-Android/simulator paths report limitation instead of registering remote push.
6. Notification tap fetches claim details from authenticated backend endpoint; expired session triggers login flow and then reopens queued claim.
7. In-app durable event list is the fallback.

## Findings and status

| Item | Status | Evidence |
|---|---|---|
| Durable event model/outbox | PASS – source | `AdminPushEvent`, `AdminPushDelivery`, unique event key, retry/locking logic |
| Payment proof event created after successful persistence | PASS – source | Event created in same transactional claim submission path |
| Authorized admin targeting | PASS – source | Finance/Admin/Super Admin filter in outbox/device query |
| Invalid token cleanup | PASS – source | `DeviceNotRegistered` revokes device |
| Duplicate notification prevention | PASS – source | Event key uniqueness and delivery `skipDuplicates` |
| Sensitive payload exclusion | PASS – source | Only IDs/type and generic title/body sent |
| Expo Go handling | PASS – source/build | `expo-notifications` loaded only outside Expo Go; Expo Go message is explicit |
| EAS project configuration | BLOCKED | Admin local `.env` has no `EXPO_PUBLIC_EAS_PROJECT_ID` value |
| Android notification permission and token registration | NOT TESTED | No Android device attached (`adb devices` empty) |
| Foreground/background/killed app push receipt | NOT TESTED | Requires physical device and EAS/Expo push setup |
| Push tap/deep-link to exact record | NOT TESTED | Code route exists; device session not exercised |
| Expo provider acceptance/delivery | NOT TESTED | Outbox has not been sent from an authenticated registered device |

An Expo ticket accepted by the service would still not prove Android displayed it. Real device delivery remains unverified. Required next step is set the EAS project ID in local build config, build/install the Admin development build, grant notification permission, sign in, register device, submit a test proof in isolated test accounts, and inspect delivery/tap flow.
