import request from 'supertest';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { openapi } from '../openapi.js';
import { assertOpenApiResponse } from './support/openapiRuntimeValidator.js';

describe('PaisaPay API foundation', () => {
  it('documents the dedicated Admin password-reset flow and rejects the four-digit static code', async () => {
    const paths = (openapi as unknown as { paths: Record<string, Record<string, unknown>> }).paths;
    const resetRequest = paths['/admin/auth/forgot-password/request-otp']?.post as {
      security?: unknown[];
      requestBody?: { required?: boolean; content?: Record<string, { schema?: { required?: string[]; properties?: Record<string, { type?: string; pattern?: string }> } }> };
    };
    const reset = paths['/admin/auth/password/reset']?.post as {
      security?: unknown[];
      requestBody?: { required?: boolean; content?: Record<string, { schema?: { required?: string[]; properties?: Record<string, { type?: string; pattern?: string; minLength?: number }> } }> };
    };
    expect(resetRequest.requestBody?.required).toBe(true);
    expect(resetRequest.requestBody?.content?.['application/json']?.schema?.required).toEqual(['phoneE164']);
    expect(resetRequest.security).toBeUndefined();
    expect(reset.requestBody?.required).toBe(true);
    expect(reset.requestBody?.content?.['application/json']?.schema?.required).toEqual(['phoneE164', 'challengeId', 'code', 'newPassword']);
    expect(reset.requestBody?.content?.['application/json']?.schema?.properties?.code?.pattern).toBe('^\\d{6}$');
    expect(reset.requestBody?.content?.['application/json']?.schema?.properties?.newPassword?.minLength).toBe(12);
    expect(reset.security).toBeUndefined();

    await request(app).post('/api/v1/admin/auth/password/reset').send({
      phoneE164: '+919876543210',
      challengeId: '00000000-0000-4000-8000-000000000001',
      code: '2321',
      newPassword: 'NewSecureAdminPassword1!',
    }).expect(400);
  });

  it('runtime-validates representative success and error responses against OpenAPI', async () => {
    const config = await request(app).get('/api/v1/config').expect(200);
    assertOpenApiResponse(openapi, 'GET', '/config', config);

    const invalidLogin = await request(app).post('/api/v1/auth/password/login').send({}).expect(400);
    assertOpenApiResponse(openapi, 'POST', '/auth/password/login', invalidLogin);

    const protectedRoutes: Array<[string, string]> = [
      ['GET', '/users/me'], ['GET', '/users/me/upi'], ['GET', '/users/me/bank-accounts'],
      ['GET', '/users/me/balance'], ['GET', '/users/me/transactions'], ['GET', '/users/me/referrals'],
      ['GET', '/wallet-methods'], ['GET', '/wallet-references'], ['GET', '/deposits'],
      ['GET', '/orders'], ['GET', '/withdrawals'], ['GET', '/deposits/orders/my'],
      ['GET', '/support/tickets'], ['GET', '/notifications'], ['GET', '/admin/overview'],
      ['GET', '/admin/deposits'], ['GET', '/admin/referrals'], ['GET', '/admin/p2p/claims'],
      ['GET', '/admin/reports'], ['GET', '/admin/settings'],
      ['GET', '/admin/users/00000000-0000-4000-8000-000000000001/wallet/credits'],
      ['POST', '/admin/users/00000000-0000-4000-8000-000000000001/wallet/credit'],
      ['POST', '/admin/wallet/credits/direct'],
      ['GET', '/admin/wallet/credits/requests'], ['GET', '/admin/wallet/funding/requests'], ['GET', '/admin/wallet/reconciliation'],
    ];
    for (const [method, path] of protectedRoutes) {
      const response = await request(app)[method.toLowerCase() as 'get' | 'post'](`/api/v1${path}`);
      expect(response.status, `Expected auth rejection for ${path}`).toBe(401);
      assertOpenApiResponse(openapi, method, path, response);
    }
  });

  it('documents every Express router method/path declared by the API modules', async () => {
    const routers: Array<{ file: string; mounts: Record<string, string> }> = [
      { file: '../modules/auth/routes.ts', mounts: { authRouter: '/api/v1/auth', adminAuthRouter: '/api/v1/admin/auth' } },
      { file: '../modules/users/routes.ts', mounts: { usersRouter: '/api/v1/users' } },
      { file: '../modules/payments/routes.ts', mounts: { paymentsRouter: '/api/v1' } },
      { file: '../modules/p2p/routes.ts', mounts: { p2pRouter: '/api/v1' } },
      { file: '../modules/orders/routes.ts', mounts: { ordersRouter: '/api/v1/orders' } },
      { file: '../modules/support/routes.ts', mounts: { supportRouter: '/api/v1/support', notificationRouter: '/api/v1/notifications', withdrawalsRouter: '/api/v1/withdrawals' } },
      { file: '../modules/admin/routes.ts', mounts: { adminAuthRouter: '/api/v1/admin/auth', adminRouter: '/api/v1/admin' } },
    ];
    const routes = new Set<string>();
    for (const { file, mounts } of routers) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const [router, base] of Object.entries(mounts)) {
        const pattern = new RegExp(String.raw`\b${router}\.(get|post|put|patch|delete)\((?:'([^']*)'|"([^"]*)")`, 'g');
        for (const match of source.matchAll(pattern)) {
          const routePath = `${base}${match[2] ?? match[3]}`.replace(/\/$/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
          routes.add(`${match[1].toUpperCase()} ${routePath}`);
        }
      }
    }

    const spec = (await request(app).get('/api/v1/openapi.json').expect(200)).body;
    const missing = [...routes].filter((entry) => {
      const separator = entry.indexOf(' ');
      const method = entry.slice(0, separator).toLowerCase();
      const path = entry.slice(separator + 1).replace('/api/v1', '') || '/';
      return !spec.paths[path]?.[method];
    });
    expect(missing).toEqual([]);
  });

  it('provides JSON request and response schemas for body-consuming/documented operations', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json').expect(200)).body;
    let genericSuccessSchemas = 0;
    const documentedJsonHandlers = [
      'post /auth/request-otp', 'post /auth/verify-otp', 'post /auth/register/request-otp', 'post /auth/register/verify-otp',
      'post /auth/forgot-password/request-otp', 'post /auth/password/login', 'post /auth/password/reset', 'post /auth/refresh',
      'post /auth/logout', 'post /admin/auth/login', 'post /admin/push-devices', 'delete /admin/push-devices',
      'patch /users/me', 'patch /users/me/upi',
      'post /users/me/bank-accounts', 'patch /users/me/bank-accounts/{id}', 'post /wallet-references', 'post /deposits',
      'post /deposits/{id}/manual-verification', 'post /admin/reconciliation/claims/{claimId}/review', 'post /orders',
      'post /orders/{id}/reservations', 'post /withdrawals', 'post /deposits/quick-match',
      'post /deposits/orders/{id}/confirm', 'post /deposits/orders/{id}/handoff-attempt', 'post /deposits/orders/{id}/payment-reference',
      'post /orders/{id}/dispute', 'post /admin/p2p/offers/{id}/cancel', 'post /admin/p2p/claims/{id}/review',
      'post /support/tickets', 'post /admin/users/{id}/status',
      'post /admin/wallet/credits/requests', 'post /admin/wallet/credits/requests/{id}/decision',
      'post /admin/wallet/funding/requests', 'post /admin/wallet/funding/requests/{id}/decision',
      'patch /admin/referrals/config', 'patch /admin/referrals/milestones/{key}', 'post /admin/support/tickets/{id}/reply',
      'patch /admin/support/tickets/{id}/status', 'post /admin/notifications', 'patch /admin/reward-rules/{id}',
    ];
    expect(new Set(documentedJsonHandlers).size).toBe(42);
    for (const entry of documentedJsonHandlers) {
      const separator = entry.indexOf(' ');
      const method = entry.slice(0, separator);
      const path = entry.slice(separator + 1);
      const operation = spec.paths[path]?.[method];
      expect(operation, entry).toBeDefined();
      const requestSchema = operation.requestBody?.content?.['application/json']?.schema;
      expect(requestSchema, entry).toBeDefined();
      expect(typeof requestSchema).toBe('object');
    }

    expect(spec.paths['/auth/logout'].post.requestBody.required).toBe(false);
    expect(spec.paths['/orders/{id}/reservations'].post.requestBody.required).toBe(false);
    expect(spec.paths['/deposits/orders/{id}/confirm'].post.requestBody.required).toBe(false);

    for (const [path, operations] of Object.entries(spec.paths) as Array<[string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>; security?: unknown }>]>) {
      for (const [method, operation] of Object.entries(operations)) {
        expect(operation.responses, `${method.toUpperCase()} ${path} responses`).toBeDefined();
        const responses = Object.entries(operation.responses ?? {}).filter(([status]) => status !== '204');
        expect(responses.length, `${method.toUpperCase()} ${path} response count`).toBeGreaterThan(0);
        for (const [status, response] of responses) {
          const schemas = Object.values(response.content ?? {}).map((media) => media.schema).filter(Boolean);
          expect(schemas.length, `${method.toUpperCase()} ${path} ${status} schema`).toBeGreaterThan(0);
          for (const schema of schemas) {
            expect(typeof schema, `${method.toUpperCase()} ${path} ${status} machine-readable schema`).toBe('object');
            const ref = (schema as { $ref?: string }).$ref;
            if (ref === '#/components/schemas/ApiJsonObject') genericSuccessSchemas += 1;
            if (ref) {
              const schemaName = ref.split('/').at(-1);
              expect(spec.components.schemas[schemaName], `${method.toUpperCase()} ${path} ${status} schema ref`).toBeDefined();
            }
          }
        }
        const isPublic = path === '/config' || path.startsWith('/auth/') || path === '/admin/auth/login' || path.startsWith('/admin/auth/forgot-password/') || path === '/admin/auth/password/reset' || path.startsWith('/webhooks/payments/');
        if (!isPublic) expect(operation.security, `${method.toUpperCase()} ${path} security`).toEqual([{ bearerAuth: [] }]);
      }
    }
    expect(genericSuccessSchemas).toBe(0);
    expect(spec.components.schemas.ApiJsonObject).toBeUndefined();

    const balance = spec.paths['/users/me/balance'].get.responses['200'].content['application/json'].schema;
    expect(balance.properties.availablePaise).toEqual({ type: 'integer' });
    expect(balance.properties.reservedPaise).toEqual({ type: 'integer' });
    const otpLogin = spec.paths['/auth/verify-otp'].post.responses['200'].content['application/json'].schema;
    expect(otpLogin.properties.accessToken).toEqual({ type: 'string' });
    expect(otpLogin.properties.accessExpiresInSeconds).toEqual({ type: 'integer' });
    expect(otpLogin.properties.user.type).toBe('object');
    const adminDeposits = spec.paths['/admin/deposits'].get.responses['200'].content['application/json'].schema;
    expect(adminDeposits.properties.deposits.type).toBe('array');
    expect(adminDeposits.properties.page).toEqual({ type: 'integer' });
    const handoff = spec.paths['/deposits/orders/{id}/confirm'].post.responses['200'].content['application/json'].schema;
    expect(handoff.properties.paymentDetails.type).toBe('object');
    const idempotentMatch = spec.paths['/deposits/quick-match'].post.responses['200'].content['application/json'].schema;
    expect(idempotentMatch.properties.serverTime).toBeUndefined();
    expect(idempotentMatch.properties.order.type).toBe('object');
    const referrals = spec.paths['/users/me/referrals'].get.responses['200'].content['application/json'].schema;
    expect(referrals.properties.members.type).toBe('array');
    expect(referrals.properties.commissionHistory.type).toBe('array');
    const announcement = spec.paths['/admin/notifications'].post.responses['201'].content['application/json'].schema;
    expect(announcement.properties.recipientCount).toEqual({ type: 'integer' });
    expect(announcement.properties.notifications).toBeUndefined();
    const supportReply = spec.paths['/admin/support/tickets/{id}/reply'].post.responses['201'].content['application/json'].schema;
    expect(supportReply.properties.message.type).toBe('object');
    expect(supportReply.properties.status).toEqual({ type: 'string' });
    const overview = spec.paths['/admin/overview'].get.responses['200'].content['application/json'].schema;
    expect(overview.properties.users).toEqual({ type: 'integer' });
    expect(overview.properties.metrics.type).toBe('object');
    const withdrawalList = spec.paths['/withdrawals'].get.responses['200'].content['application/json'].schema;
    expect(withdrawalList.properties.withdrawals.type).toBe('array');
    expect(withdrawalList.properties.offers.type).toBe('array');
    const walletReferences = spec.paths['/wallet-references'].get.responses['200'].content['application/json'].schema;
    expect(walletReferences.properties.wallets.type).toBe('array');
    const legacyOrderCancel = spec.paths['/orders/{id}/cancel'].post.responses['200'].content['application/json'].schema;
    expect(legacyOrderCancel.properties.id).toEqual({ type: 'string' });
    expect(spec.components.schemas.ApiError.properties.error.properties).toMatchObject({ code: { type: 'string' }, message: { type: 'string' } });
  });

  it('documents bounded operational reports and read-only settings without sensitive fields', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json').expect(200)).body;
    const reports = spec.paths['/admin/reports'].get;
    expect(reports.security).toEqual([{ bearerAuth: [] }]);
    expect(reports.parameters.map((parameter: { name: string; in: string; required?: boolean }) => [parameter.in, parameter.name, parameter.required])).toEqual([
      ['query', 'report', true], ['query', 'from', true], ['query', 'to', true], ['query', 'status', false],
    ]);
    const reportSchema = reports.responses['200'].content['application/json'].schema;
    expect(reportSchema.properties.statusBreakdown.items.properties).toMatchObject({ status: { type: 'string' }, count: { type: 'integer' }, amountPaise: { type: 'string' } });
    expect(reportSchema.properties.daily.items.properties).toMatchObject({ date: { type: 'string', format: 'date' }, count: { type: 'integer' } });
    const settings = spec.paths['/admin/settings'].get;
    expect(settings.security).toEqual([{ bearerAuth: [] }]);
    const settingsSchema = settings.responses['200'].content['application/json'].schema;
    expect(settingsSchema.properties.financialOperationsEnabled).toEqual({ type: 'boolean' });
    expect(settingsSchema.properties.editableSettings.items).toEqual({ type: 'string' });
    expect(Object.keys(settingsSchema.properties)).not.toEqual(expect.arrayContaining(['databaseUrl', 'secret', 'apiKey']));
  });

  it('limits flexible object schemas to explicitly dynamic JSON fields and documents VIP response types', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json').expect(200)).body;
    const flexiblePaths: string[] = [];
    const visit = (value: unknown, pointer: string): void => {
      if (!value || typeof value !== 'object') return;
      const schema = value as { type?: string; additionalProperties?: unknown };
      if (schema.type === 'object' && schema.additionalProperties === true) flexiblePaths.push(pointer);
      for (const [key, child] of Object.entries(value)) visit(child, `${pointer}/${key}`);
    };
    visit(spec, '');
    expect(flexiblePaths.sort()).toEqual([
      '/paths//admin/audit-logs/get/responses/200/content/application/json/schema/properties/auditLogs/items/properties/metadata',
      '/paths//admin/p2p/orders/get/responses/200/content/application/json/schema/properties/orders/items/properties/timeline/items/properties/metadata',
      '/paths//admin/reward-rules/get/responses/200/content/application/json/schema/properties/rules/items/properties/eligibility',
      '/paths//admin/reward-rules/{id}/patch/requestBody/content/application/json/schema/properties/eligibility',
      '/paths//admin/reward-rules/{id}/patch/responses/200/content/application/json/schema/properties/rule/properties/eligibility',
    ].sort());

    const vip = spec.paths['/users/me/vip'].get.responses['200'].content['application/json'].schema;
    expect(vip.properties.activeLevels).toEqual({ type: 'integer' });
    expect(vip.properties.levels.items.additionalProperties).toBe(false);
    expect(vip.properties.levels.items.properties.targetPaise).toEqual({ type: 'integer' });
  });

  it('returns the requested minimal health response', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({ ok: true, service: 'paisapay-api' });
  });

  it('reports the actual PostgreSQL readiness state', async () => {
    const response = await request(app).get('/ready');
    expect([200, 503]).toContain(response.status);
    expect(['ready', 'unavailable', 'not_configured']).toContain(response.body.dependencies.database);
  });

  it('serves the public API config using the documented path', async () => {
    const response = await request(app).get('/api/v1/config').expect(200);
    expect(response.body.currency).toBe('INR');
    expect(response.body.livePaymentsEnabled).toBe(false);
    expect(response.body.upiDeposit.receiverVpa).toBe(env.depositReceiverUpiId ?? null);
    expect(response.body.upiDeposit.paymentInitiation).toBe(env.depositReceiverUpiId ? 'UPI_INTENT' : 'UNAVAILABLE');
    if (!env.depositReceiverUpiId) expect(response.body.upiDeposit.message).toMatch(/unavailable because no recipient is configured/i);
    expect(response.body.upiDeposit.rewardPercentBps).toBe(1700);
    expect(response.body.upiDeposit.rewardEnabled).toBe(env.upiDepositRewardEnabled);
    expect(response.body.methods.find((item: { name: string }) => item.name === 'PhonePe').buyEnabled).toBe(false);
    expect(response.body.methods.every((item: { available: boolean }) => item.available === false)).toBe(true);
    expect(response.body.availabilityMessage).toMatch(/unavailable/);
  });

  it('returns helpful API information at root', async () => {
    const response = await request(app).get('/').expect(200);
    expect(response.body.docs).toBe('/api/v1/docs');
  });

  it('returns a JSON 404 for missing routes', async () => {
    const response = await request(app).get('/api/v1/missing').expect(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('returns a controlled forbidden response for an unapproved browser origin', async () => {
    const response = await request(app).post('/api/v1/auth/request-otp')
      .set('Origin', 'https://unapproved.example')
      .send({ phoneE164: '+919876543210' })
      .expect(403);
    expect(response.body.error.code).toBe('CORS_ORIGIN_DENIED');
  });

  it('allows the production API origin while keeping CORS allowlisting active', async () => {
    const response = await request(app).get('/api/v1/openapi.json')
      .set('Origin', 'https://paisapay-api.onrender.com')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://paisapay-api.onrender.com');
  });

  it('validates the documented JSON OTP request body and accepts only phoneE164', async () => {
    const invalid = await request(app).post('/api/v1/auth/request-otp')
      .set('Origin', 'https://paisapay-api.onrender.com')
      .send({ phoneE164: 'not-e164' })
      .expect(400);
    expect(invalid.headers['access-control-allow-origin']).toBe('https://paisapay-api.onrender.com');
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const spec = (await request(app).get('/api/v1/openapi.json').expect(200)).body;
    const operation = spec.paths['/auth/request-otp'].post;
    expect(operation.requestBody.required).toBe(true);
    expect(operation.requestBody.content['application/json'].schema.required).toEqual(['phoneE164']);
    expect(operation.requestBody.content['application/json'].schema.properties.phoneE164.example).toBe('+919876543210');
  });

  it('serves API documentation', async () => {
    const response = await request(app).get('/api/v1/docs/').expect(200);
    expect(response.text).toContain('./swagger-ui-bundle.js');
    expect(response.text).toContain('./swagger-ui.css');
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['content-security-policy']).toContain("style-src 'self' https: 'unsafe-inline'");

    await request(app).get('/api/v1/docs/swagger-ui.css').expect(200).expect('Content-Type', /text\/css/);
    await request(app).get('/api/v1/docs/swagger-ui-bundle.js').expect(200).expect('Content-Type', /javascript/);
    const initializer = await request(app).get('/api/v1/docs/swagger-ui-init.js').expect(200).expect('Content-Type', /javascript/);
    expect(initializer.text).toContain('/api/v1/openapi.json');
  });

  it('serves the OpenAPI document at its public JSON path', async () => {
    const response = await request(app).get('/api/v1/openapi.json').expect(200).expect('Content-Type', /json/);
    expect(response.body.openapi).toBe('3.0.3');
    expect(response.body.info.title).toBe('PaisaPay API');
    expect(response.body.paths).toHaveProperty('/config');

    const verifyOtp = response.body.paths['/auth/verify-otp'].post;
    expect(verifyOtp.requestBody.required).toBe(true);
    expect(verifyOtp.requestBody.content['application/json'].schema.required).toEqual(['challengeId', 'phoneE164', 'code']);
    expect(verifyOtp.requestBody.content['application/json'].example).toEqual({
      challengeId: '00000000-0000-4000-8000-000000000001',
      phoneE164: '+919876543210',
      code: '123456',
    });
  });

  it('documents the editable PATCH /users/me profile request body', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json').expect(200)).body;
    const operation = spec.paths['/users/me'].patch;
    expect(operation.requestBody.required).toBe(true);
    const body = operation.requestBody.content['application/json'];
    expect(body.schema.type).toBe('object');
    expect(body.schema.minProperties).toBe(1);
    expect(body.schema.additionalProperties).toBe(false);
    expect(body.schema.properties).toEqual({
      displayName: expect.objectContaining({ type: 'string', minLength: 2, maxLength: 80 }),
      avatarId: expect.objectContaining({
        type: 'string', nullable: true,
        enum: ['boy_aarav', 'boy_veer', 'boy_kabir', 'girl_anya', 'girl_myra', 'girl_tara'],
      }),
      referralCode: expect.objectContaining({ type: 'string', minLength: 4, maxLength: 60 }),
    });
    expect(body.example).toEqual({ displayName: 'Hemanth', avatarId: 'boy_aarav' });
  });

  it('documents the editable PATCH /users/me/upi JSON request body', async () => {
    const spec = (await request(app).get('/api/v1/openapi.json').expect(200)).body;
    const operation = spec.paths['/users/me/upi'].patch;
    expect(operation.requestBody.required).toBe(true);
    const body = operation.requestBody.content['application/json'];
    expect(body.schema.required).toEqual(['upiId']);
    expect(body.schema.properties.upiId).toEqual(expect.objectContaining({ type: 'string', minLength: 3, maxLength: 100 }));
    expect(body.schema.properties.displayName).toEqual(expect.objectContaining({ type: 'string', minLength: 2, maxLength: 100 }));
    expect(body.schema.properties.displayName.nullable).not.toBe(true);
    expect(body.schema.anyOf).toEqual([{ required: ['displayName'] }, { required: ['name'] }, { required: ['accountName'] }]);
    expect(body.example).toEqual({ upiId: 'yourname@okaxis', displayName: 'Hemanth' });
  });

  it('protects private profile data', async () => {
    const response = await request(app).get('/api/v1/users/me').expect(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('protects UPI ID management and manual payment claims', async () => {
    await request(app).get('/api/v1/users/me/upi').expect(401);
    await request(app).patch('/api/v1/users/me/upi').send({ upiId: 'user@bank' }).expect(401);
    await request(app).delete('/api/v1/users/me/upi').expect(401);
    const claim = await request(app).post('/api/v1/deposits/00000000-0000-4000-8000-000000000001/manual-verification').send({ transactionReference: '123456789012', evidenceImageBase64: 'AA==', evidenceMimeType: 'image/png' }).expect(401);
    expect(claim.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('protects bank-account endpoints and update actions', async () => {
    await request(app).get('/api/v1/users/me/bank-accounts').expect(401);
    await request(app).post('/api/v1/users/me/bank-accounts').send({}).expect(401);
    await request(app).patch('/api/v1/users/me/bank-accounts/00000000-0000-4000-8000-000000000001').send({ ifsc: 'ABCD0123456' }).expect(401);
    await request(app).delete('/api/v1/users/me/bank-accounts/00000000-0000-4000-8000-000000000001').expect(401);
    const verify = await request(app).post('/api/v1/users/me/bank-accounts/00000000-0000-4000-8000-000000000001/verify').expect(401);
    expect(verify.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('protects manual reconciliation review behind authenticated admin routes', async () => {
    const list = await request(app).get('/api/v1/admin/reconciliation/claims').expect(401);
    expect(list.body.error.code).toBe('AUTH_REQUIRED');
    const review = await request(app).post('/api/v1/admin/reconciliation/claims/00000000-0000-4000-8000-000000000001/review').send({ decision: 'APPROVE' }).expect(401);
    expect(review.body.error.code).toBe('AUTH_REQUIRED');
    const evidence = await request(app).get('/api/v1/admin/reconciliation/claims/00000000-0000-4000-8000-000000000001/evidence').expect(401);
    expect(evidence.body.error.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    '/api/v1/admin/overview', '/api/v1/admin/users', '/api/v1/admin/deposits', '/api/v1/admin/withdrawals',
    '/api/v1/admin/transactions', '/api/v1/admin/wallets/ledger', '/api/v1/admin/referrals',
    '/api/v1/admin/referrals/config',
    '/api/v1/admin/commissions', '/api/v1/admin/providers', '/api/v1/admin/audit-logs',
    '/api/v1/admin/system-health', '/api/v1/admin/disputes', '/api/v1/admin/support/tickets', '/api/v1/admin/admins',
    '/api/v1/admin/notifications', '/api/v1/admin/reward-rules',
  ])('protects admin data endpoint %s', async (path) => {
    const response = await request(app).get(path).expect(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    ['GET', '/api/v1/users/me/vip'], ['PATCH', '/api/v1/users/me'],
    ['GET', '/api/v1/users/me/upi'], ['PATCH', '/api/v1/users/me/upi'], ['DELETE', '/api/v1/users/me/upi'],
    ['GET', '/api/v1/users/me/balance'], ['GET', '/api/v1/users/me/transactions'], ['GET', '/api/v1/users/me/referrals'],
    ['GET', '/api/v1/wallet-references'], ['POST', '/api/v1/wallet-references'],
    ['GET', '/api/v1/deposits'], ['POST', '/api/v1/deposits'], ['GET', '/api/v1/orders'], ['POST', '/api/v1/orders'],
    ['GET', '/api/v1/withdrawals'], ['POST', '/api/v1/withdrawals'], ['GET', '/api/v1/withdrawals/marketplace'],
    ['POST', '/api/v1/deposits/quick-match'], ['GET', '/api/v1/deposits/orders/my'],
    ['GET', '/api/v1/notifications'], ['GET', '/api/v1/support/tickets'], ['POST', '/api/v1/support/tickets'],
    ['GET', '/api/v1/admin/me'], ['POST', '/api/v1/admin/push-devices'], ['GET', '/api/v1/admin/push-events'],
    ['POST', '/api/v1/admin/wallet/credits/direct'],
    ['GET', '/api/v1/admin/p2p/offers'], ['GET', '/api/v1/admin/p2p/orders'], ['GET', '/api/v1/admin/p2p/claims'],
    ['GET', '/api/v1/admin/reconciliation/claims'],
  ])('requires authentication for %s %s', async (method, path) => {
    const response = method === 'GET'
      ? await request(app).get(path).expect(401)
      : method === 'PATCH'
        ? await request(app).patch(path).send({}).expect(401)
        : method === 'DELETE'
          ? await request(app).delete(path).send({}).expect(401)
          : await request(app).post(path).send({}).expect(401);
    expect(response.body.error).toEqual(expect.objectContaining({ code: 'AUTH_REQUIRED', message: expect.any(String) }));
  });

  it('requires an authenticated administrator role for admin mutations', async () => {
    const response = await request(app).post('/api/v1/admin/users/00000000-0000-4000-8000-000000000001/status').send({ status: 'SUSPENDED', reason: 'Suspicious account report' }).expect(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
    const rates = await request(app).patch('/api/v1/admin/referrals/config').send({ directRateBps: 40, indirectRateBps: 10, reason: 'Policy update requested' }).expect(401);
    expect(rates.body.error.code).toBe('AUTH_REQUIRED');
    const milestone = await request(app).patch('/api/v1/admin/referrals/milestones/TIER_5').send({}).expect(401);
    expect(milestone.body.error.code).toBe('AUTH_REQUIRED');
    const announcement = await request(app).post('/api/v1/admin/notifications').send({}).expect(401);
    expect(announcement.body.error.code).toBe('AUTH_REQUIRED');
    const rewardRule = await request(app).patch('/api/v1/admin/reward-rules/00000000-0000-4000-8000-000000000001').send({}).expect(401);
    expect(rewardRule.body.error.code).toBe('AUTH_REQUIRED');
    const supportReply = await request(app).post('/api/v1/admin/support/tickets/00000000-0000-4000-8000-000000000001/reply').send({}).expect(401);
    expect(supportReply.body.error.code).toBe('AUTH_REQUIRED');
    const supportStatus = await request(app).patch('/api/v1/admin/support/tickets/00000000-0000-4000-8000-000000000001/status').send({}).expect(401);
    expect(supportStatus.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('does not accept malformed OTP input', async () => {
    const response = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164: '+919876543210', challengeId: 'bad-id', code: '1234' }).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('validates the phone and six-digit code shape for password reset before touching the database', async () => {
    const requestOtp = await request(app).post('/api/v1/auth/forgot-password/request-otp').send({}).expect(400);
    expect(requestOtp.body.error.code).toBe('VALIDATION_ERROR');
    const reset = await request(app).post('/api/v1/auth/password/reset').send({ phoneE164: '+919876543210', challengeId: '00000000-0000-4000-8000-000000000000', code: '7891', newPassword: 'changed-password-1' }).expect(400);
    expect(reset.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('routes OTP status requests to auth handling instead of the route-not-found fallback', async () => {
    const response = await request(app).get('/api/v1/auth/otp-status/00000000-0000-4000-8000-000000000000');
    expect([404, 503]).toContain(response.status);
    expect(response.body.error.code).not.toBe('ROUTE_NOT_FOUND');
  });

  it('keeps payment webhooks disabled until a provider is configured', async () => {
    const previous = env.financialOperationsEnabled;
    env.financialOperationsEnabled = true;
    try {
      const response = await request(app).post('/api/v1/webhooks/payments/example').send({ status: 'success' }).expect(503);
      expect(response.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    } finally { env.financialOperationsEnabled = previous; }
  });

  it('does not allow unauthenticated wallet-method configuration access', async () => {
    const response = await request(app).get('/api/v1/wallet-methods').expect(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('removes the MobiKwik linking API routes', async () => {
    await request(app).get('/api/v1/wallet-links').expect(404);
    await request(app).post('/api/v1/wallet-links/mobikwik').send({ phoneE164: '+919876543210' }).expect(404);
  });

  it('removes the MobiKwik payment status API route', async () => {
    await request(app).get('/api/v1/deposits/00000000-0000-4000-8000-000000000000/mobikwik-status').expect(404);
  });

  it.each([
    ['successful-looking', { status: 'success', amountPaise: 9900 }],
    ['pending', { status: 'pending', amountPaise: 9900 }],
    ['failed', { status: 'failed', amountPaise: 9900 }],
    ['invalid', { status: 'success', amountPaise: -1, currency: 'USD' }],
    ['duplicate-looking', { status: 'success', eventId: 'duplicate-event', amountPaise: 9900 }],
  ])('does not credit funds from a %s callback without an adapter', async (_caseName, payload) => {
    const previous = env.financialOperationsEnabled;
    env.financialOperationsEnabled = true;
    try {
      const response = await request(app).post('/api/v1/webhooks/payments/example').send(payload).expect(503);
      expect(response.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    } finally { env.financialOperationsEnabled = previous; }
  });

  it('rejects unauthenticated withdrawal requests', async () => {
    const response = await request(app).post('/api/v1/withdrawals').send({ amountPaise: 9900 }).expect(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });
});
