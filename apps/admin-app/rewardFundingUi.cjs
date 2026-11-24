'use strict';

/** Parse a user-entered INR amount without binary floating-point rounding. */
function parseRupeesToPaise(value) {
  const normalized = String(value ?? '').trim();
  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const wholePaise = BigInt(match[1]) * 100n;
  const fractionPaise = BigInt((match[2] || '').padEnd(2, '0') || '0');
  const amountPaise = wholePaise + fractionPaise;
  if (amountPaise > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(amountPaise);
}

module.exports = { parseRupeesToPaise };
