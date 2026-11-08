const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ADMIN_API_VERSION_PATH,
  STAGING_ADMIN_VERSION_URL,
  STAGING_ADMIN_WEB_URL,
  adminUpdateState,
  isValidAdminRelease,
} = require('./adminUpdate.cjs');

const stagingApi = { service: 'paisapay-api', deploymentEnvironment: 'staging', buildId: 'abcdef1234567890' };
const latestRelease = { appId: 'com.paisapay.admin', buildId: 'fedcba0987654321', buildCode: 4_000_123, version: '1.0.3', apiBase: 'https://paisapay-api-staging.onrender.com', deploymentEnvironment: 'staging' };

test('version check points only to the staging API release endpoint and Pages app', () => {
  assert.equal(ADMIN_API_VERSION_PATH, '/api/v1/admin/app-version');
  assert.equal(STAGING_ADMIN_WEB_URL, 'https://dummanihemanth86-cyber.github.io/cd-C-paisapay_starter/');
  assert.equal(STAGING_ADMIN_VERSION_URL, `${STAGING_ADMIN_WEB_URL}admin-version.json`);
  assert.equal(STAGING_ADMIN_WEB_URL.includes('paisapay-api.onrender.com'), false);
});

test('newer valid staging release enables the blinking update button', () => {
  assert.equal(isValidAdminRelease(latestRelease), true);
  assert.deepEqual(adminUpdateState(4, stagingApi, latestRelease), {
    available: true,
    label: 'UPDATE AVAILABLE',
    blink: true,
    updateUrl: STAGING_ADMIN_WEB_URL,
  });
});

test('same or older build does not display an update', () => {
  assert.equal(adminUpdateState(latestRelease.buildCode, stagingApi, latestRelease).available, false);
  assert.equal(adminUpdateState(latestRelease.buildCode + 1, stagingApi, latestRelease).available, false);
});

test('invalid, production, or malformed release metadata fails closed', () => {
  assert.equal(adminUpdateState(4, { ...stagingApi, deploymentEnvironment: 'production' }, latestRelease).available, false);
  assert.equal(adminUpdateState(4, stagingApi, { ...latestRelease, buildCode: 'NaN' }).available, false);
  assert.equal(adminUpdateState(4, stagingApi, { ...latestRelease, appId: 'another-app' }).available, false);
  assert.equal(adminUpdateState(4, stagingApi, { ...latestRelease, apiBase: 'https://paisapay-api.onrender.com' }).available, false);
});
