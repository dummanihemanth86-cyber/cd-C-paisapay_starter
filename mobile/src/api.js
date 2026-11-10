import * as SecureStore from 'expo-secure-store';
import sessionPersistence from './sessionPersistence.cjs';
import apiRetry from './apiRetry.cjs';
import apiEnvironment from './apiEnvironment.cjs';

export const API_URL = apiEnvironment.resolveApiBaseUrl({
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  deploymentEnv: process.env.EXPO_PUBLIC_DEPLOYMENT_ENV,
  isDev: __DEV__,
});
const SESSION_KEY = 'paisapay.session.v1';
const REMEMBERED_PHONE_KEY = 'paisapay.login.phone.v1';
let accessToken = null;
let refreshToken = null;
let refreshPromise = null;
let sessionEpoch = 0;
let apiNetworkObserver = null;
const persistencePolicy = sessionPersistence.createSessionPersistencePolicy();

export function setApiNetworkObserver(observer) {
  apiNetworkObserver = typeof observer === 'function' ? observer : null;
  return () => { if (apiNetworkObserver === observer) apiNetworkObserver = null; };
}

function reportApiNetworkState(state, details = {}) {
  try { apiNetworkObserver?.({ state, ...details }); } catch { /* UI observers must not break API calls. */ }
}

export async function restoreSession() {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session?.accessToken || !session?.refreshToken) throw new Error('Session is incomplete.');
    accessToken = session.accessToken;
    refreshToken = session.refreshToken;
    persistencePolicy.setRemembered(true);
    return session;
  } catch {
    await clearSession();
    return null;
  }
}

export async function saveSession(session, { remember } = {}) {
  if (!session?.accessToken || !session?.refreshToken) throw new Error('The server did not return a valid session.');
  sessionEpoch++;
  if (typeof remember === 'boolean') persistencePolicy.setRemembered(remember);
  accessToken = session.accessToken;
  refreshToken = session.refreshToken;
  if (persistencePolicy.shouldPersist()) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ accessToken, refreshToken }));
  else await SecureStore.deleteItemAsync(SESSION_KEY);
}

export async function clearSession() {
  sessionEpoch++;
  accessToken = null;
  refreshToken = null;
  persistencePolicy.reset();
  await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
}

export async function getRememberedLoginPhone() {
  return SecureStore.getItemAsync(REMEMBERED_PHONE_KEY);
}

export async function setRememberedLoginPhone(phone) {
  if (phone) return SecureStore.setItemAsync(REMEMBERED_PHONE_KEY, phone);
  return SecureStore.deleteItemAsync(REMEMBERED_PHONE_KEY);
}

async function request(path, { method = 'GET', body, idempotencyKey, auth = true, retry = true, timeoutMs, totalTimeoutMs = 45000, transientRetries = 2 } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const accessTokenUsed = auth ? accessToken : null;
  if (auth && accessTokenUsed) headers.Authorization = `Bearer ${accessTokenUsed}`;
  let result;
  let retryAttempts = 0;
  const safeToReplay = apiRetry.canRetryRequest({ method, path, idempotencyKey });
  const perAttemptTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : (safeToReplay ? 15000 : totalTimeoutMs);
  try {
    result = await apiRetry.withTransientRetries(async ({ remainingMs }) => {
      const controller = new AbortController();
      const attemptTimeoutMs = Math.max(1, Math.floor(Math.min(perAttemptTimeoutMs, remainingMs)));
      const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        const response = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
        return { status: response.status, text: await response.text(), retryAfter: response.headers?.get?.('Retry-After') || undefined };
      } finally {
        clearTimeout(timeout);
      }
    }, {
      method, path, idempotencyKey, maxRetries: transientRetries, totalTimeoutMs,
      onRetry: (event) => {
        retryAttempts = event.attempt;
        reportApiNetworkState('retrying', event);
      },
    });
  } catch (error) {
    const timeoutError = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    const wrapped = new Error(timeoutError
      ? (safeToReplay
        ? 'PaisaPay is responding slowly. The request was retried safely; check the order or wallet status before submitting again.'
        : 'PaisaPay is responding slowly. This action was not retried to avoid duplicating it. Check its status before trying again.')
      : (safeToReplay
        ? 'PaisaPay could not be reached after safe retries. Check your internet connection and try again.'
        : 'PaisaPay could not be reached. This action was not retried to avoid duplicating it; check its status before trying again.'));
    wrapped.name = 'ApiConnectionError';
    wrapped.code = timeoutError ? 'API_TIMEOUT' : 'API_UNAVAILABLE';
    wrapped.outcomeUnknown = String(method).toUpperCase() !== 'GET';
    wrapped.safeToRetry = safeToReplay;
    reportApiNetworkState('unavailable', { method: String(method).toUpperCase(), path, safeToReplay });
    throw wrapped;
  }
  const status = result.status;
  const text = result.text;
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { throw new Error('The server returned an invalid response.'); }
  if (status === 401 && auth && retry && refreshToken && !path.startsWith('/api/v1/auth/')) {
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
  if (status < 200 || status >= 300) {
    const fieldDetails = Array.isArray(data?.error?.fields)
      ? data.error.fields
        .filter((field) => field && typeof field.message === 'string')
        .map((field) => `${field.field || 'Request'}: ${field.message}`)
        .join('; ')
      : '';
    const transientHttpFailure = apiRetry.isRetryableResponse(result);
    if (transientHttpFailure && retryAttempts > 0) reportApiNetworkState('unavailable', { method: String(method).toUpperCase(), path, safeToReplay });
    const baseMessage = transientHttpFailure && status >= 500
      ? (String(method).toUpperCase() === 'GET'
        ? 'PaisaPay is temporarily unavailable after retrying the connection. Please refresh in a moment.'
        : 'PaisaPay could not confirm this request. Check its status before submitting again.')
      : data?.error?.message || data?.message || `Request failed (${status}).`;
    const error = new Error(fieldDetails ? `${baseMessage} ${fieldDetails}` : baseMessage);
    error.code = data?.error?.code;
    error.status = status;
    error.outcomeUnknown = String(method).toUpperCase() !== 'GET' && transientHttpFailure;
    error.safeToRetry = apiRetry.canRetryRequest({ method, path, idempotencyKey });
    error.pendingDeposits = data?.pendingDeposits;
    throw error;
  }
  if (retryAttempts > 0) reportApiNetworkState('connected', { method: String(method).toUpperCase(), path });
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
