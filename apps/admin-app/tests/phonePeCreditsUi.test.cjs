'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { phonePeCreditIntentUrl, validatePhonePeApproval } = require('../phonePeCreditsUi.cjs');

test('builds a standard UPI intent for the exact target and whole-rupee amount', () => {
  const url = new URL(phonePeCreditIntentUrl({ requestId: '12345678-1234-4234-9234-123456789012', receiverVpa: 'zitch@ptyes', amountPaise: 12500 }));
  assert.equal(url.protocol, 'upi:');
  const params = new URLSearchParams(url.search.slice(1));
  assert.equal(params.get('pa'), 'zitch@ptyes');
  assert.equal(params.get('am'), '125.00');
  assert.equal(params.get('cu'), 'INR');
  assert.equal(params.get('tr'), '12345678123442349234123456789012');
});

test('accepts the API request shape so the payment action opens the configured receiver', () => {
  const url = new URL(phonePeCreditIntentUrl({ id: '12345678-1234-4234-9234-123456789012', payeeVpa: 'zitch@ptyes', amountPaise: 10000 }));
  const params = new URLSearchParams(url.search.slice(1));
  assert.equal(params.get('pa'), 'zitch@ptyes');
  assert.equal(params.get('am'), '100.00');
});

test('refuses an unsafe or malformed payment intent', () => {
  assert.throws(() => phonePeCreditIntentUrl({ requestId: 'id', receiverVpa: 'zitch@ptyes', amountPaise: 5000 }));
  assert.throws(() => phonePeCreditIntentUrl({ requestId: '12345678-1234-4234-9234-123456789012', receiverVpa: '', amountPaise: 10000 }));
});

test('approval requires the exact reference, amount, payee, confirmation and reason', () => {
  const request = { amountPaise: 12500, payeeVpa: 'zitch@ptyes' };
  const valid = { request, reference: '123456789012', amountRupees: '125', payeeVpa: 'zitch@ptyes', receiverConfirmed: true, reason: 'Matched actual receipt' };
  assert.equal(validatePhonePeApproval(valid), '');
  assert.match(validatePhonePeApproval({ ...valid, receiverConfirmed: false }), /receiver-side/);
  assert.match(validatePhonePeApproval({ ...valid, amountRupees: '124' }), /exact received amount/);
  assert.match(validatePhonePeApproval({ ...valid, payeeVpa: 'attacker@upi' }), /Confirm that payment/);
});
