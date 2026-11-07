export function normalizePagination(total, page, pageSize) {
  const safeTotal = Number.isSafeInteger(Number(total)) && Number(total) >= 0 ? Number(total) : 0;
  const safePageSize = Number.isSafeInteger(Number(pageSize)) && Number(pageSize) > 0 ? Math.min(100, Number(pageSize)) : 25;
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const safePage = Number.isSafeInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const currentPage = Math.min(safePage, pageCount);
  return { page: currentPage, pageSize: safePageSize, total: safeTotal, pageCount, hasPrevious: currentPage > 1, hasNext: currentPage < pageCount };
}

export function buildAdminListQuery({ page = 1, pageSize = 25, q = '', status = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (String(q).trim()) params.set('q', String(q).trim());
  if (String(status).trim()) params.set('status', String(status).trim());
  return `?${params.toString()}`;
}
