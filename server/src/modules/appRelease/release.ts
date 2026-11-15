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
