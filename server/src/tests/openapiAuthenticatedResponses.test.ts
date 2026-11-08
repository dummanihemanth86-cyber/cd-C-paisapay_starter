import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openapi } from '../openapi.js';
import { env } from '../config/env.js';
import { FINANCIAL_OPERATION_ROUTE_MANIFEST } from '../middleware/financialOperations.js';
import { assertOpenApiResponse } from './support/openapiRuntimeValidator.js';

const { fakeDatabase } = vi.hoisted(() => {
  const userId = '00000000-0000-4000-8000-000000000123';
  const now = new Date('2026-01-02T03:04:05.000Z');
  const user = { id: userId, publicId: '123456789', phoneE164: '+919876543210', displayName: 'Contract Fixture', avatarId: null, status: 'ACTIVE', referralCode: 'FIXTURE123', upiId: 'fixture@okaxis', upiDisplayName: 'Fixture Name', upiIdVerifiedAt: null, createdAt: now };
  const session = { id: '00000000-0000-4000-8000-000000000456', userId, accessTokenHash: '', refreshTokenHash: '', accessExpiresAt: new Date('2099-01-01T00:00:00.000Z'), refreshExpiresAt: new Date('2099-01-01T00:00:00.000Z'), revokedAt: null, user };
  const replies = new Map<string, unknown>();
  const writes: string[] = [];
  const administrator = { id: '00000000-0000-4000-8000-000000000789', userId, role: 'SUPER_ADMIN' };
  const database = new Proxy({}, {
    get(_target, model: string) {
      if (model === '$transaction') return async (input: unknown) => typeof input === 'function' ? (input as (tx: unknown) => unknown)(database) : Promise.all(input as Promise<unknown>[]);
      if (model === '$queryRaw') return async () => [];
      return new Proxy({}, {
        get(_delegate, method: string) {
          return async (...args: unknown[]) => {
            if (['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].includes(method)) writes.push(`${model}.${method}`);
            const configured = replies.get(`${model}.${method}`);
            if (configured !== undefined) return typeof configured === 'function' ? (configured as (...values: unknown[]) => unknown)(...args) : configured;
            if (method === 'findMany' || method === 'groupBy') return [];
            if (method === 'count') return 0;
            if (method === 'aggregate') return { _sum: { amountPaise: null, creditPaise: null } };
            if (method === 'updateMany' || method === 'createMany' || method === 'deleteMany') return { count: 1 };
            if (method === 'findUnique' && model === 'session') return session;
            if (method === 'findUnique' && model === 'adminUser') return administrator;
            if (method === 'findUniqueOrThrow' && model === 'user') {
              const select = (args[0] as { select?: Record<string, boolean> } | undefined)?.select;
              return select ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, user[key as keyof typeof user]])) : user;
            }
            if (method === 'upsert' && model === 'referralProgramConfig') return { id: 1, directRateBps: 40, indirectRateBps: 10, updatedAt: now };
            if (method === 'findFirst' || method === 'findUnique') return null;
            if (method === 'findUniqueOrThrow') return {};
            if (method === 'upsert' || method === 'update' || method === 'create') return { id: '00000000-0000-4000-8000-000000000999', ...((args[0] as { data?: object } | undefined)?.data ?? {}) };
            return undefined;
          };
        },
      });
    },
  });
  return { fakeDatabase: { database, replies, writes, user, session, administrator } };
});

vi.mock('../lib/db.js', () => ({
  prisma: fakeDatabase.database,
  databaseRequired: () => fakeDatabase.database,
  closeDatabase: async () => undefined,
}));

import { app } from '../app.js';

describe('authenticated API response contracts (in-memory Prisma mock)', () => {
  const authorization = { Authorization: 'Bearer isolated-openapi-contract-token' };
  const previousFinancialOperationsEnabled = env.financialOperationsEnabled;

  beforeAll(() => { env.financialOperationsEnabled = true; });
  afterAll(() => { env.financialOperationsEnabled = previousFinancialOperationsEnabled; });

  it('validates successful authenticated responses across user and finance modules', async () => {
    const cases: Array<[string, string]> = [
      ['GET', '/users/me'],
      ['GET', '/users/me/upi'],
      ['GET', '/users/me/bank-accounts'],
      ['GET', '/users/me/balance'],
      ['GET', '/users/me/transactions'],
      ['GET', '/users/me/referrals'],
      ['GET', '/users/me/vip'],
      ['GET', '/wallet-methods'],
      ['GET', '/wallet-references'],
      ['GET', '/deposits'],
      ['GET', '/orders'],
      ['GET', '/withdrawals'],
      ['GET', '/deposits/orders/my'],
      ['GET', '/support/tickets'],
      ['GET', '/notifications'],
      ['GET', '/admin/me'],
      ['GET', '/admin/deposits'],
      ['GET', '/admin/p2p/overview'],
      ['GET', '/admin/overview'],
      ['GET', '/admin/users'],
      ['GET', '/admin/withdrawals'],
      ['GET', '/admin/transactions'],
      ['GET', '/admin/wallets/ledger'],
      ['GET', '/admin/referrals'],
      ['GET', '/admin/commissions'],
      ['GET', '/admin/audit-logs'],
      ['GET', '/admin/system-health'],
      ['GET', '/admin/settings'],
      ['GET', '/admin/disputes'],
      ['GET', '/admin/support/tickets'],
      ['GET', '/admin/notifications'],
      ['GET', '/admin/reward-rules'],
      ['GET', '/admin/push-events'],
    ];

    for (const [method, path] of cases) {
      const response = await request(app)[method.toLowerCase() as 'get'](`/api/v1${path}`).set(authorization).expect(200);
      assertOpenApiResponse(openapi, method, path, response);
      if (path === '/admin/me') {
        expect(response.body.financialOperationsEnabled).toBe(true);
        expect(response.body.walletAdjustmentAllowed).toBe(false);
        expect(response.body.walletAdjustmentsEnabled).toBe(false);
        expect(response.body.walletCreditRequestsEnabled).toBe(false);
        expect(response.body.walletCreditBlockers).toContain('Maker-checker migration is missing');
      }
      if (path === '/admin/settings') {
        expect(response.body.financialSafety.walletCreditReadiness).toBe('BLOCKED');
        expect(response.body.financialSafety.walletProductionApproved).toBe(false);
        expect(response.body.financialSafety.walletCreditBlockers).toContain('Maker-checker migration is missing');
      }
    }
    const report = await request(app).get('/api/v1/admin/reports?report=registrations&from=2026-01-01&to=2026-01-02').set(authorization).expect(200);
    assertOpenApiResponse(openapi, 'GET', '/admin/reports', report);
    expect(report.body.daily).toEqual([{ date: '2026-01-01', count: 0 }, { date: '2026-01-02', count: 0 }]);
    expect(report.body).not.toHaveProperty('userIds');
  });

  it('retires the direct wallet adjustment route before any financial mutation', async () => {
    const previous = { enabled: env.walletAdjustmentsEnabled, adminId: env.walletAdjustmentAdminUserId, role: fakeDatabase.administrator.role };
    env.walletAdjustmentsEnabled = false;
    env.walletAdjustmentAdminUserId = fakeDatabase.user.id;
    fakeDatabase.administrator.role = 'ADMIN';
    fakeDatabase.writes.length = 0;
    try {
      const response = await request(app).post('/api/v1/admin/wallet-adjustments').set(authorization)
        .set('Idempotency-Key', '84ac3927-50df-4cf3-8ef2-6b9966e05fd1')
        .send({ targetPublicId: '123456789', direction: 'CREDIT', amountPaise: 100, reason: 'Isolated disabled-route contract test' })
        .expect(409);
      assertOpenApiResponse(openapi, 'POST', '/admin/wallet-adjustments', response);
      expect(response.body.error.code).toBe('MAKER_CHECKER_REQUIRED');
      expect(fakeDatabase.writes).toEqual([]);
    } finally {
      env.walletAdjustmentsEnabled = previous.enabled;
      env.walletAdjustmentAdminUserId = previous.adminId;
      fakeDatabase.administrator.role = previous.role;
    }
  });

  it('keeps the retired per-user direct credit route non-successful and write-free', async () => {
    fakeDatabase.administrator.role = 'SUPER_ADMIN';
    fakeDatabase.writes.length = 0;
    const response = await request(app)
      .post(`/api/v1/admin/users/${fakeDatabase.user.id}/wallet/credit`)
      .set(authorization)
      .send({ amountPaise: 10_000, reason: 'Must use maker checker' })
      .expect(409);
    expect(response.body.error.code).toBe('MAKER_CHECKER_REQUIRED');
    expect(fakeDatabase.writes).toEqual([]);
    const operation = openapi.paths['/admin/users/{id}/wallet/credit'].post;
    expect(Object.keys(operation.responses).some((status) => status.startsWith('2'))).toBe(false);
    expect(operation.responses['409'].content?.['application/json']?.schema).toEqual({ $ref: '#/components/schemas/ApiError' });
  });

  it('keeps the new direct-credit route unavailable outside explicit staging and write-free', async () => {
    const previous = { enabled: env.stagingDirectWalletCreditsEnabled, staging: env.isExplicitRenderStaging };
    env.stagingDirectWalletCreditsEnabled = false;
    env.isExplicitRenderStaging = false;
    fakeDatabase.administrator.role = 'SUPER_ADMIN';
    fakeDatabase.writes.length = 0;
    try {
      const response = await request(app)
        .post('/api/v1/admin/wallet/credits/direct')
        .set(authorization)
        .set('Idempotency-Key', 'a4f63025-05b9-41af-a714-59e44bc92a4e')
        .send({})
        .expect(404);
      expect(response.body.error.code).toBe('STAGING_DIRECT_CREDIT_UNAVAILABLE');
      assertOpenApiResponse(openapi, 'POST', '/admin/wallet/credits/direct', response);
      expect(fakeDatabase.writes).toEqual([]);
    } finally {
      env.stagingDirectWalletCreditsEnabled = previous.enabled;
      env.isExplicitRenderStaging = previous.staging;
    }
  });

  it('keeps direct staging credit disabled without the dedicated flag, even on staging', async () => {
    const previous = { enabled: env.stagingDirectWalletCreditsEnabled, staging: env.isExplicitRenderStaging };
    env.stagingDirectWalletCreditsEnabled = false;
    env.isExplicitRenderStaging = true;
    fakeDatabase.administrator.role = 'SUPER_ADMIN';
    fakeDatabase.writes.length = 0;
    try {
      const response = await request(app)
        .post('/api/v1/admin/wallet/credits/direct')
        .set(authorization)
        .set('Idempotency-Key', 'c965733c-8d85-4597-87ec-20c7ca1187bf')
        .send({})
        .expect(503);
      expect(response.body.error.code).toBe('STAGING_DIRECT_CREDIT_DISABLED');
      assertOpenApiResponse(openapi, 'POST', '/admin/wallet/credits/direct', response);
      expect(fakeDatabase.writes).toEqual([]);
    } finally {
      env.stagingDirectWalletCreditsEnabled = previous.enabled;
      env.isExplicitRenderStaging = previous.staging;
    }
  });

  it('rejects direct-credit mutations from non-SUPER_ADMIN roles before financial checks', async () => {
    const previousRole = fakeDatabase.administrator.role;
    fakeDatabase.administrator.role = 'ADMIN';
    fakeDatabase.writes.length = 0;
    try {
      const response = await request(app)
        .post('/api/v1/admin/wallet/credits/direct')
        .set(authorization)
        .send({})
        .expect(403);
      expect(response.body.error.code).toBe('ADMIN_PERMISSION_DENIED');
      assertOpenApiResponse(openapi, 'POST', '/admin/wallet/credits/direct', response);
      expect(fakeDatabase.writes).toEqual([]);
    } finally {
      fakeDatabase.administrator.role = previousRole;
    }
  });

  it('retires the legacy adjustment endpoint regardless of admin role', async () => {
    const previous = { adminId: env.walletAdjustmentAdminUserId, role: fakeDatabase.administrator.role };
    env.walletAdjustmentAdminUserId = fakeDatabase.user.id;
    fakeDatabase.administrator.role = 'SUPER_ADMIN';
    fakeDatabase.writes.length = 0;
    try {
      const response = await request(app).post('/api/v1/admin/wallet-adjustments').set(authorization)
        .set('Idempotency-Key', '84ac3927-50df-4cf3-8ef2-6b9966e05fd2')
        .send({ targetPublicId: '123456789', direction: 'CREDIT', amountPaise: 100, reason: 'Role isolation regression test' })
        .expect(409);
      expect(response.body.error.code).toBe('MAKER_CHECKER_REQUIRED');
      expect(fakeDatabase.writes).toEqual([]);
    } finally {
      env.walletAdjustmentAdminUserId = previous.adminId;
      fakeDatabase.administrator.role = previous.role;
    }
  });

  it('does not let old direct adjustment traffic bypass maker-checker when the global gate changes', async () => {
    const previous = { wallet: env.walletAdjustmentsEnabled, finance: env.financialOperationsEnabled, adminId: env.walletAdjustmentAdminUserId, role: fakeDatabase.administrator.role };
    env.walletAdjustmentsEnabled = true;
    env.financialOperationsEnabled = false;
    env.walletAdjustmentAdminUserId = fakeDatabase.user.id;
    fakeDatabase.administrator.role = 'ADMIN';
    fakeDatabase.writes.length = 0;
    try {
      const response = await request(app).post('/api/v1/admin/wallet-adjustments').set(authorization)
        .set('Idempotency-Key', '84ac3927-50df-4cf3-8ef2-6b9966e05fd3')
        .send({ targetPublicId: '123456789', direction: 'CREDIT', amountPaise: 100, reason: 'Global gate isolation test' })
        .expect(409);
      expect(response.body.error.code).toBe('MAKER_CHECKER_REQUIRED');
      expect(fakeDatabase.writes).toEqual([]);
    } finally {
      env.walletAdjustmentsEnabled = previous.wallet;
      env.financialOperationsEnabled = previous.finance;
      env.walletAdjustmentAdminUserId = previous.adminId;
      fakeDatabase.administrator.role = previous.role;
    }
  });

  it('blocks financial summary reports before any database query while the gate is disabled', async () => {
    const previous = env.financialOperationsEnabled;
    env.financialOperationsEnabled = false;
    try {
      const response = await request(app).get('/api/v1/admin/reports?report=deposits&from=2026-01-01&to=2026-01-02').set(authorization).expect(503);
      expect(response.body.error.code).toBe('FINANCIAL_OPERATIONS_DISABLED');
      assertOpenApiResponse(openapi, 'GET', '/admin/reports', response);
    } finally { env.financialOperationsEnabled = previous; }
  });

  it('enforces Admin role permissions for reports and settings', async () => {
    fakeDatabase.administrator.role = 'OPERATIONS';
    try {
      await request(app).get('/api/v1/admin/reports?report=registrations&from=2026-01-01&to=2026-01-02').set(authorization).expect(403);
      await request(app).get('/api/v1/admin/settings').set(authorization).expect(403);
    } finally { fakeDatabase.administrator.role = 'SUPER_ADMIN'; }
  });

  it('rejects report statuses that do not belong to the selected report', async () => {
    const response = await request(app).get('/api/v1/admin/reports?report=registrations&from=2026-01-01&to=2026-01-02&status=OPEN').set(authorization).expect(400);
    assertOpenApiResponse(openapi, 'GET', '/admin/reports', response);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('validates a successful session refresh response without database access', async () => {
    const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'isolated-contract-refresh-token-123456' }).expect(200);
    assertOpenApiResponse(openapi, 'POST', '/auth/refresh', response);
  });

  it('fails closed when the production UPI recipient is missing and creates no deposit', async () => {
    env.financialOperationsEnabled = true;
    const previousReceiver = env.depositReceiverUpiId;
    env.depositReceiverUpiId = undefined;
    const createDeposit = vi.fn(() => { throw new Error('deposit creation must not run without a receiver'); });
    fakeDatabase.replies.set('deposit.create', createDeposit);
    try {
      const response = await request(app).post('/api/v1/deposits')
        .set(authorization)
        .set('Idempotency-Key', 'missing-receiver-test-001')
        .send({ amountPaise: 10000, method: 'UPI' })
        .expect(503);
      assertOpenApiResponse(openapi, 'POST', '/deposits', response);
      expect(response.body.error.code).toBe('DEPOSIT_RECEIVER_NOT_CONFIGURED');
      expect(JSON.stringify(response.body)).not.toMatch(/receiverVpa|upi:\/\//i);
      expect(createDeposit).not.toHaveBeenCalled();
    } finally {
      env.depositReceiverUpiId = previousReceiver;
      if (createDeposit === undefined) fakeDatabase.replies.delete('deposit.create');
      else fakeDatabase.replies.set('deposit.create', createDeposit);
    }
  });

  it('returns the stable 503 gate response for financial operations before database mutations', async () => {
    const previous = env.financialOperationsEnabled;
    env.financialOperationsEnabled = false;
    try {
      await request(app).post('/api/v1/deposits').send({ amountPaise: 10000, method: 'UPI' }).expect(401);
      await request(app).post('/api/v1/withdrawals').send({ amountPaise: 10000 }).expect(401);
      const beforeWrites = fakeDatabase.writes.length;
      const id = '00000000-0000-4000-8000-000000000abc';
      const methods = ['get', 'post', 'patch'] as const;
      for (const [verb, template] of FINANCIAL_OPERATION_ROUTE_MANIFEST) {
        const path = template
          .replaceAll(':id', id)
          .replaceAll(':claimId', id)
          .replaceAll(':provider', 'cashfree')
          .replaceAll(':key', 'TIER_5');
        const method = verb.toLowerCase() as typeof methods[number];
        const endpoint = request(app)[method](path).set(authorization);
        const response = method === 'get' ? await endpoint.expect(503) : await endpoint.send({}).expect(503);
        expect(response.body.error.code, `${verb} ${template}`).toBe('FINANCIAL_OPERATIONS_DISABLED');
        expect(response.headers['content-type'], `${verb} ${template}`).toContain('application/json');
      }

      const previousAdminRecord = fakeDatabase.replies.get('adminUser.findUnique');
      fakeDatabase.replies.set('adminUser.findUnique', { id: '00000000-0000-4000-8000-000000000789', userId: fakeDatabase.user.id, role: 'SUPPORT' });
      try {
        const unauthorizedFinance = await request(app).post(`/api/v1/admin/p2p/claims/${id}/review`).set(authorization).send({}).expect(403);
        expect(unauthorizedFinance.body.error.code).toBe('FINANCE_REVIEW_REQUIRED');
      } finally {
        if (previousAdminRecord === undefined) fakeDatabase.replies.delete('adminUser.findUnique');
        else fakeDatabase.replies.set('adminUser.findUnique', previousAdminRecord);
      }
      expect(fakeDatabase.writes).toHaveLength(beforeWrites);
    } finally {
      env.financialOperationsEnabled = previous;
    }
  });

  it('keeps non-financial read routes available while the gate is disabled', async () => {
    const previous = env.financialOperationsEnabled;
    env.financialOperationsEnabled = false;
    try {
      const config = await request(app).get('/api/v1/config').expect(200);
      assertOpenApiResponse(openapi, 'GET', '/config', config);
      const profile = await request(app).get('/api/v1/users/me').set(authorization).expect(200);
      assertOpenApiResponse(openapi, 'GET', '/users/me', profile);
      const notifications = await request(app).get('/api/v1/notifications').set(authorization).expect(200);
      assertOpenApiResponse(openapi, 'GET', '/notifications', notifications);
      const support = await request(app).get('/api/v1/support/tickets').set(authorization).expect(200);
      assertOpenApiResponse(openapi, 'GET', '/support/tickets', support);
    } finally {
      env.financialOperationsEnabled = previous;
    }
  });

  it('validates a successful authenticated response body containing nested fixture rows', async () => {
    const now = new Date('2026-01-02T03:04:05.000Z');
    const depositId = '00000000-0000-4000-8000-000000000020';
    fakeDatabase.replies.set('deposit.findMany', [{ id: depositId, userId: fakeDatabase.user.id, amountPaise: 10000n, currency: 'INR', method: 'UPI', status: 'PENDING_PAYMENT', merchantReference: 'PPDEP-FIXTURE', idempotencyKey: 'fixture-deposit-key', providerReference: null, paymentSessionId: null, expiresAt: new Date('2026-01-02T03:09:05.000Z'), ledgerTransactionId: null, createdAt: now, updatedAt: now, manualPaymentClaim: null }]);
    const deposits = await request(app).get('/api/v1/deposits').set(authorization).expect(200);
    assertOpenApiResponse(openapi, 'GET', '/deposits', deposits);

    const offerId = '00000000-0000-4000-8000-000000000021';
    const orderId = '00000000-0000-4000-8000-000000000022';
    const order = { id: orderId, referenceId: 'PPDEP-ORDER-FIXTURE', buyerUserId: fakeDatabase.user.id, sellerUserId: '00000000-0000-4000-8000-000000000124', withdrawalOfferId: offerId, amountPaise: 10000n, currency: 'INR', status: 'MATCHED', idempotencyKey: 'fixture-p2p-key', providerReference: null, expiresAt: new Date('2026-01-02T03:09:05.000Z'), paymentDetailsShownAt: null, paymentHandoffStartedAt: null, cancellationRequestedAt: null, createdAt: now, updatedAt: now, withdrawalOffer: { id: offerId, referenceId: 'PPWD-FIXTURE' }, claims: [{ status: 'PENDING_REVIEW', transactionReference: null, reviewReason: null, createdAt: now, claimedAmountPaise: null, claimedPaidAt: null, evidenceMimeType: null }] };
    fakeDatabase.replies.set('p2pDepositOrder.findMany', (args: { where?: { OR?: unknown } }) => args.where?.OR ? [order] : []);
    const p2pOrders = await request(app).get('/api/v1/deposits/orders/my').set(authorization).expect(200);
    assertOpenApiResponse(openapi, 'GET', '/deposits/orders/my', p2pOrders);

    const claimId = '00000000-0000-4000-8000-000000000023';
    const claimOrderId = '00000000-0000-4000-8000-000000000024';
    fakeDatabase.replies.set('p2pPaymentClaim.findMany', [{ id: claimId, orderId: claimOrderId, userId: fakeDatabase.user.id, transactionReference: 'UTR12345', status: 'PENDING_REVIEW', claimedAmountPaise: 10000n, claimedPaidAt: now, evidenceMimeType: 'image/png', evidenceReference: null, reviewReason: null, createdAt: now, order: { id: claimOrderId, referenceId: 'PPDEP-CLAIM-FIXTURE', amountPaise: 10000n, status: 'PAYMENT_PROCESSING', createdAt: now, expiresAt: new Date('2026-01-02T03:09:05.000Z'), paymentDetailsShownAt: now, paymentHandoffStartedAt: now, cancellationRequestedAt: null, seller: { id: fakeDatabase.user.id, publicId: fakeDatabase.user.publicId }, withdrawalOffer: { id: offerId, referenceId: 'PPWD-FIXTURE', payeeVpa: 'seller@okaxis', payeeName: 'Seller Name' } }, user: { id: fakeDatabase.user.id, publicId: fakeDatabase.user.publicId, phoneE164: fakeDatabase.user.phoneE164, displayName: fakeDatabase.user.displayName } }]);
    const adminClaims = await request(app).get('/api/v1/admin/p2p/claims').set(authorization).expect(200);
    assertOpenApiResponse(openapi, 'GET', '/admin/p2p/claims', adminClaims);

    fakeDatabase.replies.set('supportTicket.findMany', [{ id: '00000000-0000-4000-8000-000000000010', subject: 'Fixture ticket', status: 'OPEN', createdAt: now, updatedAt: now }]);
    const tickets = await request(app).get('/api/v1/support/tickets').set(authorization).expect(200);
    assertOpenApiResponse(openapi, 'GET', '/support/tickets', tickets);

    fakeDatabase.replies.set('notification.findMany', [{ id: '00000000-0000-4000-8000-000000000011', userId: fakeDatabase.user.id, title: 'Fixture title', body: 'Fixture body', readAt: null, createdAt: now }]);
    const notifications = await request(app).get('/api/v1/notifications').set(authorization).expect(200);
    assertOpenApiResponse(openapi, 'GET', '/notifications', notifications);
  });
});
