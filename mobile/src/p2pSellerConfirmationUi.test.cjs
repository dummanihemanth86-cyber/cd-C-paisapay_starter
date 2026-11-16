const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('User App does not request seller receipt acknowledgement; Admin review handles settlement', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'WithdrawalScreen.js'), 'utf8');
  assert.doesNotMatch(source, /SellerReceiptAcknowledgement|seller-received|Confirm received|Your UPI transaction reference/);
  assert.match(source, /Pending withdrawal requests/);
});

test('User App offers cancellation for an active withdrawal and protects matched buyer funds', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'WithdrawalScreen.js'), 'utf8');
  assert.match(source, /Cancel withdrawal request/);
  assert.match(source, /Any already matched buyer amount stays reserved/);
  assert.match(source, /cancelOffer\?\.\(offer\)/);
  assert.doesNotMatch(source, /if \(financialActionsDisabled\) return note\?\.\('Financial actions unavailable'/);
});

test('P2P match countdown updates only at the displayed one-second precision', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'DepositScreen.js'), 'utf8');
  assert.match(source, /setMatchSeconds\(Math\.max\(0, Math\.ceil\(\(deadline - Date\.now\(\)\) \/ 1000\)\)\), 1000\)/);
  assert.doesNotMatch(source, /setMatchSeconds\(Math\.max\(0, Math\.ceil\(\(deadline - Date\.now\(\)\) \/ 1000\)\)\), 200\)/);
});
