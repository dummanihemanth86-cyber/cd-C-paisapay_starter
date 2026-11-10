const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSessionPersistencePolicy } = require('./sessionPersistence.cjs');

test('a non-remembered login remains in-memory when access tokens refresh', () => {
  const policy = createSessionPersistencePolicy();
  policy.setRemembered(false);
  assert.equal(policy.shouldPersist(), false);
  assert.equal(policy.shouldPersist(), false);
});

test('remembered sessions persist across token refresh and logout resets the next login policy', () => {
  const policy = createSessionPersistencePolicy();
  policy.setRemembered(true);
  assert.equal(policy.shouldPersist(), true);
  policy.reset();
  assert.equal(policy.shouldPersist(), true);
});

test('API token refresh uses the remembered-session policy instead of forcing persistence', () => {
  const apiSource = fs.readFileSync(path.resolve(__dirname, 'api.js'), 'utf8');
  const appSource = fs.readFileSync(path.resolve(__dirname, '../App.js'), 'utf8');

  assert.match(apiSource, /if \(persistencePolicy\.shouldPersist\(\)\) await SecureStore\.setItemAsync/);
  assert.match(apiSource, /saveSession\(refreshed\)/);
  assert.match(appSource, /saveSession\)\(result, \{ remember \}\)/);
});
