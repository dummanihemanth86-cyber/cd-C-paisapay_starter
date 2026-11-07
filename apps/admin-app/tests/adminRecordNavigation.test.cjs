const test = require('node:test');
const assert = require('node:assert/strict');
const { adminRecordDetailPath } = require('../../../shared/adminRecordNavigation.cjs');

test('native admin opens user and support details through existing backend routes', () => {
  assert.equal(adminRecordDetailPath('users', 'user-1'), '/api/v1/admin/users/user-1');
  assert.equal(adminRecordDetailPath('support', 'ticket-1'), '/api/v1/admin/support/tickets/ticket-1');
  assert.equal(adminRecordDetailPath('withdrawals', 'w-1'), null);
});
