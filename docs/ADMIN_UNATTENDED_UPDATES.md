# PaisaPay Admin unattended staging updates

## How updates work

- The native Admin app checks the staging API version endpoint and the public `admin-version.json` manifest at launch, when resumed, and every five minutes.
- A staging frontend release newer than the installed native build displays a blinking **UPDATE AVAILABLE** button. It opens the latest staging Admin web app at `https://dummanihemanth86-cyber.github.io/cd-C-paisapay_starter/`.
- This is a browser handoff, not a silent native APK update. The installed app remains installed and its Android SecureStore session is not cleared. The web app keeps its own login in tab-scoped browser session storage; sign in to the browser version separately.
- The browser app uses the staging API. The web build does not receive credentials, OTPs, database URLs, Render secrets, or wallet configuration.

## Deployment

The GitHub Actions workflow `.github/workflows/admin-staging-web.yml` runs on pushes to `codex/admin-wallet-credit-staging`. It exports the Expo Admin web app with the staging API URL, generates the public build manifest, checks the bundle for the production API host and secret variable names, then deploys the static files to GitHub Pages. The web build and Pages deploy do not depend on a Render backend deployment.

One-time repository setting: open **GitHub → Settings → Pages → Build and deployment → Source** and select **GitHub Actions**. The workflow needs the repository's Pages feature enabled. No deploy token or application secret is required by the workflow.

## Public version APIs

- Staging backend: `GET https://paisapay-api-staging.onrender.com/api/v1/admin/app-version`
- Staging web manifest: `GET https://dummanihemanth86-cyber.github.io/cd-C-paisapay_starter/admin-version.json`
- Latest staging Admin web app: `https://dummanihemanth86-cyber.github.io/cd-C-paisapay_starter/`

The API endpoint is unauthenticated read-only metadata. It returns the service name, API version, deployment environment and validated Render commit SHA. It never returns secrets or user/account data. The staging web origin is allowed by API CORS only when the backend is running on the explicitly identified `paisapay-api-staging` Render service; production CORS behavior is unchanged.

## Verification and recovery

After a push, check the **Actions → Deploy PaisaPay Admin staging web** run. Then verify the two GET endpoints above return HTTP 200, the API says `deploymentEnvironment: "staging"`, and the manifest's `deploymentEnvironment` is `"staging"` with the new commit SHA/build code. If Pages is disabled, enable the GitHub Pages source setting above and rerun the workflow. A failed version request hides the update indicator without affecting existing Admin sessions or API actions.

All payment and wallet feature flags remain controlled by the backend. This updater neither changes financial configuration nor submits financial requests.
