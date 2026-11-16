export const USER_APP_PACKAGE_ID = 'com.paisapay.app';

export type UserAppReleaseConfig = {
  version?: string;
  buildCode?: number;
  minSupportedBuildCode?: number;
  apkUrl?: string;
  sha256?: string;
  releaseNotes?: string;
};

export type UserAppRelease = {
  appId: typeof USER_APP_PACKAGE_ID;
  version: string;
  buildCode: number;
  minSupportedBuildCode: number;
  apkUrl: string;
  sha256: string;
  releaseNotes?: string;
};

// Checked-in release metadata keeps the public updater endpoint in sync with
// the signed APK release even when Render still has an older env-var value.
// Future configured releases with a higher build code continue to take priority.
export const LATEST_USER_APP_RELEASE: UserAppReleaseConfig = Object.freeze({
  version: '1.1.29',
  buildCode: 40,
  minSupportedBuildCode: 0,
  apkUrl: 'https://github.com/dummanihemanth86-cyber/cd-C-paisapay_starter/releases/download/paisapay-user-v1.1.29/app-release.apk',
  sha256: '0ed3201ce0fec0b042ea35728e715aaef9aa629e84f9e86b4e48d639978ea4ed',
  releaseNotes: 'PaisaPay User App 1.1.29 with refreshed branding and mobile reliability improvements. Rewards remain subject to server funding and verification.',
});

export function getConfiguredUserAppRelease(config: UserAppReleaseConfig): UserAppRelease | null {
  const { version, buildCode, minSupportedBuildCode = 0, apkUrl, sha256, releaseNotes } = config;
  if (!version || !Number.isSafeInteger(buildCode) || !buildCode || !apkUrl || !sha256) return null;

  let parsedUrl: URL;
  try { parsedUrl = new URL(apkUrl); } catch { return null; }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) return null;
  if (!/^[a-f\d]{64}$/i.test(sha256) || !Number.isSafeInteger(minSupportedBuildCode) || minSupportedBuildCode < 0 || minSupportedBuildCode > buildCode) return null;

  return {
    appId: USER_APP_PACKAGE_ID,
    version,
    buildCode,
    minSupportedBuildCode,
    apkUrl: parsedUrl.toString(),
    sha256: sha256.toLowerCase(),
    ...(releaseNotes ? { releaseNotes } : {}),
  };
}

export function getLatestUserAppRelease(config: UserAppReleaseConfig): UserAppRelease | null {
  const configured = getConfiguredUserAppRelease(config);
  const bundled = getConfiguredUserAppRelease(LATEST_USER_APP_RELEASE);
  if (!bundled) return configured;
  if (!configured || configured.buildCode < bundled.buildCode) return bundled;
  return configured;
}
