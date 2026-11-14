import { describe, expect, it, vi } from 'vitest';
import { createFinancialWorkerGate, financialBackgroundWorkEnabled } from '../lib/financialWorkerGate.js';

describe('financialBackgroundWorkEnabled', () => {
  it('runs financial and manual UPI maintenance only when either matching gate is enabled', () => {
    expect(financialBackgroundWorkEnabled(false, false)).toBe(false);
    expect(financialBackgroundWorkEnabled(true, false)).toBe(true);
    expect(financialBackgroundWorkEnabled(false, true)).toBe(true);
    expect(financialBackgroundWorkEnabled(true, true)).toBe(true);
  });
});

describe('financial background worker gate', () => {
  it('skips every worker tick while disabled and logs one informational notice', () => {
    const onDisabled = vi.fn();
    const expireP2pOffersBatch = vi.fn();
    const runFinancialWorker = createFinancialWorkerGate(false, onDisabled);

    for (let tick = 0; tick < 5; tick += 1) {
      expect(runFinancialWorker(expireP2pOffersBatch)).toBe(false);
    }

    expect(expireP2pOffersBatch).not.toHaveBeenCalled();
    expect(onDisabled).toHaveBeenCalledTimes(1);
  });

  it('runs the worker when explicitly enabled', () => {
    const onDisabled = vi.fn();
    const expireP2pOffersBatch = vi.fn();
    const runFinancialWorker = createFinancialWorkerGate(true, onDisabled);

    expect(runFinancialWorker(expireP2pOffersBatch)).toBe(true);
    expect(expireP2pOffersBatch).toHaveBeenCalledTimes(1);
    expect(onDisabled).not.toHaveBeenCalled();
  });
});
