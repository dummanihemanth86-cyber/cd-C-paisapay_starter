const DEFAULT_TIMEOUT_MS = 15_000;
const SESSION_FAILURE_CODES = new Set(['AUTH_REQUIRED', 'SESSION_INVALID']);

function apiError(payload, response) {
  const backendError = payload?.error;
  const fields = Array.isArray(backendError?.fields)
    ? backendError.fields.map((item) => item?.field && item?.message ? `${item.field}: ${item.message}` : item?.message).filter(Boolean).join(' · ')
    : '';
  const error = new Error(`${backendError?.message || `Request failed (${response.status}).`}${backendError?.code ? ` [${backendError.code}]` : ''}${fields ? ` ${fields}` : ''}${payload?.requestId ? ` Request ID: ${payload.requestId}` : ''}`);
  error.status = response.status;
  error.code = backendError?.code || 'HTTP_ERROR';
  error.requestId = payload?.requestId;
  return error;
}

function isSessionFailure(response, payload) {
  return response.status === 401 && SESSION_FAILURE_CODES.has(payload?.error?.code);
}

function isReadOnly(method) {
  return method === 'GET' || method === 'HEAD';
}

export function createAdminApiClient({
  apiBase = '',
  fetchImpl = globalThis.fetch?.bind(globalThis),
  getSession,
  onSessionChange = () => {},
  onSessionExpired = () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  if (typeof getSession !== 'function') throw new Error('A session getter is required.');
  let refreshFlight = null;

  const currentSession = () => getSession() || { accessToken: '', refreshToken: '' };
  const hasSessionChanged = (observed) => {
    const latest = currentSession();
    return latest.accessToken && (latest.accessToken !== observed.accessToken || latest.refreshToken !== observed.refreshToken);
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
      const error = new Error('Could not reach the PaisaPay API. Check the connection and retry.');
      error.code = 'API_NETWORK_ERROR';
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function requestInit({ method, body, token, accept = 'application/json', headers = {} }) {
    return {
      method,
      headers: {
        Accept: accept,
        ...headers,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
  }

  async function readPayload(response) {
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  }

  async function refreshSession(observed) {
    const latest = currentSession();
    if (hasSessionChanged(observed)) return latest;
    if (!latest.refreshToken) {
      const error = new Error('Admin session expired. Sign in again.');
      error.status = 401;
      error.code = 'REFRESH_INVALID';
      await onSessionExpired(error);
      throw error;
    }
    if (refreshFlight) return refreshFlight;

    refreshFlight = (async () => {
      try {
        const response = await fetchWithTimeout(`${apiBase}/api/v1/auth/refresh`, requestInit({
          method: 'POST', body: { refreshToken: latest.refreshToken }, token: '',
        }));
        const payload = await readPayload(response);
        if (!response.ok) throw apiError(payload, response);
        if (typeof payload?.accessToken !== 'string' || !payload.accessToken || typeof payload?.refreshToken !== 'string' || !payload.refreshToken) {
          const error = new Error('The session refresh response was incomplete. Sign in again.');
          error.status = response.status;
          error.code = 'REFRESH_INVALID_RESPONSE';
          throw error;
        }
        const renewed = { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
        await onSessionChange(renewed);
        return renewed;
      } catch (error) {
        const afterFailure = currentSession();
        if (afterFailure.refreshToken === latest.refreshToken && afterFailure.accessToken === latest.accessToken) {
          await onSessionExpired(error);
        }
        throw error;
      } finally {
        refreshFlight = null;
      }
    })();
    return refreshFlight;
  }

  async function fetchAuthorized(url, { method, body, token, accept, headers }, allowRefresh = true, rawResponse = false) {
    const initial = currentSession();
    const usedToken = token ?? initial.accessToken;
    const response = await fetchWithTimeout(url, requestInit({ method, body, token: usedToken, accept, headers }));
    if (response.ok) return { response, payload: rawResponse ? null : await readPayload(response) };
    const payload = await readPayload(response);
    if (!allowRefresh || !isSessionFailure(response, payload)) throw apiError(payload, response);
    if (!initial.refreshToken) {
      const error = apiError(payload, response);
      await onSessionExpired(error);
      throw error;
    }

    const observed = { accessToken: usedToken, refreshToken: initial.refreshToken };
    let renewed;
    try {
      renewed = hasSessionChanged(observed) ? currentSession() : await refreshSession(observed);
    } catch (error) {
      throw error;
    }

    if (!isReadOnly(method)) {
      const error = new Error('Admin session renewed. This action was not retried; review its status, then submit again if needed.');
      error.status = 401;
      error.code = 'SESSION_RENEWED_MANUAL_RETRY';
      throw error;
    }

    const retry = await fetchWithTimeout(url, requestInit({ method, body, token: renewed.accessToken, accept, headers }));
    if (retry.ok) return { response: retry, payload: rawResponse ? null : await readPayload(retry) };
    const retryPayload = await readPayload(retry);
    if (isSessionFailure(retry, retryPayload)) {
      const error = apiError(retryPayload, retry);
      await onSessionExpired(error);
      throw error;
    }
    throw apiError(retryPayload, retry);
  }

  async function request(path, { token, method = 'GET', body, headers } = {}) {
    const normalizedMethod = method.toUpperCase();
    const { payload } = await fetchAuthorized(`${apiBase}${path}`, { method: normalizedMethod, body, token, headers });
    if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('PaisaPay API returned an empty or invalid response. Refresh and try again.');
    }
    return payload;
  }

  async function requestRaw(url, { token, method = 'GET', accept = '*/*' } = {}) {
    const normalizedMethod = method.toUpperCase();
    const { response } = await fetchAuthorized(url, { method: normalizedMethod, token, accept }, true, true);
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
