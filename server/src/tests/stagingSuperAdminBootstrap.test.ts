import { describe, expect, it, vi } from 'vitest';
import {
  bootstrapSingleStagingSuperAdmin,
  validateSingleStagingSuperAdminEnvironment,
  validateSingleStagingSuperAdminPassword,
  validateSingleStagingSuperAdminUserId,
} from '../../scripts/stagingSuperAdminBootstrap.js';
import { STAGING_FINANCIAL_FLAG_NAMES } from '../config/stagingFinancialFlags.js';
import { STAGING_DATABASE_HOST, STAGING_DATABASE_NAME } from '../../scripts/stagingSuperAdminProvision.js';

const userId = '00000000-0000-4000-8000-000000000111';
const user = { id: userId, publicId: 'STAGE11111', phoneE164: '+919876543210', status: 'ACTIVE', adminRole: null };

function stagingEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ...Object.fromEntries(STAGING_FINANCIAL_FLAG_NAMES.map((flag) => [flag, 'false'])),
    PAISAPAY_ENVIRONMENT: 'staging', NODE_ENV: 'production', PAYMENT_PROVIDER: 'disabled',
    FINANCIAL_OPERATIONS_ENABLED: 'false', PAISAPAY_STAGING_PROVISIONED_BY: 'staging-operator@example.test',
    PAISAPAY_STAGING_ADMIN_DATABASE_URL: `postgresql://stage_user:stage_password@${STAGING_DATABASE_HOST}/${STAGING_DATABASE_NAME}?sslmode=verify-full`,
    ...overrides,
  };
}

const financialGateCases = STAGING_FINANCIAL_FLAG_NAMES.flatMap((flag) => [
  { flag, state: 'missing', value: undefined },
  { flag, state: 'true', value: 'true' },
  { flag, state: 'unknown', value: 'enabled' },
]);

function txFixture(overrides: Record<string, any> = {}) {
  const calls = {
    userUpdate: vi.fn(async () => ({})), adminCreate: vi.fn(async () => ({})),
    sessions: vi.fn(async () => ({ count: 2 })), audit: vi.fn(async () => ({})),
  };
  const tx = {
    $executeRaw: vi.fn(async () => 1), $queryRaw: vi.fn(async () => []),
    user: { findUnique: vi.fn(async () => user), update: calls.userUpdate },
    adminUser: { count: vi.fn(async () => 0), create: calls.adminCreate },
    otpChallenge: { findFirst: vi.fn(async () => ({ id: 'recent-consumed-otp' })) },
    session: { updateMany: calls.sessions }, auditLog: { create: calls.audit },
    ...overrides,
  } as unknown as Parameters<typeof bootstrapSingleStagingSuperAdmin>[0];
  return { tx, calls };
}

describe('one-time staging SUPER_ADMIN bootstrap', () => {
  it('reuses the candidate 17-flag list for all three fail-closed states', () => {
    expect(STAGING_FINANCIAL_FLAG_NAMES).toHaveLength(17);
    expect(financialGateCases).toHaveLength(51);
  });

  it('accepts only the approved staging DB, TLS, and disabled financial configuration', () => {
    expect(validateSingleStagingSuperAdminEnvironment(stagingEnv())).toEqual({ hostname: STAGING_DATABASE_HOST, database: STAGING_DATABASE_NAME, operator: 'staging-operator@example.test' });
  });

  it.each([
    [{ PAISAPAY_ENVIRONMENT: 'production' }, /PAISAPAY_ENVIRONMENT=staging/],
    [{ NODE_ENV: 'development' }, /NODE_ENV=production/],
    [{ PAYMENT_PROVIDER: 'cashfree' }, /PAYMENT_PROVIDER.*disabled/],
    [{ FINANCIAL_OPERATIONS_ENABLED: 'true' }, /FINANCIAL_OPERATIONS_ENABLED.*false/],
    [{ PAISAPAY_STAGING_ADMIN_DATABASE_URL: 'postgresql://u:p@ep-prod.neon.tech/paisapay_staging?sslmode=verify-full' }, /host does not match/],
    [{ PAISAPAY_STAGING_ADMIN_DATABASE_URL: `postgresql://u:p@${STAGING_DATABASE_HOST}/production?sslmode=verify-full` }, /paisapay_staging/],
    [{ PAISAPAY_STAGING_ADMIN_DATABASE_URL: `postgresql://u:p@${STAGING_DATABASE_HOST}/${STAGING_DATABASE_NAME}?sslmode=require` }, /exactly one sslmode=verify-full/],
    [{ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, /TLS certificate verification/],
    [{ PGSSLMODE: 'disable' }, /PostgreSQL TLS cannot be disabled/],
  ] as const)('rejects unsafe environment %j', (overrides, expected) => {
    expect(() => validateSingleStagingSuperAdminEnvironment(stagingEnv(overrides))).toThrow(expected);
  });

  it.each(financialGateCases)('rejects $flag when its value is $state', ({ flag, value }) => {
    const values = stagingEnv();
    if (value === undefined) delete values[flag];
    else values[flag] = value;
    expect(() => validateSingleStagingSuperAdminEnvironment(values))
      .toThrow(new RegExp(flag + '.*explicitly false'));
  });

  it('validates one existing user UUID and strong password', () => {
    expect(() => validateSingleStagingSuperAdminUserId(userId)).not.toThrow();
    expect(() => validateSingleStagingSuperAdminUserId('not-a-uuid')).toThrow(/UUID/);
    expect(() => validateSingleStagingSuperAdminPassword('short')).toThrow(/12–128/);
    expect(() => validateSingleStagingSuperAdminPassword('valid-staging-password')).not.toThrow();
  });

  it('assigns exactly one role atomically, revokes sessions, and audits after fresh OTP proof', async () => {
    const { tx, calls } = txFixture();
    const result = await bootstrapSingleStagingSuperAdmin(tx, { userId, passwordHash: 'scrypt-hash', operator: 'staging-operator@example.test' });
    expect(result.userId).toBe(userId);
    expect(calls.userUpdate).toHaveBeenCalledTimes(1);
    expect(calls.adminCreate).toHaveBeenCalledExactlyOnceWith({ data: { userId, role: 'SUPER_ADMIN' } });
    expect(calls.sessions).toHaveBeenCalledTimes(1);
    expect(calls.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: expect.objectContaining({
      actorId: null,
      action: 'STAGING_SUPER_ADMIN_BOOTSTRAPPED',
      metadata: expect.objectContaining({ operator: 'staging-operator@example.test', role: 'SUPER_ADMIN' }),
    }) }));
    expect((tx as any).$executeRaw).toHaveBeenCalledTimes(1);
    expect(((tx as any).$executeRaw.mock.calls[0][0] as TemplateStringsArray).join(''))
      .toContain('pg_advisory_xact_lock');
    expect((tx as any).otpChallenge.findFirst.mock.calls[0][0].where).toMatchObject({
      phoneE164: user.phoneE164, purpose: { in: ['LOGIN', 'REGISTER'] }, consumedAt: { gte: expect.any(Date) },
    });
  });

  const expiredOtp = new Date(Date.now() - 16 * 60 * 1000);
  it.each([
    ['existing Admin', { adminUser: { count: vi.fn(async () => 1), create: vi.fn() } }, /already has an Admin/],
    ['inactive user', { user: { findUnique: vi.fn(async () => ({ ...user, status: 'SUSPENDED' })), update: vi.fn() } }, /ACTIVE staging user/],
    ['OTP missing', { otpChallenge: { findFirst: vi.fn(async () => null) }, user: { findUnique: vi.fn(async () => user), update: vi.fn() } }, /real LOGIN or REGISTER OTP/],
    ['OTP expired', { otpChallenge: { findFirst: vi.fn(async ({ where }: any) => expiredOtp >= where.consumedAt.gte ? { id: 'expired-consumed-otp' } : null) }, user: { findUnique: vi.fn(async () => user), update: vi.fn() } }, /real LOGIN or REGISTER OTP/],
  ] as const)('does not write when %s', async (_label, overrides, expected) => {
    const { tx, calls } = txFixture(overrides);
    await expect(bootstrapSingleStagingSuperAdmin(tx, { userId, passwordHash: 'hash', operator: 'staging-operator@example.test' })).rejects.toThrow(expected);
    expect(calls.adminCreate).not.toHaveBeenCalled();
    expect(calls.userUpdate).not.toHaveBeenCalled();
    expect(calls.sessions).not.toHaveBeenCalled();
    expect(calls.audit).not.toHaveBeenCalled();
  });

  it('refuses an account that already has an Admin role', async () => {
    const { tx, calls } = txFixture({ user: { findUnique: vi.fn(async () => ({ ...user, adminRole: { id: 'existing-role' } })), update: callsUserUpdate() } });
    await expect(bootstrapSingleStagingSuperAdmin(tx, { userId, passwordHash: 'hash', operator: 'staging-operator@example.test' })).rejects.toThrow(/already has an Admin role/);
    expect(calls.adminCreate).not.toHaveBeenCalled();
  });

  it('serializes concurrent initial bootstraps so only one Admin is created', async () => {
    let adminCount = 0;
    let creationCount = 0;
    let lockTail = Promise.resolve();
    const audit = vi.fn(async () => ({}));

    const runAttempt = async () => {
      let releaseLock: (() => void) | undefined;
      const tx = {
        $executeRaw: vi.fn(async () => {
          const previous = lockTail;
          let release!: () => void;
          lockTail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          releaseLock = release;
          return 1;
        }),
        $queryRaw: vi.fn(async () => []),
        user: { findUnique: vi.fn(async () => user), update: vi.fn(async () => ({})) },
        adminUser: {
          count: vi.fn(async () => adminCount),
          create: vi.fn(async () => { adminCount += 1; creationCount += 1; return {}; }),
        },
        otpChallenge: { findFirst: vi.fn(async () => ({ id: 'recent-consumed-otp' })) },
        session: { updateMany: vi.fn(async () => ({ count: 0 })) },
        auditLog: { create: audit },
      } as unknown as Parameters<typeof bootstrapSingleStagingSuperAdmin>[0];

      try {
        await bootstrapSingleStagingSuperAdmin(tx, { userId, passwordHash: 'scrypt-hash', operator: 'staging-operator@example.test' });
        return 'created';
      } finally {
        releaseLock?.();
      }
    };

    const results = await Promise.allSettled([runAttempt(), runAttempt()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(creationCount).toBe(1);
    expect(adminCount).toBe(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });
});

function callsUserUpdate() { return vi.fn(async () => ({})); }
