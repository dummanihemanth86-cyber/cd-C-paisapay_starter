import { describe, expect, it } from 'vitest';
import { buildUserLookupConditions } from '../modules/admin/userLookup.js';

function phoneSearchTerms(query: string): string[] {
  return buildUserLookupConditions(query)
    .flatMap((condition) => {
      const phone = condition.phoneE164 as { contains?: string } | undefined;
      return phone?.contains ? [phone.contains] : [];
    });
}

describe('Admin user lookup', () => {
  it('matches a local Indian mobile number against E.164 storage', () => {
    expect(phoneSearchTerms('6303302128')).toContain('6303302128');
  });

  it('normalizes formatted and country-prefixed mobile numbers', () => {
    expect(phoneSearchTerms('+91 630-330-2128')).toEqual(expect.arrayContaining(['916303302128', '6303302128']));
    expect(phoneSearchTerms('06303302128')).toEqual(expect.arrayContaining(['06303302128', '6303302128']));
  });

  it('keeps exact UUID lookup and text lookup predicates', () => {
    const conditions = buildUserLookupConditions('00000000-0000-4000-8000-000000000001');
    expect(conditions).toContainEqual({ id: '00000000-0000-4000-8000-000000000001' });
    expect(conditions).toContainEqual({ publicId: { contains: '00000000-0000-4000-8000-000000000001', mode: 'insensitive' } });
  });

  it('does not add phone predicates for mixed text identifiers', () => {
    expect(phoneSearchTerms('PP-6303302128')).toEqual([]);
  });
});
