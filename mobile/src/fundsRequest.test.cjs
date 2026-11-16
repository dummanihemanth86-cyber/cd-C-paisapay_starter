const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Profile no longer offers a separate funds request; general support remains available', () => {
  const profile = fs.readFileSync(path.resolve(__dirname, 'ProfileScreen.js'), 'utf8');
  const app = fs.readFileSync(path.resolve(__dirname, '../App.js'), 'utf8');
  assert.doesNotMatch(profile, /\['Request funds',/);
  assert.doesNotMatch(profile, /subject: 'Funds request'/);
  assert.match(profile, /\['Support', 'Support'/);
  assert.match(profile, /onPress\(item\[1\], item\[4\]\)/);
  assert.match(app, /apiPost\)\('\/api\/v1\/support\/tickets'/);
});
