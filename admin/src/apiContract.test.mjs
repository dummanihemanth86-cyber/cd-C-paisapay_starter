import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ADMIN_LOGIN_PATH, resolveAdminApiBaseUrl } from './apiContract.js';

test('browser admin login targets the separately authorized admin session route', async () => {
  const app = await readFile(new URL('./main.jsx', import.meta.url), 'utf8');
  const serverApp = await readFile(new URL('../../server/src/app.ts', import.meta.url), 'utf8');
  const adminRoutes = await readFile(new URL('../../server/src/modules/admin/routes.ts', import.meta.url), 'utf8');

  assert.equal(ADMIN_LOGIN_PATH, '/api/v1/admin/auth/login');
  assert.match(app, /api\(ADMIN_LOGIN_PATH,\s*\{\s*method:\s*'POST'/);
  assert.match(serverApp, /app\.use\('\/api\/v1\/admin\/auth',\s*adminAuthRouter\)/);
  assert.match(adminRoutes, /adminAuthRouter\.post\('\/login'/);
});

test('browser admin requires an explicit API origin in production but retains Vite same-origin proxy in development', () => {
  assert.throws(() => resolveAdminApiBaseUrl('', true), /VITE_API_URL must be configured/);
  assert.equal(resolveAdminApiBaseUrl('https://api.example.test/', true), 'https://api.example.test');
  assert.equal(resolveAdminApiBaseUrl('', false), '');
});
