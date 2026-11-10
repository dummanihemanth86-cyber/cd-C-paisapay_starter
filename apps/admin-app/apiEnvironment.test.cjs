const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STAGING_API, PRODUCTION_API, resolveAdminApiBaseUrl } = require('./apiEnvironment.cjs');

test('Admin release accepts only the exact production origin and normalizes trailing slashes', () => {
  assert.equal(resolveAdminApiBaseUrl({ apiUrl: `${PRODUCTION_API}///`, deploymentEnv: 'production', isDev: false }), PRODUCTION_API);
});

test('Admin staging release accepts only its exact API origin', () => {
  assert.equal(resolveAdminApiBaseUrl({ apiUrl: STAGING_API, deploymentEnv: 'staging', isDev: false }), STAGING_API);
});

test('Admin production rejects staging, local, foreign, path, credential and empty URLs', () => {
  for (const apiUrl of [STAGING_API, 'http://localhost:4000', 'https://evil.example', `${PRODUCTION_API}/api`, 'https://user:pass@paisapay-api.onrender.com', '']) {
    assert.throws(() => resolveAdminApiBaseUrl({ apiUrl, deploymentEnv: 'production', isDev: false }));
  }
});

test('Admin staging rejects production and unknown origins', () => {
  assert.throws(() => resolveAdminApiBaseUrl({ apiUrl: PRODUCTION_API, deploymentEnv: 'staging', isDev: false }));
  assert.throws(() => resolveAdminApiBaseUrl({ apiUrl: 'https://unknown.example', deploymentEnv: 'staging', isDev: false }));
});

test('Admin release without an explicit deployment environment fails closed', () => {
  assert.throws(() => resolveAdminApiBaseUrl({ apiUrl: PRODUCTION_API, deploymentEnv: '', isDev: false }), /explicit production or staging/);
});

test('Admin development can use a valid local HTTP origin', () => {
  assert.equal(resolveAdminApiBaseUrl({ apiUrl: 'http://10.0.2.2:4000/', deploymentEnv: '', isDev: true }), 'http://10.0.2.2:4000');
});

test('Admin UI resolves its API through the strict environment validator', () => {
  const app = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');
  assert.match(app, /resolveAdminApiBaseUrl/);
  assert.match(app, /EXPO_PUBLIC_ADMIN_DEPLOYMENT_ENV/);
  assert.doesNotMatch(app, /EXPO_PUBLIC_API_URL\s*\|\|\s*['"]https:\/\/paisapay-api-staging/);
});
