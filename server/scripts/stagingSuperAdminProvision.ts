import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

export const STAGING_DATABASE_HOST = 'dpg-dbnnr3jl550s73fnn4f0-a.oregon-postgres.render.com';
export const STAGING_DATABASE_NAME = 'paisapay_staging';
export const STAGING_ADMIN_PROVISIONING_CONFIRMATION = 'PROVISION STAGING SUPER_ADMINS';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINANCIAL_FLAGS = [
  'FINANCIAL_OPERATIONS_ENABLED',
  'ADMIN_WALLET_CREDITS_ENABLED',
  'ADMIN_WALLET_FUNDING_ENABLED',
  'WALLET_ADJUSTMENTS_ENABLED',
  'WELCOME_BONUS_ENABLED',
  'UPI_DEPOSIT_REWARD_ENABLED',
  'ADMIN_WALLET_PRODUCTION_APPROVED',
  'ADMIN_WALLET_EXTERNAL_RECONCILIATION_VERIFIED',
] as const;

class StagingProvisioningError extends Error {}

type ProvisioningEnvironment = Record<string, string | undefined>;
type ExistingAccount = {
  id: string;
  publicId: string | null;
  phoneE164: string;
  displayName: string | null;
  status: string;
  passwordHash: string | null;
  adminRole: { id: string; role: string } | null;
};

export function validateStagingProvisioningEnvironment(values: ProvisioningEnvironment) {
  if (values.PAISAPAY_ENVIRONMENT !== 'staging') throw new StagingProvisioningError('Set PAISAPAY_ENVIRONMENT=staging explicitly before provisioning.');
  if (values.NODE_ENV !== 'production') throw new StagingProvisioningError('Set NODE_ENV=production to use the staging service runtime configuration.');
  if (values.PAYMENT_PROVIDER !== 'disabled') throw new StagingProvisioningError('PAYMENT_PROVIDER must be explicitly set to disabled.');
  if (values.FINANCIAL_OPERATIONS_ENABLED !== 'false') throw new StagingProvisioningError('FINANCIAL_OPERATIONS_ENABLED must be explicitly set to false.');
  const operator = values.PAISAPAY_STAGING_PROVISIONED_BY?.trim();
  if (!operator || !/^[A-Za-z0-9._@-]{3,80}$/.test(operator)) throw new StagingProvisioningError('Set PAISAPAY_STAGING_PROVISIONED_BY to the approved operator email or identifier.');
  for (const flag of FINANCIAL_FLAGS) {
    if (values[flag] === 'true') throw new StagingProvisioningError(`${flag} must remain disabled during staging Admin provisioning.`);
    if (values[flag] !== undefined && values[flag] !== 'false') throw new StagingProvisioningError(`${flag} must be false when configured.`);
  }
  if (values.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new StagingProvisioningError('TLS certificate verification cannot be disabled.');
  if (values.PGSSLMODE?.toLowerCase() === 'disable') throw new StagingProvisioningError('PostgreSQL TLS cannot be disabled.');

  const connectionString = values.PAISAPAY_STAGING_ADMIN_DATABASE_URL;
  if (!connectionString) throw new StagingProvisioningError('Set PAISAPAY_STAGING_ADMIN_DATABASE_URL from the isolated Render staging database.');
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new StagingProvisioningError('The staging database URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname.toLowerCase() !== STAGING_DATABASE_HOST) {
    throw new StagingProvisioningError('The database URL host does not match the isolated PaisaPay Render staging database.');
  }
  if (url.hostname.endsWith('.neon.tech')) throw new StagingProvisioningError('Neon database connections are forbidden for this staging-only tool.');
  if (decodeURIComponent(url.pathname.slice(1)) !== STAGING_DATABASE_NAME) {
    throw new StagingProvisioningError('The database URL must target the paisapay_staging database.');
  }
  const sslModes = url.searchParams.getAll('sslmode');
  if (sslModes.length !== 1 || sslModes[0] !== 'verify-full') {
    throw new StagingProvisioningError('The staging database URL must contain exactly one sslmode=verify-full parameter.');
  }
  if (!url.username || !url.password) throw new StagingProvisioningError('The staging database URL must include its staging database credentials.');

  return { hostname: url.hostname, database: STAGING_DATABASE_NAME };
}

export function validateStagingProvisioningUserIds(userIds: string[]) {
  if (userIds.length !== 2 || userIds.some((id) => !UUID.test(id)) || new Set(userIds).size !== 2) {
    throw new StagingProvisioningError('Provide two different existing staging user UUIDs.');
  }
}

export function validateStagingProvisioningPasswords(passwords: string[]) {
  if (passwords.length !== 2 || passwords.some((password) => password.length < 12 || password.length > 128)) {
    throw new StagingProvisioningError('Each Admin password must be 12–128 characters.');
  }
  if (passwords[0] === passwords[1]) throw new StagingProvisioningError('The two SUPER_ADMIN accounts must use different passwords.');
}

export function stagingProvisioningPreflightFailure(input: {
  requestedUserIds: string[];
  users: ExistingAccount[];
  usersWithVerifiedOtp: Set<string>;
  adminCount: number;
}): string | null {
  if (input.requestedUserIds.length !== 2 || new Set(input.requestedUserIds).size !== 2) return 'Two different staging user accounts are required.';
  if (input.adminCount !== 0) return 'Staging already contains an Admin account; first staging provisioning is permanently disabled.';
  if (input.users.length !== 2 || input.users.some((user) => !input.requestedUserIds.includes(user.id))) return 'Both target staging user accounts must exist.';
  if (input.users.some((user) => user.status !== 'ACTIVE')) return 'Both target staging user accounts must already be active.';
  if (input.users.some((user) => !input.usersWithVerifiedOtp.has(user.id))) return 'Both target accounts need a recently consumed login or registration OTP.';
  if (input.users.some((user) => user.adminRole !== null)) return 'A target account already has an Admin role; no role will be changed.';
  if (new Set(input.users.map((user) => user.phoneE164)).size !== 2) return 'The two target accounts must have different phone numbers.';
  return null;
}

export async function provisionStagingSuperAdmins(
  tx: Prisma.TransactionClient,
  input: { userIds: [string, string]; passwordHashes: [string, string]; operator: string },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('paisapay-staging-super-admin-provision-v1'))`;
  await tx.$queryRaw`SELECT id FROM users WHERE id IN (${input.userIds[0]}::uuid, ${input.userIds[1]}::uuid) ORDER BY id FOR UPDATE`;

  const users = await tx.user.findMany({
    where: { id: { in: input.userIds } },
    select: { id: true, publicId: true, phoneE164: true, displayName: true, status: true, passwordHash: true, adminRole: { select: { id: true, role: true } } },
  }) as ExistingAccount[];
  const adminCount = await tx.adminUser.count();
  const usersWithVerifiedOtp = new Set<string>();
  for (const user of users) {
    const evidence = await tx.otpChallenge.findFirst({
      where: { phoneE164: user.phoneE164, purpose: { in: ['LOGIN', 'REGISTER'] }, consumedAt: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
      select: { id: true },
    });
    if (evidence) usersWithVerifiedOtp.add(user.id);
  }
  const failure = stagingProvisioningPreflightFailure({ requestedUserIds: input.userIds, users, usersWithVerifiedOtp, adminCount });
  if (failure) throw new StagingProvisioningError(failure);

  const operationId = randomUUID();
  const provisioned = [] as Array<{ userId: string; publicId: string | null; maskedPhone: string; revokedSessions: number }>;
  for (const [index, userId] of input.userIds.entries()) {
    const user = users.find((candidate) => candidate.id === userId)!;
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: input.passwordHashes[index], loginFailedAttempts: 0, loginLockedUntil: null },
    });
    await tx.adminUser.create({ data: { userId, role: 'SUPER_ADMIN' } });
    const revoked = await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: 'STAGING_SUPER_ADMIN_PROVISIONED',
        target: `STAGING_ADMIN_USER:${userId}`,
        reason: 'Existing OTP-verified staging user provisioned for isolated maker-checker testing.',
        metadata: { operationId, role: 'SUPER_ADMIN', method: 'STAGING_ONLY_LOCAL_OPERATOR', operator: input.operator, revokedSessionCount: revoked.count },
      },
    });
    provisioned.push({
      userId,
      publicId: user.publicId,
      maskedPhone: `${user.phoneE164.slice(0, -4).replace(/\d/g, '*')}${user.phoneE164.slice(-4)}`,
      revokedSessions: revoked.count,
    });
  }
  return { operationId, provisioned };
}

function readVisible(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function readHidden(prompt: string): Promise<string> {
  const input = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new StagingProvisioningError('Run this utility in an interactive terminal so passwords are entered without echo.');
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let answer = '';
    const finish = (error?: Error) => {
      input.off('data', onData);
      input.setRawMode?.(false);
      input.pause();
      process.stdout.write('\r\n');
      if (error) reject(error); else resolve(answer);
    };
    const onData = (buffer: Buffer) => {
      for (const char of buffer.toString('utf8')) {
        if (char === '\u0003') return finish(new StagingProvisioningError('Cancelled; no changes were made.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') answer = answer.slice(0, -1);
        else if (char >= ' ' && char !== '\u007f') answer += char;
      }
    };
    input.setRawMode!(true);
    input.resume();
    input.on('data', onData);
  });
}

async function main() {
  const target = validateStagingProvisioningEnvironment(process.env);
  const userIds = process.argv.slice(2);
  if (userIds.length !== 2) throw new StagingProvisioningError('Usage: npm exec -- tsx scripts/stagingSuperAdminProvision.ts <EXISTING_STAGING_USER_UUID_1> <EXISTING_STAGING_USER_UUID_2>');
  validateStagingProvisioningUserIds(userIds);

  console.log(`Staging-only target: ${target.hostname}/${target.database}`);
  console.log('This tool only promotes two existing active OTP-verified users. It never creates users or changes wallet/financial records.');
  const expected = `${STAGING_ADMIN_PROVISIONING_CONFIRMATION} ${userIds[0]} ${userIds[1]}`;
  if (await readVisible(`Type exactly "${expected}" to continue: `) !== expected) throw new StagingProvisioningError('Confirmation did not match; no changes were made.');

  const passwords = ['', ''];
  const passwordConfirmations = ['', ''];
  try {
    passwords[0] = await readHidden('Enter the first staging Admin password (hidden): ');
    passwordConfirmations[0] = await readHidden('Confirm the first staging Admin password (hidden): ');
    passwords[1] = await readHidden('Enter the second staging Admin password (hidden): ');
    passwordConfirmations[1] = await readHidden('Confirm the second staging Admin password (hidden): ');
    if (passwords[0] !== passwordConfirmations[0] || passwords[1] !== passwordConfirmations[1]) throw new StagingProvisioningError('Password confirmation failed; no changes were made.');
    validateStagingProvisioningPasswords(passwords);
    const passwordHashes = await Promise.all(passwords.map((password) => hashPassword(password))) as [string, string];

    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.PAISAPAY_STAGING_ADMIN_DATABASE_URL!, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000, max: 2 }) });
    try {
      await prisma.$connect();
      const result = await prisma.$transaction(
        (tx) => provisionStagingSuperAdmins(tx, { userIds: userIds as [string, string], passwordHashes, operator: process.env.PAISAPAY_STAGING_PROVISIONED_BY! }),
        { isolationLevel: 'Serializable', maxWait: 15_000, timeout: 30_000 },
      );
      const verified = await Promise.all(result.provisioned.map(async (account, index) => {
        const stored = await prisma.user.findUnique({ where: { id: account.userId }, select: { passwordHash: true, status: true, adminRole: { select: { role: true } } } });
        return stored?.status === 'ACTIVE' && stored.adminRole?.role === 'SUPER_ADMIN' && Boolean(stored.passwordHash && await verifyPassword(passwords[index]!, stored.passwordHash));
      }));
      if (verified.some((ok) => !ok)) throw new StagingProvisioningError('Provisioning committed, but post-write staging verification failed. Do not rerun; inspect staging Admin roles and audit logs.');
      console.log(`Staging provisioning verified for ${result.provisioned.length} accounts; operation ${result.operationId}.`);
      for (const account of result.provisioned) console.log(`SUPER_ADMIN ${account.publicId ?? account.userId} (${account.maskedPhone}); revoked sessions: ${account.revokedSessions}.`);
      console.log('Passwords, OTPs, database credentials, and session tokens were not logged. Financial operations remain disabled.');
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    passwords.fill('');
    passwordConfirmations.fill('');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof StagingProvisioningError
      ? error.message
      : 'A database or runtime error stopped staging Admin provisioning. No sensitive error details were printed; inspect staging state before retrying.';
    console.error(`Staging SUPER_ADMIN provisioning stopped: ${message}`);
    process.exitCode = 1;
  });
}
