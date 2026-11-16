'use strict';

const APP_ID = 'com.paisapay.app';
const APP_VERSION_PATH = '/api/v1/app-version';

function normalizeReleaseManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.appId !== APP_ID) return null;
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) return null;
  if (!Number.isSafeInteger(value.buildCode) || value.buildCode < 1) return null;
  if (!Number.isSafeInteger(value.minSupportedBuildCode) || value.minSupportedBuildCode < 0 || value.minSupportedBuildCode > value.buildCode) return null;
  if (typeof value.apkUrl !== 'string' || typeof value.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.sha256)) return null;

  let apkUrl;
  try { apkUrl = new URL(value.apkUrl); } catch { return null; }
  if (apkUrl.protocol !== 'https:' || !apkUrl.hostname || apkUrl.username || apkUrl.password || apkUrl.search || apkUrl.hash) return null;
  if (value.releaseNotes !== undefined && (typeof value.releaseNotes !== 'string' || value.releaseNotes.length > 500)) return null;

  return {
    appId: APP_ID,
    version: value.version,
    buildCode: value.buildCode,
    minSupportedBuildCode: value.minSupportedBuildCode,
    apkUrl: apkUrl.toString(),
    sha256: value.sha256.toLowerCase(),
    releaseNotes: value.releaseNotes || '',
  };
}

function getUpdateState(installed, value) {
  const release = normalizeReleaseManifest(value);
  if (!release || !installed || !Number.isSafeInteger(installed.buildCode) || installed.buildCode < 0) {
    return { available: false, mandatory: false, release: null };
  }
  return {
    available: release.buildCode > installed.buildCode,
    mandatory: release.buildCode > installed.buildCode && installed.buildCode < release.minSupportedBuildCode,
    release,
  };
}

module.exports = { APP_ID, APP_VERSION_PATH, getUpdateState, normalizeReleaseManifest };
