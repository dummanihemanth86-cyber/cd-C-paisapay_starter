import { env } from './config/env.js';
import { closeDatabase, prisma } from './lib/db.js';
import { logger } from './lib/logger.js';
import { createFinancialWorkerGate } from './lib/financialWorkerGate.js';
import app from './app.js';
import { expireUnpaidUpiDeposits } from './modules/payments/depositExpiry.js';
import { expireP2pOffersBatch } from './modules/p2p/service.js';
import { runAdminPushOutboxBatch } from './modules/admin/pushNotifications.js';
import { singleFlight } from './lib/singleFlight.js';

const server = app.listen(env.port, env.host, () => {
  logger.info({ host: env.host, port: env.port, databaseConfigured: Boolean(env.databaseUrl), otpProvider: env.otpProvider, paymentProvider: env.paymentProvider }, 'PaisaPay API started');
  if (!env.databaseUrl) logger.warn('DATABASE_URL is not set; /ready and data routes will report the database unavailable.');
  if (env.otpProvider === 'console') logger.warn('Console OTP provider selected, but OTP values are never logged or returned; OTP requests will be unavailable.');
  if (env.otpProvider === 'demo') logger.warn('Development demo OTP provider is active for all valid phone numbers; no SMS is sent and payments must remain disabled.');
});

let p2pExpiryWorkerRunning = false;
const runFinancialWorker = createFinancialWorkerGate(env.financialOperationsEnabled, () => {
  logger.info('Financial background workers are disabled by FINANCIAL_OPERATIONS_ENABLED=false.');
});
async function runP2pExpiryWorker() {
  if (!env.financialOperationsEnabled || !prisma || p2pExpiryWorkerRunning) return;
  p2pExpiryWorkerRunning = true;
  try { await expireP2pOffersBatch(prisma); }
  catch (error) { logger.warn({ err: error }, 'Could not expire old P2P matches and offers'); }
  finally { p2pExpiryWorkerRunning = false; }
}

const runAdminPushWorker = singleFlight(async () => {
  if (!prisma) return;
  try { await runAdminPushOutboxBatch(prisma); }
  catch (error) { logger.warn({ err: error }, 'Could not process admin push notification outbox'); }
});

function runFinancialWorkers() {
  runFinancialWorker(() => {
    if (!prisma) return;
    void expireUnpaidUpiDeposits(prisma).catch((error) => logger.warn({ err: error }, 'Could not expire old unpaid UPI deposits'));
    void runP2pExpiryWorker();
  });
}

runFinancialWorkers();
const depositExpiryTimer = setInterval(() => {
  runFinancialWorkers();
  void runAdminPushWorker();
}, 5_000);
depositExpiryTimer.unref();
void runAdminPushWorker();

async function shutdown(signal: string) {
  logger.info({ signal }, 'Stopping server');
  clearInterval(depositExpiryTimer);
  server.close(async () => { await closeDatabase(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
