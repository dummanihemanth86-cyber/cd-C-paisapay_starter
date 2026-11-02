import * as SecureStore from 'expo-secure-store';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/$/, '');
const SESSION_KEY = 'paisapay.session.v1';
const REMEMBERED_PHONE_KEY = 'paisapay.login.phone.v1';
let accessToken = null;
let refreshToken = null;
let refreshPromise = null;
let sessionEpoch = 0;

if (!API_URL) {
  throw new Error('PaisaPay API is not configured. Set EXPO_PUBLIC_API_URL for this app build.');
}
if (!__DEV__ && !API_URL.startsWith('https://')) {
  throw new Error('PaisaPay production builds require an HTTPS API URL.');
}
if (!__DEV__) {
  try {
    const apiOrigin = new URL(API_URL);
    if (apiOrigin.origin !== API_URL) throw new Error('PaisaPay production API URL must be an HTTPS origin without a path.');
  } catch (error) {
    throw new Error(error?.message || 'PaisaPay production API URL is invalid.');
  }
}

export async function restoreSession() {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session?.accessToken || !session?.refreshToken) throw new Error('Session is incomplete.');
    accessToken = session.accessToken;
    refreshToken = session.refreshToken;
    return session;
  } catch {
    await clearSession();
    return null;
  }
}

export async function saveSession(session, { remember = true } = {}) {
  if (!session?.accessToken || !session?.refreshToken) throw new Error('The server did not return a valid session.');
  sessionEpoch++;
  accessToken = session.accessToken;
  refreshToken = session.refreshToken;
  if (remember) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ accessToken, refreshToken }));
  else await SecureStore.deleteItemAsync(SESSION_KEY);
}

export async function clearSession() {
  sessionEpoch++;
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
}

export async function getRememberedLoginPhone() {
  return SecureStore.getItemAsync(REMEMBERED_PHONE_KEY);
}

export async function setRememberedLoginPhone(phone) {
  if (phone) return SecureStore.setItemAsync(REMEMBERED_PHONE_KEY, phone);
  return SecureStore.deleteItemAsync(REMEMBERED_PHONE_KEY);
}

async function request(path, { method = 'GET', body, idempotencyKey, auth = true, retry = true, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const accessTokenUsed = auth ? accessToken : null;
  if (auth && accessTokenUsed) headers.Authorization = `Bearer ${accessTokenUsed}`;
  let response;
  let text;
  try {
    response = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    text = await response.text();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The server took too long to respond. Check the connection and retry.');
    throw new Error(`Cannot reach PaisaPay API at ${API_URL}. Check Wi-Fi, the server, and its firewall.`);
  } finally { clearTimeout(timeout); }
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { throw new Error('The server returned an invalid response.'); }
  if (response.status === 401 && auth && retry && refreshToken && !path.startsWith('/api/v1/auth/')) {
    // A sibling request may already have rotated the token while this request
    // was in flight. Retry with that token instead of refreshing the old one.
    if (accessTokenUsed && accessToken !== accessTokenUsed) {
      return request(path, { method, body, idempotencyKey, auth, retry: false, timeoutMs });
    }
    try {
      if (!refreshPromise) {
        const tokenToRefresh = refreshToken;
        const refreshEpoch = sessionEpoch;
        refreshPromise = request('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: tokenToRefresh }, auth: false, retry: false })
          .then((refreshed) => {
            if (refreshEpoch !== sessionEpoch) throw new Error('The PaisaPay session ended while refreshing.');
            return saveSession(refreshed).then(() => refreshed);
          })
          .finally(() => { refreshPromise = null; });
      }
      await refreshPromise;
      return request(path, { method, body, idempotencyKey, auth, retry: false });
    } catch (refreshError) {
      // Keep a valid local refresh credential when the network is unavailable.
      // Only a server rejection proves that the refresh credential is invalid.
      if (refreshError?.status === 401) await clearSession();
      throw refreshError;
    }
  }
  if (!response.ok) {
    const fieldDetails = Array.isArray(data?.error?.fields)
      ? data.error.fields
        .filter((field) => field && typeof field.message === 'string')
        .map((field) => `${field.field || 'Request'}: ${field.message}`)
        .join('; ')
      : '';
    const baseMessage = data?.error?.message || data?.message || `Request failed (${response.status}).`;
    const error = new Error(fieldDetails ? `${baseMessage} ${fieldDetails}` : baseMessage);
    error.code = data?.error?.code;
    error.status = response.status;
    error.pendingDeposits = data?.pendingDeposits;
    throw error;
  }
  return data;
}

export const apiGet = (path, options = {}) => request(path, options);
export const apiPost = (path, body, idempotencyKey, options = {}) => request(path, { ...options, method: 'POST', body, idempotencyKey });
export const apiPatch = (path, body, options = {}) => request(path, { ...options, method: 'PATCH', body });
export const apiDelete = (path, options = {}) => request(path, { ...options, method: 'DELETE' });
export async function apiLogout() {
  const token = refreshToken;
  try { await apiPost('/api/v1/auth/logout', { refreshToken: token }, undefined, { auth: false, retry: false }); }
  finally { await clearSession(); }
}
