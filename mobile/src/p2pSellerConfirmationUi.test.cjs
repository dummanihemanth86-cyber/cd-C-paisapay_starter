const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('seller receipt UI is gated, requests confirmation, and says Finance still verifies', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'WithdrawalScreen.js'), 'utf8');
  assert.match(source, /\/seller-received/);
  assert.match(source, /disabled=\{disabled \|\| working \|\| reference\.trim\(\)\.length < 4\}/);
  assert.match(source, /Confirm you received this payment\?/);
  assert.match(source, /will not verify or settle the payment/);
  assert.match(source, /Finance verification is still required/);
});
