const test = require('node:test');
const assert = require('node:assert/strict');
const { adminRecordDetailPath } = require('./adminRecordNavigation.cjs');

test('user and support rows route to their existing authorized detail endpoints', () => {
  assert.equal(adminRecordDetailPath('users', 'user/with spaces'), '/api/v1/admin/users/user%2Fwith%20spaces');
  assert.equal(adminRecordDetailPath('support', 'ticket-1'), '/api/v1/admin/support/tickets/ticket-1');
});

test('known list details use returned row data when no backend detail route exists', () => {
  for (const section of ['deposits', 'withdrawals', 'p2p', 'transactions', 'referrals']) assert.equal(adminRecordDetailPath(section, 'record-1'), null);
  assert.equal(adminRecordDetailPath('users', ''), null);
  assert.equal(adminRecordDetailPath('users', null), null);
});
