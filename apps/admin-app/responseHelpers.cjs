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
  const offerPayload = asRecord(offers);
  const orderPayload = asRecord(orders);
  const claimPayload = asRecord(claims);
  return {
    ...summary,
    offers: asRecord(summary.offers),
    orders: asRecord(summary.orders),
    pendingClaims: Number(summary.pendingClaims) || 0,
    offerRecords: asArray(offerPayload.offers),
    orderRecords: asArray(orderPayload.orders),
    offerPage: Number(offerPayload.page) || 1,
    offerPageSize: Number(offerPayload.pageSize) || 25,
    offerTotal: Number(offerPayload.total) || 0,
    orderPage: Number(orderPayload.page) || 1,
    orderPageSize: Number(orderPayload.pageSize) || 25,
    orderTotal: Number(orderPayload.total) || 0,
    claimPage: Number(claimPayload.page) || 1,
    claimPageSize: Number(claimPayload.pageSize) || 25,
    claimTotal: Number(claimPayload.total) || 0,
    claims: asArray(claimPayload.claims),
  };
}

function paginationState(total, page, pageSize) {
  const safeTotal = Number.isSafeInteger(Number(total)) && Number(total) >= 0 ? Number(total) : 0;
  const safePage = Number.isSafeInteger(Number(page)) && Number(page) >= 1 ? Number(page) : 1;
  const safePageSize = Number.isSafeInteger(Number(pageSize)) && Number(pageSize) >= 1 ? Math.min(100, Number(pageSize)) : 25;
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePageSize));
  return { page: Math.min(safePage, pageCount), pageSize: safePageSize, total: safeTotal, pageCount, hasPrevious: safePage > 1, hasNext: safePage < pageCount };
}

function formatPaise(value) {
  if (!(typeof value === 'string' && /^\d+$/.test(value)) && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return '—';
  const paise = BigInt(value);
  const rupees = paise / 100n;
  const fraction = String(paise % 100n).padStart(2, '0');
  return `₹${rupees.toLocaleString('en-IN')}.${fraction}`;
}

function normalizeSupportTicket(value) {
  const ticket = asRecord(value);
  return { ...ticket, messages: asArray(ticket.messages) };
}

module.exports = { asArray, asRecord, ensureApiObject, normalizeListPayload, normalizeP2pPayload, normalizeSupportTicket, paginationState, formatPaise };
