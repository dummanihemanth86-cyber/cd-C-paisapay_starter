const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminApiClient } = require('./sessionApiClient.cjs');

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
function setup(fetchImpl, timeoutMs = 30) {
  let session = { accessToken: 'access-old', refreshToken: 'refresh-old' };
  let expired = 0;
  const client = createAdminApiClient({ apiBase: 'https://api.example.test', fetchImpl, getSession: () => session, onSessionChange: (value) => { session = value; }, onSessionExpired: () => { expired += 1; session = { accessToken: '', refreshToken: '' }; }, timeoutMs });
  return { client, getSession: () => session, expired: () => expired };
}

test('expired authenticated read refreshes and retries once', async () => {
  const calls = [];
  const { client, getSession } = setup(async (url, init) => {
    calls.push({ url, method: init.method, authorization: init.headers.Authorization });
    if (url.endsWith('/auth/refresh')) return response(200, { accessToken: 'access-new', refreshToken: 'refresh-new' });
    return init.headers.Authorization === 'Bearer access-old' ? response(401, { error: { code: 'SESSION_INVALID', message: 'expired' } }) : response(200, { users: [] });
  });
  assert.deepEqual(await client.request('/users'), { users: [] });
  assert.equal(calls.filter((call) => call.url.endsWith('/auth/refresh')).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith('/users')).length, 2);
  assert.deepEqual(getSession(), { accessToken: 'access-new', refreshToken: 'refresh-new' });
});

test('refresh failure clears credentials and reports expired session', async () => {
  const { client, expired, getSession } = setup(async (url) => url.endsWith('/auth/refresh') ? response(401, { error: { code: 'REFRESH_INVALID', message: 'expired' } }) : response(401, { error: { code: 'SESSION_INVALID', message: 'expired' } }));
  await assert.rejects(client.request('/users'), (error) => error.code === 'REFRESH_INVALID');
  assert.equal(expired(), 1);
  assert.deepEqual(getSession(), { accessToken: '', refreshToken: '' });
});

test('expired access without a refresh token clears the local session', async () => {
  let session = { accessToken: 'access-old', refreshToken: '' };
  let expired = 0;
  const client = createAdminApiClient({ apiBase: 'https://api.example.test', fetchImpl: async () => response(401, { error: { code: 'SESSION_INVALID' } }), getSession: () => session, onSessionExpired: () => { expired += 1; session = { accessToken: '', refreshToken: '' }; } });
  await assert.rejects(client.request('/users'), (error) => error.code === 'SESSION_INVALID');
  assert.equal(expired, 1);
  assert.deepEqual(session, { accessToken: '', refreshToken: '' });
});

test('simultaneous expired reads share one refresh', async () => {
  let refreshCalls = 0;
  const { client } = setup(async (url, init) => {
    if (url.endsWith('/auth/refresh')) { refreshCalls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return response(200, { accessToken: 'access-new', refreshToken: 'refresh-new' }); }
    if (init.headers.Authorization === 'Bearer access-old') return response(401, { error: { code: 'SESSION_INVALID' } });
    return response(200, { ok: true });
  });
  assert.deepEqual(await Promise.all([client.request('/one'), client.request('/two')]), [{ ok: true }, { ok: true }]);
  assert.equal(refreshCalls, 1);
});

test('financial or other mutations are never retried after refresh', async () => {
  const calls = [];
  const { client } = setup(async (url, init) => { calls.push({ url, method: init.method }); return url.endsWith('/auth/refresh') ? response(200, { accessToken: 'access-new', refreshToken: 'refresh-new' }) : response(401, { error: { code: 'SESSION_INVALID' } }); });
  await assert.rejects(client.request('/financial-action', { method: 'POST', body: { amount: 1 } }), (error) => error.code === 'SESSION_RENEWED_MANUAL_RETRY');
  assert.equal(calls.filter((call) => call.url.endsWith('/financial-action')).length, 1);
});

test('request timeout returns a stable error code', async () => {
  const { client } = setup((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })), 10);
  await assert.rejects(client.request('/slow', { token: '' }), (error) => error.code === 'API_TIMEOUT');
});

test('protected binary response is not consumed before the evidence viewer reads it', async () => {
  let jsonCalled = false;
  const { client } = setup(async () => ({ status: 200, ok: true, json: async () => { jsonCalled = true; throw new Error('binary body'); }, blob: async () => 'image' }));
  const responseValue = await client.requestRaw('https://api.example.test/evidence');
  assert.equal(jsonCalled, false);
  assert.equal(await responseValue.blob(), 'image');
});

test('logout clears access and refresh credentials locally', async () => {
  const { client, getSession } = setup(async () => response(200, {}));
  await client.logout(async () => {});
  assert.deepEqual(getSession(), { accessToken: '', refreshToken: '' });
});

test('logout clears credentials even when backend revocation cannot be reached', async () => {
  const { client, getSession } = setup(async () => response(200, {}));
  await assert.rejects(client.logout(async () => { throw new Error('offline'); }), /offline/);
  assert.deepEqual(getSession(), { accessToken: '', refreshToken: '' });
});

test('custom idempotency headers reach authorized mutation requests unchanged', async () => {
  let sent;
  const { client } = setup(async (_url, init) => { sent = init.headers['Idempotency-Key']; return response(201, { adjustment: { id: 'tx' } }); });
  await client.request('/api/v1/admin/wallet-adjustments', { method: 'POST', headers: { 'Idempotency-Key': 'test-idempotency-key' }, body: { amountPaise: 1 } });
  assert.equal(sent, 'test-idempotency-key');
});
