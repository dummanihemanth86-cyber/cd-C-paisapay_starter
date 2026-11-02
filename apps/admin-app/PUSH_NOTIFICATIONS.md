# PaisaPay Admin Push Notifications

Payment proof submission creates a durable `AdminPushEvent` in the same PostgreSQL transaction as the claim. The server outbox worker sends only a generic title/body and claim ID through Expo Push Service. Payment amount, UTR, VPA, image, and other financial details are fetched only after an authenticated admin opens the claim. Push delivery never changes payment state.

## Required setup for Android delivery

1. Link `com.paisapay.admin` to an Expo EAS project and set `EXPO_PUBLIC_EAS_PROJECT_ID` in the admin app build environment. The dynamic app config reads this value to request the project's Expo push token.
2. Configure Firebase Cloud Messaging HTTP v1 credentials for the same EAS project using Expo's official [FCM setup](https://docs.expo.dev/push-notifications/fcm-credentials/). The service account key belongs in EAS credentials; do not commit it.
3. Build and install a development or production Android app. Expo Go on SDK 53+ is not a valid remote-push test environment.
4. Sign into the Admin app with an authorized Finance, Admin, or Super Admin account and allow notifications. The app registers the device token with `/api/v1/admin/push-devices`.
5. Submit a test payment claim from a separate public test account. Verify the Android notification, tap it, confirm Admin opens the claim, and verify that the API returns the latest status. Repeat with the app backgrounded and closed.

The backend may optionally use `EXPO_PUSH_ACCESS_TOKEN` to authenticate requests to Expo Push Service. Keep it server-side. If push credentials or permission are unavailable, the durable Admin Alerts inbox remains available after sign-in.

## Local build

From `apps/admin-app`, install a custom Android Development Build (Expo Go does not support remote push on SDK 53+):

```powershell
npx expo install expo-dev-client
$env:EXPO_PUBLIC_EAS_PROJECT_ID = "<your-EAS-project-UUID>"
npx expo run:android
npm run start:dev-client
```

For a distributable development APK, the configured EAS profile is `development`:

```powershell
$env:EXPO_PUBLIC_EAS_PROJECT_ID = "<your-EAS-project-UUID>"
npx eas-cli build --profile development --platform android
```

Never put the Firebase service-account private key in the mobile app. A successful build does not prove remote push delivery; EAS project linking, FCM credentials, notification permission, an authorized admin session, and a real Android device are still required.
