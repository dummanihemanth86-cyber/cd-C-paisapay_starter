const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { canRetryRequest, withTransientRetries } = require('./apiRetry.cjs');

test('only reads and explicitly idempotent supported POST routes are retryable', () => {
  assert.equal(canRetryRequest({ method: 'GET', path: '/api/v1/users/me' }), true);
  assert.equal(canRetryRequest({ method: 'POST', path: '/api/v1/deposits', idempotencyKey: 'deposit-key-1' }), true);
  assert.equal(canRetryRequest({ method: 'POST', path: '/api/v1/deposits/quick-match', idempotencyKey: 'match-key-1' }), true);
  assert.equal(canRetryRequest({ method: 'POST', path: '/api/v1/auth/password/login' }), false);
  assert.equal(canRetryRequest({ method: 'POST', path: '/api/v1/deposits', idempotencyKey: undefined }), false);
  assert.equal(canRetryRequest({ method: 'POST', path: '/api/v1/deposits/orders/order-1/cancel', idempotencyKey: 'cancel-key-1' }), false);
  assert.equal(canRetryRequest({ method: 'PATCH', path: '/api/v1/users/me', idempotencyKey: 'profile-key-1' }), false);
});

test('transient GET failures retry with exponential backoff and then return the real response', async () => {
  let calls = 0;
  const delays = [];
  const result = await withTransientRetries(async () => {
    calls += 1;
    return calls < 3 ? { status: 502 } : { status: 200, text: '{"ok":true}' };
  }, { path: '/ready', maxRetries: 2, random: () => 0, sleep: async (ms) => delays.push(ms) });

  assert.equal(result.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [300, 600]);
});

test('idempotent POST retries reuse the same caller-supplied idempotency key', async () => {
  const keys = [];
  const delays = [];
  let calls = 0;
  const result = await withTransientRetries(async () => {
    calls += 1;
    keys.push('stable-deposit-request-123');
    return calls === 1 ? { status: 503, retryAfter: '1' } : { status: 201, text: '{"deposit":{}}' };
  }, { method: 'POST', path: '/api/v1/deposits', idempotencyKey: 'stable-deposit-request-123', sleep: async (ms) => delays.push(ms) });

  assert.equal(result.status, 201);
  assert.deepEqual(keys, ['stable-deposit-request-123', 'stable-deposit-request-123']);
  assert.deepEqual(delays, [1000]);
});

test('non-idempotent POST is never replayed after a transient failure', async () => {
  let calls = 0;
  const result = await withTransientRetries(async () => {
    calls += 1;
    return { status: 503, retryAfter: '1' };
  }, { method: 'POST', path: '/api/v1/auth/password/login', sleep: async () => assert.fail('must not back off') });

  assert.equal(result.status, 503);
  assert.equal(calls, 1);
});

test('financial safety-gate 503 responses are not retried', async () => {
  let calls = 0;
  const result = await withTransientRetries(async () => {
    calls += 1;
    return { status: 503, text: '{"error":{"code":"FINANCIAL_OPERATIONS_DISABLED"}}' };
  }, { method: 'POST', path: '/api/v1/deposits', idempotencyKey: 'stable-key-123456', sleep: async () => assert.fail('gate response should not retry') });

  assert.equal(result.status, 503);
  assert.equal(calls, 1);
});

test('network timeouts retry only when the request is safe to replay', async () => {
  let getCalls = 0;
  const result = await withTransientRetries(async () => {
    getCalls += 1;
    if (getCalls === 1) { const error = new Error('timeout'); error.name = 'AbortError'; throw error; }
    return { status: 200 };
  }, { method: 'GET', path: '/ready', sleep: async () => {} });
  assert.equal(result.status, 200);
  assert.equal(getCalls, 2);

  let postCalls = 0;
  await assert.rejects(withTransientRetries(async () => {
    postCalls += 1;
    const error = new Error('network failed'); error.name = 'TypeError'; throw error;
  }, { method: 'POST', path: '/api/v1/support/tickets', sleep: async () => assert.fail('unsafe POST should not retry') }));
  assert.equal(postCalls, 1);
});

test('mobile API wiring uses bounded retries and exposes a server connectivity check', () => {
  const apiSource = fs.readFileSync(require.resolve('./api.js'), 'utf8');
  const appSource = fs.readFileSync(require.resolve('../App.js'), 'utf8');
  const toastSource = fs.readFileSync(require.resolve('./ToastNotice.js'), 'utf8');
  const eas = JSON.parse(fs.readFileSync(require.resolve('../eas.json'), 'utf8'));

  assert.match(apiSource, /withTransientRetries/);
  assert.match(apiSource, /totalTimeoutMs = 45000/);
  assert.match(apiSource, /safeToReplay \? 15000 : totalTimeoutMs/);
  assert.match(apiSource, /setApiNetworkObserver/);
  assert.match(appSource, /Checking PaisaPay server/);
  assert.match(toastSource, /Check server/);
  assert.equal(eas.build['production-apk'].env.EXPO_PUBLIC_API_URL, 'https://paisapay-api.onrender.com');
  assert.equal(eas.build.production.env.EXPO_PUBLIC_API_URL, 'https://paisapay-api.onrender.com');
});
