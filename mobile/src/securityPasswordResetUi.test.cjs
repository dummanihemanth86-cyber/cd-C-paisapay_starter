'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const app = readFileSync(join(__dirname, '..', 'App.js'), 'utf8');

test('Security screen sends users through the implemented SMS password reset flow', () => {
  assert.match(app, /title: "Reset login password by SMS"/);
  assert.match(app, /onResetPassword: \(\) => \{ logout\(\)\.catch\(\(\) => \{\}\)\.finally\(\(\) => go\('Forgot Password'\)\); \}/);
  assert.match(app, /apiPost\)\('\/api\/v1\/auth\/forgot-password\/request-otp'/);
  assert.match(app, /apiPost\)\('\/api\/v1\/auth\/password\/reset'/);
  assert.match(app, /title: "Sign out this device"/);
  assert.doesNotMatch(app, /title: "Manage sessions"/);
  assert.doesNotMatch(app, /title: "Transaction PIN"/);
});
