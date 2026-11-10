'use strict';

const PRODUCTION_API = 'https://paisapay-api.onrender.com';
const STAGING_API = 'https://paisapay-api-staging.onrender.com';

function resolveApiBaseUrl({ apiUrl, deploymentEnv, isDev }) {
  // Expo dotenv values and shell-provided values may include one or more
  // trailing origin separators. Normalize those while preserving strict origin
  // validation below; paths, query strings, credentials, ports and other hosts
  // remain invalid in release builds.
  const value = String(apiUrl || '').trim().replace(/\/+$/, '');
  if (!value) throw new Error('PaisaPay API is not configured. Set EXPO_PUBLIC_API_URL for this app build.');

  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error('PaisaPay API URL is invalid.'); }
  if (parsed.origin !== value) throw new Error('PaisaPay API URL must be an origin without a path.');

  if (isDev) {
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('PaisaPay development API URL must use HTTP or HTTPS.');
    return value;
  }

  if (deploymentEnv === 'staging') {
    if (value !== STAGING_API) throw new Error('PaisaPay staging builds must use the approved staging API origin.');
    return value;
  }
  if (deploymentEnv && deploymentEnv !== 'production') {
    throw new Error('PaisaPay deployment environment must be staging or production.');
  }
  if (value !== PRODUCTION_API) throw new Error('PaisaPay production builds must use the approved production API origin.');
  return value;
}

module.exports = { PRODUCTION_API, STAGING_API, resolveApiBaseUrl };
