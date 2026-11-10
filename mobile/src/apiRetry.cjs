const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 504]);
const NON_TRANSIENT_503_CODES = new Set([
  'FINANCIAL_OPERATIONS_DISABLED',
  'WALLET_ADJUSTMENTS_DISABLED',
  'DEPOSIT_RECEIVER_NOT_CONFIGURED',
  'DEPOSIT_PROVIDER_UNAVAILABLE',
  'PAYOUT_PROVIDER_UNAVAILABLE',
  'PAYMENT_PROVIDER_DISABLED',
]);

function isIdempotentPostPath(path) {
  const pathname = String(path || '').split('?')[0];
  return pathname === '/api/v1/deposits'
    || pathname === '/api/v1/withdrawals'
    || pathname === '/api/v1/deposits/quick-match'
    || pathname === '/api/v1/orders'
    || /^\/api\/v1\/orders\/[^/]+\/reservations$/.test(pathname);
}

function canRetryRequest({ method = 'GET', path = '', idempotencyKey } = {}) {
  const normalizedMethod = String(method).toUpperCase();
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD') return true;
  return normalizedMethod === 'POST' && Boolean(idempotencyKey) && isIdempotentPostPath(path);
}

function isRetryableError(error) {
  return error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || error?.code === 'ETIMEDOUT'
    || error?.code === 'ECONNRESET'
    || error instanceof TypeError;
}

function isRetryableResponse(result) {
  const status = Number(result?.status);
  if (TRANSIENT_STATUSES.has(status)) return true;
  if (status !== 503) return false;

  const retryAfter = result?.retryAfter;
  if (retryAfter !== undefined && retryAfter !== null && retryAfter !== '') return true;
  let code;
  try { code = JSON.parse(result?.text || '').error?.code; } catch { return true; }
  return !NON_TRANSIENT_503_CODES.has(code);
}

function retryDelayMs(attempt, { baseDelayMs = 400, maxDelayMs = 4000, random = Math.random } = {}) {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
  // Bounded jitter prevents a group of clients from retrying in lockstep.
  return Math.floor(ceiling * (0.75 + (Math.max(0, Math.min(1, random())) * 0.5)));
}

function retryAfterMs(value, now = Date.now) {
  if (value === undefined || value === null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, Math.ceil(seconds * 1000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.min(10_000, timestamp - now())) : null;
}

async function withTransientRetries(operation, {
  method = 'GET',
  path = '',
  idempotencyKey,
  maxRetries = 2,
  totalTimeoutMs = 45_000,
  baseDelayMs = 400,
  maxDelayMs = 4000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
  now = Date.now,
  onRetry,
} = {}) {
  const retryAllowed = canRetryRequest({ method, path, idempotencyKey });
  const deadline = now() + totalTimeoutMs;
  let retries = 0;
  while (true) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      const timeout = new Error('The request exceeded the connection retry time limit.');
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    let result;
    try {
      result = await operation({ attempt: retries, remainingMs });
      if (!retryAllowed || !isRetryableResponse(result) || retries >= maxRetries) return result;
    } catch (error) {
      if (!retryAllowed || !isRetryableError(error) || retries >= maxRetries) throw error;
    }

    const resultDelay = retryAfterMs(result?.retryAfter, now);
    const delayMs = Math.min(resultDelay ?? retryDelayMs(retries, { baseDelayMs, maxDelayMs, random }), Math.max(0, remainingMs));
    if (delayMs <= 0) return result;
    onRetry?.({ attempt: retries + 1, maxRetries, delayMs, method: String(method).toUpperCase(), path });
    await sleep(delayMs);
    retries += 1;
  }
}

module.exports = {
  canRetryRequest,
  isRetryableError,
  isRetryableResponse,
  retryAfterMs,
  retryDelayMs,
  withTransientRetries,
};
