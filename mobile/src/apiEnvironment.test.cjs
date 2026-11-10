'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PRODUCTION_API, STAGING_API, resolveApiBaseUrl } = require('./apiEnvironment.cjs');
const easConfig = require('../eas.json');
const packageConfig = require('../package.json');
const { resolveProductionBuildEnvironment } = require('../scripts/buildProductionApk.cjs');

test('staging release requires an explicit staging marker and exact staging API', () => {
  assert.equal(resolveApiBaseUrl({ apiUrl: STAGING_API, deploymentEnv: 'staging', isDev: false }), STAGING_API);
  assert.throws(() => resolveApiBaseUrl({ apiUrl: STAGING_API, deploymentEnv: undefined, isDev: false }), /production builds/);
  assert.throws(() => resolveApiBaseUrl({ apiUrl: PRODUCTION_API, deploymentEnv: 'staging', isDev: false }), /staging builds/);
});

test('production release remains pinned to the production API origin', () => {
  assert.equal(resolveApiBaseUrl({ apiUrl: PRODUCTION_API, deploymentEnv: 'production', isDev: false }), PRODUCTION_API);
  assert.equal(resolveApiBaseUrl({ apiUrl: `${PRODUCTION_API}/`, deploymentEnv: 'production', isDev: false }), PRODUCTION_API);
  assert.equal(resolveApiBaseUrl({ apiUrl: `${PRODUCTION_API}////`, deploymentEnv: 'production', isDev: false }), PRODUCTION_API);
  for (const apiUrl of [
    STAGING_API,
    'http://paisapay-api.onrender.com',
    'https://paisapay-api.onrender.com.evil.example',
    'https://user@paisapay-api.onrender.com',
    'https://paisapay-api.onrender.com:444',
    `${PRODUCTION_API}/v1`,
    `${PRODUCTION_API}?target=production`,
    `${PRODUCTION_API}#fragment`,
  ]) {
    assert.throws(() => resolveApiBaseUrl({ apiUrl, deploymentEnv: 'production', isDev: false }), undefined, apiUrl);
  }
});

test('local Android production APK build explicitly embeds the approved production origin', () => {
  assert.deepEqual(resolveProductionBuildEnvironment(easConfig), {
    EXPO_PUBLIC_API_URL: PRODUCTION_API,
    EXPO_PUBLIC_DEPLOYMENT_ENV: 'production',
  });
  assert.equal(packageConfig.scripts['build:release:apk'], 'node scripts/buildProductionApk.cjs');

  for (const profile of [
    { build: { 'production-apk': { env: { EXPO_PUBLIC_API_URL: STAGING_API, EXPO_PUBLIC_DEPLOYMENT_ENV: 'production' } } } },
    { build: { 'production-apk': { env: { EXPO_PUBLIC_API_URL: PRODUCTION_API, EXPO_PUBLIC_DEPLOYMENT_ENV: 'staging' } } } },
    { build: { 'production-apk': { env: { EXPO_PUBLIC_DEPLOYMENT_ENV: 'production' } } } },
  ]) {
    assert.throws(() => resolveProductionBuildEnvironment(profile));
  }
});

test('release builds reject other hosts, paths, empty URLs and unknown environments', () => {
  for (const apiUrl of ['', 'https://attacker.example', `${PRODUCTION_API}/v1`]) {
    assert.throws(() => resolveApiBaseUrl({ apiUrl, deploymentEnv: 'production', isDev: false }));
  }
  assert.throws(() => resolveApiBaseUrl({ apiUrl: PRODUCTION_API, deploymentEnv: 'preview', isDev: false }), /deployment environment/);
});

test('development permits local HTTP while still requiring a valid origin', () => {
  assert.equal(resolveApiBaseUrl({ apiUrl: 'http://127.0.0.1:4000', isDev: true }), 'http://127.0.0.1:4000');
  assert.throws(() => resolveApiBaseUrl({ apiUrl: 'ftp://api.example', isDev: true }), /HTTP or HTTPS/);
});
