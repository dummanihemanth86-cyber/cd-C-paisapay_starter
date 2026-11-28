import { describe, expect, it } from 'vitest';
import { STAGING_FINANCIAL_FLAG_NAMES, stagingFinancialFlagViolations } from '../config/stagingFinancialFlags.js';

describe('staging financial gate policy', () => {
  const allFalse = Object.fromEntries(STAGING_FINANCIAL_FLAG_NAMES.map((name) => [name, 'false']));

  it('accepts staging only when every financial flag is explicitly false', () => {
    expect(STAGING_FINANCIAL_FLAG_NAMES).toHaveLength(17);
    expect(stagingFinancialFlagViolations(allFalse)).toEqual([]);
  });

  it.each(STAGING_FINANCIAL_FLAG_NAMES)('%s blocks bootstrap/runtime staging when missing', (flag) => {
    const values = { ...allFalse };
    delete (values as Record<string, string | undefined>)[flag];
    expect(stagingFinancialFlagViolations(values)).toEqual([flag]);
  });

  it.each(STAGING_FINANCIAL_FLAG_NAMES)('%s blocks staging when true', (flag) => {
    expect(stagingFinancialFlagViolations({ ...allFalse, [flag]: 'true' })).toEqual([flag]);
  });

  it.each(STAGING_FINANCIAL_FLAG_NAMES)('%s blocks staging when unknown', (flag) => {
    expect(stagingFinancialFlagViolations({ ...allFalse, [flag]: 'enabled' })).toEqual([flag]);
  });
});
