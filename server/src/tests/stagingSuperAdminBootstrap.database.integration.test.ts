import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { bootstrapSingleStagingSuperAdmin } from '../../scripts/stagingSuperAdminBootstrap.js';

const DATABASE_PREFIX = 'paisapay_bootstrap_it_';
const OLD_HASH = 'synthetic-original-password-hash';
const NEW_HASH_A = 'synthetic-bootstrap-hash-a';
const NEW_HASH_B = 'synthetic-bootstrap-hash-b';
const OPERATOR_LABEL = 'local-bootstrap-integration-test';
const AUDIT_ACTION = 'STAGING_SUPER_ADMIN_BOOTSTRAPPED';

let prisma: PrismaClient | undefined;

function requireLocalTestTarget() {
  const connectionString = process.env.DATABASE_URL;
  const expectedDatabase = process.env.PAISAPAY_TEST_DATABASE_NAME;
  const expectedPort = Number(process.env.PAISAPAY_TEST_DATABASE_PORT);
  if (!connectionString || !expectedDatabase?.startsWith(DATABASE_PREFIX) || !Number.isInteger(expectedPort)) {
    throw new Error('Refusing database integration tests without the dedicated local test target settings.');
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Refusing database integration tests: DATABASE_URL is invalid.');
  }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname.toLowerCase())
    || Number(url.port) !== expectedPort
    || decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase) {
    throw new Error('Refusing database integration tests: DATABASE_URL is not the expected local disposable database.');
  }

  const directUrl = process.env.DIRECT_DATABASE_URL;
  if (directUrl) {
    let direct: URL;
    try {
      direct = new URL(directUrl);
    } catch {
      throw new Error('Refusing database integration tests: DIRECT_DATABASE_URL is invalid.');
    }
    if (!['127.0.0.1', 'localhost'].includes(direct.hostname.toLowerCase())
      || Number(direct.port) !== expectedPort
      || decodeURIComponent(direct.pathname.slice(1)) !== expectedDatabase) {
      throw new Error('Refusing database integration tests: DIRECT_DATABASE_URL is not the expected local disposable database.');
    }
  }

  return { connectionString, expectedDatabase, expectedPort };
}

function syntheticPhone() {
  return `+1555${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

async function createSyntheticUser(options: { consumedAt?: Date; createOtp?: boolean } = {}) {
  if (!prisma) throw new Error('Local test database is not connected.');
  const phoneE164 = syntheticPhone();
  const user = await prisma.user.create({
    data: { phoneE164, passwordHash: OLD_HASH, status: 'ACTIVE' },
    select: { id: true, phoneE164: true, status: true },
  });
  if (options.createOtp !== false) {
    const now = new Date();
    await prisma.otpChallenge.create({
      data: {
        phoneE164,
        purpose: 'LOGIN',
        codeHash: `synthetic-otp-${randomUUID()}`,
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        resendAt: now,
        consumedAt: options.consumedAt ?? now,
      },
    });
  }
  const now = new Date();
  await prisma.session.create({
    data: {
      userId: user.id,
      accessTokenHash: `synthetic-access-${randomUUID()}`,
      refreshTokenHash: `synthetic-refresh-${randomUUID()}`,
      accessExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      refreshExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    },
  });
  return user;
}

async function runBootstrap(userId: string, passwordHash: string) {
  if (!prisma) throw new Error('Local test database is not connected.');
  return prisma.$transaction(
    (tx: Prisma.TransactionClient) => bootstrapSingleStagingSuperAdmin(tx, { userId, passwordHash, operator: OPERATOR_LABEL }),
    { isolationLevel: 'Serializable', maxWait: 15_000, timeout: 30_000 },
  );
}

describe('single staging SUPER_ADMIN bootstrap on disposable PostgreSQL', () => {
  beforeAll(async () => {
    const target = requireLocalTestTarget();
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: target.connectionString, max: 6 }),
    });
    await prisma.$connect();

    const identity = await prisma.$queryRaw<Array<{
      databaseName: string;
      serverAddress: string;
      serverPort: number;
    }>>`SELECT current_database() AS "databaseName",
             inet_server_addr()::text AS "serverAddress",
             inet_server_port() AS "serverPort"`;
    const actual = identity[0];
    if (!actual
      || actual.databaseName !== target.expectedDatabase
      || !['127.0.0.1', '127.0.0.1/32'].includes(actual.serverAddress)
      || actual.serverPort !== target.expectedPort) {
      await prisma.$disconnect();
      prisma = undefined;
      throw new Error('Refusing tests: PostgreSQL identity is not the verified local disposable target.');
    }

    if (await prisma.user.count() !== 0 || await prisma.adminUser.count() !== 0) {
      throw new Error('Refusing tests: the disposable database was not empty before synthetic data setup.');
    }
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it.each([
    ['missing', { createOtp: false }],
    ['expired', { consumedAt: new Date(Date.now() - 16 * 60 * 1000) }],
  ] as const)('rejects a %s consumed OTP without changing user, Admin, session, or audit state', async (_label, options) => {
    if (!prisma) throw new Error('Local test database is not connected.');
    const user = await createSyntheticUser(options);
    await expect(runBootstrap(user.id, NEW_HASH_A)).rejects.toThrow(/real LOGIN or REGISTER OTP/);

    const after = await prisma.user.findUnique({ where: { id: user.id }, include: { adminRole: true } });
    expect(after).toMatchObject({ id: user.id, status: 'ACTIVE', passwordHash: OLD_HASH, adminRole: null });
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: AUDIT_ACTION, target: `STAGING_ADMIN_USER:${user.id}` } })).toBe(0);
    expect(await prisma.adminUser.count()).toBe(0);
  });

  it('rolls back password, role, session, and audit writes if the audit insert fails', async () => {
    if (!prisma) throw new Error('Local test database is not connected.');
    const user = await createSyntheticUser();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION public.paisapay_test_reject_bootstrap_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = '${AUDIT_ACTION}' THEN
          RAISE EXCEPTION 'synthetic bootstrap audit failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER paisapay_test_reject_bootstrap_audit
      BEFORE INSERT ON public.audit_logs
      FOR EACH ROW EXECUTE FUNCTION public.paisapay_test_reject_bootstrap_audit()
    `);

    try {
      await expect(runBootstrap(user.id, NEW_HASH_A)).rejects.toThrow(/synthetic bootstrap audit failure/);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS paisapay_test_reject_bootstrap_audit ON public.audit_logs');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS public.paisapay_test_reject_bootstrap_audit()');
    }

    const after = await prisma.user.findUnique({ where: { id: user.id }, include: { adminRole: true } });
    expect(after).toMatchObject({ id: user.id, status: 'ACTIVE', passwordHash: OLD_HASH, adminRole: null });
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: AUDIT_ACTION, target: `STAGING_ADMIN_USER:${user.id}` } })).toBe(0);
    expect(await prisma.adminUser.count()).toBe(0);
  });

  it('serializes two simultaneous initial attempts and commits exactly one Admin, password, session revocation, and audit', async () => {
    if (!prisma) throw new Error('Local test database is not connected.');
    const user = await createSyntheticUser();
    const attempts = await Promise.allSettled([
      runBootstrap(user.id, NEW_HASH_A),
      runBootstrap(user.id, NEW_HASH_B),
    ]);
    const successes = attempts.filter((result) => result.status === 'fulfilled');
    const failures = attempts.filter((result) => result.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const winningHash = attempts[0].status === 'fulfilled' ? NEW_HASH_A : NEW_HASH_B;
    const after = await prisma.user.findUnique({ where: { id: user.id }, include: { adminRole: true } });
    expect(after).toMatchObject({ id: user.id, status: 'ACTIVE', passwordHash: winningHash, adminRole: { role: 'SUPER_ADMIN' } });
    expect(await prisma.adminUser.count({ where: { userId: user.id, role: 'SUPER_ADMIN' } })).toBe(1);
    expect(await prisma.adminUser.count()).toBe(1);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: { not: null } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: AUDIT_ACTION, target: `STAGING_ADMIN_USER:${user.id}` } })).toBe(1);
    const audit = await prisma.auditLog.findFirst({ where: { action: AUDIT_ACTION, target: `STAGING_ADMIN_USER:${user.id}` } });
    expect(audit).toMatchObject({ actorId: null, metadata: expect.objectContaining({ operator: OPERATOR_LABEL, role: 'SUPER_ADMIN' }) });
  });

  it('rejects a later bootstrap after the first Admin exists without changing the new target user', async () => {
    if (!prisma) throw new Error('Local test database is not connected.');
    const user = await createSyntheticUser();
    await expect(runBootstrap(user.id, NEW_HASH_A)).rejects.toThrow(/already has an Admin/);
    const after = await prisma.user.findUnique({ where: { id: user.id }, include: { adminRole: true } });
    expect(after).toMatchObject({ id: user.id, status: 'ACTIVE', passwordHash: OLD_HASH, adminRole: null });
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: AUDIT_ACTION, target: `STAGING_ADMIN_USER:${user.id}` } })).toBe(0);
    expect(await prisma.adminUser.count()).toBe(1);
  });
});
