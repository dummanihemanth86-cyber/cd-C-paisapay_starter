import { z } from 'zod';

/**
 * Build safe search predicates for the Admin user list. Phone numbers are
 * stored in E.164 form, while operators commonly paste local or formatted
 * numbers (for example, `630-330-2128` or `+91 630 330 2128`). Search by
 * digits-only variants so those inputs resolve to the same account.
 */
export function buildUserLookupConditions(query: string) {
  const trimmed = query.trim();
  const conditions: Array<Record<string, unknown>> = [
    { publicId: { contains: trimmed, mode: 'insensitive' } },
    { displayName: { contains: trimmed, mode: 'insensitive' } },
  ];

  if (z.string().uuid().safeParse(trimmed).success) conditions.push({ id: trimmed });

  // Only interpret phone-like input as a phone number, avoiding accidental
  // broad phone matches for IDs or names that happen to contain digits.
  if (/^\+?[\d\s().-]+$/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 3) {
      const phoneVariants = new Set([digits]);
      if (digits.startsWith('00') && digits.length > 2) phoneVariants.add(digits.slice(2));
      if (digits.startsWith('0') && digits.length === 11) phoneVariants.add(digits.slice(1));
      if (digits.startsWith('91') && digits.length === 12) phoneVariants.add(digits.slice(2));
      for (const phone of phoneVariants) conditions.push({ phoneE164: { contains: phone } });
    }
  }

  return conditions;
}
