const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REMEMBERED_SESSION_MAX_AGE_MS, createSessionPersistencePolicy, isRememberedSessionExpired, rememberedSessionStartedAt } = require('./sessionPersistence.cjs');

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

test('remembered sessions expire exactly 24 hours after sign-in and legacy sessions receive a 24-hour migration window', () => {
  const now = 1_800_000_000_000;
  const session = { rememberedAt: now };
  assert.equal(isRememberedSessionExpired(session, now + REMEMBERED_SESSION_MAX_AGE_MS - 1), false);
  assert.equal(isRememberedSessionExpired(session, now + REMEMBERED_SESSION_MAX_AGE_MS), true);
  assert.equal(isRememberedSessionExpired({}, now), false);
  assert.equal(isRememberedSessionExpired({ rememberedAt: null }, now), false);
  assert.equal(rememberedSessionStartedAt({}, now), now);
});

test('API token refresh uses the remembered-session policy instead of forcing persistence', () => {
  const apiSource = fs.readFileSync(path.resolve(__dirname, 'api.js'), 'utf8');
  const appSource = fs.readFileSync(path.resolve(__dirname, '../App.js'), 'utf8');

  assert.match(apiSource, /rememberedAt: rememberedSessionStartedAt/);
  assert.match(apiSource, /isRememberedSessionExpired\(session\)/);
  assert.match(apiSource, /saveSession\(refreshed\)/);
  assert.match(appSource, /saveSession\)\(result, \{ remember \}\)/);
  assert.match(appSource, /autoComplete: "current-password"/);
  assert.match(appSource, /autoComplete: "tel"/);
  assert.doesNotMatch(apiSource, /SecureStore\.setItemAsync\([^\n]*password/i);
});
