import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminApiClient } from './sessionApiClient.js';

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    json: async () => body,
  };
}

function setup(fetchImpl, overrides = {}) {
  let session = { accessToken: 'access-old', refreshToken: 'refresh-old' };
  let expired = 0;
  const client = createAdminApiClient({
    apiBase: 'https://api.example.test',
    fetchImpl,
    getSession: () => session,
    onSessionChange: (value) => { session = value; },
    onSessionExpired: () => { expired += 1; session = { accessToken: '', refreshToken: '' }; },
    timeoutMs: 30,
    ...overrides,
  });
  return { client, getSession: () => session, getExpired: () => expired };
}

test('expired read refreshes once and retries with rotated credentials', async () => {
  const calls = [];
  const { client, getSession } = setup(async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    if (url.endsWith('/auth/refresh')) return response(200, { accessToken: 'access-new', refreshToken: 'refresh-new' });
    if (init.headers.Authorization === 'Bearer access-old') return response(401, { error: { code: 'SESSION_INVALID', message: 'expired' } });
    return response(200, { users: [] });
  });
  assert.deepEqual(await client.request('/users', { token: 'access-old' }), { users: [] });
  assert.equal(calls.filter((call) => call.url.endsWith('/auth/refresh')).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith('/users')).length, 2);
  assert.deepEqual(getSession(), { accessToken: 'access-new', refreshToken: 'refresh-new' });
});

test('failed refresh clears local session once and exposes login recovery', async () => {
  const { client, getExpired } = setup(async (url) => url.endsWith('/auth/refresh')
    ? response(401, { error: { code: 'REFRESH_INVALID', message: 'expired' } })
    : response(401, { error: { code: 'SESSION_INVALID', message: 'expired' } }));
  await assert.rejects(client.request('/users'), (error) => error.status === 401 && error.code === 'REFRESH_INVALID');
  assert.equal(getExpired(), 1);
});

test('expired access without a refresh token clears the invalid local session', async () => {
  let session = { accessToken: 'access-old', refreshToken: '' };
  let expired = 0;
  const client = createAdminApiClient({ fetchImpl: async () => response(401, { error: { code: 'SESSION_INVALID' } }), getSession: () => session, onSessionExpired: () => { expired += 1; session = { accessToken: '', refreshToken: '' }; } });
  await assert.rejects(client.request('/users'), (error) => error.code === 'SESSION_INVALID');
  assert.equal(expired, 1);
  assert.deepEqual(session, { accessToken: '', refreshToken: '' });
});

test('concurrent expired reads share one refresh and both retry', async () => {
  let refreshCalls = 0;
  const { client } = setup(async (url, init) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response(200, { accessToken: 'access-new', refreshToken: 'refresh-new' });
    }
    if (init.headers.Authorization === 'Bearer access-old') return response(401, { error: { code: 'SESSION_INVALID' } });
    return response(200, { ok: true });
  });
  const results = await Promise.all([client.request('/one'), client.request('/two')]);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(results, [{ ok: true }, { ok: true }]);
});

test('mutation is never replayed after refresh', async () => {
  const calls = [];
  const { client } = setup(async (url, init) => {
    calls.push({ url, method: init.method });
    if (url.endsWith('/auth/refresh')) return response(200, { accessToken: 'access-new', refreshToken: 'refresh-new' });
    return response(401, { error: { code: 'SESSION_INVALID', message: 'expired' } });
  });
  await assert.rejects(client.request('/financial-action', { method: 'POST', body: { value: 1 } }), (error) => error.code === 'SESSION_RENEWED_MANUAL_RETRY');
  assert.equal(calls.filter((call) => call.url.endsWith('/financial-action')).length, 1);
});

test('custom idempotency headers reach authorized mutation requests unchanged', async () => {
  let sent;
  const { client } = setup(async (_url, init) => { sent = init.headers['Idempotency-Key']; return response(201, { adjustment: { id: 'tx' } }); });
  await client.request('/admin/wallet-adjustments', { method: 'POST', headers: { 'Idempotency-Key': 'test-idempotency-key' }, body: { amountPaise: 1 } });
  assert.equal(sent, 'test-idempotency-key');
});

test('requests time out with a stable timeout error', async () => {
  const { client } = setup((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  await assert.rejects(client.request('/slow', { token: '' }), (error) => error.code === 'API_TIMEOUT');
});

test('protected binary responses remain unread for secure evidence viewers', async () => {
  let jsonCalled = false;
  const { client } = setup(async () => ({ status: 200, ok: true, json: async () => { jsonCalled = true; throw new Error('binary body'); }, blob: async () => 'image' }));
  const responseValue = await client.requestRaw('https://api.example.test/evidence');
  assert.equal(jsonCalled, false);
  assert.equal(await responseValue.blob(), 'image');
});

test('logout clears all local credentials through the session callback', async () => {
  let session = { accessToken: 'access-old', refreshToken: 'refresh-old' };
  const client = createAdminApiClient({
    fetchImpl: async () => response(200, {}),
    getSession: () => session,
    onSessionExpired: () => { session = { accessToken: '', refreshToken: '' }; },
  });
  await client.logout(async () => {});
  assert.deepEqual(session, { accessToken: '', refreshToken: '' });
});

test('logout clears local credentials even when server revocation is unavailable', async () => {
  const { client, getSession } = setup(async () => response(200, {}));
  await assert.rejects(client.logout(async () => { throw new Error('offline'); }), /offline/);
  assert.deepEqual(getSession(), { accessToken: '', refreshToken: '' });
});

test('a late 401 uses a session rotated by another request instead of replaying the old refresh token', async () => {
  let session;
  let calls = 0;
  const { client } = setup(async (url, init) => {
    if (url.endsWith('/auth/refresh')) return response(200, { accessToken: 'access-new', refreshToken: 'refresh-new' });
    calls += 1;
    if (init.headers.Authorization === 'Bearer access-old') {
      if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 10));
      return response(401, { error: { code: 'SESSION_INVALID' } });
    }
    return response(200, { ok: true });
  }, { onSessionChange: (value) => { session = value; }, getSession: () => session || { accessToken: 'access-old', refreshToken: 'refresh-old' } });
  const first = client.request('/slow-old');
  await new Promise((resolve) => setTimeout(resolve, 2));
  const second = client.request('/fast-old');
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
});
