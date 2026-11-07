import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { databaseRequired, prisma } from '../../lib/db.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { assertFinancialOperationsEnabled } from '../../middleware/financialOperations.js';
import { Prisma } from '../../generated/prisma/client.js';
import { getPaymentMethodAvailability } from '../payments/availability.js';
import { verifyPassword, hashPassword } from '../../lib/password.js';
import { hashOtp, hashToken, newOpaqueToken, safeHashEqual } from '../../lib/security.js';
import { env } from '../../config/env.js';
import { formatReportResult, hasMoney, reportQuerySchema, safeSettingsSnapshot, type ReportKind } from './reporting.js';
import { applyAdminWalletAdjustment, applySuperAdminWalletCredit, MAX_ADMIN_ADJUSTMENT_PAISE, MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE } from './walletAdjustment.js';
import { createOtpChallenge } from '../auth/routes.js';

export const adminRouter = Router();
export const adminAuthRouter = Router();
const adminLoginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'ADMIN_LOGIN_RATE_LIMITED', message: 'Too many admin sign-in attempts. Wait before trying again.' } } });
const adminPhoneLoginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: (req) => `phone:${hashToken(typeof req.body?.phoneE164 === 'string' ? req.body.phoneE164 : 'invalid')}`, message: { error: { code: 'ADMIN_LOGIN_RATE_LIMITED', message: 'Too many sign-in attempts for this account. Wait before trying again.' } } });
const adminPasswordResetIpLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'ADMIN_PASSWORD_RESET_RATE_LIMITED', message: 'Too many password-reset attempts. Wait before trying again.' } } });
const adminPasswordResetPhoneLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: (req) => `admin-reset:${hashToken(typeof req.body?.phoneE164 === 'string' ? req.body.phoneE164 : 'invalid')}`, message: { error: { code: 'ADMIN_PASSWORD_RESET_RATE_LIMITED', message: 'Too many password-reset attempts for this number. Try again later.' } } });
const adminPhone = z.string().regex(/^\+[1-9]\d{7,14}$/);
const dummyAdminPasswordHash = hashPassword('paisa-pay-invalid-admin-password-dummy');

adminAuthRouter.post('/forgot-password/request-otp', adminPasswordResetIpLimit, adminPasswordResetPhoneLimit, asyncRoute(async (req, res) => {
  const input = z.object({ phoneE164: adminPhone }).strict().parse(req.body);
  const db = databaseRequired();
  const admin = await db.user.findUnique({ where: { phoneE164: input.phoneE164 }, select: { status: true, adminRole: { select: { id: true } } } });
  const activeAdmin = admin?.status === 'ACTIVE' && Boolean(admin.adminRole);
  const challenge = activeAdmin
    ? await createOtpChallenge(input.phoneE164, 'ADMIN_PASSWORD_RESET')
    : { challengeId: randomUUID() };
  // A generic response avoids disclosing whether the phone belongs to an active admin.
  res.status(202).json({
    challengeId: challenge.challengeId,
    expiresInSeconds: 300,
    resendAfterSeconds: 60,
    message: 'If an active Admin account exists for this number, a password-reset code will be sent by SMS.',
  });
}));

adminAuthRouter.post('/password/reset', adminPasswordResetIpLimit, adminPasswordResetPhoneLimit, asyncRoute(async (req, res) => {
  const input = z.object({
    phoneE164: adminPhone,
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(12).max(128),
  }).strict().parse(req.body);
  const db = databaseRequired();
  const passwordHash = await hashPassword(input.newPassword);
  const reset = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM otp_challenges WHERE id = ${input.challengeId}::uuid FOR UPDATE`;
    const challenge = await tx.otpChallenge.findUnique({ where: { id: input.challengeId } });
    if (!challenge || challenge.purpose !== 'ADMIN_PASSWORD_RESET' || challenge.phoneE164 !== input.phoneE164 || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      throw new HttpError(401, 'ADMIN_PASSWORD_RESET_INVALID', 'The admin reset code is invalid or expired. Request a new code.');
    }
    const isTestDemo = env.isTest && env.otpProvider === 'demo' && challenge.deliveryStatus === 'DEMO';
    if (!isTestDemo && !['ACCEPTED', 'SENT', 'DELIVERED'].includes(challenge.deliveryStatus ?? '')) {
      throw new HttpError(401, 'ADMIN_PASSWORD_RESET_INVALID', 'The admin reset code is invalid or expired. Request a new code.');
    }
    if (challenge.attempts >= 5) throw new HttpError(429, 'ADMIN_PASSWORD_RESET_ATTEMPTS_EXCEEDED', 'Too many incorrect codes. Request a new code.');
    if (!safeHashEqual(challenge.codeHash, hashOtp(input.phoneE164, input.code))) {
      await tx.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      return false;
    }
    const admin = await tx.user.findUnique({ where: { phoneE164: input.phoneE164 }, select: { id: true, status: true, adminRole: { select: { id: true } } } });
    if (!admin || admin.status !== 'ACTIVE' || !admin.adminRole) {
      throw new HttpError(401, 'ADMIN_PASSWORD_RESET_INVALID', 'The admin reset code is invalid or expired. Request a new code.');
    }
    const now = new Date();
    await tx.user.update({ where: { id: admin.id }, data: { passwordHash, loginFailedAttempts: 0, loginLockedUntil: null } });
    await tx.otpChallenge.updateMany({ where: { phoneE164: input.phoneE164, purpose: 'ADMIN_PASSWORD_RESET', consumedAt: null }, data: { consumedAt: now } });
    await tx.session.updateMany({ where: { userId: admin.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.auditLog.create({ data: { actorId: admin.id, action: 'ADMIN_PASSWORD_RESET', target: `ADMIN_USER:${admin.id}`, reason: 'Admin password reset using a delivered one-time code.', metadata: { requestId: req.requestId || null } } });
    return true;
  }, { isolationLevel: 'ReadCommitted' });
  if (!reset) throw new HttpError(401, 'ADMIN_PASSWORD_RESET_INVALID', 'The admin reset code is incorrect.');
  res.json({ ok: true, message: 'Admin password reset. Sign in using your new password.' });
}));

// Separate admin sign-in: existing users only, and an AdminUser row is required
// before a session is created. This route intentionally does not create users,
// initialize wallets, or grant welcome bonuses.
adminAuthRouter.post('/login', adminLoginLimit, adminPhoneLoginLimit, asyncRoute(async (req, res) => {
  const input = z.object({ phoneE164: adminPhone, password: z.string().min(1).max(128) }).strict().parse(req.body);
  const db = databaseRequired();
  const fallbackHash = await dummyAdminPasswordHash;
  const now = new Date();
  const accessToken = newOpaqueToken(); const refreshToken = newOpaqueToken();
  const accessExpiresAt = new Date(now.getTime() + 15 * 60 * 1000); const refreshExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const result = await db.$transaction(async (tx) => {
    const found = await tx.user.findUnique({ where: { phoneE164: input.phoneE164 }, include: { adminRole: true } });
    if (!found) { await verifyPassword(input.password, fallbackHash); await tx.auditLog.create({ data: { action: 'ADMIN_LOGIN_FAILED', target: 'ADMIN_LOGIN:UNKNOWN', reason: 'Invalid administrator credentials.', metadata: { requestId: req.requestId || null } } }); return null; }
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${found.id}::uuid FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: found.id }, include: { adminRole: true } });
    const currentTime = new Date();
    if (!user.adminRole || user.status !== 'ACTIVE' || (user.loginLockedUntil && user.loginLockedUntil > currentTime)) {
      await verifyPassword(input.password, fallbackHash); await tx.auditLog.create({ data: { actorId: user.id, action: 'ADMIN_LOGIN_FAILED', target: `ADMIN_USER:${user.id}`, reason: 'Account is not permitted to sign in.', metadata: { requestId: req.requestId || null } } }); return null;
    }
    const matches = user.passwordHash ? await verifyPassword(input.password, user.passwordHash) : (await verifyPassword(input.password, fallbackHash), false);
    if (!matches) {
      const attempts = user.loginLockedUntil && user.loginLockedUntil <= currentTime ? 1 : user.loginFailedAttempts + 1;
      await tx.user.update({ where: { id: user.id }, data: { loginFailedAttempts: attempts, loginLockedUntil: attempts >= 5 ? new Date(currentTime.getTime() + 15 * 60 * 1000) : null } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'ADMIN_LOGIN_FAILED', target: `ADMIN_USER:${user.id}`, reason: attempts >= 5 ? 'Failed sign-in limit reached; account temporarily locked.' : 'Invalid administrator credentials.', metadata: { failedAttempts: attempts, requestId: req.requestId || null } } });
      return null;
    }
    await tx.user.update({ where: { id: user.id }, data: { loginFailedAttempts: 0, loginLockedUntil: null } });
    await tx.session.create({ data: { userId: user.id, accessTokenHash: hashToken(accessToken), refreshTokenHash: hashToken(refreshToken), accessExpiresAt, refreshExpiresAt, deviceLabel: 'PaisaPay Admin App' } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'ADMIN_LOGIN_SUCCEEDED', target: `ADMIN_USER:${user.id}`, metadata: { role: user.adminRole.role, requestId: req.requestId || null } } });
    return { user, role: user.adminRole.role };
  });
  if (!result) throw new HttpError(401, 'ADMIN_LOGIN_INVALID', 'The administrator number or password is incorrect.');
  res.json({ accessToken, refreshToken, accessExpiresInSeconds: 900, user: { publicId: result.user.publicId, displayName: result.user.displayName }, role: result.role });
}));

adminRouter.use(requireAuth, requireAdmin);
adminRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'ADMIN_RATE_LIMITED', message: 'Too many administrator requests. Wait and retry.' } } }));
const adminMutationLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'ADMIN_ACTION_RATE_LIMITED', message: 'Too many administrator actions. Wait and retry.' } } });

const pageInput = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), q: z.string().trim().max(120).optional(), status: z.string().trim().max(40).optional() });
const financeRoles = new Set(['FINANCE', 'ADMIN', 'SUPER_ADMIN']);
const operationsRoles = new Set(['OPERATIONS', 'ADMIN', 'SUPER_ADMIN']);
function requireRole(role: string | undefined, allowed: Set<string>) { if (!role || !allowed.has(role)) throw new HttpError(403, 'ADMIN_PERMISSION_DENIED', 'Your administrator role cannot perform this action.'); }
const phoneMasked = (phone: string) => `${phone.slice(0, Math.max(0, phone.length - 4)).replace(/\d/g, '*')}${phone.slice(-4)}`;

adminRouter.get('/reports', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['ADMIN', 'SUPER_ADMIN']));
  const input = reportQuerySchema.parse(req.query);
  if (hasMoney(input.report)) assertFinancialOperationsEnabled();
  const db = databaseRequired();
  const reportSources: Record<ReportKind, { table: string; amountColumn: string | null }> = {
    registrations: { table: 'users', amountColumn: null },
    deposits: { table: 'deposits', amountColumn: 'amount_paise' },
    withdrawals: { table: 'withdrawals', amountColumn: 'amount_paise' },
    'p2p-orders': { table: 'p2p_deposit_orders', amountColumn: 'amount_paise' },
    'support-tickets': { table: 'support_tickets', amountColumn: null },
  };
  const source = reportSources[input.report];
  const amountExpression = source.amountColumn ? Prisma.raw(`COALESCE(SUM(${source.amountColumn}), 0)::text`) : Prisma.raw('NULL::text');
  const from = new Date(`${input.from}T00:00:00.000Z`);
  const toExclusive = new Date(Date.parse(`${input.to}T00:00:00.000Z`) + 86_400_000);
  const rows = await db.$queryRaw<Array<{ day: string; status: string; recordCount: bigint; amountPaise: string | null }>>`
    SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
           status::text AS status,
           COUNT(*)::bigint AS "recordCount",
           ${amountExpression} AS "amountPaise"
      FROM ${Prisma.raw(source.table)}
     WHERE created_at >= ${from} AND created_at < ${toExclusive}
       AND (${input.status ?? null}::text IS NULL OR status::text = ${input.status ?? null})
     GROUP BY date_trunc('day', created_at AT TIME ZONE 'UTC'), status::text
     ORDER BY day ASC, status ASC
  `;
  res.json(formatReportResult(input, rows));
}));

adminRouter.get('/settings', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['ADMIN', 'SUPER_ADMIN']));
  res.json(safeSettingsSnapshot({
    nodeEnv: env.nodeEnv,
    financialOperationsEnabled: env.financialOperationsEnabled,
    paymentProvider: env.paymentProvider,
    otpProvider: env.otpProvider,
    databaseConfigured: Boolean(env.databaseUrl),
  }));
}));

adminRouter.get('/me', asyncRoute(async (req, res) => {
  const role = req.auth!.role || 'SUPPORT';
  const common = ['overview', 'health'];
  const roleViews: Record<string, string[]> = {
    SUPPORT: [...common, 'support'],
    OPERATIONS: [...common, 'users', 'deposits', 'withdrawals', 'p2p', 'providers', 'referrals', 'support', 'audit'],
    FINANCE: [...common, 'users', 'deposits', 'withdrawals', 'p2p', 'alerts', 'transactions', 'ledger', 'commissions', 'rewardRules', 'disputes', 'reconciliation'],
    ADMIN: ['overview', 'users', 'deposits', 'withdrawals', 'p2p', 'alerts', 'transactions', 'ledger', 'providers', 'commissions', 'referrals', 'rewardRules', 'disputes', 'support', 'reconciliation', 'audit', 'health', 'reports', 'notifications', 'settings'],
    SUPER_ADMIN: ['overview', 'users', 'deposits', 'withdrawals', 'p2p', 'alerts', 'transactions', 'ledger', 'providers', 'commissions', 'referrals', 'rewardRules', 'disputes', 'support', 'reconciliation', 'admins', 'audit', 'health', 'reports', 'notifications', 'settings'],
  };
  const walletAdjustmentAllowed = role === 'ADMIN' && env.walletAdjustmentAdminUserId === req.auth!.userId;
  const walletCreditsAllowed = role === 'SUPER_ADMIN';
  const allowedSections = [...(roleViews[role] || common)];
  if (walletAdjustmentAllowed && !allowedSections.includes('walletAdjustments')) allowedSections.push('walletAdjustments');
  if (walletCreditsAllowed && !allowedSections.includes('walletCredits')) allowedSections.push('walletCredits');
  res.json({
    userId: req.auth!.userId,
    role,
    allowedSections,
    // Read-only capability metadata for Admin UI explanations. Mutation
    // authorization continues to run through financialOperationsGate.
    financialOperationsEnabled: env.financialOperationsEnabled,
    walletAdjustmentAllowed,
    walletAdjustmentsEnabled: walletAdjustmentAllowed && env.walletAdjustmentsEnabled && env.financialOperationsEnabled,
    walletCreditsAllowed,
    walletCreditsEnabled: walletCreditsAllowed && env.walletAdjustmentsEnabled && env.financialOperationsEnabled,
  });
}));

adminRouter.post('/push-devices', asyncRoute(async (req, res) => {
  const input = z.object({ expoPushToken: z.string().trim().min(20).max(255).regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/), platform: z.enum(['android', 'ios']) }).strict().parse(req.body);
  const db = databaseRequired();
  const admin = await db.adminUser.findUnique({ where: { userId: req.auth!.userId }, select: { id: true } });
  if (!admin) throw new HttpError(403, 'ADMIN_PERMISSION_DENIED', 'An administrator account is required to register a push device.');
  const now = new Date();
  const device = await db.adminPushDevice.upsert({
    where: { expoPushToken: input.expoPushToken },
    create: { adminUserId: admin.id, expoPushToken: input.expoPushToken, platform: input.platform, lastRegisteredAt: now },
    update: { adminUserId: admin.id, platform: input.platform, revokedAt: null, lastRegisteredAt: now },
    select: { id: true, platform: true, lastRegisteredAt: true },
  });
  await db.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ADMIN_PUSH_DEVICE_REGISTERED', target: `ADMIN_PUSH_DEVICE:${device.id}`, metadata: { platform: device.platform } } });
  res.status(201).json({ device, message: 'Admin device registered for eligible push alerts.' });
}));

adminRouter.delete('/push-devices', asyncRoute(async (req, res) => {
  const input = z.object({ expoPushToken: z.string().trim().min(20).max(255).regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/) }).strict().parse(req.body);
  const db = databaseRequired();
  const admin = await db.adminUser.findUnique({ where: { userId: req.auth!.userId }, select: { id: true } });
  if (!admin) throw new HttpError(403, 'ADMIN_PERMISSION_DENIED', 'An administrator account is required to revoke a push device.');
  const result = await db.adminPushDevice.updateMany({ where: { adminUserId: admin.id, expoPushToken: input.expoPushToken, revokedAt: null }, data: { revokedAt: new Date() } });
  if (result.count) await db.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ADMIN_PUSH_DEVICE_REVOKED', target: `ADMIN_USER:${req.auth!.userId}`, metadata: { deviceTokenHash: hashToken(input.expoPushToken) } } });
  res.json({ revoked: result.count > 0 });
}));

adminRouter.get('/push-events', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, financeRoles);
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page ?? '1');
  const pageSize = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.pageSize ?? '50');
  const db = databaseRequired();
  const [events, total] = await Promise.all([
    db.adminPushEvent.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, type: true, title: true, body: true, claimId: true, createdAt: true, deliveries: { select: { status: true, acceptedAt: true } } } }),
    db.adminPushEvent.count(),
  ]);
  res.json({ events: events.map(({ deliveries, ...event }) => ({ ...event, pushAccepted: deliveries.some((delivery) => delivery.status === 'ACCEPTED'), pushDeliveryCount: deliveries.filter((delivery) => delivery.status === 'ACCEPTED').length })), total, page, pageSize });
}));

adminRouter.get('/overview', asyncRoute(async (_req, res) => {
  const db = databaseRequired();
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const [users, activeUsers, blockedUsers, newUsersToday, deposits, withdrawals, pendingDeposits, pendingWithdrawals, completedDeposits, completedWithdrawals, completedP2p, failedDeposits, disputedOrders, totals, depositValue, withdrawalValue, daily, weekly, monthly, commissions] = await Promise.all([
    db.user.count(), db.user.count({ where: { status: 'ACTIVE' } }), db.user.count({ where: { status: 'SUSPENDED' } }), db.user.count({ where: { createdAt: { gte: startToday } } }),
    db.deposit.count(), db.withdrawal.count(), db.deposit.count({ where: { status: { in: ['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING'] } } }),
    db.withdrawal.count({ where: { status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING'] } } }),
    db.deposit.count({ where: { status: { in: ['PAYMENT_VERIFIED', 'COMPLETED'] } } }), db.withdrawal.count({ where: { status: 'COMPLETED' } }), db.p2pDepositOrder.count({ where: { status: 'SETTLED' } }), db.deposit.count({ where: { status: 'FAILED' } }),
    db.order.count({ where: { status: 'DISPUTED' } }),
    db.$queryRaw<Array<{ type: string; balance: bigint }>>`SELECT a.type::text AS type, COALESCE(SUM(e.credit_paise - e.debit_paise), 0)::bigint AS balance FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id GROUP BY a.type`,
    db.deposit.aggregate({ where: { status: { in: ['PAYMENT_VERIFIED', 'COMPLETED'] } }, _sum: { amountPaise: true } }),
    db.withdrawal.aggregate({ where: { status: 'COMPLETED' }, _sum: { amountPaise: true } }),
    db.$queryRaw<Array<{ day: Date; deposits: bigint; withdrawals: bigint; registrations: bigint }>>`SELECT d.day::date AS day, COALESCE((SELECT SUM(amount_paise) FROM deposits WHERE status IN ('PAYMENT_VERIFIED','COMPLETED') AND created_at::date=d.day::date),0)::bigint AS deposits, COALESCE((SELECT SUM(amount_paise) FROM withdrawals WHERE status='COMPLETED' AND created_at::date=d.day::date),0)::bigint AS withdrawals, (SELECT COUNT(*) FROM users WHERE created_at::date=d.day::date)::bigint AS registrations FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') d(day) ORDER BY day`,
    db.$queryRaw<Array<{ period: Date; deposits: bigint; withdrawals: bigint; registrations: bigint }>>`SELECT d.period::date AS period, COALESCE((SELECT SUM(amount_paise) FROM deposits WHERE status IN ('PAYMENT_VERIFIED','COMPLETED') AND created_at >= d.period AND created_at < d.period + INTERVAL '1 week'),0)::bigint AS deposits, COALESCE((SELECT SUM(amount_paise) FROM withdrawals WHERE status='COMPLETED' AND created_at >= d.period AND created_at < d.period + INTERVAL '1 week'),0)::bigint AS withdrawals, (SELECT COUNT(*) FROM users WHERE created_at >= d.period AND created_at < d.period + INTERVAL '1 week')::bigint AS registrations FROM generate_series(date_trunc('week', CURRENT_DATE::timestamp) - INTERVAL '3 weeks', date_trunc('week', CURRENT_DATE::timestamp), INTERVAL '1 week') d(period) ORDER BY period`,
    db.$queryRaw<Array<{ period: Date; deposits: bigint; withdrawals: bigint; registrations: bigint }>>`SELECT d.period::date AS period, COALESCE((SELECT SUM(amount_paise) FROM deposits WHERE status IN ('PAYMENT_VERIFIED','COMPLETED') AND created_at >= d.period AND created_at < d.period + INTERVAL '1 month'),0)::bigint AS deposits, COALESCE((SELECT SUM(amount_paise) FROM withdrawals WHERE status='COMPLETED' AND created_at >= d.period AND created_at < d.period + INTERVAL '1 month'),0)::bigint AS withdrawals, (SELECT COUNT(*) FROM users WHERE created_at >= d.period AND created_at < d.period + INTERVAL '1 month')::bigint AS registrations FROM generate_series(date_trunc('month', CURRENT_DATE::timestamp) - INTERVAL '11 months', date_trunc('month', CURRENT_DATE::timestamp), INTERVAL '1 month') d(period) ORDER BY period`,
    db.commissionEntry.aggregate({ _sum: { amountPaise: true } }),
  ]);
  const balances = Object.fromEntries(totals.map((r) => [r.type, Number(r.balance)]));
  const [recentDeposits, recentUsers, p2pPending, openOffers] = await Promise.all([
    db.deposit.findMany({ take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, amountPaise: true, currency: true, method: true, status: true, createdAt: true, user: { select: { publicId: true, displayName: true } } } }),
    db.user.findMany({ take: 5, orderBy: { createdAt: 'desc' }, select: { publicId: true, displayName: true, status: true, createdAt: true } }),
    db.p2pPaymentClaim.count({ where: { status: 'PENDING_REVIEW' } }), db.p2pWithdrawalOffer.count({ where: { status: 'OPEN' } }),
  ]);
  res.json({ users, deposits, withdrawals, disputedOrders, currency: 'INR', metrics: {
    users, activeUsers, blockedUsers, newUsersToday, totalWalletBalancePaise: balances.AVAILABLE || 0, totalReservedBalancePaise: balances.RESERVED || 0,
    totalDeposits: deposits, totalWithdrawals: withdrawals, totalDepositValuePaise: Number(depositValue._sum.amountPaise || 0n), totalWithdrawalValuePaise: Number(withdrawalValue._sum.amountPaise || 0n), pendingDeposits, pendingWithdrawals, completedTransactions: completedDeposits + completedWithdrawals + completedP2p,
    failedTransactions: failedDeposits, disputedTransactions: disputedOrders, totalPlatformRevenuePaise: null, commissionEarnedPaise: Number(commissions._sum.amountPaise || 0n),
    todayTransactionVolumePaise: Number(daily.at(-1)?.deposits || 0n) + Number(daily.at(-1)?.withdrawals || 0n),
  }, charts: {
    daily: daily.map((r) => ({ date: r.day, depositsPaise: Number(r.deposits), withdrawalsPaise: Number(r.withdrawals), registrations: Number(r.registrations) })),
    weekly: weekly.map((r) => ({ date: r.period, depositsPaise: Number(r.deposits), withdrawalsPaise: Number(r.withdrawals), registrations: Number(r.registrations) })),
    monthly: monthly.map((r) => ({ date: r.period, depositsPaise: Number(r.deposits), withdrawalsPaise: Number(r.withdrawals), registrations: Number(r.registrations) })),
  },
  recentTransactions: recentDeposits.map((d) => ({ ...d, amountPaise: Number(d.amountPaise), userName: d.user.displayName || d.user.publicId || 'User' })), recentUsers,
  pendingAdminActions: { manualDeposits: pendingDeposits, p2pClaims: p2pPending, openP2pOffers: openOffers }, system: { api: 'online', database: 'online' } });
}));

adminRouter.get('/users', asyncRoute(async (req, res) => {
  // Finance reviewers need masked user lookup while reconciling deposits.
  requireRole(req.auth!.role, new Set([...operationsRoles, 'FINANCE']));
  const db = databaseRequired(); const input = pageInput.parse(req.query); const where: any = {};
  if (input.status) where.status = z.enum(['PENDING_PROFILE', 'ACTIVE', 'SUSPENDED', 'CLOSED']).parse(input.status);
  if (input.q) where.OR = [
    { publicId: { contains: input.q, mode: 'insensitive' } },
    { displayName: { contains: input.q, mode: 'insensitive' } },
    { phoneE164: { contains: input.q } },
    ...(z.string().uuid().safeParse(input.q).success ? [{ id: input.q }] : []),
  ];
  const [total, rows] = await Promise.all([db.user.count({ where }), db.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, select: { id: true, publicId: true, displayName: true, phoneE164: true, status: true, createdAt: true, updatedAt: true, sessions: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } }, _count: { select: { deposits: true, withdrawals: true, buyOrders: true, sellOrders: true } } } })]);
  const ids = rows.map((u) => u.id);
  const [balances, depositsByUser, withdrawalsByUser] = ids.length ? await Promise.all([
    db.$queryRaw<Array<{ userId: string; type: string; balance: bigint }>>`SELECT a.user_id::text AS "userId", a.type::text AS type, COALESCE(SUM(e.credit_paise-e.debit_paise),0)::bigint AS balance FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id WHERE a.user_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND a.type IN ('AVAILABLE','RESERVED') GROUP BY a.user_id,a.type`,
    db.deposit.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: { in: ['PAYMENT_VERIFIED', 'COMPLETED'] } }, _sum: { amountPaise: true } }),
    db.withdrawal.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: 'COMPLETED' }, _sum: { amountPaise: true } }),
  ]) : [[], [], []];
  const balancesByUser = new Map<string, { available: number; reserved: number }>();
  for (const b of balances) { const current = balancesByUser.get(b.userId) || { available: 0, reserved: 0 }; if (b.type === 'AVAILABLE') current.available = Number(b.balance); if (b.type === 'RESERVED') current.reserved = Number(b.balance); balancesByUser.set(b.userId, current); }
  const depositMap = new Map(depositsByUser.map((x) => [x.userId, Number(x._sum.amountPaise || 0n)]));
  const withdrawalMap = new Map(withdrawalsByUser.map((x) => [x.userId, Number(x._sum.amountPaise || 0n)]));
  res.json({ users: rows.map(({ phoneE164, sessions, _count, ...u }) => ({ ...u, phoneMasked: phoneMasked(phoneE164), lastLogin: sessions[0]?.createdAt || null, walletBalancePaise: balancesByUser.get(u.id)?.available || 0, reservedBalancePaise: balancesByUser.get(u.id)?.reserved || 0, totalDepositsPaise: depositMap.get(u.id) || 0, totalWithdrawalsPaise: withdrawalMap.get(u.id) || 0, totalTransactions: _count.deposits + _count.withdrawals + _count.buyOrders + _count.sellOrders })), page: input.page, pageSize: input.pageSize, total });
}));

adminRouter.get('/users/:id', asyncRoute(async (req, res) => {
  // Expose only the same masked account summary to Finance; account actions
  // remain restricted to Operations/Admin below.
  requireRole(req.auth!.role, new Set([...operationsRoles, 'FINANCE']));
  const db = databaseRequired(); const user = await db.user.findUnique({ where: { id: req.params.id }, select: { id: true, publicId: true, displayName: true, phoneE164: true, status: true, createdAt: true, updatedAt: true, adminRole: { select: { role: true } }, _count: { select: { deposits: true, withdrawals: true, buyOrders: true, sellOrders: true } } } });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User was not found.');
  const [balances, recentLedgerEntries] = await Promise.all([
    db.$queryRaw<Array<{ type: string; balance: bigint }>>`SELECT a.type::text AS type, COALESCE(SUM(e.credit_paise-e.debit_paise),0)::bigint AS balance FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id WHERE a.user_id=${user.id}::uuid AND a.type IN ('AVAILABLE','RESERVED') GROUP BY a.type`,
    db.ledgerEntry.findMany({ where: { account: { userId: user.id } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, creditPaise: true, debitPaise: true, createdAt: true, account: { select: { type: true, currency: true } }, transaction: { select: { id: true, eventType: true, referenceType: true, referenceId: true, actorUserId: true } } } }),
  ]);
  const balance = (type: string) => Number(balances.find((row) => row.type === type)?.balance ?? 0n);
  res.json({ user: { ...user, phoneMasked: phoneMasked(user.phoneE164), phoneE164: undefined, totalTransactions: Object.values(user._count).reduce((a,b)=>a+b,0), walletBalancePaise: balance('AVAILABLE'), reservedBalancePaise: balance('RESERVED'), recentLedgerEntries: recentLedgerEntries.map((entry) => ({ ...entry, creditPaise: Number(entry.creditPaise), debitPaise: Number(entry.debitPaise) })) } });
}));

adminRouter.post('/users/:id/status', adminMutationLimit, asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, operationsRoles);
  const input = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().min(8).max(500) }).strict().parse(req.body);
  if (req.params.id === req.auth!.userId) throw new HttpError(409, 'CANNOT_CHANGE_SELF_STATUS', 'Administrators cannot change their own account status.');
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
    if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User was not found.');
    const updated = await tx.user.update({ where: { id: user.id }, data: { status: input.status }, select: { id: true, publicId: true, status: true } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ADMIN_USER_STATUS_CHANGED', target: `USER:${user.id}`, reason: input.reason, metadata: { previousStatus: user.status, newStatus: updated.status } } });
    return updated;
  });
  res.json({ user: result });
}));

adminRouter.get('/deposits', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['FINANCE', 'OPERATIONS', 'ADMIN', 'SUPER_ADMIN']));
  const db = databaseRequired(); const input = pageInput.parse(req.query); const where: any = {};
  if (input.status) where.status = z.enum(['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_VERIFIED', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'REVERSED']).parse(input.status);
  if (input.q) where.OR = [{ id: { contains: input.q, mode: 'insensitive' } }, { merchantReference: { contains: input.q, mode: 'insensitive' } }, { providerReference: { contains: input.q, mode: 'insensitive' } }, { user: { is: { publicId: { contains: input.q, mode: 'insensitive' } } } }, { user: { is: { displayName: { contains: input.q, mode: 'insensitive' } } } }, { user: { is: { phoneE164: { contains: input.q } } } }];
  const [total, rows] = await Promise.all([db.deposit.count({ where }), db.deposit.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, select: { id: true, amountPaise: true, currency: true, method: true, status: true, merchantReference: true, providerReference: true, createdAt: true, updatedAt: true, user: { select: { publicId: true, displayName: true, phoneE164: true } }, manualPaymentClaim: { select: { id: true, transactionReference: true, status: true, evidenceMimeType: true, reviewedAt: true, evidenceReference: true } } } })]);
  res.json({ deposits: rows.map((d) => ({ ...d, amountPaise: Number(d.amountPaise), user: { ...d.user, phoneMasked: phoneMasked(d.user.phoneE164), phoneE164: undefined } })), page: input.page, pageSize: input.pageSize, total });
}));

adminRouter.get('/withdrawals', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['FINANCE', 'OPERATIONS', 'ADMIN', 'SUPER_ADMIN']));
  const db = databaseRequired(); const input = pageInput.parse(req.query); const where: any = {};
  if (input.status) where.status = z.enum(['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED']).parse(input.status);
  if (input.q) where.OR = [{ id: { contains: input.q, mode: 'insensitive' } }, { payoutReference: { contains: input.q, mode: 'insensitive' } }, { user: { is: { publicId: { contains: input.q, mode: 'insensitive' } } } }];
  const [total, rows] = await Promise.all([db.withdrawal.count({ where }), db.withdrawal.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, select: { id: true, amountPaise: true, currency: true, status: true, payoutReference: true, createdAt: true, updatedAt: true, user: { select: { publicId: true, displayName: true, phoneE164: true } } } })]);
  res.json({ withdrawals: rows.map((w) => ({ ...w, amountPaise: Number(w.amountPaise), user: { ...w.user, phoneMasked: phoneMasked(w.user.phoneE164), phoneE164: undefined } })), page: input.page, pageSize: input.pageSize, total, payoutIntegration: 'NOT_CONFIGURED' });
}));

adminRouter.get('/transactions', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, financeRoles);
  const db = databaseRequired(); const input = pageInput.parse(req.query); const take = input.pageSize; const offset = (input.page - 1) * take;
  const base = Prisma.sql`SELECT d.id::text AS id, d.merchant_reference AS "referenceId", 'DEPOSIT'::text AS type, d.amount_paise AS "amountPaise", d.status::text AS status, d.method::text AS method, d.created_at AS "createdAt", u.public_id AS "userId" FROM deposits d JOIN users u ON u.id=d.user_id
    UNION ALL SELECT w.id::text, COALESCE(w.payout_reference,w.id::text), 'WITHDRAWAL'::text, w.amount_paise, w.status::text, NULL::text, w.created_at, u.public_id FROM withdrawals w JOIN users u ON u.id=w.user_id
    UNION ALL SELECT o.id::text, o.reference_id, 'P2P_ORDER'::text, o.amount_paise, o.status, 'UPI'::text, o.created_at, u.public_id FROM p2p_deposit_orders o JOIN users u ON u.id=o.buyer_user_id`;
  const statusClause = input.status ? Prisma.sql`status=${input.status}` : Prisma.sql`TRUE`;
  const queryClause = input.q ? Prisma.sql`("referenceId" ILIKE ${`%${input.q}%`} OR COALESCE("userId",'') ILIKE ${`%${input.q}%`})` : Prisma.sql`TRUE`;
  const [transactions, count] = await Promise.all([
    db.$queryRaw<Array<{ id: string; referenceId: string; type: string; amountPaise: bigint; status: string; method: string | null; createdAt: Date; userId: string | null }>>`WITH all_tx AS (${base}) SELECT * FROM all_tx WHERE ${statusClause} AND ${queryClause} ORDER BY "createdAt" DESC LIMIT ${take} OFFSET ${offset}`,
    db.$queryRaw<Array<{ total: bigint }>>`WITH all_tx AS (${base}) SELECT COUNT(*)::bigint AS total FROM all_tx WHERE ${statusClause} AND ${queryClause}`,
  ]);
  res.json({ transactions: transactions.map((t) => ({ ...t, amountPaise: Number(t.amountPaise) })), page: input.page, pageSize: take, total: Number(count[0]?.total || 0n) });
}));

adminRouter.get('/wallets/ledger', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, financeRoles); const db = databaseRequired();
  const input = z.object({ userId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
  const where: any = { ...(input.userId ? { account: { userId: input.userId } } : {}) };
  const [total, rows] = await Promise.all([db.ledgerEntry.count({ where }), db.ledgerEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { account: { select: { userId: true, type: true, currency: true, user: { select: { publicId: true } } } }, transaction: { select: { id: true, eventType: true, referenceType: true, referenceId: true, actorUserId: true } } } })]);
  res.json({ entries: rows.map((e) => ({ id: e.id, userId: e.account.user?.publicId, accountType: e.account.type, currency: e.account.currency, creditPaise: Number(e.creditPaise), debitPaise: Number(e.debitPaise), transaction: e.transaction, createdAt: e.createdAt })), total, page: input.page, pageSize: input.pageSize });
}));

adminRouter.get('/users/:id/wallet/credits', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['SUPER_ADMIN']));
  const userId = z.string().uuid().parse(req.params.id);
  const input = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
  const db = databaseRequired();
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User was not found.');
  const where = { eventType: 'ADMIN_ADJUSTMENT', referenceType: 'ADMIN_ADJUSTMENT', entries: { some: { account: { is: { userId } } } } };
  const [total, transactions, auditLogs] = await Promise.all([
    db.ledgerTransaction.count({ where }),
    db.ledgerTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize,
      select: { id: true, actorUserId: true, referenceId: true, createdAt: true, metadata: true,
        entries: { where: { account: { is: { userId } } }, select: { creditPaise: true } } } }),
    db.auditLog.findMany({ where: { target: `USER:${userId}`, action: 'ADMIN_WALLET_CREDIT' }, orderBy: { createdAt: 'desc' }, take: input.pageSize,
      select: { id: true, actorId: true, reason: true, metadata: true, createdAt: true } }),
  ]);
  const safeReason = (metadata: unknown) => metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof (metadata as Record<string, unknown>).reason === 'string' ? (metadata as Record<string, string>).reason : '';
  const safeReference = (metadata: unknown) => metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof (metadata as Record<string, unknown>).transactionReference === 'string' ? (metadata as Record<string, string>).transactionReference : '';
  res.json({
    credits: transactions.map((transaction) => ({ id: transaction.id, transactionReference: transaction.referenceId, adminId: transaction.actorUserId,
      amountPaise: Number(transaction.entries[0]?.creditPaise ?? 0n), reason: safeReason(transaction.metadata), createdAt: transaction.createdAt })),
    auditLogs: auditLogs.map((entry) => ({ id: entry.id, adminId: entry.actorId, reason: entry.reason ?? safeReason(entry.metadata), transactionReference: safeReference(entry.metadata), createdAt: entry.createdAt })),
    total, page: input.page, pageSize: input.pageSize,
  });
}));

adminRouter.post('/users/:id/wallet/credit', adminMutationLimit, asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['SUPER_ADMIN']));
  if (!env.walletAdjustmentsEnabled) throw new HttpError(503, 'WALLET_CREDITS_DISABLED', 'Manual wallet credits are disabled by server financial controls. No balance was changed.');
  assertFinancialOperationsEnabled();
  const userId = z.string().uuid().parse(req.params.id);
  const idempotencyKey = z.string().uuid().parse(req.get('Idempotency-Key'));
  const input = z.object({
    amountPaise: z.number().int().min(MIN_SUPER_ADMIN_WALLET_CREDIT_PAISE).max(MAX_ADMIN_ADJUSTMENT_PAISE),
    reason: z.string().trim().min(8).max(500),
  }).strict().parse(req.body);
  const db = databaseRequired();
  const credit = await db.$transaction((tx) => applySuperAdminWalletCredit(tx, { actorUserId: req.auth!.userId, idempotencyKey, targetUserId: userId, ...input }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(credit.replayed ? 200 : 201).json({ credit, message: credit.replayed ? 'This credit was already recorded; no duplicate ledger entry was created.' : 'Manual ADMIN_ADJUSTMENT credit recorded in the immutable ledger.' });
}));

adminRouter.post('/wallet-adjustments', adminMutationLimit, asyncRoute(async (req, res) => {
  if (req.auth!.role !== 'ADMIN' || !env.walletAdjustmentAdminUserId || req.auth!.userId !== env.walletAdjustmentAdminUserId) {
    throw new HttpError(403, 'ADMIN_PERMISSION_DENIED', 'This wallet adjustment action is restricted to the explicitly configured ADMIN account.');
  }
  if (!env.walletAdjustmentsEnabled) throw new HttpError(503, 'WALLET_ADJUSTMENTS_DISABLED', 'Admin wallet adjustments are disabled until financial controls are approved. No balance was changed.');
  assertFinancialOperationsEnabled();
  const clientKey = z.string().uuid().parse(req.get('Idempotency-Key'));
  const input = z.object({
    targetPublicId: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/),
    direction: z.enum(['CREDIT', 'DEBIT']),
    amountPaise: z.number().int().min(1).max(MAX_ADMIN_ADJUSTMENT_PAISE),
    reason: z.string().trim().min(8).max(500),
  }).strict().parse(req.body);
  const db = databaseRequired();
  const adjustment = await db.$transaction((tx) => applyAdminWalletAdjustment(tx, {
    actorUserId: req.auth!.userId, idempotencyKey: clientKey, ...input,
  }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(adjustment.replayed ? 200 : 201).json({ adjustment, message: adjustment.replayed ? 'This adjustment was already recorded; no duplicate ledger entry was created.' : 'Wallet adjustment was recorded in the immutable ledger.' });
}));

adminRouter.get('/referrals', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, operationsRoles);
  const db = databaseRequired(); const input = pageInput.parse(req.query);
  const where = input.q ? { OR: [
    { referrer: { is: { publicId: { contains: input.q, mode: 'insensitive' as const } } } },
    { referrer: { is: { displayName: { contains: input.q, mode: 'insensitive' as const } } } },
    { invitee: { is: { publicId: { contains: input.q, mode: 'insensitive' as const } } } },
    { invitee: { is: { displayName: { contains: input.q, mode: 'insensitive' as const } } } },
  ] } : {};
  const [total, rows, config] = await Promise.all([db.referral.count({ where }), db.referral.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { referrer: { select: { publicId: true, displayName: true } }, invitee: { select: { publicId: true, displayName: true, createdAt: true } } } }), db.referralProgramConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })]);
  res.json({ referrals: rows, total, page: input.page, pageSize: input.pageSize, commissionPolicy: { directRateBps: config.directRateBps, indirectRateBps: config.indirectRateBps, basis: 'Eligible successful INR transactions only after server-side verified deposits or Finance-verified P2P receipt', funding: 'No approved payout funding configured; accruals remain pending and are not credited to wallets.' } });
}));

adminRouter.get('/referrals/config', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, operationsRoles);
  const db = databaseRequired();
  const [config, milestones] = await Promise.all([
    db.referralProgramConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    db.referralMilestoneRule.findMany({ orderBy: { requiredReferrals: 'asc' } }),
  ]);
  res.json({ config: { directRateBps: config.directRateBps, indirectRateBps: config.indirectRateBps, updatedAt: config.updatedAt }, milestones: milestones.map((rule) => ({ ...rule, qualifyingTopUpPaise: rule.qualifyingTopUpPaise === null ? null : Number(rule.qualifyingTopUpPaise), rewardAmountPaise: Number(rule.rewardAmountPaise) })), payoutFundingConfigured: false });
}));

adminRouter.patch('/referrals/config', adminMutationLimit, asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['ADMIN', 'SUPER_ADMIN']));
  assertFinancialOperationsEnabled();
  const input = z.object({ directRateBps: z.number().int().min(0).max(1000), indirectRateBps: z.number().int().min(0).max(1000), reason: z.string().trim().min(8).max(500) }).strict().parse(req.body);
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    const before = await tx.referralProgramConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const after = await tx.referralProgramConfig.update({ where: { id: 1 }, data: { directRateBps: input.directRateBps, indirectRateBps: input.indirectRateBps } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'REFERRAL_COMMISSION_RATES_CHANGED', target: 'REFERRAL_PROGRAM:CONFIG', reason: input.reason, metadata: { previousDirectRateBps: before.directRateBps, newDirectRateBps: after.directRateBps, previousIndirectRateBps: before.indirectRateBps, newIndirectRateBps: after.indirectRateBps } } });
    return after;
  });
  res.json({ config: { directRateBps: result.directRateBps, indirectRateBps: result.indirectRateBps, updatedAt: result.updatedAt }, payoutFundingConfigured: false });
}));

adminRouter.patch('/referrals/milestones/:key', adminMutationLimit, asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['ADMIN', 'SUPER_ADMIN']));
  assertFinancialOperationsEnabled();
  const key = z.enum(['TIER_5', 'TIER_10', 'TIER_20']).parse(req.params.key);
  const input = z.object({ requiredReferrals: z.number().int().min(1).max(100000), qualifyingTopUpPaise: z.number().int().positive().nullable(), rewardAmountPaise: z.number().int().nonnegative(), enabled: z.boolean(), reason: z.string().trim().min(8).max(500) }).strict().parse(req.body);
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    const before = await tx.referralMilestoneRule.findUnique({ where: { key } });
    const rule = await tx.referralMilestoneRule.upsert({ where: { key }, create: { key, requiredReferrals: input.requiredReferrals, qualifyingTopUpPaise: input.qualifyingTopUpPaise === null ? null : BigInt(input.qualifyingTopUpPaise), rewardAmountPaise: BigInt(input.rewardAmountPaise), enabled: input.enabled }, update: { requiredReferrals: input.requiredReferrals, qualifyingTopUpPaise: input.qualifyingTopUpPaise === null ? null : BigInt(input.qualifyingTopUpPaise), rewardAmountPaise: BigInt(input.rewardAmountPaise), enabled: input.enabled } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'REFERRAL_MILESTONE_RULE_CHANGED', target: `REFERRAL_MILESTONE:${key}`, reason: input.reason, metadata: { previous: before ? { requiredReferrals: before.requiredReferrals, qualifyingTopUpPaise: before.qualifyingTopUpPaise?.toString() ?? null, rewardAmountPaise: before.rewardAmountPaise.toString(), enabled: before.enabled } : null, next: { requiredReferrals: rule.requiredReferrals, qualifyingTopUpPaise: rule.qualifyingTopUpPaise?.toString() ?? null, rewardAmountPaise: rule.rewardAmountPaise.toString(), enabled: rule.enabled } } } });
    return rule;
  });
  res.json({ milestone: { ...result, qualifyingTopUpPaise: result.qualifyingTopUpPaise === null ? null : Number(result.qualifyingTopUpPaise), rewardAmountPaise: Number(result.rewardAmountPaise) }, payoutFundingConfigured: false });
}));

adminRouter.get('/commissions', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, financeRoles); const db = databaseRequired(); const input = pageInput.parse(req.query); const [total, rows, aggregate, config] = await Promise.all([db.commissionEntry.count(), db.commissionEntry.findMany({ orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { user: { select: { publicId: true, displayName: true } } } }), db.commissionEntry.aggregate({ _sum: { amountPaise: true }, _count: true }), db.referralProgramConfig.upsert({ where: { id: 1 }, create: { id: 1, directRateBps: 40, indirectRateBps: 10 }, update: {} })]);
  res.json({ commissions: rows.map((r) => ({ ...r, amountPaise: Number(r.amountPaise) })), total, totalCommissionPaise: Number(aggregate._sum.amountPaise || 0n), page: input.page, pageSize: input.pageSize, configuration: { directRateBps: config.directRateBps, indirectRateBps: config.indirectRateBps, referralBasis: 'Eligible successful INR transactions after server-side deposit verification or Finance-verified P2P receipt', payoutFundingConfigured: false } });
}));

adminRouter.get('/providers', asyncRoute(async (req, res) => { requireRole(req.auth!.role, operationsRoles); res.json(await getPaymentMethodAvailability()); }));
adminRouter.get('/audit-logs', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, operationsRoles); const db = databaseRequired(); const input = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50), q: z.string().trim().max(120).optional() }).parse(req.query); const where = input.q ? { OR: [{ action: { contains: input.q, mode: 'insensitive' as const } }, { target: { contains: input.q, mode: 'insensitive' as const } }] } : {};
  const [total, rows] = await Promise.all([db.auditLog.count({ where }), db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, select: { id: true, actorId: true, action: true, target: true, reason: true, metadata: true, createdAt: true } })]); res.json({ auditLogs: rows, total, page: input.page, pageSize: input.pageSize });
}));
adminRouter.get('/system-health', asyncRoute(async (_req, res) => {
  const checkedAt = new Date(); let database: 'online' | 'offline' = 'offline'; let responseTimeMs: number | null = null;
  if (prisma) { const start = Date.now(); try { await prisma.$queryRaw`SELECT 1`; database = 'online'; responseTimeMs = Date.now() - start; } catch { database = 'offline'; } }
  const providers = await getPaymentMethodAvailability(); res.json({ checkedAt, api: 'online', database, databaseResponseTimeMs: responseTimeMs, payments: providers.methods.map((p) => ({ name: p.name, status: p.status, available: p.available })), payoutProvider: 'NOT_CONFIGURED', backgroundWorkers: 'NOT_CONFIGURED' });
}));

adminRouter.get('/p2p/overview', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, financeRoles); const db = databaseRequired(); const [offers, orders, claims] = await Promise.all([db.p2pWithdrawalOffer.groupBy({ by: ['status'], _count: true }), db.p2pDepositOrder.groupBy({ by: ['status'], _count: true }), db.p2pPaymentClaim.count({ where: { status: 'PENDING_REVIEW' } })]); res.json({ offers: Object.fromEntries(offers.map((x) => [x.status, x._count])), orders: Object.fromEntries(orders.map((x) => [x.status, x._count])), pendingClaims: claims });
}));

adminRouter.get('/disputes', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, financeRoles); const db = databaseRequired(); const input = pageInput.parse(req.query);
  if (input.status && input.status.toUpperCase() !== 'DISPUTED') return res.json({ disputes: [], total: 0, page: input.page, pageSize: input.pageSize, message: 'Disputes are view-only; resolution workflow is not implemented.' });
  const search = input.q ? `%${input.q}%` : null;
  const status = 'DISPUTED' as const;
  const [countRows, pageKeys] = await Promise.all([
    db.$queryRaw<Array<{ total: bigint }>>`
      SELECT (
        SELECT count(*) FROM orders WHERE status::text = ${status} AND (${search}::text IS NULL OR id::text ILIKE ${search})
      ) + (
        SELECT count(*) FROM p2p_deposit_orders WHERE status = ${status} AND (${search}::text IS NULL OR id::text ILIKE ${search} OR reference_id ILIKE ${search})
      ) AS total
    `,
    db.$queryRaw<Array<{ id: string; source: 'ORDER' | 'P2P' }>>`
      SELECT id, source FROM (
        SELECT id, updated_at, 'ORDER'::text AS source FROM orders
          WHERE status::text = ${status} AND (${search}::text IS NULL OR id::text ILIKE ${search})
        UNION ALL
        SELECT id, updated_at, 'P2P'::text AS source FROM p2p_deposit_orders
          WHERE status = ${status} AND (${search}::text IS NULL OR id::text ILIKE ${search} OR reference_id ILIKE ${search})
      ) AS disputes ORDER BY updated_at DESC, id DESC
      OFFSET ${(input.page - 1) * input.pageSize} LIMIT ${input.pageSize}
    `,
  ]);
  const orderIds = pageKeys.filter((item) => item.source === 'ORDER').map((item) => item.id);
  const p2pIds = pageKeys.filter((item) => item.source === 'P2P').map((item) => item.id);
  const [orders, p2pOrders] = await Promise.all([
    orderIds.length ? db.order.findMany({ where: { id: { in: orderIds } }, include: { buyer: { select: { publicId: true, displayName: true } }, seller: { select: { publicId: true, displayName: true } }, history: { orderBy: { createdAt: 'desc' }, take: 5 } } }) : [],
    p2pIds.length ? db.p2pDepositOrder.findMany({ where: { id: { in: p2pIds } }, include: { buyer: { select: { publicId: true, displayName: true } }, seller: { select: { publicId: true, displayName: true } }, claims: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, createdAt: true } } } }) : [],
  ]);
  const legacyById = new Map(orders.map((o) => [o.id, { id: o.id, referenceId: o.id, kind: o.kind, amountPaise: Number(o.amountPaise), status: o.status, buyer: o.buyer, seller: o.seller, createdAt: o.updatedAt, history: o.history }]));
  const p2pById = new Map(p2pOrders.map((o) => [o.id, { id: o.id, referenceId: o.referenceId, kind: 'P2P', amountPaise: Number(o.amountPaise), status: o.status, buyer: o.buyer, seller: o.seller, createdAt: o.updatedAt, latestClaim: o.claims[0] }]));
  const disputes = pageKeys.map((item) => item.source === 'ORDER' ? legacyById.get(item.id) : p2pById.get(item.id)).filter((item) => item !== undefined);
  res.json({ disputes, total: Number(countRows[0]?.total ?? 0n), page: input.page, pageSize: input.pageSize, message: 'Disputes are view-only; resolution workflow is not implemented.' });
}));

adminRouter.get('/support/tickets', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, operationsRoles); const db = databaseRequired(); const input = pageInput.parse(req.query); const where: any = input.status ? { status: input.status } : {};
  const [total, tickets] = await Promise.all([db.supportTicket.count({ where }), db.supportTicket.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, select: { id: true, subject: true, status: true, createdAt: true, updatedAt: true, user: { select: { publicId: true, displayName: true, phoneE164: true } }, _count: { select: { messages: true } } } })]);
  res.json({ tickets: tickets.map((x) => ({ ...x, user: { ...x.user, phoneMasked: phoneMasked(x.user.phoneE164), phoneE164: undefined } })), total, page: input.page, pageSize: input.pageSize, actions: 'Support response actions are not implemented.' });
}));

adminRouter.get('/support/tickets/:id', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set([...operationsRoles, 'SUPPORT']));
  const ticket = await databaseRequired().supportTicket.findUnique({ where: { id: req.params.id }, include: { user: { select: { publicId: true, displayName: true, phoneE164: true } }, messages: { orderBy: { createdAt: 'asc' }, select: { id: true, authorId: true, message: true, createdAt: true } } } });
  if (!ticket) throw new HttpError(404, 'TICKET_NOT_FOUND', 'Support ticket was not found.');
  const { phoneE164, ...user } = ticket.user;
  res.json({ ticket: { ...ticket, user: { ...user, phoneMasked: phoneMasked(phoneE164) } } });
}));

adminRouter.post('/support/tickets/:id/reply', adminMutationLimit, asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set([...operationsRoles, 'SUPPORT']));
  const input = z.object({ message: z.string().trim().min(2).max(2000), reason: z.string().trim().min(8).max(500) }).strict().parse(req.body);
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true, status: true, subject: true } });
    if (!ticket) throw new HttpError(404, 'TICKET_NOT_FOUND', 'Support ticket was not found.');
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') throw new HttpError(409, 'TICKET_CLOSED', 'This support ticket is closed. Reopen it before replying.');
    const message = await tx.supportMessage.create({ data: { ticketId: ticket.id, authorId: req.auth!.userId, message: input.message } });
    await tx.supportTicket.update({ where: { id: ticket.id }, data: { status: 'IN_PROGRESS' } });
    await tx.notification.create({ data: { userId: ticket.userId, title: `Support update: ${ticket.subject}`, body: input.message.slice(0, 1000) } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ADMIN_SUPPORT_REPLY_SENT', target: `SUPPORT_TICKET:${ticket.id}`, reason: input.reason, metadata: { previousStatus: ticket.status, newStatus: 'IN_PROGRESS', messageId: message.id } } });
    return { message, status: 'IN_PROGRESS' };
  });
  res.status(201).json(result);
}));

adminRouter.patch('/support/tickets/:id/status', adminMutationLimit, asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set([...operationsRoles, 'SUPPORT']));
  const input = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']), reason: z.string().trim().min(8).max(500) }).strict().parse(req.body);
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    const before = await tx.supportTicket.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, userId: true, subject: true } });
    if (!before) throw new HttpError(404, 'TICKET_NOT_FOUND', 'Support ticket was not found.');
    if (before.status === 'CLOSED') throw new HttpError(409, 'TICKET_CLOSED', 'Closed ticket status cannot be changed.');
    const ticket = await tx.supportTicket.update({ where: { id: before.id }, data: { status: input.status }, select: { id: true, status: true, updatedAt: true } });
    if (input.status === 'RESOLVED') await tx.notification.create({ data: { userId: before.userId, title: `Support ticket resolved: ${before.subject}`, body: 'Your PaisaPay support ticket has been marked resolved. Please reopen a new ticket if you still need help.' } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ADMIN_SUPPORT_TICKET_STATUS_CHANGED', target: `SUPPORT_TICKET:${before.id}`, reason: input.reason, metadata: { previousStatus: before.status, newStatus: ticket.status } } });
    return ticket;
  });
  res.json({ ticket: result });
}));

// In-app announcements only. This does not send SMS or push notifications.
// Broad sends require an explicit confirmation flag and are always audited.
adminRouter.get('/notifications', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['ADMIN', 'SUPER_ADMIN']));
  const input = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
  const db = databaseRequired();
  const [total, notifications] = await Promise.all([
    db.notification.count(),
    db.notification.findMany({ orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, select: { id: true, title: true, body: true, readAt: true, createdAt: true, user: { select: { publicId: true, displayName: true } } } }),
  ]);
  res.json({ notifications, total, page: input.page, pageSize: input.pageSize, delivery: 'IN_APP_ONLY' });
}));

adminRouter.post('/notifications', adminMutationLimit, asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['ADMIN', 'SUPER_ADMIN']));
  const input = z.object({
    title: z.string().trim().min(3).max(100), body: z.string().trim().min(3).max(1000),
    audience: z.enum(['ALL_ACTIVE', 'USER_IDS']), userIds: z.array(z.string().uuid()).max(1000).optional(),
    confirmAll: z.boolean().optional(), reason: z.string().trim().min(8).max(500),
  }).strict().parse(req.body);
  if (input.audience === 'ALL_ACTIVE' && input.confirmAll !== true) throw new HttpError(400, 'BROADCAST_CONFIRMATION_REQUIRED', 'Confirm the all-active-user announcement before sending.');
  if (input.audience === 'USER_IDS' && (!input.userIds?.length || input.userIds.length > 1000)) throw new HttpError(400, 'RECIPIENTS_REQUIRED', 'Select between 1 and 1000 user IDs.');
  const db = databaseRequired();
  const result = await db.$transaction(async (tx) => {
    const users = await tx.user.findMany({ where: input.audience === 'ALL_ACTIVE' ? { status: 'ACTIVE' } : { id: { in: input.userIds! }, status: 'ACTIVE' }, select: { id: true } });
    if (input.audience === 'USER_IDS' && users.length !== new Set(input.userIds).size) throw new HttpError(400, 'RECIPIENTS_INVALID', 'One or more selected users do not exist or are not active.');
    if (users.length > 0) await tx.notification.createMany({ data: users.map(({ id }) => ({ userId: id, title: input.title, body: input.body })) });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ADMIN_IN_APP_ANNOUNCEMENT_SENT', target: 'NOTIFICATIONS', reason: input.reason, metadata: { audience: input.audience, recipientCount: users.length, title: input.title } } });
    return { recipientCount: users.length };
  });
  res.status(201).json({ ...result, delivery: 'IN_APP_ONLY' });
}));

adminRouter.get('/reward-rules', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['ADMIN', 'SUPER_ADMIN', 'FINANCE']));
  const rules = await databaseRequired().rewardRule.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json({ rules: rules.map((rule) => ({ ...rule, amountPaise: Number(rule.amountPaise) })), payoutFundingConfigured: false });
}));

adminRouter.patch('/reward-rules/:id', adminMutationLimit, asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['SUPER_ADMIN']));
  assertFinancialOperationsEnabled();
  const input = z.object({ name: z.string().trim().min(2).max(100), eligibility: z.record(z.string(), z.unknown()), amountPaise: z.number().int().min(0).max(100_000_000_000), fundingSource: z.string().trim().max(100).nullable(), enabled: z.boolean(), reason: z.string().trim().min(8).max(500) }).strict().parse(req.body);
  const db = databaseRequired();
  const rule = await db.$transaction(async (tx) => {
    const before = await tx.rewardRule.findUnique({ where: { id: req.params.id } });
    if (!before) throw new HttpError(404, 'REWARD_RULE_NOT_FOUND', 'Reward rule was not found.');
    const next = await tx.rewardRule.update({ where: { id: before.id }, data: { name: input.name, eligibility: input.eligibility as Prisma.InputJsonValue, amountPaise: BigInt(input.amountPaise), fundingSource: input.fundingSource, enabled: input.enabled } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ADMIN_REWARD_RULE_UPDATED', target: `REWARD_RULE:${before.id}`, reason: input.reason, metadata: { previous: { name: before.name, eligibility: before.eligibility, amountPaise: before.amountPaise.toString(), fundingSource: before.fundingSource, enabled: before.enabled }, next: { name: next.name, eligibility: next.eligibility, amountPaise: next.amountPaise.toString(), fundingSource: next.fundingSource, enabled: next.enabled } } } });
    return next;
  });
  res.json({ rule: { ...rule, amountPaise: Number(rule.amountPaise) }, payoutFundingConfigured: false });
}));

adminRouter.get('/admins', asyncRoute(async (req, res) => {
  requireRole(req.auth!.role, new Set(['SUPER_ADMIN'])); const db = databaseRequired(); const input = pageInput.parse(req.query);
  const where: Prisma.AdminUserWhereInput = input.q ? { OR: [{ user: { is: { publicId: { contains: input.q, mode: 'insensitive' } } } }, { user: { is: { displayName: { contains: input.q, mode: 'insensitive' } } } }] } : {};
  const [total, rows] = await Promise.all([db.adminUser.count({ where }), db.adminUser.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, select: { role: true, createdAt: true, user: { select: { id: true, publicId: true, displayName: true, phoneE164: true, status: true } } } })]);
  res.json({ admins: rows.map((x) => ({ ...x, user: { ...x.user, phoneMasked: phoneMasked(x.user.phoneE164), phoneE164: undefined } })), management: 'Role changes are not configured in this admin API.', total, page: input.page, pageSize: input.pageSize });
}));
