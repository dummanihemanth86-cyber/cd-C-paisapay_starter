import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminListQuery, normalizePagination } from './pagination.js';

test('browser admin pagination has correct boundary controls', () => {
  assert.deepEqual(normalizePagination(0, 1, 25), { page: 1, pageSize: 25, total: 0, pageCount: 1, hasPrevious: false, hasNext: false });
  assert.deepEqual(normalizePagination(51, 1, 25), { page: 1, pageSize: 25, total: 51, pageCount: 3, hasPrevious: false, hasNext: true });
  assert.deepEqual(normalizePagination(51, 3, 25), { page: 3, pageSize: 25, total: 51, pageCount: 3, hasPrevious: true, hasNext: false });
  assert.equal(normalizePagination(51, 999, 25).page, 3);
});

test('pagination query retains search and status filters and page metadata is bounded', () => {
  assert.equal(buildAdminListQuery({ page: 2, pageSize: 50, q: ' user 42 ', status: 'ACTIVE' }), '?page=2&pageSize=50&q=user+42&status=ACTIVE');
  assert.deepEqual(normalizePagination(10, 1, 500), { page: 1, pageSize: 100, total: 10, pageCount: 1, hasPrevious: false, hasNext: false });
});
