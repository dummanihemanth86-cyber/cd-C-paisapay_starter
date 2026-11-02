import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { DEVELOPMENT_REWARD_FUND_ACCOUNT_ID, DEVELOPMENT_SETTLEMENT_ACCOUNT_ID } from '../src/modules/users/welcomeBonus.js';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running the development seed.');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  // These are configuration values only; this seed creates no users or financial records.
  for (const [method, buyEnabled, sellEnabled] of [
    ['MOBIKWIK', true, true], ['PAYTM', true, true], ['PHONEPE', false, true], ['NAVI', false, true], ['CASHFREE', false, false],
  ] as const) {
    await prisma.paymentMethodConfiguration.upsert({ where: { method }, create: { method, buyEnabled, sellEnabled, providerApproved: false, enabled: false }, update: { buyEnabled, sellEnabled, providerApproved: false, enabled: false } });
  }
  if (process.env.WELCOME_BONUS_ENABLED === 'true') {
    if (process.env.NODE_ENV === 'production') throw new Error('Development bonus seed is prohibited in production.');
    if (process.env.WELCOME_BONUS_FUNDING_SOURCE !== 'DEVELOPMENT_TEST_FUND') throw new Error('Set WELCOME_BONUS_FUNDING_SOURCE=DEVELOPMENT_TEST_FUND to seed the local test pool.');
    const amountPaise = Number(process.env.WELCOME_BONUS_TEST_FUND_PAISE ?? 0);
    const bonusAmountPaise = Number(process.env.WELCOME_BONUS_AMOUNT_PAISE ?? 9900);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < bonusAmountPaise || !Number.isSafeInteger(bonusAmountPaise) || bonusAmountPaise !== 9900) {
      throw new Error('Development test pool must be a whole-paise amount of at least 9900, and welcome bonus must be 9900 paise.');
    }
    await prisma.ledgerAccount.upsert({ where: { id: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID }, create: { id: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID, type: 'REWARD_FUND', currency: 'INR' }, update: {} });
    await prisma.ledgerAccount.upsert({ where: { id: DEVELOPMENT_SETTLEMENT_ACCOUNT_ID }, create: { id: DEVELOPMENT_SETTLEMENT_ACCOUNT_ID, type: 'SETTLEMENT_CASH', currency: 'INR' }, update: {} });
    const fundingKey = 'DEV_TEST_WELCOME_BONUS_FUNDING_V1';
    if (!(await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: fundingKey }, select: { id: true } }))) {
      await prisma.ledgerTransaction.create({ data: {
        eventType: 'DEVELOPMENT_TEST_FUNDING', referenceType: 'CONFIGURATION', referenceId: 'WELCOME_BONUS_TEST_POOL', idempotencyKey: fundingKey,
        metadata: { amountPaise, currency: 'INR', source: 'DEVELOPMENT_TEST_FUND', developmentOnly: true, notRedeemable: true },
        entries: { create: [
          { accountId: DEVELOPMENT_SETTLEMENT_ACCOUNT_ID, debitPaise: BigInt(amountPaise) },
          { accountId: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID, creditPaise: BigInt(amountPaise) },
        ] },
      } });
    }
  }
  console.info(process.env.WELCOME_BONUS_ENABLED === 'true'
    ? 'Seeded payment settings and a labelled non-redeemable development test reward pool. This is not real money.'
    : 'Seeded payment-method configuration only. No user or financial records were created.');
} finally { await prisma.$disconnect(); }
