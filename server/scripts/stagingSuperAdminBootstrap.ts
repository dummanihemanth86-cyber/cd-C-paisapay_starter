import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { STAGING_DATABASE_HOST, STAGING_DATABASE_NAME } from './stagingSuperAdminProvision.js';

export const STAGING_SUPER_ADMIN_BOOTSTRAP_CONFIRMATION = 'BOOTSTRAP ONE STAGING SUPER_ADMIN';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINANCIAL_FLAGS = [
  'ADMIN_WALLET_CREDITS_ENABLED', 'ADMIN_WALLET_FUNDING_ENABLED', 'WALLET_ADJUSTMENTS_ENABLED',
  'WELCOME_BONUS_ENABLED', 'UPI_DEPOSIT_REWARD_ENABLED', 'ADMIN_WALLET_PRODUCTION_APPROVED',
  'ADMIN_WALLET_EXTERNAL_RECONCILIATION_VERIFIED',
] as const;

class StagingSuperAdminBootstrapError extends Error {}

export function validateSingleStagingSuperAdminEnvironment(values: Record<string, string | undefined>) {
  if (values.PAISAPAY_ENVIRONMENT !== 'staging') throw new StagingSuperAdminBootstrapError('Set PAISAPAY_ENVIRONMENT=staging explicitly.');
  if (values.NODE_ENV !== 'production') throw new StagingSuperAdminBootstrapError('Set NODE_ENV=production for the staging runtime configuration.');
  if (values.PAYMENT_PROVIDER !== 'disabled') throw new StagingSuperAdminBootstrapError('PAYMENT_PROVIDER must be disabled.');
  if (values.FINANCIAL_OPERATIONS_ENABLED !== 'false') throw new StagingSuperAdminBootstrapError('FINANCIAL_OPERATIONS_ENABLED must be explicitly false during initial Admin bootstrap.');
  const operator = values.PAISAPAY_STAGING_PROVISIONED_BY?.trim();
  if (!operator || !/^[A-Za-z0-9._@-]{3,80}$/.test(operator)) throw new StagingSuperAdminBootstrapError('Set PAISAPAY_STAGING_PROVISIONED_BY to the approved operator identifier.');
  for (const flag of FINANCIAL_FLAGS) {
    if (values[flag] === 'true') throw new StagingSuperAdminBootstrapError(`${flag} must remain false during initial Admin bootstrap.`);
    if (values[flag] !== undefined && values[flag] !== 'false') throw new StagingSuperAdminBootstrapError(`${flag} must be false when configured.`);
  }
  if (values.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new StagingSuperAdminBootstrapError('TLS certificate verification cannot be disabled.');
  if (values.PGSSLMODE?.toLowerCase() === 'disable') throw new StagingSuperAdminBootstrapError('PostgreSQL TLS cannot be disabled.');

  const connectionString = values.PAISAPAY_STAGING_ADMIN_DATABASE_URL;
  if (!connectionString) throw new StagingSuperAdminBootstrapError('Set PAISAPAY_STAGING_ADMIN_DATABASE_URL from the isolated Render staging database.');
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new StagingSuperAdminBootstrapError('The staging database URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname.toLowerCase() !== STAGING_DATABASE_HOST) {
    throw new StagingSuperAdminBootstrapError('The database URL host does not match the isolated PaisaPay Render staging database.');
  }
  if (decodeURIComponent(url.pathname.slice(1)) !== STAGING_DATABASE_NAME) throw new StagingSuperAdminBootstrapError('The database URL must target paisapay_staging.');
  const sslModes = url.searchParams.getAll('sslmode');
  if (sslModes.length !== 1 || sslModes[0] !== 'verify-full') throw new StagingSuperAdminBootstrapError('The staging database URL must contain exactly one sslmode=verify-full parameter.');
  if (!url.username || !url.password) throw new StagingSuperAdminBootstrapError('The staging database URL must include its staging database credentials.');
  return { hostname: url.hostname, database: STAGING_DATABASE_NAME, operator };
}

export function validateSingleStagingSuperAdminUserId(userId: string) {
  if (!UUID.test(userId)) throw new StagingSuperAdminBootstrapError('Provide one existing staging user UUID.');
}

export function validateSingleStagingSuperAdminPassword(password: string) {
  if (password.length < 12 || password.length > 128) throw new StagingSuperAdminBootstrapError('The Admin password must be 12–128 characters.');
}

export async function bootstrapSingleStagingSuperAdmin(
  tx: Prisma.TransactionClient,
  input: { userId: string; passwordHash: string; operator: string },
) {
  // Share the lock with the existing two-account bootstrap so either path wins
  // once and the other observes an existing Admin and aborts.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('paisapay-staging-super-admin-provision-v1'))`;
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId}::uuid FOR UPDATE`;
  const [user, adminCount] = await Promise.all([
    tx.user.findUnique({ where: { id: input.userId }, select: { id: true, publicId: true, phoneE164: true, status: true, adminRole: { select: { id: true } } } }),
    tx.adminUser.count(),
  ]);
  if (adminCount !== 0) throw new StagingSuperAdminBootstrapError('Staging already has an Admin; first-time bootstrap is permanently disabled.');
  if (!user || user.status !== 'ACTIVE') throw new StagingSuperAdminBootstrapError('The target must be an existing ACTIVE staging user.');
  if (user.adminRole) throw new StagingSuperAdminBootstrapError('The target already has an Admin role; no role will be changed.');
  const recentVerifiedLogin = await tx.otpChallenge.findFirst({
    where: { phoneE164: user.phoneE164, purpose: { in: ['LOGIN', 'REGISTER'] }, consumedAt: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
    select: { id: true },
  });
  if (!recentVerifiedLogin) throw new StagingSuperAdminBootstrapError('The target needs a real LOGIN or REGISTER OTP consumed within the last 15 minutes.');

  await tx.user.update({ where: { id: user.id }, data: { passwordHash: input.passwordHash, loginFailedAttempts: 0, loginLockedUntil: null } });
  await tx.adminUser.create({ data: { userId: user.id, role: 'SUPER_ADMIN' } });
  const revoked = await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await tx.auditLog.create({ data: {
    actorId: null,
    action: 'STAGING_SUPER_ADMIN_BOOTSTRAPPED',
    target: `STAGING_ADMIN_USER:${user.id}`,
    reason: 'First staging SUPER_ADMIN assigned to an existing active user with recent real OTP proof.',
    metadata: { role: 'SUPER_ADMIN', method: 'STAGING_ONLY_LOCAL_OPERATOR', operator: input.operator, revokedSessionCount: revoked.count },
  } });
  return { userId: user.id, publicId: user.publicId, phoneE164: user.phoneE164, revokedSessions: revoked.count };
}

function readVisible(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function readHidden(prompt: string): Promise<string> {
  const input = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new StagingSuperAdminBootstrapError('Run in an interactive terminal so the password is entered without echo.');
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let answer = '';
    const finish = (error?: Error) => {
      input.off('data', onData); input.setRawMode?.(false); input.pause(); process.stdout.write('\r\n');
      if (error) reject(error); else resolve(answer);
    };
    const onData = (buffer: Buffer) => {
      for (const char of buffer.toString('utf8')) {
        if (char === '\u0003') return finish(new StagingSuperAdminBootstrapError('Cancelled; no changes were made.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') answer = answer.slice(0, -1);
        else if (char >= ' ' && char !== '\u007f') answer += char;
      }
    };
    input.setRawMode!(true); input.resume(); input.on('data', onData);
  });
}

async function main() {
  const target = validateSingleStagingSuperAdminEnvironment(process.env);
  const [userId] = process.argv.slice(2);
  if (!userId) throw new StagingSuperAdminBootstrapError('Usage: npm run admin:bootstrap:staging:single -- <EXISTING_ACTIVE_STAGING_USER_UUID>');
  validateSingleStagingSuperAdminUserId(userId);
  console.log(`Staging-only target: ${target.hostname}/${target.database}; requested user ${userId}.`);
  console.log('This first-time operation grants one SUPER_ADMIN role. It does not create a user or touch financial records.');
  const expected = `${STAGING_SUPER_ADMIN_BOOTSTRAP_CONFIRMATION} ${userId}`;
  if (await readVisible(`Type exactly "${expected}" to continue: `) !== expected) throw new StagingSuperAdminBootstrapError('Confirmation did not match; no changes were made.');
  let password = '';
  let confirmation = '';
  try {
    password = await readHidden('Enter the new staging Admin password (hidden): ');
    confirmation = await readHidden('Confirm the password (hidden): ');
    if (password !== confirmation) throw new StagingSuperAdminBootstrapError('Password confirmation failed; no changes were made.');
    validateSingleStagingSuperAdminPassword(password);
    const passwordHash = await hashPassword(password);
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.PAISAPAY_STAGING_ADMIN_DATABASE_URL!, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000, max: 2 }) });
    try {
      await prisma.$connect();
      const result = await prisma.$transaction(
        (tx) => bootstrapSingleStagingSuperAdmin(tx, { userId, passwordHash, operator: target.operator }),
        { isolationLevel: 'Serializable', maxWait: 15_000, timeout: 30_000 },
      );
      const stored = await prisma.user.findUnique({ where: { id: result.userId }, select: { status: true, passwordHash: true, adminRole: { select: { role: true } } } });
      const verified = stored?.status === 'ACTIVE' && stored.adminRole?.role === 'SUPER_ADMIN' && Boolean(stored.passwordHash && await verifyPassword(password, stored.passwordHash));
      if (!verified) throw new StagingSuperAdminBootstrapError('Bootstrap committed, but verification failed. Do not rerun; inspect staging Admin and audit state.');
      const maskedPhone = `${result.phoneE164.slice(0, -4).replace(/\d/g, '*')}${result.phoneE164.slice(-4)}`;
      console.log(`Single staging SUPER_ADMIN verified: ${result.publicId ?? result.userId} (${maskedPhone}); revoked sessions: ${result.revokedSessions}.`);
      console.log('Password, OTP, database URL, and session tokens were not logged. Financial operations remain disabled.');
    } finally { await prisma.$disconnect(); }
  } finally { password = ''; confirmation = ''; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof StagingSuperAdminBootstrapError ? error.message : 'A database or runtime error stopped staging bootstrap. No sensitive details were printed; inspect staging state before retrying.';
    console.error(`Single staging SUPER_ADMIN bootstrap stopped: ${message}`);
    process.exitCode = 1;
  });
}
