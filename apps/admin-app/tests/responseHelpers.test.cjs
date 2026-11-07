const test = require('node:test');
const assert = require('node:assert/strict');
const {
  asArray,
  ensureApiObject,
  normalizeListPayload,
  normalizeP2pPayload,
  normalizeSupportTicket,
  paginationState,
  formatPaise,
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

test('pagination metadata has stable empty, first, middle, last and out-of-range boundaries', () => {
  assert.deepEqual(paginationState(0, 1, 25), { page: 1, pageSize: 25, total: 0, pageCount: 1, hasPrevious: false, hasNext: false });
  assert.deepEqual(paginationState(51, 1, 25), { page: 1, pageSize: 25, total: 51, pageCount: 3, hasPrevious: false, hasNext: true });
  assert.deepEqual(paginationState(51, 2, 25), { page: 2, pageSize: 25, total: 51, pageCount: 3, hasPrevious: true, hasNext: true });
  assert.deepEqual(paginationState(51, 3, 25), { page: 3, pageSize: 25, total: 51, pageCount: 3, hasPrevious: true, hasNext: false });
  assert.equal(paginationState(51, 99, 25).page, 3);
});

test('P2P payload retains bounded page and total metadata for orders and offers', () => {
  const p2p = normalizeP2pPayload({}, { offers: [], page: 2, pageSize: 10, total: 27 }, { orders: [], page: 3, pageSize: 10, total: 29 }, {});
  assert.equal(p2p.offerPage, 2);
  assert.equal(p2p.offerTotal, 27);
  assert.equal(p2p.orderPage, 3);
  assert.equal(p2p.orderTotal, 29);
});

test('report paise values format exactly without floating-point rounding', () => {
  assert.equal(formatPaise('12345678901234567890'), '₹1,23,45,67,89,01,23,45,678.90');
  assert.equal(formatPaise(100), '₹1.00');
  assert.equal(formatPaise('not-paise'), '—');
});
