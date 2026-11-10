'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const appConfig = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
const appSource = readFileSync(join(root, 'App.js'), 'utf8');
const webSource = readFileSync(join(root, '..', '..', 'admin', 'src', 'main.jsx'), 'utf8');
const manifest = readFileSync(join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');

test('Admin launcher, splash, login and dashboard use distinct Admin artwork', () => {
  assert.equal(appConfig.icon, './assets/paisapay-admin-emblem.png');
  assert.equal(appConfig.splash.image, './assets/paisapay-admin-brand.png');
  assert.equal(appConfig.android.adaptiveIcon.foregroundImage, './assets/paisapay-admin-emblem.png');
  assert.ok(existsSync(join(root, appConfig.icon)));
  assert.ok(existsSync(join(root, appConfig.splash.image)));
  assert.equal((appSource.match(/require\('\.\/assets\/paisapay-admin-emblem\.png'\)/g) || []).length, 2);
  assert.match(webSource, /src="\/paisapay-admin-emblem\.png" alt="PaisaPay Admin security emblem"/);
  assert.ok(existsSync(join(root, '..', '..', 'admin', 'public', 'paisapay-admin-emblem.png')));
  for (const permission of ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW']) {
    assert.ok(appConfig.android.blockedPermissions.includes(permission));
    assert.equal(manifest.includes(permission), false);
  }
});
