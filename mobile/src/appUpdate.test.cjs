'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { APP_ID, APP_VERSION_PATH, getUpdateState, normalizeReleaseManifest } = require('./appUpdate.cjs');

const release = {
  appId: APP_ID,
  version: '1.0.1',
  buildCode: 2,
  minSupportedBuildCode: 2,
  apkUrl: 'https://github.com/example/paisapay/releases/download/v1.0.1/paisapay-user.apk',
  sha256: 'a'.repeat(64),
  releaseNotes: 'Fixes availability messaging and adds secure app updates.',
};

test('User App update uses the backend release endpoint and requires verified HTTPS release metadata', () => {
  assert.equal(APP_VERSION_PATH, '/api/v1/app-version');
  assert.deepEqual(normalizeReleaseManifest(release), release);
  for (const invalid of [
    { ...release, appId: 'com.paisapay.admin' },
    { ...release, apkUrl: 'http://example.com/app.apk' },
    { ...release, apkUrl: 'https://user:password@example.com/app.apk' },
    { ...release, apkUrl: 'https://example.com/app.apk?token=secret' },
    { ...release, sha256: 'not-a-digest' },
    { ...release, buildCode: 1.5 },
    { ...release, releaseNotes: 'x'.repeat(501) },
  ]) assert.equal(normalizeReleaseManifest(invalid), null);
});

test('update prompt appears only for a newer build and marks releases below the minimum as required', () => {
  assert.deepEqual(getUpdateState({ buildCode: 1 }, release), { available: true, mandatory: true, release });
  assert.equal(getUpdateState({ buildCode: 2 }, release).available, false);
  assert.equal(getUpdateState({ buildCode: 3 }, release).available, false);
  assert.equal(getUpdateState({ buildCode: 1 }, { ...release, buildCode: 1 }).available, false);
  assert.equal(getUpdateState({ buildCode: 1 }, { ...release, appId: 'other' }).available, false);
  assert.equal(getUpdateState({ buildCode: 0 }, { ...release, minSupportedBuildCode: 0 }).mandatory, false);
});
