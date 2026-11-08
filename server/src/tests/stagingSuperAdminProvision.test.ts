import { describe, expect, it, vi } from 'vitest';
import {
  provisionStagingSuperAdmins,
  STAGING_DATABASE_HOST,
  STAGING_DATABASE_NAME,
  stagingProvisioningPreflightFailure,
  validateStagingProvisioningEnvironment,
  validateStagingProvisioningPasswords,
  validateStagingProvisioningUserIds,
} from '../../scripts/stagingSuperAdminProvision.js';

const userIds = [
  '00000000-0000-4000-8000-000000000111',
  '00000000-0000-4000-8000-000000000222',
];
const activeUsers = userIds.map((id, index) => ({
  id,
  publicId: `STAGE${index + 1}`,
  phoneE164: `+91987654321${index}`,
  displayName: `Staging Admin ${index + 1}`,
  status: 'ACTIVE',
  passwordHash: null,
  adminRole: null,
}));

function stagingEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    PAISAPAY_ENVIRONMENT: 'staging',
    NODE_ENV: 'production',
    PAYMENT_PROVIDER: 'disabled',
    FINANCIAL_OPERATIONS_ENABLED: 'false',
    PAISAPAY_STAGING_PROVISIONED_BY: 'staging-operator@example.test',
    PAISAPAY_STAGING_ADMIN_DATABASE_URL: `postgresql://stage_user:stage_password@${STAGING_DATABASE_HOST}/${STAGING_DATABASE_NAME}?sslmode=verify-full`,
    ...overrides,
  };
}

function txFixture(overrides: Record<string, any> = {}) {
  const calls = {
    userUpdate: vi.fn(async () => ({})),
    adminCreate: vi.fn(async () => ({})),
    sessionUpdate: vi.fn(async () => ({ count: 3 })),
    auditCreate: vi.fn(async () => ({})),
  };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    user: { findMany: vi.fn(async () => activeUsers), update: calls.userUpdate },
    adminUser: { count: vi.fn(async () => 0), create: calls.adminCreate },
    otpChallenge: { findFirst: vi.fn(async () => ({ id: 'verified-otp' })) },
    session: { updateMany: calls.sessionUpdate },
    auditLog: { create: calls.auditCreate },
    ...overrides,
  } as unknown as Parameters<typeof provisionStagingSuperAdmins>[0];
  return { tx, calls };
}

describe('staging-only SUPER_ADMIN provisioning safeguards', () => {
  it('accepts only the explicitly identified Render staging database with strict TLS and financial gates off', () => {
    expect(validateStagingProvisioningEnvironment(stagingEnv())).toEqual({ hostname: STAGING_DATABASE_HOST, database: STAGING_DATABASE_NAME });
  });

  it.each([
    [{ PAISAPAY_ENVIRONMENT: 'production' }, /PAISAPAY_ENVIRONMENT=staging/],
    [{ NODE_ENV: 'development' }, /NODE_ENV=production/],
    [{ PAYMENT_PROVIDER: 'cashfree' }, /PAYMENT_PROVIDER.*disabled/],
    [{ FINANCIAL_OPERATIONS_ENABLED: 'true' }, /FINANCIAL_OPERATIONS_ENABLED.*false/],
    [{ ADMIN_WALLET_CREDITS_ENABLED: 'true' }, /ADMIN_WALLET_CREDITS_ENABLED/],
    [{ ADMIN_WALLET_PRODUCTION_APPROVED: 'true' }, /ADMIN_WALLET_PRODUCTION_APPROVED/],
    [{ PAISAPAY_STAGING_PROVISIONED_BY: '' }, /PAISAPAY_STAGING_PROVISIONED_BY/],
    [{ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, /TLS certificate verification/],
    [{ PGSSLMODE: 'disable' }, /PostgreSQL TLS/],
    [{ PAISAPAY_STAGING_ADMIN_DATABASE_URL: 'postgresql://user:pass@ep-production.neon.tech/paisapay_staging?sslmode=verify-full' }, /host does not match/],
    [{ PAISAPAY_STAGING_ADMIN_DATABASE_URL: `postgresql://user:pass@${STAGING_DATABASE_HOST}/production?sslmode=verify-full` }, /paisapay_staging/],
    [{ PAISAPAY_STAGING_ADMIN_DATABASE_URL: `postgresql://user:pass@${STAGING_DATABASE_HOST}/${STAGING_DATABASE_NAME}?sslmode=disable` }, /sslmode=verify-full/],
    [{ PAISAPAY_STAGING_ADMIN_DATABASE_URL: `postgresql://user:pass@${STAGING_DATABASE_HOST}/${STAGING_DATABASE_NAME}?sslmode=verify-full&sslmode=require` }, /exactly one/],
  ] as const)('rejects unsafe environment configuration %j', (overrides, expected) => {
    expect(() => validateStagingProvisioningEnvironment(stagingEnv(overrides))).toThrow(expected);
  });

  it('requires two distinct account IDs and separate strong passwords', () => {
    expect(() => validateStagingProvisioningUserIds([userIds[0]!])).toThrow(/two different/);
    expect(() => validateStagingProvisioningUserIds([userIds[0]!, userIds[0]!])).toThrow(/two different/);
    expect(() => validateStagingProvisioningPasswords(['short', 'different-password-2'])).toThrow(/12–128/);
    expect(() => validateStagingProvisioningPasswords(['same-password-value', 'same-password-value'])).toThrow(/different passwords/);
    expect(() => validateStagingProvisioningPasswords(['staging-password-one', 'staging-password-two'])).not.toThrow();
  });

  it('refuses missing, inactive, unverified, existing-admin, or already-provisioned accounts', () => {
    const base = { requestedUserIds: userIds, users: activeUsers, usersWithVerifiedOtp: new Set(userIds), adminCount: 0 };
    expect(stagingProvisioningPreflightFailure(base)).toBeNull();
    expect(stagingProvisioningPreflightFailure({ ...base, adminCount: 1 })).toMatch(/already contains an Admin/);
    expect(stagingProvisioningPreflightFailure({ ...base, users: [activeUsers[0]!] })).toMatch(/Both target.*must exist/);
    expect(stagingProvisioningPreflightFailure({ ...base, users: [{ ...activeUsers[0]!, status: 'SUSPENDED' }, activeUsers[1]!] })).toMatch(/already be active/);
    expect(stagingProvisioningPreflightFailure({ ...base, usersWithVerifiedOtp: new Set([userIds[0]!]) })).toMatch(/consumed login or registration OTP/);
    expect(stagingProvisioningPreflightFailure({ ...base, users: [{ ...activeUsers[0]!, adminRole: { id: 'role', role: 'ADMIN' } }, activeUsers[1]!] })).toMatch(/already has an Admin role/);
  });

  it('promotes both verified accounts atomically with distinct role rows, session revocation, and audit records', async () => {
    const { tx, calls } = txFixture();
    const result = await provisionStagingSuperAdmins(tx, { userIds: userIds as [string, string], passwordHashes: ['hash-one', 'hash-two'], operator: 'staging-operator@example.test' });

    expect(result.provisioned).toHaveLength(2);
    expect(calls.userUpdate).toHaveBeenCalledTimes(2);
    expect(calls.adminCreate).toHaveBeenCalledTimes(2);
    expect(calls.adminCreate.mock.calls.map(([arg]) => arg.data)).toEqual(userIds.map((userId) => ({ userId, role: 'SUPER_ADMIN' })));
    expect(calls.sessionUpdate).toHaveBeenCalledTimes(2);
    expect(calls.auditCreate).toHaveBeenCalledTimes(2);
    expect(calls.auditCreate.mock.calls.every(([arg]) => arg.data.action === 'STAGING_SUPER_ADMIN_PROVISIONED')).toBe(true);
    expect(calls.auditCreate.mock.calls.every(([arg]) => arg.data.metadata.operator === 'staging-operator@example.test')).toBe(true);
    const otpQuery = (tx as any).otpChallenge.findFirst.mock.calls[0][0];
    expect(otpQuery.where.purpose.in).toEqual(['LOGIN', 'REGISTER']);
    expect(otpQuery.where.consumedAt.gte).toBeInstanceOf(Date);
  });

  it('does not write if an Admin already exists, preventing repeat privilege provisioning', async () => {
    const calls = txFixture();
    const tx = { ...calls.tx, adminUser: { count: vi.fn(async () => 1), create: calls.calls.adminCreate } } as unknown as Parameters<typeof provisionStagingSuperAdmins>[0];
    await expect(provisionStagingSuperAdmins(tx, { userIds: userIds as [string, string], passwordHashes: ['hash-one', 'hash-two'], operator: 'staging-operator@example.test' })).rejects.toThrow(/already contains an Admin/);
    expect(calls.calls.userUpdate).not.toHaveBeenCalled();
    expect(calls.calls.adminCreate).not.toHaveBeenCalled();
    expect(calls.calls.sessionUpdate).not.toHaveBeenCalled();
    expect(calls.calls.auditCreate).not.toHaveBeenCalled();
  });

  it('requires a recently consumed real OTP before writing either account', async () => {
    const fixture = txFixture({ otpChallenge: { findFirst: vi.fn(async () => null) } });
    await expect(provisionStagingSuperAdmins(fixture.tx, { userIds: userIds as [string, string], passwordHashes: ['hash-one', 'hash-two'], operator: 'staging-operator@example.test' })).rejects.toThrow(/consumed login or registration OTP/);
    expect(fixture.calls.userUpdate).not.toHaveBeenCalled();
    expect(fixture.calls.adminCreate).not.toHaveBeenCalled();
    expect(fixture.calls.sessionUpdate).not.toHaveBeenCalled();
    expect(fixture.calls.auditCreate).not.toHaveBeenCalled();
  });
});
