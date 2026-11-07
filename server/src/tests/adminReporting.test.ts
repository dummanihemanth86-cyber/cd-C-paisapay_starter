import { describe, expect, it } from 'vitest';
import { formatReportResult, reportQuerySchema, safeSettingsSnapshot } from '../modules/admin/reporting.js';

describe('Admin report inputs and summaries', () => {
  it('accepts bounded inclusive date ranges and only statuses from the selected report', () => {
    expect(reportQuerySchema.parse({ report: 'deposits', from: '2026-01-01', to: '2026-01-31', status: 'COMPLETED' }).status).toBe('COMPLETED');
    expect(() => reportQuerySchema.parse({ report: 'deposits', from: '2026-01-01', to: '2026-01-31', status: 'OPEN' })).toThrow();
    expect(() => reportQuerySchema.parse({ report: 'deposits', from: '2026-02-01', to: '2026-01-31' })).toThrow();
    expect(() => reportQuerySchema.parse({ report: 'deposits', from: '2025-01-01', to: '2026-01-02' })).toThrow();
    expect(() => reportQuerySchema.parse({ report: 'deposits', from: '2026-02-30', to: '2026-03-01' })).toThrow();
  });

  it('summarizes only aggregate counts and exact paise strings, including empty dates', () => {
    const input = reportQuerySchema.parse({ report: 'deposits', from: '2026-01-01', to: '2026-01-03' });
    expect(formatReportResult(input, [
      { day: '2026-01-01', status: 'COMPLETED', recordCount: 2n, amountPaise: '25001' },
      { day: '2026-01-03', status: 'FAILED', recordCount: 1n, amountPaise: '0' },
    ])).toEqual({
      report: 'deposits', from: '2026-01-01', to: '2026-01-03', statusFilter: null, total: 3,
      totalAmountPaise: '25001',
      statusBreakdown: [{ status: 'COMPLETED', count: 2, amountPaise: '25001' }, { status: 'FAILED', count: 1, amountPaise: '0' }],
      daily: [{ date: '2026-01-01', count: 2, amountPaise: '25001' }, { date: '2026-01-02', count: 0, amountPaise: '0' }, { date: '2026-01-03', count: 1, amountPaise: '0' }],
    });
  });

  it('does not add PII or amounts to non-financial report summaries', () => {
    const input = reportQuerySchema.parse({ report: 'registrations', from: '2026-01-01', to: '2026-01-01' });
    const result = formatReportResult(input, [{ day: '2026-01-01', status: 'ACTIVE', recordCount: 1n, amountPaise: null }]);
    expect(result).toEqual({ report: 'registrations', from: '2026-01-01', to: '2026-01-01', statusFilter: null, total: 1, statusBreakdown: [{ status: 'ACTIVE', count: 1 }], daily: [{ date: '2026-01-01', count: 1 }] });
    expect(JSON.stringify(result)).not.toMatch(/phone|email|publicId|userId/i);
  });

  it('exposes safe read-only settings without secrets or mutation controls', () => {
    const result = safeSettingsSnapshot({ nodeEnv: 'test', financialOperationsEnabled: false, paymentProvider: 'disabled', otpProvider: 'disabled', databaseConfigured: false });
    expect(result).toMatchObject({ financialOperationsEnabled: false, paymentProvider: 'disabled', editableSettings: [] });
    expect(Object.keys(result).join(',')).not.toMatch(/secret|password|token|databaseUrl|apiKey/i);
    expect(result.message).toContain('read-only');
  });
});
