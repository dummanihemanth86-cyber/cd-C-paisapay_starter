'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { getInstalledVersion } = require('./versionCenter.cjs');

const root = join(__dirname, '..');

test('Version Center displays the configured installed app version', () => {
  const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
  const app = readFileSync(join(root, 'App.js'), 'utf8');

  assert.equal(getInstalledVersion(), config.version);
  assert.match(app, /Installed version \\xB7 " \+ _versionCenter\.getInstalledVersion\(\)/);
  assert.doesNotMatch(app, /Installed version \\xB7 1\.0\.0/);
});
