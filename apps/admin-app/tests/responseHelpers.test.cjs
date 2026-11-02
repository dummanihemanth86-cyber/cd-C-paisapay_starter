const test = require('node:test');
const assert = require('node:assert/strict');
const {
  asArray,
  ensureApiObject,
  normalizeListPayload,
  normalizeP2pPayload,
  normalizeSupportTicket,
} = require('../responseHelpers.cjs');

test('list payloads always expose the expected array, even when API data is missing or malformed', () => {
  assert.deepEqual(normalizeListPayload('deposits', { total: 3 }).deposits, []);
  assert.deepEqual(normalizeListPayload('deposits', { deposits: null }).deposits, []);
  assert.deepEqual(normalizeListPayload('deposits', { deposits: { id: 'not-a-list' } }).deposits, []);
  assert.deepEqual(normalizeListPayload('deposits', { deposits: [{ id: 'd1' }] }).deposits, [{ id: 'd1' }]);
});

test('P2P and support responses normalize nested collections instead of trusting API shapes', () => {
  const p2p = normalizeP2pPayload(null, { offers: null }, {}, { claims: {} });
  assert.deepEqual(p2p.offerRecords, []);
  assert.deepEqual(p2p.orderRecords, []);
  assert.deepEqual(p2p.claims, []);
  assert.equal(p2p.pendingClaims, 0);
  assert.deepEqual(normalizeSupportTicket({ messages: null }).messages, []);
  assert.deepEqual(normalizeSupportTicket({ messages: [{ id: 'm1' }] }).messages, [{ id: 'm1' }]);
  assert.deepEqual(asArray(undefined), []);
});

test('successful API responses must be valid JSON objects', () => {
  assert.deepEqual(ensureApiObject({ ok: true }), { ok: true });
  assert.throws(() => ensureApiObject(null), /empty or invalid response/);
  assert.throws(() => ensureApiObject([]), /empty or invalid response/);
});
