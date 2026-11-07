function adminRecordDetailPath(section, id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  const encodedId = encodeURIComponent(id);
  if (section === 'users') return `/api/v1/admin/users/${encodedId}`;
  if (section === 'support' || section === 'tickets') return `/api/v1/admin/support/tickets/${encodedId}`;
  // Deposit, withdrawal and P2P list records already carry their safe detail
  // fields. Do not invent detail endpoints the backend does not expose.
  return null;
}

module.exports = { adminRecordDetailPath };
