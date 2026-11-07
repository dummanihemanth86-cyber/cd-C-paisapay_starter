import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const productionEnvironment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    APP_ORIGIN: '',
    DATABASE_URL: 'postgresql://dpg-stage.internal/paisapay_staging?sslmode=require',
    SESSION_HASH_SECRET: 's'.repeat(48),
    BANK_ACCOUNT_ENCRYPTION_KEY: 'a'.repeat(64),
    OTP_PROVIDER: 'renflair-v1',
    RENFLAIR_API_KEY: 'test-only-placeholder',
    OTP_RATE_LIMIT_BYPASS_PHONE: '',
    WELCOME_BONUS_ENABLED: 'false',
    UPI_DEPOSIT_REWARD_ENABLED: 'false',
    PAYMENT_PROVIDER: 'disabled',
    FINANCIAL_OPERATIONS_ENABLED: 'false',
    WALLET_ADJUSTMENTS_ENABLED: 'false',
    ADMIN_WALLET_FUNDING_ENABLED: 'false',
    ADMIN_WALLET_CREDITS_ENABLED: 'false',
    ADMIN_WALLET_PRODUCTION_APPROVED: 'false',
    ADMIN_WALLET_EXTERNAL_RECONCILIATION_VERIFIED: 'false',
    DOTENV_CONFIG_PATH: '.database-tls-test-no-env-file',
    ...overrides,
  };
  for (const name of [
    'DEMO_LOGIN_PHONE_E164', 'DEMO_LOGIN_PASSWORD', 'SMS_GATEWAY_URL', 'SMS_GATEWAY_API_KEY',
    'CASHFREE_CLIENT_ID', 'CASHFREE_CLIENT_SECRET', 'PAYMENT_MERCHANT_ID', 'PAYMENT_SECRET',
    'PAYMENT_WEBHOOK_SECRET', 'ADMIN_BOOTSTRAP_SECRET',
  ]) delete childEnv[name];
  return childEnv;
};

const loadProductionConfiguration = (overrides: NodeJS.ProcessEnv = {}) => spawnSync(
  process.execPath,
  ['--import', 'tsx', '--input-type=module', '-e', 'await import("./src/config/env.ts")'],
  { cwd: process.cwd(), env: productionEnvironment(overrides), encoding: 'utf8' },
);

const loadPrismaMigrationConfiguration = (overrides: NodeJS.ProcessEnv = {}, expression = 'await import("./prisma.config.ts")') => spawnSync(
  process.execPath,
  ['--import', 'tsx', '--input-type=module', '-e', expression],
  { cwd: process.cwd(), env: productionEnvironment(overrides), encoding: 'utf8' },
);

describe('production PostgreSQL TLS configuration', () => {
  it.each(['require', 'verify-full'])('accepts sslmode=%s for Render internal runtime and migration URLs', (sslmode) => {
    const result = loadProductionConfiguration({
      DATABASE_URL: `postgresql://dpg-stage.internal/paisapay_staging?application_name=api&sslmode=${sslmode}`,
      DIRECT_DATABASE_URL: `postgresql://dpg-stage.internal/paisapay_staging?sslmode=${sslmode}`,
      DATABASE_URL_UNPOOLED: `postgresql://dpg-stage.internal/paisapay_staging?sslmode=${sslmode}`,
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects a runtime URL without an explicit TLS mode', () => {
    const result = loadProductionConfiguration({
      DATABASE_URL: 'postgresql://dpg-stage.internal/paisapay_staging',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DATABASE_URL must enable TLS');
  });

  it.each([
    ['DIRECT_DATABASE_URL', 'DIRECT_DATABASE_URL'],
    ['DATABASE_URL_UNPOOLED', 'DATABASE_URL_UNPOOLED'],
  ])('rejects %s when it would use sslmode=disable for migrations', (variableName, expectedName) => {
    const result = loadProductionConfiguration({
      [variableName]: 'postgresql://dpg-stage.internal/paisapay_staging?sslmode=disable',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${expectedName} must enable TLS`);
  });

  it('uses the first non-empty direct, unpooled, or runtime URL for Prisma migrations', () => {
    const result = loadPrismaMigrationConfiguration({
      DATABASE_URL: 'postgresql://runtime.internal/paisapay_staging?sslmode=require',
      DATABASE_URL_UNPOOLED: 'postgresql://unpooled.internal/paisapay_staging?sslmode=require',
      DIRECT_DATABASE_URL: 'postgresql://direct.internal/paisapay_staging?sslmode=require',
    }, 'const config = await import("./prisma.config.ts"); console.log(new URL(config.default.datasource.url).hostname)');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('direct.internal');
  }, 20_000);

  it('blocks Prisma migration when its selected direct URL lacks TLS', () => {
    const result = loadPrismaMigrationConfiguration({
      DIRECT_DATABASE_URL: 'postgresql://direct.internal/paisapay_staging?sslmode=disable',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DIRECT_DATABASE_URL must enable TLS');
  });
});
