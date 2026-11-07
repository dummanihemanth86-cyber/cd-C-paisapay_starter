'use strict';

const MAX_ADMIN_ADJUSTMENT_PAISE = 1_000_000;

function parseRupeesToPaise(value) {
  const match = String(value ?? '').trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(paise) && paise >= 1 && paise <= MAX_ADMIN_ADJUSTMENT_PAISE ? paise : null;
}

function walletAdjustmentUiState(role, allowed, enabled) {
  const permitted = String(role || '').toUpperCase() === 'ADMIN' && allowed === true;
  return {
    visible: permitted,
    enabled: permitted && enabled === true,
    reason: !permitted
      ? 'Only the explicitly configured PaisaPay ADMIN account can access wallet adjustments.'
      : enabled === true
        ? ''
        : 'Wallet adjustments are disabled until production financial controls and the adjustment funding account are approved.',
  };
}

function newIdempotencyKey(random = Math.random) {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(random() * 16);
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

module.exports = { MAX_ADMIN_ADJUSTMENT_PAISE, parseRupeesToPaise, walletAdjustmentUiState, newIdempotencyKey };
