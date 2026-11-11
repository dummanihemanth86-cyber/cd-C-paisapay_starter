import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { prisma } from './lib/db.js';
import { asyncRoute, HttpError } from './lib/http.js';
import { logger } from './lib/logger.js';
import { requireAdmin, requireAuth } from './middleware/auth.js';
import { authRouter } from './modules/auth/routes.js';
import { ordersRouter } from './modules/orders/routes.js';
import { paymentsRouter } from './modules/payments/routes.js';
import { notificationRouter, supportRouter } from './modules/support/routes.js';
import { handleCashfreeWebhook } from './modules/payments/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { p2pRouter } from './modules/p2p/routes.js';
import { getPaymentMethodAvailability } from './modules/payments/availability.js';
import { openapi } from './openapi.js';
import { adminAuthRouter, adminRouter } from './modules/admin/routes.js';
import { financialOperationsGate } from './middleware/financialOperations.js';
import { isAllowedApiOrigin } from './config/adminWebOrigin.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: (origin, callback) => {
  if (isAllowedApiOrigin(origin, { apiProductionOrigin: 'https://paisapay-api.onrender.com', appOrigins: env.appOrigins, isDevelopment: env.isDevelopment, isExplicitRenderStaging: env.isExplicitRenderStaging })) return callback(null, true);
  return callback(Object.assign(new Error('Origin is not allowed by CORS.'), { statusCode: 403, code: 'CORS_ORIGIN_DENIED' }));
} }));
app.use(express.json({ limit: '2.1mb', verify: (req, _res, buffer) => { (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
// Always generate correlation IDs server-side; never promote caller-controlled
// header contents (which might contain a phone, OTP, or credential) into logs.
app.use((req, _res, next) => { req.requestId = randomUUID(); next(); });
app.use(pinoHttp({ logger, genReqId: (req) => req.requestId!, redact: ['req.headers.authorization', 'req.headers.x-request-id'], customProps: (req) => ({ requestId: req.requestId }) }));

app.get('/', (_req, res) => res.json({ service: 'paisapay-api', docs: '/api/v1/docs', health: '/health', readiness: '/ready' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'paisapay-api' }));
app.get('/ready', async (_req, res) => {
  if (!prisma) return res.status(503).json({ ok: false, service: 'paisapay-api', dependencies: { database: 'not_configured' } });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, service: 'paisapay-api', dependencies: { database: 'ready' } });
  } catch {
    return res.status(503).json({ ok: false, service: 'paisapay-api', dependencies: { database: 'unavailable' } });
  }
});

app.get('/api/v1/config', asyncRoute(async (_req, res) => {
  res.json(await getPaymentMethodAvailability());
}));
// Versioned public contract for clients that need machine-readable capability
// fields. Keep /api/v1/config unchanged for existing app versions.
app.get('/api/v2/availability', asyncRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const availability = await getPaymentMethodAvailability();
  res.json({ apiVersion: '2.0.0', schemaVersion: 2, ...availability });
}));
// Compatibility alias for the earlier demo client. Remove after all installations use /api/v1.
app.get('/v1/config', asyncRoute(async (_req, res) => {
  res.json({ ...await getPaymentMethodAvailability(), demoOnly: true });
}));
app.get('/api/v1/openapi.json', (_req, res) => res.json(openapi));
const publicApiBuildId = /^[a-f0-9]{7,40}$/i.test(process.env.RENDER_GIT_COMMIT || '') ? process.env.RENDER_GIT_COMMIT! : 'unknown';
app.get('/api/v1/admin/app-version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json({
    service: 'paisapay-api',
    apiVersion: '1.0.0',
    buildId: publicApiBuildId,
    deploymentEnvironment: env.isExplicitRenderStaging ? 'staging' : env.isProduction ? 'production' : env.isDevelopment ? 'development' : 'test',
  });
});
app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(undefined, {
  swaggerOptions: { url: '/api/v1/openapi.json' },
}));
app.post('/api/v1/webhooks/payments/:provider', financialOperationsGate, (req, res, next) => {
  if (req.params.provider === 'cashfree') return void handleCashfreeWebhook(req, res).catch(next);
  return res.status(503).json({ error: { code: 'PAYMENT_PROVIDER_UNAVAILABLE', message: 'No approved payment adapter is configured for this provider.' } });
});
app.use('/api/v1', (req, res, next) => {
  const path = req.path;
  const known = [
    ['/auth/request-otp', 'POST'], ['/auth/verify-otp', 'POST'], ['/auth/register/request-otp', 'POST'], ['/auth/register/verify-otp', 'POST'], ['/auth/forgot-password/request-otp', 'POST'], ['/auth/password/login', 'POST'], ['/auth/password/reset', 'POST'], ['/auth/refresh', 'POST'], ['/auth/logout', 'POST'],
    ['/config', 'GET'], ['/wallet-methods', 'GET'], ['/wallet-references', 'GET'], ['/wallet-references', 'POST'], ['/users/me/vip', 'GET'], ['/admin/app-version', 'GET'],
    ['/deposits', 'GET'], ['/deposits', 'POST'], ['/users/me', 'GET'], ['/users/me', 'PATCH'], ['/users/me/upi', 'GET'], ['/users/me/upi', 'PATCH'], ['/users/me/upi', 'DELETE'], ['/users/me/referrals', 'GET'],
    ['/users/me/bank-accounts', 'GET'], ['/users/me/bank-accounts', 'POST'],
    ['/users/me/balance', 'GET'], ['/users/me/transactions', 'GET'], ['/orders', 'GET'], ['/orders', 'POST'],
    ['/withdrawals', 'GET'], ['/withdrawals', 'POST'], ['/notifications', 'GET'], ['/support/tickets', 'GET'], ['/support/tickets', 'POST'],
    ['/admin/auth/login', 'POST'], ['/admin/auth/forgot-password/request-otp', 'POST'], ['/admin/auth/password/reset', 'POST'], ['/admin/me', 'GET'], ['/admin/overview', 'GET'], ['/admin/users', 'GET'], ['/admin/deposits', 'GET'], ['/admin/withdrawals', 'GET'], ['/admin/transactions', 'GET'], ['/admin/wallets/ledger', 'GET'], ['/admin/wallet-adjustments', 'POST'], ['/admin/referrals', 'GET'], ['/admin/referrals/config', 'GET'], ['/admin/referrals/config', 'PATCH'], ['/admin/commissions', 'GET'], ['/admin/providers', 'GET'], ['/admin/audit-logs', 'GET'], ['/admin/system-health', 'GET'], ['/admin/reports', 'GET'], ['/admin/settings', 'GET'], ['/admin/p2p/overview', 'GET'], ['/admin/disputes', 'GET'], ['/admin/support/tickets', 'GET'], ['/admin/admins', 'GET'], ['/admin/reconciliation/claims', 'GET'], ['/admin/notifications', 'GET'], ['/admin/notifications', 'POST'], ['/admin/reward-rules', 'GET'], ['/deposits/orders/my', 'GET'], ['/admin/p2p/offers', 'GET'], ['/admin/p2p/orders', 'GET'], ['/admin/p2p/claims', 'GET'], ['/admin/push-events', 'GET'], ['/admin/push-devices', 'POST'], ['/admin/push-devices', 'DELETE'],
    ['/admin/wallet/credits/requests', 'GET'], ['/admin/wallet/credits/requests', 'POST'], ['/admin/wallet/funding/requests', 'GET'], ['/admin/wallet/funding/requests', 'POST'], ['/admin/wallet/reconciliation', 'GET'],
    ['/admin/wallet/credits/direct', 'POST'],
  ].some(([route, method]) => path === route && req.method === method) ||
    (/^\/auth\/otp-status\/[^/]+$/.test(path) && req.method === 'GET') ||
    (/^\/deposits\/[^/]+$/.test(path) && req.method === 'GET') ||
    (/^\/deposits\/[^/]+\/cancel$/.test(path) && req.method === 'POST') ||
    (/^\/deposits\/[^/]+\/manual-verification$/.test(path) && req.method === 'POST') ||
    (/^\/admin\/reconciliation\/claims\/[^/]+\/evidence$/.test(path) && req.method === 'GET') ||
    (/^\/admin\/referrals\/milestones\/(TIER_5|TIER_10|TIER_20)$/.test(path) && req.method === 'PATCH') ||
    (/^\/admin\/reward-rules\/[^/]+$/.test(path) && req.method === 'PATCH') ||
    (/^\/admin\/support\/tickets\/[^/]+$/.test(path) && req.method === 'GET') ||
    (/^\/admin\/support\/tickets\/[^/]+\/reply$/.test(path) && req.method === 'POST') ||
    (/^\/admin\/support\/tickets\/[^/]+\/status$/.test(path) && req.method === 'PATCH') ||
    (/^\/withdrawals\/marketplace$/.test(path) && req.method === 'GET') ||
    (/^\/withdrawals\/offers\/[^/]+\/cancel$/.test(path) && req.method === 'POST') ||
    (path === '/deposits/quick-match' && req.method === 'POST') ||
    (/^\/deposits\/orders\/[^/]+$/.test(path) && req.method === 'GET') ||
    (/^\/deposits\/orders\/[^/]+\/(confirm|handoff-attempt|payment-reference|cancel)$/.test(path) && req.method === 'POST') ||
    (/^\/orders\/[^/]+\/dispute$/.test(path) && req.method === 'POST') ||
    (/^\/admin\/p2p\/claims\/[^/]+\/review$/.test(path) && req.method === 'POST') ||
    (/^\/admin\/p2p\/claims\/[^/]+$/.test(path) && req.method === 'GET') ||
    (/^\/admin\/p2p\/claims\/[^/]+\/evidence$/.test(path) && req.method === 'GET') ||
    (/^\/admin\/p2p\/offers\/[^/]+\/cancel$/.test(path) && req.method === 'POST') ||
    (/^\/admin\/users\/[^/]+$/.test(path) && req.method === 'GET') ||
    (/^\/admin\/users\/[^/]+\/wallet\/credits$/.test(path) && req.method === 'GET') ||
    (/^\/admin\/users\/[^/]+\/wallet\/credit$/.test(path) && req.method === 'POST') ||
    (/^\/admin\/wallet\/credits\/requests\/[^/]+\/decision$/.test(path) && req.method === 'POST') ||
    (/^\/admin\/wallet\/funding\/requests\/[^/]+\/decision$/.test(path) && req.method === 'POST') ||
    (/^\/admin\/users\/[^/]+\/status$/.test(path) && req.method === 'POST') ||
    (/^\/admin\/disputes$/.test(path) && req.method === 'GET') ||
    (/^\/admin\/reconciliation\/claims\/[^/]+\/review$/.test(path) && req.method === 'POST') ||
    (/^\/users\/me\/bank-accounts\/[^/]+$/.test(path) && ['PATCH', 'DELETE'].includes(req.method)) ||
    (/^\/users\/me\/bank-accounts\/[^/]+\/verify$/.test(path) && req.method === 'POST') ||
    (/^\/orders\/[^/]+$/.test(path) && req.method === 'GET') ||
    (/^\/orders\/[^/]+\/(reservations|cancel|payment-submission)$/.test(path) && req.method === 'POST') ||
    (/^\/support\/tickets\/[^/]+$/.test(path) && req.method === 'GET');
  if (!known) return res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'The requested API route was not found.' } });
  next();
});
app.use('/api/v1/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Let local demo users repeat OTP requests while iterating. This is only
  // enabled with the fixed demo provider in development; other auth routes
  // and all production requests remain rate limited.
  skip: (req) => (env.isDevelopment || env.isTest) && env.otpProvider === 'demo' && req.path === '/request-otp',
}), authRouter);
// Mount public admin authentication before the authenticated root API routers.
app.use('/api/v1/admin/auth', adminAuthRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1', paymentsRouter);
app.use('/api/v1', p2pRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/support', supportRouter);
app.use('/api/v1/admin', adminRouter);

app.use((_req, res) => res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'The requested API route was not found.' } }));

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Check the request fields.', fields: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })) }, requestId: req.requestId });
  if (error instanceof HttpError || (typeof error?.statusCode === 'number' && typeof error?.code === 'string')) {
    const status = error.statusCode as number; return res.status(status).json({ error: { code: error.code, message: error.message }, requestId: req.requestId });
  }
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'Request body is too large.' } });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
  if (error?.code === 'P2002') return res.status(409).json({ error: { code: 'DUPLICATE_REFERENCE', message: 'This request conflicts with an existing record.' } });
  logger.error({ err: error, requestId: req.requestId }, 'Unhandled API error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' }, requestId: req.requestId });
};
app.use(errorHandler);

export default app;
