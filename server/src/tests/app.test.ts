import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { env } from '../config/env.js';

describe('PaisaPay API foundation', () => {
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
    expect(response.body.upiDeposit.receiverVpa).toBe('zitch@ptyes');
    expect(response.body.upiDeposit.rewardPercentBps).toBe(1700);
    expect(response.body.upiDeposit.rewardEnabled).toBe(env.upiDepositRewardEnabled);
    expect(response.body.methods.find((item: { name: string }) => item.name === 'PhonePe').buyEnabled).toBe(false);
    expect(response.body.methods.every((item: { available: boolean }) => item.available === false)).toBe(true);
    expect(response.body.availabilityMessage).toMatch(/temporarily unavailable/);
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
    const response = await request(app).post('/api/v1/webhooks/payments/example').send({ status: 'success' }).expect(503);
    expect(response.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
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
    const response = await request(app).post('/api/v1/webhooks/payments/example').send(payload).expect(503);
    expect(response.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
  });

  it('rejects unauthenticated withdrawal requests', async () => {
    const response = await request(app).post('/api/v1/withdrawals').send({ amountPaise: 9900 }).expect(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });
});
