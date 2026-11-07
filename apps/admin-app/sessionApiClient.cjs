const SESSION_FAILURE_CODES = new Set(['AUTH_REQUIRED', 'SESSION_INVALID']);

function buildHttpError(payload, response) {
  const backendError = payload?.error;
  const fieldErrors = Array.isArray(backendError?.fields)
    ? backendError.fields.map((item) => item?.field && item?.message ? `${item.field}: ${item.message}` : item?.message).filter(Boolean).join(' · ')
    : '';
  const message = backendError?.message || `Request failed (${response.status}).`;
  const error = new Error(`${message}${backendError?.code ? ` [${backendError.code}]` : ''}${fieldErrors ? ` ${fieldErrors}` : ''}`);
  error.status = response.status;
  error.code = backendError?.code || 'HTTP_ERROR';
  error.requestId = payload?.requestId;
  return error;
}

function isSessionFailure(response, payload) {
  return response.status === 401 && SESSION_FAILURE_CODES.has(payload?.error?.code);
}

function isReadOnly(method) { return method === 'GET' || method === 'HEAD'; }

function createAdminApiClient({ apiBase, fetchImpl = globalThis.fetch, getSession, onSessionChange = async () => {}, onSessionExpired = async () => {}, timeoutMs = 15_000 }) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  if (typeof getSession !== 'function') throw new Error('A session getter is required.');
  let refreshFlight = null;
  const currentSession = () => getSession() || { accessToken: '', refreshToken: '' };
  const changed = (observed) => {
    const current = currentSession();
    return current.accessToken && (current.accessToken !== observed.accessToken || current.refreshToken !== observed.refreshToken);
  };

  async function fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (cause) {
      if (controller.signal.aborted) {
        const error = new Error('PaisaPay API request timed out. Check your connection and retry.');
        error.code = 'API_TIMEOUT';
        throw error;
      }
      const error = new Error('Cannot reach PaisaPay API. Check server, Wi-Fi and firewall.');
      error.code = 'API_NETWORK_ERROR';
      error.cause = cause;
      throw error;
    } finally { clearTimeout(timer); }
  }

  function initFor({ method, body, token, accept = 'application/json', headers = {} }) {
    return {
      method,
      headers: { Accept: accept, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
  }

  async function parseJson(response) {
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  }

  async function refreshSession(observed) {
    const current = currentSession();
    if (changed(observed)) return current;
    if (!current.refreshToken) {
      const error = Object.assign(new Error('Admin session expired. Sign in again.'), { status: 401, code: 'REFRESH_INVALID' });
      await onSessionExpired(error);
      throw error;
    }
    if (refreshFlight) return refreshFlight;
    refreshFlight = (async () => {
      try {
        const response = await fetchWithTimeout(`${apiBase}/api/v1/auth/refresh`, initFor({ method: 'POST', body: { refreshToken: current.refreshToken }, token: '' }));
        const payload = await parseJson(response);
        if (!response.ok) throw buildHttpError(payload, response);
        if (typeof payload?.accessToken !== 'string' || !payload.accessToken || typeof payload?.refreshToken !== 'string' || !payload.refreshToken) {
          throw Object.assign(new Error('The session refresh response was incomplete. Sign in again.'), { status: response.status, code: 'REFRESH_INVALID_RESPONSE' });
        }
        const renewed = { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
        await onSessionChange(renewed);
        return renewed;
      } catch (error) {
        const afterFailure = currentSession();
        if (afterFailure.accessToken === current.accessToken && afterFailure.refreshToken === current.refreshToken) await onSessionExpired(error);
        throw error;
      } finally { refreshFlight = null; }
    })();
    return refreshFlight;
  }

  async function fetchAuthorized(url, { method, body, token, accept, headers }, allowRefresh = true, rawResponse = false) {
    const initial = currentSession();
    const usedToken = token ?? initial.accessToken;
    const response = await fetchWithTimeout(url, initFor({ method, body, token: usedToken, accept, headers }));
    if (response.ok) return { response, payload: rawResponse ? null : await parseJson(response) };
    const payload = await parseJson(response);
    if (!allowRefresh || !isSessionFailure(response, payload)) throw buildHttpError(payload, response);
    if (!initial.refreshToken) {
      const error = buildHttpError(payload, response);
      await onSessionExpired(error);
      throw error;
    }
    const observed = { accessToken: usedToken, refreshToken: initial.refreshToken };
    const renewed = changed(observed) ? currentSession() : await refreshSession(observed);
    if (!isReadOnly(method)) {
      throw Object.assign(new Error('Admin session renewed. This action was not retried; review its status, then submit again if needed.'), { status: 401, code: 'SESSION_RENEWED_MANUAL_RETRY' });
    }
    const retry = await fetchWithTimeout(url, initFor({ method, body, token: renewed.accessToken, accept, headers }));
    if (retry.ok) return { response: retry, payload: rawResponse ? null : await parseJson(retry) };
    const retryPayload = await parseJson(retry);
    if (isSessionFailure(retry, retryPayload)) {
      const error = buildHttpError(retryPayload, retry);
      await onSessionExpired(error);
      throw error;
    }
    throw buildHttpError(retryPayload, retry);
  }

  async function request(path, { token, method = 'GET', body, headers } = {}) {
    const { payload } = await fetchAuthorized(`${apiBase}${path}`, { method: method.toUpperCase(), body, token, headers });
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('PaisaPay API returned an empty or invalid response. Refresh and try again.');
    return payload;
  }

  async function requestRaw(url, { token, method = 'GET', accept = '*/*' } = {}) {
    const { response } = await fetchAuthorized(url, { method: method.toUpperCase(), token, accept }, true, true);
    return response;
  }

  async function clearSession() {
    await onSessionExpired(Object.assign(new Error('Admin signed out.'), { code: 'SESSION_CLEARED' }));
  }

  async function logout(revokeSession = async () => {}) {
    try { await revokeSession(currentSession()); }
    finally { await clearSession(); }
  }

  return { request, requestRaw, clearSession, logout };
}

module.exports = { createAdminApiClient };
