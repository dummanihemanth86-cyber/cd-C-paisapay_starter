const STAGING_ADMIN_WEB_URL = 'https://dummanihemanth86-cyber.github.io/cd-C-paisapay_starter/';
const STAGING_ADMIN_VERSION_URL = `${STAGING_ADMIN_WEB_URL}admin-version.json`;
const ADMIN_API_VERSION_PATH = '/api/v1/admin/app-version';
const ADMIN_APP_ID = 'com.paisapay.admin';

function normalizeBuildCode(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isValidAdminRelease(value) {
  return Boolean(value && typeof value === 'object'
    && value.appId === ADMIN_APP_ID
    && typeof value.buildId === 'string' && /^[a-f0-9-]{7,64}$/i.test(value.buildId)
    && normalizeBuildCode(value.buildCode) !== null
    && value.deploymentEnvironment === 'staging'
    && typeof value.version === 'string' && value.version.length <= 32);
}

function adminUpdateState(currentBuildCode, apiVersion, release) {
  const current = normalizeBuildCode(currentBuildCode);
  const latest = normalizeBuildCode(release?.buildCode);
  const apiIsStaging = apiVersion?.service === 'paisapay-api'
    && apiVersion?.deploymentEnvironment === 'staging'
    && typeof apiVersion?.buildId === 'string';
  const available = current !== null && latest !== null && latest > current
    && apiIsStaging && isValidAdminRelease(release);
  return {
    available,
    label: available ? 'UPDATE AVAILABLE' : '',
    blink: available,
    updateUrl: available ? STAGING_ADMIN_WEB_URL : null,
  };
}

module.exports = {
  ADMIN_API_VERSION_PATH,
  ADMIN_APP_ID,
  STAGING_ADMIN_VERSION_URL,
  STAGING_ADMIN_WEB_URL,
  adminUpdateState,
  isValidAdminRelease,
  normalizeBuildCode,
};
