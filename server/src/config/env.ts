import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  APP_ORIGIN: z.string().default(''),
  DEPOSIT_RECEIVER_UPI_ID: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,48}@[A-Za-z0-9][A-Za-z0-9.-]{1,48}$/).optional(),
  ),
  MIN_DEPOSIT_PAISE: z.coerce.number().int().positive().default(1000),
  MAX_DEPOSIT_PAISE: z.coerce.number().int().positive().default(1_000_000),
  P2P_WITHDRAWAL_OFFER_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  EXPO_PUSH_ACCESS_TOKEN: z.string().trim().min(1).max(512).optional(),
  UPI_DEPOSIT_REWARD_PERCENT_BPS: z.coerce.number().int().min(0).max(10_000).default(1_700),
  UPI_DEPOSIT_REWARD_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  UPI_DEPOSIT_REWARD_FUNDING_SOURCE: z.string().trim().default(''),
  DATABASE_URL: z.string().optional(),
  SESSION_HASH_SECRET: z.string().min(32).optional(),
  BANK_ACCOUNT_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  OTP_PROVIDER: z.enum(['console', 'disabled', 'twilio', 'android-gateway', 'renflair-v1', 'demo']).default('disabled'),
  OTP_API_KEY: z.string().optional(),
  OTP_RATE_LIMIT_BYPASS_PHONE: z.string().default('').refine((value) => value === '' || /^\+[1-9]\d{7,14}$/.test(value), 'Use an E.164 phone number or leave this setting empty.'),
  DEMO_LOGIN_PHONE_E164: z.string().optional().refine((value) => !value || /^\+[1-9]\d{7,14}$/.test(value), 'Use an E.164 demo phone number.'),
  DEMO_LOGIN_PASSWORD: z.string().min(4).max(128).optional(),
  SMS_GATEWAY_URL: z.string().url().optional(),
  SMS_GATEWAY_API_KEY: z.string().min(1).optional(),
  SMS_GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(500).max(15000).default(5000),
  RENFLAIR_V1_API_URL: z.string().url().default('https://sms.renflair.in/V1.php'),
  RENFLAIR_API_KEY: z.string().optional(),
  PAYMENT_PROVIDER: z.enum(['disabled', 'sandbox', 'cashfree-sandbox']).default('disabled'),
  FINANCIAL_OPERATIONS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  WALLET_ADJUSTMENTS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  WALLET_ADJUSTMENT_ADMIN_USER_ID: z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, z.string().uuid().optional()),
  CASHFREE_CLIENT_ID: z.string().optional(),
  CASHFREE_CLIENT_SECRET: z.string().optional(),
  CASHFREE_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-01-01'),
  PAYMENT_MERCHANT_ID: z.string().optional(),
  PAYMENT_SECRET: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  WELCOME_BONUS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  WELCOME_BONUS_AMOUNT_PAISE: z.coerce.number().int().positive().default(9900),
  WELCOME_BONUS_FUNDING_SOURCE: z.string().trim().default(''),
  WELCOME_BONUS_TEST_FUND_PAISE: z.coerce.number().int().nonnegative().default(0),
  ADMIN_BOOTSTRAP_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid server configuration: ${issues}`);
}

const values = parsed.data;
if (Math.min(values.MAX_DEPOSIT_PAISE, 1_000_000) < values.MIN_DEPOSIT_PAISE) throw new Error('MIN_DEPOSIT_PAISE must not exceed the ₹10,000 deposit cap or MAX_DEPOSIT_PAISE.');
if (Boolean(values.SMS_GATEWAY_URL) !== Boolean(values.SMS_GATEWAY_API_KEY)) {
  throw new Error('SMS_GATEWAY_URL and SMS_GATEWAY_API_KEY must either both be configured or both be empty.');
}
if (values.OTP_PROVIDER === 'android-gateway' && (!values.SMS_GATEWAY_URL || !values.SMS_GATEWAY_API_KEY)) {
  throw new Error('OTP_PROVIDER=android-gateway requires SMS_GATEWAY_URL and SMS_GATEWAY_API_KEY.');
}
if (values.OTP_PROVIDER === 'demo' && !['development', 'test'].includes(values.NODE_ENV)) {
  throw new Error('OTP_PROVIDER=demo is permitted only in automated tests.');
}
if (values.OTP_PROVIDER === 'demo' && values.NODE_ENV !== 'test') {
  throw new Error('OTP_PROVIDER=demo is disabled outside automated tests.');
}
if (values.OTP_PROVIDER === 'demo' && !['disabled', 'cashfree-sandbox'].includes(values.PAYMENT_PROVIDER)) {
  throw new Error('OTP_PROVIDER=demo may be used only with payments disabled or the non-redeemable Cashfree sandbox.');
}
if (Boolean(values.DEMO_LOGIN_PHONE_E164) !== Boolean(values.DEMO_LOGIN_PASSWORD)) {
  throw new Error('DEMO_LOGIN_PHONE_E164 and DEMO_LOGIN_PASSWORD must either both be configured or both be empty.');
}
if (values.OTP_PROVIDER === 'renflair-v1' && !values.RENFLAIR_API_KEY) {
  throw new Error('OTP_PROVIDER=renflair-v1 requires RENFLAIR_API_KEY.');
}
const renflairUrl = new URL(values.RENFLAIR_V1_API_URL);
if (renflairUrl.protocol !== 'https:' || renflairUrl.hostname !== 'sms.renflair.in' || renflairUrl.pathname !== '/V1.php' || renflairUrl.username || renflairUrl.password || renflairUrl.search || renflairUrl.hash) {
  throw new Error('RENFLAIR_V1_API_URL must be https://sms.renflair.in/V1.php without credentials, query parameters, or a fragment.');
}
if (Boolean(values.CASHFREE_CLIENT_ID) !== Boolean(values.CASHFREE_CLIENT_SECRET)) {
  throw new Error('CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET must either both be configured or both be empty.');
}
if (values.PAYMENT_PROVIDER === 'cashfree-sandbox' && (!values.CASHFREE_CLIENT_ID || !values.CASHFREE_CLIENT_SECRET)) {
  throw new Error('PAYMENT_PROVIDER=cashfree-sandbox requires Cashfree sandbox credentials.');
}
if (values.PAYMENT_PROVIDER === 'cashfree-sandbox' && values.NODE_ENV === 'production') {
  throw new Error('Cashfree sandbox cannot be enabled in production.');
}
if ((values.DEMO_LOGIN_PHONE_E164 || values.DEMO_LOGIN_PASSWORD) && (values.NODE_ENV !== 'test' || values.OTP_PROVIDER !== 'demo' || !['disabled', 'cashfree-sandbox'].includes(values.PAYMENT_PROVIDER))) {
  throw new Error('Demo password login is permitted only in automated tests.');
}
if (values.OTP_RATE_LIMIT_BYPASS_PHONE && values.NODE_ENV === 'production') {
  throw new Error('OTP_RATE_LIMIT_BYPASS_PHONE is development-only and must be empty in production.');
}
if (values.SMS_GATEWAY_URL) {
  const gatewayUrl = new URL(values.SMS_GATEWAY_URL);
  if (gatewayUrl.username || gatewayUrl.password || gatewayUrl.search || gatewayUrl.hash || !['http:', 'https:'].includes(gatewayUrl.protocol)) {
    throw new Error('SMS_GATEWAY_URL must be an HTTP(S) base URL without credentials, query parameters, or a fragment.');
  }
}
if (values.NODE_ENV === 'production') {
  const missing = [
    !values.DATABASE_URL && 'DATABASE_URL',
    !values.SESSION_HASH_SECRET && 'SESSION_HASH_SECRET',
    !values.BANK_ACCOUNT_ENCRYPTION_KEY && 'BANK_ACCOUNT_ENCRYPTION_KEY',
    values.OTP_PROVIDER !== 'renflair-v1' && 'OTP_PROVIDER=renflair-v1 (live OTP delivery is required)',
    values.OTP_PROVIDER === 'console' && 'OTP_PROVIDER (console is development-only)',
    values.OTP_PROVIDER === 'twilio' && !values.OTP_API_KEY && 'OTP_API_KEY',
    values.OTP_PROVIDER === 'renflair-v1' && !values.RENFLAIR_API_KEY && 'RENFLAIR_API_KEY',
    values.SMS_GATEWAY_URL && 'SMS_GATEWAY_URL (the Android LAN gateway is development-only)',
  ].filter(Boolean);
  if (missing.length) throw new Error(`Production configuration is incomplete: ${missing.join(', ')}`);
  if (values.SESSION_HASH_SECRET?.toLowerCase().includes('replace-with-')) throw new Error('SESSION_HASH_SECRET still contains the example placeholder. Generate a private random value before production startup.');
  if (values.DATABASE_URL?.includes('CHANGE_ME')) throw new Error('DATABASE_URL still contains the example password placeholder. Configure private database credentials before production startup.');
  if (values.DATABASE_URL) {
    let databaseUrl: URL;
    try { databaseUrl = new URL(values.DATABASE_URL); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.'); }
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) {
      throw new Error('Production DATABASE_URL must point to a remote PostgreSQL service, not localhost.');
    }
    if (!['require', 'verify-full'].includes(databaseUrl.searchParams.get('sslmode') ?? '')) {
      throw new Error('Production DATABASE_URL must enable TLS with sslmode=require or sslmode=verify-full.');
    }
  }
  const productionOrigins = values.APP_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (productionOrigins.some((origin) => {
    try { const parsedOrigin = new URL(origin); return parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin; }
    catch { return true; }
  })) throw new Error('Every production APP_ORIGIN must be an HTTPS origin without a path or trailing slash.');
  if (values.OTP_PROVIDER !== 'renflair-v1') throw new Error('Production requires the configured Renflair V1 OTP provider; no other live OTP adapter is implemented.');
  if (values.PAYMENT_PROVIDER !== 'disabled') throw new Error('No production payment provider adapter is implemented in this build. Keep payments disabled until one is approved and implemented.');
  if (values.FINANCIAL_OPERATIONS_ENABLED) throw new Error('FINANCIAL_OPERATIONS_ENABLED cannot be enabled in production until an authorized payment and payout provider is implemented and independently verified.');
  if (values.WALLET_ADJUSTMENTS_ENABLED) throw new Error('WALLET_ADJUSTMENTS_ENABLED cannot be enabled in production until financial controls and adjustment funding are approved.');
  if (values.WELCOME_BONUS_ENABLED) throw new Error('WELCOME_BONUS_ENABLED is development-only in this build. Production promotional funding and terms have not been approved.');
}
if (values.WELCOME_BONUS_ENABLED && !['development', 'test'].includes(values.NODE_ENV)) {
  throw new Error('WELCOME_BONUS_ENABLED is permitted only in development or test environments.');
}
if (values.WELCOME_BONUS_ENABLED && (values.WELCOME_BONUS_AMOUNT_PAISE !== 9900 || values.WELCOME_BONUS_FUNDING_SOURCE !== 'DEVELOPMENT_TEST_FUND' || values.WELCOME_BONUS_TEST_FUND_PAISE < values.WELCOME_BONUS_AMOUNT_PAISE)) {
  throw new Error('Enabled development welcome bonus requires amount 9900 paise, WELCOME_BONUS_FUNDING_SOURCE=DEVELOPMENT_TEST_FUND, and a test fund of at least 9900 paise.');
}
if (values.UPI_DEPOSIT_REWARD_ENABLED && !['development', 'test'].includes(values.NODE_ENV)) {
  throw new Error('UPI_DEPOSIT_REWARD_ENABLED is permitted only in development or test environments.');
}
if (values.UPI_DEPOSIT_REWARD_ENABLED && (values.UPI_DEPOSIT_REWARD_PERCENT_BPS <= 0 || values.UPI_DEPOSIT_REWARD_FUNDING_SOURCE !== 'DEVELOPMENT_TEST_FUND')) {
  throw new Error('Enabled UPI deposit rewards require a positive percentage and UPI_DEPOSIT_REWARD_FUNDING_SOURCE=DEVELOPMENT_TEST_FUND.');
}

export const env = {
  nodeEnv: values.NODE_ENV,
  port: values.PORT,
  host: values.HOST,
  appOrigins: values.APP_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
  depositReceiverUpiId: values.DEPOSIT_RECEIVER_UPI_ID,
  minDepositPaise: values.MIN_DEPOSIT_PAISE,
  // Cap configured deposits at ₹10,000; deployment config may choose a lower limit.
  maxDepositPaise: Math.min(values.MAX_DEPOSIT_PAISE, 1_000_000),
  p2pWithdrawalOfferTtlMinutes: values.P2P_WITHDRAWAL_OFFER_TTL_MINUTES,
  expoPushAccessToken: values.EXPO_PUSH_ACCESS_TOKEN,
  upiDepositRewardPercentBps: values.UPI_DEPOSIT_REWARD_PERCENT_BPS,
  upiDepositRewardEnabled: values.UPI_DEPOSIT_REWARD_ENABLED,
  upiDepositRewardFundingSource: values.UPI_DEPOSIT_REWARD_FUNDING_SOURCE,
  databaseUrl: values.DATABASE_URL,
  sessionHashSecret: values.SESSION_HASH_SECRET ?? (values.NODE_ENV === 'test' ? 'test-session-hash-secret-at-least-32-chars' : randomBytes(32).toString('hex')),
  bankAccountEncryptionKey: values.BANK_ACCOUNT_ENCRYPTION_KEY,
  otpProvider: values.OTP_PROVIDER,
  otpApiKey: values.OTP_API_KEY,
  otpRateLimitBypassPhone: values.OTP_RATE_LIMIT_BYPASS_PHONE || undefined,
  demoLoginPhoneE164: values.DEMO_LOGIN_PHONE_E164,
  demoLoginPassword: values.DEMO_LOGIN_PASSWORD,
  smsGatewayUrl: values.SMS_GATEWAY_URL?.replace(/\/$/, ''),
  smsGatewayApiKey: values.SMS_GATEWAY_API_KEY,
  smsGatewayTimeoutMs: values.SMS_GATEWAY_TIMEOUT_MS,
  smsGatewayConfigured: Boolean(values.SMS_GATEWAY_URL && values.SMS_GATEWAY_API_KEY),
  renflairV1ApiUrl: values.RENFLAIR_V1_API_URL,
  renflairApiKey: values.RENFLAIR_API_KEY,
  renflairConfigured: Boolean(values.RENFLAIR_API_KEY),
  paymentProvider: values.PAYMENT_PROVIDER,
  financialOperationsEnabled: values.FINANCIAL_OPERATIONS_ENABLED,
  walletAdjustmentsEnabled: values.WALLET_ADJUSTMENTS_ENABLED,
  walletAdjustmentAdminUserId: values.WALLET_ADJUSTMENT_ADMIN_USER_ID,
  cashfreeClientId: values.CASHFREE_CLIENT_ID,
  cashfreeClientSecret: values.CASHFREE_CLIENT_SECRET,
  cashfreeApiVersion: values.CASHFREE_API_VERSION,
  cashfreeConfigured: Boolean(values.CASHFREE_CLIENT_ID && values.CASHFREE_CLIENT_SECRET),
  paymentMerchantId: values.PAYMENT_MERCHANT_ID,
  paymentSecret: values.PAYMENT_SECRET,
  paymentWebhookSecret: values.PAYMENT_WEBHOOK_SECRET,
  welcomeBonusEnabled: values.WELCOME_BONUS_ENABLED,
  welcomeBonusAmountPaise: values.WELCOME_BONUS_AMOUNT_PAISE,
  welcomeBonusFundingSource: values.WELCOME_BONUS_FUNDING_SOURCE,
  welcomeBonusTestFundPaise: values.WELCOME_BONUS_TEST_FUND_PAISE,
  adminBootstrapSecret: values.ADMIN_BOOTSTRAP_SECRET,
  isDevelopment: values.NODE_ENV === 'development',
  isTest: values.NODE_ENV === 'test',
  isProduction: values.NODE_ENV === 'production',
};
