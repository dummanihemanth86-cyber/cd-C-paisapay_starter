const STAGING_API = 'https://paisapay-api-staging.onrender.com';
const PRODUCTION_API = 'https://paisapay-api.onrender.com';

function normalizeOrigin(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error('PaisaPay Admin API URL is not configured.');
  const normalized = raw.replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(normalized); } catch {
    throw new Error('PaisaPay Admin API URL must be a valid URL origin.');
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== normalized) {
    throw new Error('PaisaPay Admin API URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  }
  return { normalized, protocol: parsed.protocol };
}

function resolveAdminApiBaseUrl({ apiUrl, deploymentEnv, isDev }) {
  const { normalized, protocol } = normalizeOrigin(apiUrl);
  const environment = typeof deploymentEnv === 'string' ? deploymentEnv.trim().toLowerCase() : '';

  if (environment === 'production') {
    if (normalized !== PRODUCTION_API) throw new Error('PaisaPay Admin production builds must use the approved production API origin.');
    return normalized;
  }
  if (environment === 'staging') {
    if (normalized !== STAGING_API) throw new Error('PaisaPay Admin staging builds must use the approved staging API origin.');
    return normalized;
  }
  if (!isDev) throw new Error('PaisaPay Admin release builds require an explicit production or staging deployment environment.');
  return normalized;
}

module.exports = { STAGING_API, PRODUCTION_API, resolveAdminApiBaseUrl };
