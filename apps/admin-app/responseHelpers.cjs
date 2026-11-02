const LIST_FIELD_BY_SECTION = {
  users: 'users', deposits: 'deposits', withdrawals: 'withdrawals', transactions: 'transactions',
  ledger: 'entries', referrals: 'referrals', commissions: 'commissions', disputes: 'disputes',
  support: 'tickets', admins: 'admins', audit: 'auditLogs', alerts: 'events', rewardRules: 'rules',
};

const asArray = value => Array.isArray(value) ? value : [];
const asRecord = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function ensureApiObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PaisaPay API returned an empty or invalid response. Refresh and try again.');
  }
  return value;
}

function normalizeListPayload(section, value) {
  const payload = asRecord(value);
  const field = LIST_FIELD_BY_SECTION[section];
  return field ? { ...payload, [field]: asArray(payload[field]) } : payload;
}

function normalizeP2pPayload(overview, offers, orders, claims) {
  const summary = asRecord(overview);
  return {
    ...summary,
    offers: asRecord(summary.offers),
    orders: asRecord(summary.orders),
    pendingClaims: Number(summary.pendingClaims) || 0,
    offerRecords: asArray(asRecord(offers).offers),
    orderRecords: asArray(asRecord(orders).orders),
    claims: asArray(asRecord(claims).claims),
  };
}

function normalizeSupportTicket(value) {
  const ticket = asRecord(value);
  return { ...ticket, messages: asArray(ticket.messages) };
}

module.exports = { asArray, asRecord, ensureApiObject, normalizeListPayload, normalizeP2pPayload, normalizeSupportTicket };
