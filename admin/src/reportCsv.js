const COLUMNS = ['section', 'date', 'status', 'count', 'amountPaise'];

export function formatPaise(value) {
  let paise;
  try { paise = BigInt(value == null ? '0' : String(value)); } catch { return '—'; }
  const negative = paise < 0n; const absolute = negative ? -paise : paise;
  const digits = (absolute / 100n).toString();
  const grouped = digits.length <= 3 ? digits : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${digits.slice(-3)}`;
  return `${negative ? '-' : ''}₹${grouped}.${String(absolute % 100n).padStart(2, '0')}`;
}

function csvValue(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildReportCsv(report) {
  if (!report || !Array.isArray(report.daily) || !Array.isArray(report.statusBreakdown)) throw new TypeError('A valid report result is required.');
  const rows = [COLUMNS];
  rows.push(['summary', `${report.from} to ${report.to}`, 'ALL', report.total, report.totalAmountPaise ?? '']);
  for (const item of report.daily) rows.push(['daily', item.date, '', item.count, item.amountPaise ?? '']);
  for (const item of report.statusBreakdown) rows.push(['status', '', item.status, item.count, item.amountPaise ?? '']);
  return rows.map((row) => row.map(csvValue).join(',')).join('\r\n');
}

export function reportStatusOptions(kind) {
  return ({
    registrations: ['PENDING_PROFILE', 'ACTIVE', 'SUSPENDED', 'CLOSED'],
    deposits: ['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_VERIFIED', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'REVERSED'],
    withdrawals: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED'],
    'p2p-orders': ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_SUBMITTED', 'PAYMENT_PROCESSING', 'PAYMENT_UNDER_REVIEW', 'PAYMENT_REVIEW', 'PAYMENT_UNCERTAIN', 'PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'COMPLETED', 'SETTLED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'DISPUTED', 'FAILED'],
    'support-tickets': ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  })[kind] || [];
}
