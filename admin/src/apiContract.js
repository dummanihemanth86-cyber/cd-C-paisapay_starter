// The browser admin uses the isolated admin session endpoint, not the public
// user's password-login endpoint.
export const ADMIN_LOGIN_PATH = '/api/v1/admin/auth/login';

// In development, the Vite proxy serves /api/v1 from the local backend. A
// production build must specify the real API origin to avoid same-origin
// requests silently targeting the static web host.
export function resolveAdminApiBaseUrl(configuredUrl, isProduction) {
  const baseUrl = String(configuredUrl || '').trim().replace(/\/$/, '');
  if (isProduction && !baseUrl) {
    throw new Error('VITE_API_URL must be configured for the production Admin App.');
  }
  return baseUrl;
}
