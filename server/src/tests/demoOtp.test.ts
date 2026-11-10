import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/db.js';
import { hashOtp, hashToken } from '../lib/security.js';
import { DEVELOPMENT_REWARD_FUND_ACCOUNT_ID, DEVELOPMENT_SETTLEMENT_ACCOUNT_ID } from '../modules/users/welcomeBonus.js';

const integration = describe.skipIf(!prisma);

integration('development demo OTP mode (PostgreSQL integration)', () => {
  const db = prisma!;
  const previousProvider = env.otpProvider;
  const previousBonusEnabled = env.welcomeBonusEnabled;
  const previousFinancialOperationsEnabled = env.financialOperationsEnabled;
  const previousDemoPhone = env.demoLoginPhoneE164;
  const previousDemoPassword = env.demoLoginPassword;
  const previousDepositReceiver = env.depositReceiverUpiId;
  const fundingKey = `TEST_WELCOME_BONUS_FUNDING:${randomUUID()}`;
  const testPhones: string[] = [];

  beforeAll(async () => {
    if (!db) return;
    await db.$connect();
    env.otpProvider = 'demo';
    env.financialOperationsEnabled = true;
    env.depositReceiverUpiId = 'test-only@okaxis';
    env.welcomeBonusEnabled = true;
    await db.ledgerAccount.upsert({ where: { id: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID }, create: { id: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID, type: 'REWARD_FUND', currency: 'INR' }, update: {} });
    await db.ledgerAccount.upsert({ where: { id: DEVELOPMENT_SETTLEMENT_ACCOUNT_ID }, create: { id: DEVELOPMENT_SETTLEMENT_ACCOUNT_ID, type: 'SETTLEMENT_CASH', currency: 'INR' }, update: {} });
    if (!(await db.ledgerTransaction.findUnique({ where: { idempotencyKey: fundingKey } }))) {
      await db.ledgerTransaction.create({ data: {
        eventType: 'DEVELOPMENT_TEST_FUNDING', referenceType: 'TEST', referenceId: fundingKey, idempotencyKey: fundingKey,
        metadata: { amountPaise: 990000, developmentOnly: true, notRedeemable: true },
        entries: { create: [
          { accountId: DEVELOPMENT_SETTLEMENT_ACCOUNT_ID, debitPaise: 990000n },
          { accountId: DEVELOPMENT_REWARD_FUND_ACCOUNT_ID, creditPaise: 990000n },
        ] },
      } });
    }
  });

  function newPhone() {
    const phone = `+919${randomInt(0, 1_000_000_000).toString().padStart(9, '0')}`;
    testPhones.push(phone);
    return phone;
  }

  afterAll(async () => {
    vi.unstubAllGlobals();
    env.otpProvider = previousProvider;
    env.welcomeBonusEnabled = previousBonusEnabled;
    env.financialOperationsEnabled = previousFinancialOperationsEnabled;
    env.demoLoginPhoneE164 = previousDemoPhone;
    env.demoLoginPassword = previousDemoPassword;
    env.depositReceiverUpiId = previousDepositReceiver;
    const users = await db.user.findMany({ where: { phoneE164: { in: testPhones } }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    await db.$transaction(async (tx) => {
      await tx.otpChallenge.deleteMany({ where: { phoneE164: { in: testPhones } } });
      if (userIds.length) {
        await tx.referral.deleteMany({ where: { OR: [{ referrerId: { in: userIds } }, { inviteeId: { in: userIds } }] } });
        const bonusKeys = userIds.map((userId) => `WELCOME_BONUS:${userId}`);
        await tx.ledgerEntry.deleteMany({ where: { transaction: { idempotencyKey: { in: bonusKeys } } } });
        await tx.ledgerTransaction.deleteMany({ where: { idempotencyKey: { in: bonusKeys } } });
        await tx.session.deleteMany({ where: { userId: { in: userIds } } });
      await tx.manualPaymentClaim.deleteMany({ where: { userId: { in: userIds } } });
      await tx.deposit.deleteMany({ where: { userId: { in: userIds } } });
        await tx.ledgerAccount.deleteMany({ where: { userId: { in: userIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
      }
      await tx.ledgerEntry.deleteMany({ where: { transaction: { idempotencyKey: fundingKey } } });
      await tx.ledgerTransaction.deleteMany({ where: { idempotencyKey: fundingKey } });
    });
    await db.$disconnect();
  });

  it('accepts the fixed demo code for a valid number without sending SMS or returning the code', async () => {
    await db.$connect();
    const phoneE164 = newPhone();
    const gatewayFetch = vi.fn(async () => {
      throw new Error('The SMS gateway must not be called in demo mode.');
    });
    vi.stubGlobal('fetch', gatewayFetch);
    env.otpProvider = 'demo';
    const sent = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(202);
    expect(sent.body.deliveryState).toBe('DEMO');
    expect(sent.body.gatewayStatus).toBe('NOT_SENT');
    expect(sent.body.message).toMatch(/No SMS was sent/);
    expect(JSON.stringify(sent.body)).not.toContain('123456');

    const challenge = await db.otpChallenge.findUniqueOrThrow({ where: { id: sent.body.challengeId } });
    expect(challenge.deliveryStatus).toBe('DEMO');
    expect(challenge.gatewayRequestId).toBeNull();
    expect(challenge.codeHash).toBe(hashOtp(phoneE164, '123456'));

    const status = await request(app).get(`/api/v1/auth/otp-status/${challenge.id}`).expect(200);
    expect(status.body.deliveryState).toBe('DEMO');
    expect(status.body.gatewayStatus).toBe('NOT_SENT');

    const verified = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: challenge.id, code: '123456' });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.accessToken).toBeTruthy();
    expect(gatewayFetch).not.toHaveBeenCalled();

    const methods = await request(app).get('/api/v1/wallet-methods').set('Authorization', `Bearer ${verified.body.accessToken}`).expect(200);
    expect(methods.body.livePaymentsEnabled).toBe(false);
    expect(methods.body.methods.every((method: { available: boolean }) => !method.available)).toBe(true);
    expect(methods.body.upiDeposit.rewardPercentBps).toBe(1700);
    expect(methods.body.upiDeposit.rewardEnabled).toBe(env.upiDepositRewardEnabled);

    expect(methods.body.methods.some((method: { name: string }) => method.name === 'MobiKwik')).toBe(false);
    await request(app).get('/api/v1/wallet-links').set('Authorization', `Bearer ${verified.body.accessToken}`).expect(404);
    await request(app).post('/api/v1/wallet-links/mobikwik').set('Authorization', `Bearer ${verified.body.accessToken}`).send({ phoneE164 }).expect(404);
  });

  it('supports password reset only after a live OTP challenge, then invalidates old sessions', async () => {
    await db.$connect();
    env.otpProvider = 'demo';
    env.welcomeBonusEnabled = true;
    const phoneE164 = newPhone();
    env.demoLoginPhoneE164 = phoneE164;
    env.demoLoginPassword = '1234';

    const login = await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: '1234' }).expect(200);
    expect(login.body.demoOnly).toBe(true);
    expect(login.body.accessToken).toBeTruthy();
    const storedUser = await db.user.findUniqueOrThrow({ where: { phoneE164 } });
    expect(storedUser.passwordHash).toMatch(/^scrypt\$/);
    expect(storedUser.passwordHash).not.toContain('1234');

    await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: 'incorrect' }).expect(401);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: login.body.refreshToken }).expect(204);
    const repeatedLogin = await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: '1234' }).expect(200);
    expect(repeatedLogin.body.user.id).toBe(login.body.user.id);

    const resetRequest = await request(app).post('/api/v1/auth/forgot-password/request-otp').send({ phoneE164 }).expect(202);
    expect(resetRequest.body.expiresInSeconds).toBe(300);
    expect(JSON.stringify(resetRequest.body)).not.toContain('123456');
    const reset = await request(app).post('/api/v1/auth/password/reset').send({ phoneE164, challengeId: resetRequest.body.challengeId, code: '123456', newPassword: 'new-demo-pass-8' }).expect(200);
    expect(reset.body.ok).toBe(true);
    await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: '1234' }).expect(401);
    await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: 'new-demo-pass-8' }).expect(200);
  });

  it('registers only after OTP verification and can reset with a separate OTP challenge', async () => {
    await db.$connect();
    env.otpProvider = 'demo';
    env.demoLoginPhoneE164 = undefined;
    env.demoLoginPassword = undefined;
    const phoneE164 = newPhone();
    const registration = await request(app).post('/api/v1/auth/register/request-otp').send({ phoneE164, fullName: 'Test PaisaPay User' }).expect(202);
    const crossFlow = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: registration.body.challengeId, code: '123456' });
    expect(crossFlow.status, JSON.stringify(crossFlow.body)).toBe(401);
    const wrongRegistrationCode = await request(app).post('/api/v1/auth/register/verify-otp').send({ phoneE164, fullName: 'Test PaisaPay User', password: 'password-123', challengeId: registration.body.challengeId, code: '000000' });
    expect(wrongRegistrationCode.status, JSON.stringify(wrongRegistrationCode.body)).toBe(401);
    await request(app).post('/api/v1/auth/register/verify-otp').send({ phoneE164, fullName: 'Test PaisaPay User', password: 'password-123', challengeId: registration.body.challengeId, code: '123456' }).expect(201);
    await request(app).post('/api/v1/auth/register/request-otp').send({ phoneE164, fullName: 'Duplicate User' }).expect(409);
    const user = await db.user.findUniqueOrThrow({ where: { phoneE164 } });
    expect(user.displayName).toBe('Test PaisaPay User');
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.passwordHash).not.toContain('password-123');
    await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: 'password-123' }).expect(200);

    const resetRequest = await request(app).post('/api/v1/auth/forgot-password/request-otp').send({ phoneE164 }).expect(202);
    await request(app).post('/api/v1/auth/password/reset').send({ phoneE164, challengeId: resetRequest.body.challengeId, code: '123456', newPassword: 'password-456' }).expect(200);
    await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: 'password-123' }).expect(401);
    await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: 'password-456' }).expect(200);
    for (let attempt = 0; attempt < 5; attempt += 1) await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: 'incorrect-password' }).expect(401);
    await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: 'password-123' }).expect(401);
  });

  it('binds a referral entered at OTP request to the account even if mobile state omits it at verification', async () => {
    await db.$connect();
    env.otpProvider = 'demo';
    env.demoLoginPhoneE164 = undefined;
    env.demoLoginPassword = undefined;
    const referrerPhone = newPhone();
    const inviteePhone = newPhone();
    const referrer = await db.user.create({ data: { phoneE164: referrerPhone, displayName: 'Referral Owner', status: 'ACTIVE' } });
    const requestOtp = await request(app).post('/api/v1/auth/register/request-otp').send({ phoneE164: inviteePhone, fullName: 'Invited User', referralCode: referrer.referralCode }).expect(202);
    const challenge = await db.otpChallenge.findUniqueOrThrow({ where: { id: requestOtp.body.challengeId } });
    expect(challenge.referralCode).toBe(referrer.referralCode);

    await request(app).post('/api/v1/auth/register/verify-otp').send({ phoneE164: inviteePhone, fullName: 'Invited User', password: 'secure-password-123', challengeId: challenge.id, code: '123456' }).expect(201);
    const invitee = await db.user.findUniqueOrThrow({ where: { phoneE164: inviteePhone } });
    expect(invitee.referredById).toBe(referrer.id);
    expect(await db.referral.findUnique({ where: { inviteeId: invitee.id } })).toMatchObject({ referrerId: referrer.id, referralCode: referrer.referralCode });

    const token = randomUUID();
    const now = new Date();
    await db.session.create({ data: { userId: referrer.id, accessTokenHash: hashToken(token), refreshTokenHash: hashToken(randomUUID()), accessExpiresAt: new Date(now.getTime() + 60_000), refreshExpiresAt: new Date(now.getTime() + 120_000) } });
    const team = await request(app).get('/api/v1/users/me/referrals').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(team.body).toMatchObject({ referralCode: referrer.referralCode, directCount: 1, indirectCount: 0, totalMembers: 1 });
    expect(team.body.members).toHaveLength(1);
    expect(team.body.members[0].depth).toBe(1);
  });

  it('allows repeated OTP requests in local demo mode without cooldown or request throttles', async () => {
    await db.$connect();
    const phoneE164 = newPhone();
    env.otpProvider = 'demo';
    for (let requestNumber = 0; requestNumber < 7; requestNumber += 1) {
      const response = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 });
      expect(response.status, JSON.stringify(response.body)).toBe(202);
    }
  });

  it('credits the eligible new user once and exposes the welcome credit in the ledger', async () => {
    await db.$connect();
    env.otpProvider = 'demo';
    const phoneE164 = newPhone();
    const login = async () => {
      const challenge = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(202);
      return request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: challenge.body.challengeId, code: '123456' }).expect(200);
    };

    const first = await login();
    const firstUserId = first.body.user.id as string;
    expect(first.body.user.status).toBe('PENDING_PROFILE');
    expect(first.body.welcomeBonus).toEqual({ status: 'CREDITED', amountPaise: 9900 });
    const firstBalance = await request(app).get('/api/v1/users/me/balance').set('Authorization', `Bearer ${first.body.accessToken}`).expect(200);
    expect(firstBalance.body.availablePaise).toBe(9900);
    const history = await request(app).get('/api/v1/users/me/transactions').set('Authorization', `Bearer ${first.body.accessToken}`).expect(200);
    expect(history.body.transactions).toHaveLength(1);
    expect(history.body.transactions[0]).toMatchObject({ type: 'CREDIT', amountPaise: 9900, description: 'WELCOME_BONUS', displayDescription: 'Development test welcome bonus (not redeemable)' });
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: first.body.refreshToken }).expect(204);

    const second = await login();
    expect(second.body.user.id).toBe(firstUserId);
    expect(second.body.welcomeBonus).toEqual({ status: 'NOT_ELIGIBLE', amountPaise: 0 });
    const accounts = await db.ledgerAccount.findMany({ where: { userId: firstUserId }, select: { id: true } });
    const entries = await db.ledgerEntry.findMany({ where: { accountId: { in: accounts.map((account) => account.id) } }, include: { transaction: true } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.transaction.idempotencyKey).toBe(`WELCOME_BONUS:${firstUserId}`);
    const secondBalance = await request(app).get('/api/v1/users/me/balance').set('Authorization', `Bearer ${second.body.accessToken}`).expect(200);
    expect(secondBalance.body.availablePaise).toBe(9900);
  });

  it('does not grant the bonus to a pre-existing ineligible account', async () => {
    await db.$connect();
    env.otpProvider = 'demo';
    const phoneE164 = newPhone();
    const existing = await db.user.create({ data: { phoneE164, welcomeBonusEligible: false } });
    const challenge = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(202);
    const verified = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: challenge.body.challengeId, code: '123456' }).expect(200);
    expect(verified.body.user.id).toBe(existing.id);
    expect(verified.body.welcomeBonus).toEqual({ status: 'NOT_ELIGIBLE', amountPaise: 0 });
    const balance = await request(app).get('/api/v1/users/me/balance').set('Authorization', `Bearer ${verified.body.accessToken}`).expect(200);
    expect(balance.body.availablePaise).toBe(0);
  });

  it('creates a pending UPI request without starting a false payment or crediting a reward', async () => {
    await db.$connect();
    env.otpProvider = 'demo';
    const phoneE164 = newPhone();
    const challenge = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(202);
    const session = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: challenge.body.challengeId, code: '123456' }).expect(200);
    const response = await request(app).post('/api/v1/deposits')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .set('Idempotency-Key', `deposit-unavailable-${randomInt(1, 1_000_000)}`)
      .send({ amountPaise: 10000, method: 'UPI' })
      .expect(201);
    expect(response.body.deposit.status).toBe('PENDING_PAYMENT');
    expect(response.body.paymentStarted).toBe(false);
    expect(response.body.manualVerificationAvailable).toBe(true);
    expect(response.body.deposit.receiverVpa).toBe(env.depositReceiverUpiId);
    expect(response.body.message).toMatch(/remains pending/i);
    expect(await db.ledgerTransaction.count({ where: { referenceId: response.body.deposit.id } })).toBe(0);
    expect(await db.deposit.count({ where: { userId: session.body.user.id } })).toBe(1);
    await request(app).post('/api/v1/deposits')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .set('Idempotency-Key', `removed-mobikwik-${randomInt(1, 1_000_000)}`)
      .send({ amountPaise: 10000, method: 'MobiKwik' }).expect(400);
    await request(app).post('/api/v1/orders')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .set('Idempotency-Key', `removed-mobikwik-order-${randomInt(1, 1_000_000)}`)
      .send({ kind: 'SELL', amountPaise: 10000, method: 'MobiKwik' }).expect(400);
  });

  it('serializes two simultaneous new-login bonus attempts and credits exactly once', async () => {
    await db.$connect();
    env.otpProvider = 'demo';
    const phoneE164 = newPhone();
    const challenges = await Promise.all([0, 1].map(() => request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(202)));
    const results = await Promise.all(challenges.map((challenge) => request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: challenge.body.challengeId, code: '123456' })));
    expect(results.map((result) => ({ status: result.status, body: result.body }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ status: 200 }),
    ]));
    const user = await db.user.findUniqueOrThrow({ where: { phoneE164 } });
    expect(await db.ledgerTransaction.count({ where: { eventType: 'WELCOME_BONUS', referenceId: user.id } })).toBe(1);
    const balances = await db.ledgerEntry.findMany({ where: { account: { userId: user.id, type: 'AVAILABLE' } } });
    expect(balances.reduce((sum, entry) => sum + entry.creditPaise - entry.debitPaise, 0n)).toBe(9900n);
  });

  it('allows only one concurrent verification of a challenge and creates no duplicate ledger credit', async () => {
    await db.$connect();
    env.otpProvider = 'demo';
    const phoneE164 = newPhone();
    const challenge = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(202);
    const body = { phoneE164, challengeId: challenge.body.challengeId, code: '123456' };
    const results = await Promise.all([
      request(app).post('/api/v1/auth/verify-otp').send(body),
      request(app).post('/api/v1/auth/verify-otp').send(body),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    const user = await db.user.findUniqueOrThrow({ where: { phoneE164 } });
    const accounts = await db.ledgerAccount.findMany({ where: { userId: user.id }, select: { id: true } });
    const userEntries = await db.ledgerEntry.findMany({ where: { accountId: { in: accounts.map((account) => account.id) } } });
    expect(userEntries.reduce((sum, entry) => sum + entry.creditPaise - entry.debitPaise, 0n)).toBe(9900n);
  });
});
