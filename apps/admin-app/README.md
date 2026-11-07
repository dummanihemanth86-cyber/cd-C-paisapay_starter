# PaisaPay Admin Android App

This is a separate Expo application with Android application ID `com.paisapay.admin`. The existing customer app remains under `mobile/` (`com.paisapay.demo`). Both apps use the same PaisaPay API and database.

## Local setup

```powershell
cd C:\paisapay_starter\apps\admin-app
npm install
Copy-Item .env.example .env
# EXPO_PUBLIC_API_URL defaults to the production API; override it in .env for local testing.
# Install/rebuild the native development APK after changing native modules.
npm run build:android:debug
adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
npm start
```

`npm start` uses the custom development client so it matches native modules in this project, including `expo-clipboard`. Use `npm run start:go` only for features supported by Expo Go; Expo Go may not contain every native module required by this app.

Use `http://10.0.2.2:4000` for an Android emulator. For a physical Android phone, set `EXPO_PUBLIC_API_URL=http://<PC-LAN-IPv4>:4000`, connect both devices to the same Wi-Fi, and allow inbound TCP 4000 in Windows Firewall. Production must use HTTPS.

## Android build

For a separately installable APK, use the Expo/EAS build profile after configuring the EAS project in this directory:

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
cd C:\paisapay_starter\apps\admin-app
npm run build:android:release
```

Output: `android\app\build\outputs\apk\release\app-release.apk`. Release builds require `PAISAPAY_ADMIN_STORE_FILE`, `PAISAPAY_ADMIN_STORE_PASSWORD`, `PAISAPAY_ADMIN_KEY_ALIAS`, and `PAISAPAY_ADMIN_KEY_PASSWORD` in the user-level Gradle properties file. The local config plugin applies this signing setup during Android prebuild and makes release tasks fail closed if signing properties are missing. Keep the keystore and these properties outside the repository and back them up securely. Never use the debug keystore for a release build. The release build script pins the Render API URL even if a local `.env` file points at a development server. EAS production AAB builds also require an EAS project and production signing credentials.

## Separate administrator login

The app posts to `POST /api/v1/admin/auth/login`, then loads `GET /api/v1/admin/me`. Backend membership and role permissions are authoritative. Existing users without an `AdminUser` row are denied. There is no admin registration or default credential. Provision administrators through the existing controlled database/admin process. Tokens are stored using Expo SecureStore and revoked at logout.

The app exposes screens backed by the shared PaisaPay API, including user search and account status, wallet and transaction history, audited in-app announcements, support replies/status changes, reward-rule configuration, system diagnostics and CSV exports. SUPER_ADMIN can issue a ₹100–₹10,000 manual wallet credit after searching and reviewing a user, entering a reason and confirming; the backend requires the funded adjustment account and atomically writes balanced ledger entries and an audit record with idempotency protection. A disabled financial-operations gate or missing adjustment funding leaves balances unchanged. Announcements and support replies are in-app only; SMS/push delivery is not configured. Reward rules configure eligibility only and do not credit rewards because payout funding is not configured. Payment and payout providers remain disabled unless explicitly approved and configured. KYC, Bird Assistant/joke management, dispute resolution and administrator role changes do not have complete backend workflows in this API.
