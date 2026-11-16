'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runInBackground } = require('./backgroundHydration.cjs');

test('session screen can advance before private account hydration completes', async () => {
  let finishHydration;
  let completed = false;
  const pending = runInBackground(() => new Promise((resolve) => { finishHydration = resolve; }))
    .then(() => { completed = true; });

  await Promise.resolve();
  assert.equal(typeof finishHydration, 'function');
  assert.equal(completed, false);
  finishHydration();
  await pending;
  assert.equal(completed, true);
});

test('background API failure is reported without an unhandled rejection', async () => {
  const error = new Error('temporary API outage');
  let reported;
  await runInBackground(() => Promise.reject(error), (value) => { reported = value; });
  assert.equal(reported, error);
});
