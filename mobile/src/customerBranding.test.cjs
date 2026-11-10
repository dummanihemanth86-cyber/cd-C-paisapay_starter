'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
const app = readFileSync(join(root, 'App.js'), 'utf8');
const home = readFileSync(join(root, 'src', 'UltraHome.js'), 'utf8');
const manifest = readFileSync(join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');

test('customer logo is integrated into launcher, splash, login, navigation and dashboard', () => {
  assert.equal(config.icon, './assets/paisapay-customer-emblem.png');
  assert.equal(config.android.adaptiveIcon.foregroundImage, './assets/paisapay-customer-emblem.png');
  assert.equal(config.splash.image, './assets/paisapay-customer-brand.png');
  assert.ok(existsSync(join(root, config.icon)));
  assert.ok(existsSync(join(root, config.splash.image)));
  assert.equal((app.match(/require\('\.\/assets\/paisapay-customer-emblem\.png'\)/g) || []).length, 2);
  assert.match(app, /require\('\.\/assets\/paisapay-customer-brand\.png'\)/);
  assert.match(home, /\.\.\/assets\/paisapay-customer-emblem\.png/);
  assert.notEqual(config.icon, '../apps/admin-app/assets/paisapay-admin-emblem.png');
  assert.ok(config.android.blockedPermissions.includes('android.permission.SYSTEM_ALERT_WINDOW'));
  assert.ok(config.android.blockedPermissions.includes('android.permission.RECORD_AUDIO'));
  assert.doesNotMatch(manifest, /android\.permission\.(SYSTEM_ALERT_WINDOW|RECORD_AUDIO|WRITE_EXTERNAL_STORAGE)/);
  assert.match(manifest, /android\.permission\.READ_EXTERNAL_STORAGE/);
});
