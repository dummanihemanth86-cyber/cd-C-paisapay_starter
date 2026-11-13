import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { assertFinancialOperationsEnabled, FINANCIAL_OPERATION_ROUTE_MANIFEST, FINANCIAL_OPERATIONS_DISABLED_CODE, financialOperationsGate } from '../middleware/financialOperations.js';
import { openapi } from '../openapi.js';
import { createWithdrawalOffer, releaseOfferFunds, reserveOfferFunds } from '../modules/p2p/service.js';
import { grantVerifiedP2pOrderReward, grantVerifiedUpiDepositReward } from '../modules/payments/depositReward.js';
import { expireUnpaidUpiDeposits } from '../modules/payments/depositExpiry.js';
import { recordVerifiedReferralCommission } from '../modules/users/referralCommission.js';

describe('financial operations safety gate policy', () => {
  it('defaults to disabled in the test environment and has a stable error code', () => {
    expect(env.financialOperationsEnabled).toBe(false);
    expect(env.walletAdjustmentsEnabled).toBe(false);
    expect(FINANCIAL_OPERATIONS_DISABLED_CODE).toBe('FINANCIAL_OPERATIONS_DISABLED');
  });

  it('passes requests only when explicitly enabled outside the production configuration', async () => {
    const previous = env.financialOperationsEnabled;
    const testApp = express();
    testApp.post('/financial', financialOperationsGate, (_req, res) => res.status(204).end());
    const gateErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    testApp.use(gateErrorHandler);
    try {
      env.financialOperationsEnabled = false;
      const disabled = await request(testApp).post('/financial').expect(503);
      expect(disabled.body.error.code).toBe(FINANCIAL_OPERATIONS_DISABLED_CODE);
      env.financialOperationsEnabled = true;
      await request(testApp).post('/financial').expect(204);
      expect(() => assertFinancialOperationsEnabled()).not.toThrow();
    } finally {
      env.financialOperationsEnabled = previous;
    }
  });

  it('blocks direct financial service calls before any database operation while disabled', async () => {
    const previous = env.financialOperationsEnabled;
    env.financialOperationsEnabled = false;
    let databaseCalls = 0;
    const tx = new Proxy({}, { get: () => { databaseCalls += 1; throw new Error('Database must not be touched while financial operations are disabled.'); } });
    try {
      const expected = { code: FINANCIAL_OPERATIONS_DISABLED_CODE, statusCode: 503 };
      await expect(createWithdrawalOffer({ userId: 'user', amountPaise: 10_000, idempotencyKey: 'test-key-123' })).rejects.toMatchObject(expected);
      await expect(releaseOfferFunds(tx as never, { id: 'offer', userId: 'user', amountPaise: 10_000n }, null, 'P2P_WITHDRAWAL_CANCELLED')).rejects.toMatchObject(expected);
      await expect(reserveOfferFunds(tx as never, { id: 'offer', userId: 'user', amountPaise: 10_000n }, null)).rejects.toMatchObject(expected);
      await expect(expireUnpaidUpiDeposits(tx as never)).rejects.toMatchObject(expected);
      await expect(grantVerifiedUpiDepositReward(tx as never, { depositId: 'deposit', userId: 'user', actorUserId: 'admin', amountPaise: 10_000n })).rejects.toMatchObject(expected);
      await expect(grantVerifiedP2pOrderReward(tx as never, { orderId: 'order', userId: 'user', actorUserId: 'admin', amountPaise: 10_000n })).rejects.toMatchObject(expected);
      await expect(recordVerifiedReferralCommission(tx as never, { sourceReference: 'test', sourceUserId: 'user', actorUserId: 'admin', amountPaise: 10_000n })).rejects.toMatchObject(expected);
      expect(databaseCalls).toBe(0);
    } finally {
      env.financialOperationsEnabled = previous;
    }
  });

  it('rejects production startup when financial operations are explicitly enabled in this provider-disabled build', () => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      APP_ORIGIN: '',
      DATABASE_URL: 'postgresql://test:test@db.example.invalid/paisapay?sslmode=require',
      SESSION_HASH_SECRET: 'a'.repeat(64),
      BANK_ACCOUNT_ENCRYPTION_KEY: 'b'.repeat(64),
      OTP_PROVIDER: 'renflair-v1',
      RENFLAIR_API_KEY: 'test-only-placeholder',
      OTP_RATE_LIMIT_BYPASS_PHONE: '',
      WELCOME_BONUS_ENABLED: 'false',
      UPI_DEPOSIT_REWARD_ENABLED: 'false',
      PAYMENT_PROVIDER: 'disabled',
      FINANCIAL_OPERATIONS_ENABLED: 'true',
      ADMIN_WALLET_PRODUCTION_APPROVED: 'false',
      ADMIN_WALLET_EXTERNAL_RECONCILIATION_VERIFIED: 'false',
      DOTENV_CONFIG_PATH: '.financial-gate-test-no-env-file',
    };
    delete childEnv.DEMO_LOGIN_PHONE_E164;
    delete childEnv.DEMO_LOGIN_PASSWORD;
    delete childEnv.SMS_GATEWAY_URL;
    delete childEnv.SMS_GATEWAY_API_KEY;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', 'await import("./src/config/env.ts")'], { cwd: process.cwd(), env: childEnv, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('FINANCIAL_OPERATIONS_ENABLED cannot be enabled in production');
  });

  it('rejects production startup when private wallet adjustments are explicitly enabled', () => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: 'production', APP_ORIGIN: '',
      DATABASE_URL: 'postgresql://test:test@db.example.invalid/paisapay?sslmode=require',
      SESSION_HASH_SECRET: 'a'.repeat(64), BANK_ACCOUNT_ENCRYPTION_KEY: 'b'.repeat(64),
      OTP_PROVIDER: 'renflair-v1', RENFLAIR_API_KEY: 'test-only-placeholder',
      OTP_RATE_LIMIT_BYPASS_PHONE: '', WELCOME_BONUS_ENABLED: 'false', UPI_DEPOSIT_REWARD_ENABLED: 'false',
      PAYMENT_PROVIDER: 'disabled', FINANCIAL_OPERATIONS_ENABLED: 'false', WALLET_ADJUSTMENTS_ENABLED: 'true',
      DOTENV_CONFIG_PATH: '.financial-gate-test-no-env-file',
    };
    delete childEnv.DEMO_LOGIN_PHONE_E164;
    delete childEnv.DEMO_LOGIN_PASSWORD;
    delete childEnv.SMS_GATEWAY_URL;
    delete childEnv.SMS_GATEWAY_API_KEY;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', 'await import("./src/config/env.ts")'], { cwd: process.cwd(), env: childEnv, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Production Admin wallet gates require the complete gate bundle');
  });

  it.each(['ADMIN_WALLET_FUNDING_ENABLED', 'ADMIN_WALLET_CREDITS_ENABLED'])('rejects production startup when %s is enabled by itself', (featureFlag) => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: 'production', APP_ORIGIN: '',
      DATABASE_URL: 'postgresql://test:test@db.example.invalid/paisapay?sslmode=require',
      SESSION_HASH_SECRET: 'a'.repeat(64), BANK_ACCOUNT_ENCRYPTION_KEY: 'b'.repeat(64),
      OTP_PROVIDER: 'renflair-v1', RENFLAIR_API_KEY: 'test-only-placeholder', OTP_RATE_LIMIT_BYPASS_PHONE: '',
      WELCOME_BONUS_ENABLED: 'false', UPI_DEPOSIT_REWARD_ENABLED: 'false', PAYMENT_PROVIDER: 'disabled',
      FINANCIAL_OPERATIONS_ENABLED: 'false', WALLET_ADJUSTMENTS_ENABLED: 'false',
      ADMIN_WALLET_PRODUCTION_APPROVED: 'false',
      ADMIN_WALLET_EXTERNAL_RECONCILIATION_VERIFIED: 'false',
      ADMIN_WALLET_FUNDING_ENABLED: featureFlag === 'ADMIN_WALLET_FUNDING_ENABLED' ? 'true' : 'false',
      ADMIN_WALLET_CREDITS_ENABLED: featureFlag === 'ADMIN_WALLET_CREDITS_ENABLED' ? 'true' : 'false',
      DOTENV_CONFIG_PATH: '.financial-gate-test-no-env-file',
    };
    delete childEnv.DEMO_LOGIN_PHONE_E164;
    delete childEnv.DEMO_LOGIN_PASSWORD;
    delete childEnv.SMS_GATEWAY_URL;
    delete childEnv.SMS_GATEWAY_API_KEY;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', 'await import("./src/config/env.ts")'], { cwd: process.cwd(), env: childEnv, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Production Admin wallet gates require the complete gate bundle');
  });

  it('allows only the explicitly approved dedicated Admin wallet gate bundle while global financial operations remain disabled', () => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: 'production', APP_ORIGIN: '',
      DATABASE_URL: 'postgresql://test:test@db.example.invalid/paisapay?sslmode=require',
      SESSION_HASH_SECRET: 'a'.repeat(64), BANK_ACCOUNT_ENCRYPTION_KEY: 'b'.repeat(64),
      OTP_PROVIDER: 'renflair-v1', RENFLAIR_API_KEY: 'test-only-placeholder', OTP_RATE_LIMIT_BYPASS_PHONE: '',
      WELCOME_BONUS_ENABLED: 'false', UPI_DEPOSIT_REWARD_ENABLED: 'false', PAYMENT_PROVIDER: 'disabled',
      FINANCIAL_OPERATIONS_ENABLED: 'false', WALLET_ADJUSTMENTS_ENABLED: 'true',
      ADMIN_WALLET_FUNDING_ENABLED: 'true', ADMIN_WALLET_CREDITS_ENABLED: 'true', ADMIN_WALLET_PRODUCTION_APPROVED: 'true', ADMIN_WALLET_EXTERNAL_RECONCILIATION_VERIFIED: 'true',
      DOTENV_CONFIG_PATH: '.financial-gate-test-no-env-file',
    };
    delete childEnv.DEMO_LOGIN_PHONE_E164;
    delete childEnv.DEMO_LOGIN_PASSWORD;
    delete childEnv.SMS_GATEWAY_URL;
    delete childEnv.SMS_GATEWAY_API_KEY;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', 'await import("./src/config/env.ts")'], { cwd: process.cwd(), env: childEnv, encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it('rejects the complete production wallet gate bundle until external bank reconciliation is attested', () => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: 'production', APP_ORIGIN: '',
      DATABASE_URL: 'postgresql://test:test@db.example.invalid/paisapay?sslmode=require',
      SESSION_HASH_SECRET: 'a'.repeat(64), BANK_ACCOUNT_ENCRYPTION_KEY: 'b'.repeat(64),
      OTP_PROVIDER: 'renflair-v1', RENFLAIR_API_KEY: 'test-only-placeholder', OTP_RATE_LIMIT_BYPASS_PHONE: '',
      WELCOME_BONUS_ENABLED: 'false', UPI_DEPOSIT_REWARD_ENABLED: 'false', PAYMENT_PROVIDER: 'disabled',
      FINANCIAL_OPERATIONS_ENABLED: 'false', WALLET_ADJUSTMENTS_ENABLED: 'true',
      ADMIN_WALLET_FUNDING_ENABLED: 'true', ADMIN_WALLET_CREDITS_ENABLED: 'true',
      ADMIN_WALLET_PRODUCTION_APPROVED: 'true', ADMIN_WALLET_EXTERNAL_RECONCILIATION_VERIFIED: 'false',
      DOTENV_CONFIG_PATH: '.financial-gate-test-no-env-file',
    };
    delete childEnv.DEMO_LOGIN_PHONE_E164;
    delete childEnv.DEMO_LOGIN_PASSWORD;
    delete childEnv.SMS_GATEWAY_URL;
    delete childEnv.SMS_GATEWAY_API_KEY;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', 'await import("./src/config/env.ts")'], { cwd: process.cwd(), env: childEnv, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('external bank reconciliation attestation');
  });

  it('covers only real route declarations and documents their disabled 503 response', () => {
    const routers: Array<{ file: string; mounts: Record<string, string> }> = [
      { file: '../modules/payments/routes.ts', mounts: { paymentsRouter: '/api/v1' } },
      { file: '../modules/p2p/routes.ts', mounts: { p2pRouter: '/api/v1' } },
      { file: '../modules/orders/routes.ts', mounts: { ordersRouter: '/api/v1/orders' } },
      { file: '../modules/support/routes.ts', mounts: { withdrawalsRouter: '/api/v1/withdrawals' } },
      { file: '../modules/admin/routes.ts', mounts: { adminRouter: '/api/v1/admin' } },
      { file: '../app.ts', mounts: { app: '' } },
    ];
    const declared = new Set<string>();
    for (const { file, mounts } of routers) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const [router, base] of Object.entries(mounts)) {
        const pattern = new RegExp(String.raw`\b${router}\.(get|post|put|patch|delete)\((?:'([^']*)'|"([^"]*)")`, 'g');
        for (const match of source.matchAll(pattern)) {
          const path = `${base}${match[2] ?? match[3]}`.replace(/\/$/, '');
          declared.add(`${match[1].toUpperCase()} ${path}`);
        }
      }
    }

    const missingDeclarations = FINANCIAL_OPERATION_ROUTE_MANIFEST.filter(([method, path]) => !declared.has(`${method} ${path}`));
    expect(missingDeclarations).toEqual([]);

    const p2pSource = readFileSync(new URL('../modules/p2p/routes.ts', import.meta.url), 'utf8');
    const p2pPattern = /\bp2pRouter\.(get|post|put|patch|delete)\((?:'([^']*)'|"([^"]*)")/g;
    const explicitlyReadOnlyRoutes = new Set([
      'GET /admin/p2p/offers', 'GET /admin/p2p/orders',
      'GET /withdrawals', 'GET /withdrawals/marketplace',
      'GET /deposits/orders/my', 'GET /deposits/orders/:id',
    ]);
    for (const match of p2pSource.matchAll(p2pPattern)) {
      const method = match[1].toUpperCase();
      const path = match[2] ?? match[3];
      if (explicitlyReadOnlyRoutes.has(`${method} ${path}`)) continue;
      expect(FINANCIAL_OPERATION_ROUTE_MANIFEST).toContainEqual([method, `/api/v1${path}`]);
    }

    for (const [method, fullPath] of FINANCIAL_OPERATION_ROUTE_MANIFEST) {
      const path = fullPath.replace(/^\/api\/v1/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const operation = openapi.paths[path]?.[method.toLowerCase()];
      expect(operation, `${method} ${path}`).toBeDefined();
      expect(operation?.responses['503']?.content?.['application/json']?.schema).toEqual({ $ref: '#/components/schemas/ApiError' });
    }
  });

  it('does not gate the ordinary profile, notification, support, or public configuration routes', () => {
    const nonFinancial = [
      ['get', '/config'], ['get', '/users/me'], ['get', '/notifications'], ['get', '/support/tickets'],
      ['get', '/withdrawals'], ['get', '/withdrawals/marketplace'],
      ['get', '/deposits/orders/my'], ['get', '/deposits/orders/:id'],
      ['get', '/orders'], ['get', '/orders/:id'],
    ] as const;
    for (const [method, path] of nonFinancial) {
      expect(FINANCIAL_OPERATION_ROUTE_MANIFEST.some(([gatedMethod, gatedPath]) => gatedMethod.toLowerCase() === method && gatedPath.endsWith(path))).toBe(false);
    }
  });
});
