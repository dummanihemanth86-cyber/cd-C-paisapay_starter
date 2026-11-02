# PaisaPay Admin Android App

This is a separate Expo application with Android application ID `com.paisapay.admin`. The existing customer app remains under `mobile/` (`com.paisapay.demo`). Both apps use the same PaisaPay API and database.

## Local setup

```powershell
cd C:\paisapay_starter\apps\admin-app
npm install
Copy-Item .env.example .env
# Set EXPO_PUBLIC_API_URL in .env to the server origin reachable by the phone.
npx expo start --go --lan
```

Use `http://10.0.2.2:4000` for an Android emulator. For a physical Android phone, set `EXPO_PUBLIC_API_URL=http://<PC-LAN-IPv4>:4000`, connect both devices to the same Wi-Fi, and allow inbound TCP 4000 in Windows Firewall. Production must use HTTPS.

## Android build

Expo Go is useful for local UI iteration. For a separately installable APK, use the Expo/EAS build profile after configuring the EAS project in this directory:

```powershell
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform android --profile production
```

For a local native debug APK with Android SDK/JDK installed:

```powershell
npx expo prebuild --platform android
npm run build:android:debug
```

For a standalone local release APK that bundles JavaScript:

```powershell
cd C:\paisapay_starter\apps\admin-app\android
.\gradlew.bat assembleRelease
```

Output: `android\app\build\outputs\apk\release\app-release.apk`. The checked-in local Gradle release signing config currently uses the Android debug keystore, so this APK is for internal testing only. Configure a protected production keystore or EAS-managed signing credentials before distribution. EAS production AAB builds also require an EAS project and production signing credentials.

## Separate administrator login

The app posts to `POST /api/v1/admin/auth/login`, then loads `GET /api/v1/admin/me`. Backend membership and role permissions are authoritative. Existing users without an `AdminUser` row are denied. There is no admin registration or default credential. Provision administrators through the existing controlled database/admin process. Tokens are stored using Expo SecureStore and revoked at logout.

The app exposes screens backed by the shared PaisaPay API, including audited in-app announcements, support replies/status changes, reward-rule configuration and CSV exports. Announcements and support replies are in-app only; SMS/push delivery is not configured. Reward rules configure eligibility only and do not credit rewards because payout funding is not configured. KYC, Bird Assistant/joke management, dispute resolution, provider payouts and admin role changes remain unavailable because the necessary workflows or approved integrations are not implemented. No wallet-balance editing or simulated financial approval is provided.
