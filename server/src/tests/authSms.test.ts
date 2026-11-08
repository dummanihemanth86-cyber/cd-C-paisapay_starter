import { randomInt } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/db.js';
import { hashOtp } from '../lib/security.js';
import { hashPassword } from '../lib/password.js';
import { isOtpPhoneLimitExempt } from '../modules/auth/otpPhoneRateLimit.js';

const db = prisma!;
const phones: string[] = [];
let lastMessage = '';
let lastRequestId = '';
const integration = describe.skipIf(!prisma || !env.smsGatewayConfigured);
const originalOtpProvider = env.otpProvider;
const originalWelcomeBonusEnabled = env.welcomeBonusEnabled;

describe('temporary per-phone OTP limit exception', () => {
  it('exempts only the exact configured E.164 number', () => {
    expect(isOtpPhoneLimitExempt('+919876543210', '+919876543210')).toBe(true);
    expect(isOtpPhoneLimitExempt('+919876543211', '+919876543210')).toBe(false);
    expect(isOtpPhoneLimitExempt('+919876543210', undefined)).toBe(false);
  });
});

function newPhone() {
  const phone = `+919${randomInt(0, 1_000_000_000).toString().padStart(9, '0')}`;
  phones.push(phone);
  return phone;
}

function queueResponse(_url: string | URL | Request, init?: RequestInit) {
  const payload = JSON.parse(String(init?.body)) as { message: string; request_id: string };
  lastMessage = payload.message;
  lastRequestId = payload.request_id;
  return Promise.resolve(new Response(JSON.stringify({ success: true, sms_id: 11, request_id: payload.request_id, status: 'PENDING' }), { status: 200 }));
}

integration('Android gateway OTP routes (PostgreSQL integration)', () => {
  beforeAll(async () => { await db.$connect(); env.otpProvider = 'android-gateway'; env.welcomeBonusEnabled = false; });
  beforeEach(() => {
    lastMessage = '';
    lastRequestId = '';
    vi.stubGlobal('fetch', vi.fn(queueResponse));
  });
  afterAll(async () => {
    env.otpProvider = originalOtpProvider;
    env.welcomeBonusEnabled = originalWelcomeBonusEnabled;
    if (phones.length) {
      const users = await db.user.findMany({ where: { phoneE164: { in: phones } }, select: { id: true } });
      const userIds = users.map((user) => user.id);
      await db.$transaction(async (tx) => {
        await tx.otpChallenge.deleteMany({ where: { phoneE164: { in: phones } } });
        if (userIds.length) {
          await tx.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
          await tx.session.deleteMany({ where: { userId: { in: userIds } } });
          await tx.ledgerAccount.deleteMany({ where: { userId: { in: userIds } } });
          await tx.user.deleteMany({ where: { id: { in: userIds } } });
        }
      });
    }
    await db.$disconnect();
    vi.unstubAllGlobals();
  });

  it('requests an OTP, stores only its hash, and creates a session only after successful verification', async () => {
    const phoneE164 = newPhone();
    const sent = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(202);
    expect(sent.body.deliveryState).toBe('ACCEPTED');
    expect(sent.body.gatewayStatus).toBe('PENDING');
    expect(sent.body.message).toMatch(/does not confirm SMS delivery/);
    const code = lastMessage.match(/code is (\d{6})/)?.[1];
    expect(code).toBeDefined();
    expect(JSON.stringify(sent.body)).not.toContain(code!);
    const challenge = await db.otpChallenge.findUniqueOrThrow({ where: { id: sent.body.challengeId } });
    expect(challenge.codeHash).not.toBe(code);
    expect(challenge.expiresAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(challenge.gatewayRequestId).toBe(lastRequestId);
    expect(challenge.deliveryStatus).toBe('ACCEPTED');

    const verified = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: sent.body.challengeId, code }).expect(200);
    expect(verified.body.accessToken).toBeTruthy();
    expect(verified.body.refreshToken).toBeTruthy();
    await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: sent.body.challengeId, code }).expect(401);
  });

  it('sends a password-reset OTP through the configured SMS adapter and accepts it once', async () => {
    const phoneE164 = newPhone();
    await db.user.create({ data: { phoneE164, displayName: 'Reset Flow Test', status: 'ACTIVE', passwordHash: await hashPassword('old-password-123') } });
    const oldLogin = await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: 'old-password-123' }).expect(200);
    const requested = await request(app).post('/api/v1/auth/forgot-password/request-otp').send({ phoneE164 }).expect(202);
    expect(requested.body.expiresInSeconds).toBe(300);
    expect(requested.body.resendAfterSeconds).toBe(60);
    const code = lastMessage.match(/code is (\d{6})/)?.[1];
    expect(code).toBeDefined();
    expect(requested.body).not.toHaveProperty('code');
    expect(JSON.stringify(requested.body)).not.toContain(code!);
    const challenge = await db.otpChallenge.findUniqueOrThrow({ where: { id: requested.body.challengeId } });
    expect(challenge.purpose).toBe('PASSWORD_RESET');
    expect(challenge.deliveryStatus).toBe('ACCEPTED');
    expect(challenge.codeHash).not.toBe(code);
    const wrongCode = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    await request(app).post('/api/v1/auth/password/reset').send({ phoneE164, challengeId: requested.body.challengeId, code: wrongCode, newPassword: 'new-password-456' }).expect(401);
    expect((await db.otpChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).attempts).toBe(1);
    await request(app).post('/api/v1/auth/password/reset').send({ phoneE164, challengeId: requested.body.challengeId, code, newPassword: 'new-password-456' }).expect(200);
    await request(app).post('/api/v1/auth/password/reset').send({ phoneE164, challengeId: requested.body.challengeId, code, newPassword: 'another-password-789' }).expect(401);
    await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${oldLogin.body.accessToken}`).expect(401);
    await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: 'old-password-123' }).expect(401);
    await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: 'new-password-456' }).expect(200);
  });

  it('resets only active Admin accounts using a six-digit provider OTP and revokes every old session', async () => {
    const phoneE164 = newPhone();
    const oldPassword = 'OldAdminPassword123!';
    const newPassword = 'NewAdminPassword456!';
    const admin = await db.user.create({ data: { phoneE164, displayName: 'Admin Reset Test', status: 'ACTIVE', passwordHash: await hashPassword(oldPassword) } });
    await db.adminUser.create({ data: { userId: admin.id, role: 'ADMIN' } });
    const oldSession = await request(app).post('/api/v1/admin/auth/login').send({ phoneE164, password: oldPassword }).expect(200);

    const requested = await request(app).post('/api/v1/admin/auth/forgot-password/request-otp').send({ phoneE164 }).expect(202);
    expect(requested.body.message).toMatch(/If an active Admin account exists/);
    expect(JSON.stringify(requested.body)).not.toMatch(/\b\d{6}\b/);
    const challenge = await db.otpChallenge.findUniqueOrThrow({ where: { id: requested.body.challengeId } });
    expect(challenge.purpose).toBe('ADMIN_PASSWORD_RESET');
    expect(challenge.codeHash).not.toBe(lastMessage.match(/code is (\d{6})/)?.[1]);
    const code = lastMessage.match(/code is (\d{6})/)?.[1];
    expect(code).toBeDefined();

    await request(app).post('/api/v1/admin/auth/password/reset').send({ phoneE164, challengeId: requested.body.challengeId, code: '2321', newPassword }).expect(400);
    await request(app).post('/api/v1/auth/password/reset').send({ phoneE164, challengeId: requested.body.challengeId, code, newPassword }).expect(401);
    await request(app).post('/api/v1/admin/auth/password/reset').send({ phoneE164, challengeId: requested.body.challengeId, code: `${(Number(code) + 1) % 1_000_000}`.padStart(6, '0'), newPassword }).expect(401);
    await request(app).post('/api/v1/admin/auth/password/reset').send({ phoneE164, challengeId: requested.body.challengeId, code, newPassword }).expect(200);
    await request(app).get('/api/v1/admin/me').set('Authorization', `Bearer ${oldSession.body.accessToken}`).expect(401);
    await request(app).post('/api/v1/admin/auth/login').send({ phoneE164, password: oldPassword }).expect(401);
    await request(app).post('/api/v1/admin/auth/login').send({ phoneE164, password: newPassword }).expect(200);
  });

  it('rejects an Admin reset code submitted for another phone and an expired Admin challenge', async () => {
    const phoneE164 = newPhone();
    const otherPhone = newPhone();
    const oldPassword = 'OldAdminPassword789!';
    const admin = await db.user.create({ data: { phoneE164, displayName: 'Admin OTP Boundary Test', status: 'ACTIVE', passwordHash: await hashPassword(oldPassword) } });
    await db.adminUser.create({ data: { userId: admin.id, role: 'ADMIN' } });

    const requested = await request(app).post('/api/v1/admin/auth/forgot-password/request-otp').send({ phoneE164 }).expect(202);
    const challenge = await db.otpChallenge.findUniqueOrThrow({ where: { id: requested.body.challengeId } });
    const code = lastMessage.match(/code is (\d{6})/)?.[1];
    expect(code).toBeDefined();

    await request(app).post('/api/v1/admin/auth/password/reset').send({ phoneE164: otherPhone, challengeId: challenge.id, code, newPassword: 'NewAdminPassword789!' }).expect(401);
    await db.otpChallenge.update({ where: { id: challenge.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app).post('/api/v1/admin/auth/password/reset').send({ phoneE164, challengeId: challenge.id, code, newPassword: 'NewAdminPassword789!' }).expect(401);
    await request(app).post('/api/v1/admin/auth/login').send({ phoneE164, password: oldPassword }).expect(200);
  });

  it('does not send reset SMS or change a normal user password through Admin reset endpoints', async () => {
    const phoneE164 = newPhone();
    const oldPassword = 'NormalUserPassword123!';
    await db.user.create({ data: { phoneE164, displayName: 'Non Admin Reset Test', status: 'ACTIVE', passwordHash: await hashPassword(oldPassword) } });
    const requested = await request(app).post('/api/v1/admin/auth/forgot-password/request-otp').send({ phoneE164 }).expect(202);
    expect(lastMessage).toBe('');
    expect(await db.otpChallenge.count({ where: { phoneE164, purpose: 'ADMIN_PASSWORD_RESET' } })).toBe(0);
    await request(app).post('/api/v1/admin/auth/password/reset').send({ phoneE164, challengeId: requested.body.challengeId, code: '123456', newPassword: 'NewNormalUserPassword456!' }).expect(401);
    await request(app).post('/api/v1/auth/password/login').send({ phoneE164, password: oldPassword }).expect(200);
  });

  it('does not report gateway network failure as an accepted SMS', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { message: string; request_id: string };
      lastMessage = payload.message;
      lastRequestId = payload.request_id;
      return Promise.reject(new TypeError('network failure'));
    }));
    const phoneE164 = newPhone();
    const response = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(503);
    expect(response.body.error.code).toBe('SMS_GATEWAY_UNAVAILABLE');
    expect(response.body.error.message).toMatch(/offline or unreachable/);
    const code = lastMessage.match(/code is (\d{6})/)?.[1];
    expect(code).toBeDefined();
    const challenge = await db.otpChallenge.findFirstOrThrow({ where: { phoneE164 }, orderBy: { createdAt: 'desc' } });
    expect(challenge.deliveryStatus).toBe('UNKNOWN');
    const verify = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: challenge.id, code }).expect(401);
    expect(verify.body.error.code).toBe('OTP_NOT_DELIVERED');
  });

  it.each(['FAILED', 'UNKNOWN', null] as const)('refuses OTP verification when gateway delivery state is %s', async (deliveryStatus) => {
    const phoneE164 = newPhone();
    const challenge = await db.otpChallenge.create({ data: {
      phoneE164,
      codeHash: hashOtp(phoneE164, '123456'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      resendAt: new Date(Date.now() + 60 * 1000),
      deliveryStatus,
    } });
    const response = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: challenge.id, code: '123456' }).expect(401);
    expect(response.body.error.code).toBe('OTP_NOT_DELIVERED');
  });

  it('returns actual sent or delivered state from the gateway status API', async () => {
    const phoneE164 = newPhone();
    const sent = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(202);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, status: 'DELIVERED', phone_number: phoneE164, message: lastMessage, request_id: lastRequestId }), { status: 200 })));
    const status = await request(app).get(`/api/v1/auth/otp-status/${sent.body.challengeId}`).expect(200);
    expect(status.body).toEqual({ challengeId: sent.body.challengeId, deliveryState: 'DELIVERED', gatewayStatus: 'DELIVERED' });
  });

  it('explains when an OTP challenge has no recorded gateway submission', async () => {
    const phoneE164 = newPhone();
    const challenge = await db.otpChallenge.create({ data: {
      phoneE164,
      codeHash: hashOtp(phoneE164, '123456'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      resendAt: new Date(Date.now() + 60 * 1000),
    } });
    const response = await request(app).get(`/api/v1/auth/otp-status/${challenge.id}`).expect(409);
    expect(response.body.error.code).toBe('OTP_NOT_SUBMITTED');
  });

  it('rejects an incorrect OTP and increments the attempt counter', async () => {
    const phoneE164 = newPhone();
    const sent = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(202);
    const actualCode = lastMessage.match(/code is (\d{6})/)![1]!;
    const wrongCode = String((Number(actualCode) + 1) % 1_000_000).padStart(6, '0');
    const response = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: sent.body.challengeId, code: wrongCode }).expect(401);
    expect(response.body.error.code).toBe('OTP_INVALID');
    const challenge = await db.otpChallenge.findUniqueOrThrow({ where: { id: sent.body.challengeId } });
    expect(challenge.attempts).toBe(1);
  });

  it('rejects an expired challenge', async () => {
    const phoneE164 = newPhone();
    const challenge = await db.otpChallenge.create({ data: { phoneE164, codeHash: hashOtp(phoneE164, '123456'), expiresAt: new Date(Date.now() - 1000), resendAt: new Date(Date.now() - 1000) } });
    const response = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: challenge.id, code: '123456' }).expect(401);
    expect(response.body.error.code).toBe('OTP_INVALID');
  });

  it('blocks further incorrect attempts after five failures', async () => {
    const phoneE164 = newPhone();
    const challenge = await db.otpChallenge.create({ data: { phoneE164, codeHash: hashOtp(phoneE164, '123456'), expiresAt: new Date(Date.now() + 5 * 60 * 1000), resendAt: new Date(Date.now() + 60 * 1000), deliveryStatus: 'ACCEPTED' } });
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: challenge.id, code: '654321' }).expect(401);
    }
    const blocked = await request(app).post('/api/v1/auth/verify-otp').send({ phoneE164, challengeId: challenge.id, code: '654321' }).expect(429);
    expect(blocked.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('applies the per-phone hourly OTP request limit', async () => {
    const phoneE164 = newPhone();
    const recent = new Date(Date.now() - 2 * 60 * 1000);
    await db.otpChallenge.createMany({ data: Array.from({ length: 5 }, () => ({ phoneE164, codeHash: hashOtp(phoneE164, '123456'), expiresAt: new Date(Date.now() + 5 * 60 * 1000), resendAt: recent, createdAt: recent })) });
    const response = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164 }).expect(429);
    expect(response.body.error.code).toBe('OTP_PHONE_LIMIT');
  });

  it('limits OTP requests by source IP as well', async () => {
    await request(app).post('/api/v1/auth/request-otp').send({ phoneE164: newPhone() }).expect(202);
    const response = await request(app).post('/api/v1/auth/request-otp').send({ phoneE164: newPhone() }).expect(429);
    expect(response.body.error.code).toBe('OTP_RATE_LIMITED');
  });
});
