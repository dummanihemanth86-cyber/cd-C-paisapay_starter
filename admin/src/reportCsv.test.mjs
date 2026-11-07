import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportCsv, formatPaise, reportStatusOptions } from './reportCsv.js';

test('report CSV exports only aggregate fields and preserves amount paise exactly', () => {
  const csv = buildReportCsv({ report: 'support-tickets', from: '2026-01-01', to: '2026-01-02', total: 2, statusBreakdown: [{ status: 'OPEN', count: 1 }], daily: [{ date: '2026-01-01', count: 1 }, { date: '2026-01-02', count: 1 }] });
  assert.match(csv, /"summary","2026-01-01 to 2026-01-02","ALL","2",""/);
  assert.doesNotMatch(csv, /phone|email|userId|reference/i);
  assert.equal(buildReportCsv({ report: 'deposits', from: 'a', to: 'b', total: 1, totalAmountPaise: '9007199254740993', statusBreakdown: [], daily: [] }).includes('"9007199254740993"'), true);
});

test('CSV quoting handles commas, quotes, newlines and neutralizes spreadsheet formulas', () => {
  const csv = buildReportCsv({ report: 'support-tickets', from: '2026-01-01', to: '2026-01-01', total: 0, statusBreakdown: [{ status: '=HYPERLINK("x")', count: 1 }], daily: [{ date: '2026-01-01', count: 0 }] });
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
});

test('report status filters match the backend report categories', () => {
  assert.deepEqual(reportStatusOptions('support-tickets'), ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
  assert.deepEqual(reportStatusOptions('unknown'), []);
});

test('paise formatting remains exact beyond JavaScript safe integer range', () => {
  assert.equal(formatPaise('9007199254740993'), '₹9,00,71,99,25,47,409.93');
});
