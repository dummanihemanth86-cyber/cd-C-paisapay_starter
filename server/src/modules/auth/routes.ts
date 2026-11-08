import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { databaseRequired } from '../../lib/db.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { hashOtp, hashToken, newOpaqueToken, randomOtp, safeHashEqual } from '../../lib/security.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { getGatewaySmsStatus, sendGatewaySms, SmsGatewayError } from '../../integrations/sms/androidGateway.js';
import { sendRenflairV1Otp } from '../../integrations/sms/renflairV1.js';
import { isOtpPhoneLimitExempt } from './otpPhoneRateLimit.js';
import { grantWelcomeBonus } from '../users/welcomeBonus.js';

export const authRouter = Router();
const newPublicUserId = () => randomInt(10_000_000, 10_000_000_000).toString();
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use an international phone number such as +919876543210.');
const requestLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => (env.isTest && env.otpProvider === 'demo') || isOtpPhoneLimitExempt(typeof req.body?.phoneE164 === 'string' ? req.body.phoneE164 : '', env.otpRateLimitBypassPhone),
  message: { error: { code: 'OTP_RATE_LIMITED', message: 'Too many OTP requests. Wait before trying again.' } },
});
const verifyLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const statusLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const passwordLoginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const passwordPhoneLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `phone:${hashToken(typeof req.body?.phoneE164 === 'string' ? req.body.phoneE164 : 'invalid')}`,
  message: { error: { code: 'LOGIN_RATE_LIMITED', message: 'Too many sign-in attempts. Wait before trying again.' } },
});
const passwordResetLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });
const accessLifeMs = 15 * 60 * 1000;
const refreshLifeMs = 30 * 24 * 60 * 60 * 1000;

function createTokenPair() {
  return { accessToken: newOpaqueToken(), refreshToken: newOpaqueToken(), accessExpiresAt: new Date(Date.now() + accessLifeMs), refreshExpiresAt: new Date(Date.now() + refreshLifeMs) };
}

const dummyPasswordHash = hashPassword('paisa-pay-invalid-password-dummy');

authRouter.post('/password/login', passwordLoginLimit, passwordPhoneLimit, asyncRoute(async (req, res) => {
  const input = z.object({ phoneE164: phone, password: z.string().min(1).max(128) }).strict().parse(req.body);
  const db = databaseRequired();
  const pair = createTokenPair();
  const isDemoLogin = (env.isDevelopment || env.isTest) && env.otpProvider === 'demo' && env.paymentProvider === 'disabled' && Boolean(env.demoLoginPhoneE164 && env.demoLoginPassword);
  if (isDemoLogin) {
    if (input.phoneE164 !== env.demoLoginPhoneE164) throw new HttpError(401, 'LOGIN_INVALID', 'The phone number or password is incorrect.');
    const initialHash = await hashPassword(env.demoLoginPassword!);
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { phoneE164: input.phoneE164 },
        create: { phoneE164: input.phoneE164, publicId: newPublicUserId(), displayName: 'Demo User', status: 'ACTIVE', welcomeBonusEligible: env.welcomeBonusEnabled, passwordHash: initialHash },
        update: {},
      });
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      let current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (!current.publicId) current = await tx.user.update({ where: { id: user.id }, data: { publicId: newPublicUserId() } });
      if (current.status === 'SUSPENDED' || current.status === 'CLOSED') throw new HttpError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not available for sign-in.');
      if (!current.passwordHash && await verifyPassword(input.password, initialHash)) {
        await tx.user.update({ where: { id: current.id }, data: { passwordHash: initialHash } });
      } else if (!current.passwordHash || !(await verifyPassword(input.password, current.passwordHash))) {
        throw new HttpError(401, 'LOGIN_INVALID', 'The phone number or password is incorrect.');
      }
      await tx.ledgerAccount.createMany({ data: ['AVAILABLE', 'PENDING', 'RESERVED', 'WITHDRAWAL_PENDING'].map((type) => ({ userId: current.id, type: type as 'AVAILABLE' | 'PENDING' | 'RESERVED' | 'WITHDRAWAL_PENDING', currency: 'INR' })), skipDuplicates: true });
      const welcomeBonus = await grantWelcomeBonus(tx, current.id);
      const session = await tx.session.create({ data: { userId: current.id, accessTokenHash: hashToken(pair.accessToken), refreshTokenHash: hashToken(pair.refreshToken), accessExpiresAt: pair.accessExpiresAt, refreshExpiresAt: pair.refreshExpiresAt } });
      return { user: current, welcomeBonus, session };
    }, { isolationLevel: 'ReadCommitted' });
    res.json({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, accessExpiresInSeconds: 900, user: { id: result.user.id, publicId: result.user.publicId, displayName: result.user.displayName, status: result.user.status, referralCode: result.user.referralCode }, welcomeBonus: { status: result.welcomeBonus, amountPaise: result.welcomeBonus === 'CREDITED' ? env.welcomeBonusAmountPaise : 0 }, demoOnly: true });
    return;
  }

  const fallbackHash = await dummyPasswordHash;
  const result = await db.$transaction(async (tx) => {
    const found = await tx.user.findUnique({ where: { phoneE164: input.phoneE164 } });
    if (!found) {
      await verifyPassword(input.password, fallbackHash);
      return { invalid: true as const };
    }
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${found.id}::uuid FOR UPDATE`;
    let user = await tx.user.findUniqueOrThrow({ where: { id: found.id } });
    if (!user.publicId) user = await tx.user.update({ where: { id: found.id }, data: { publicId: newPublicUserId() } });
    const now = new Date();
    if (user.status === 'SUSPENDED' || user.status === 'CLOSED') return { invalid: true as const };
    if (user.loginLockedUntil && user.loginLockedUntil > now) return { invalid: true as const };
    const matches = user.passwordHash ? await verifyPassword(input.password, user.passwordHash) : (await verifyPassword(input.password, fallbackHash), false);
    if (!matches) {
      const attempts = user.loginLockedUntil && user.loginLockedUntil <= now ? 1 : user.loginFailedAttempts + 1;
      await tx.user.update({ where: { id: user.id }, data: { loginFailedAttempts: attempts, loginLockedUntil: attempts >= 5 ? new Date(now.getTime() + 15 * 60 * 1000) : null } });
      return { invalid: true as const };
    }
    await tx.user.update({ where: { id: user.id }, data: { loginFailedAttempts: 0, loginLockedUntil: null } });
    await tx.ledgerAccount.createMany({ data: ['AVAILABLE', 'PENDING', 'RESERVED', 'WITHDRAWAL_PENDING'].map((type) => ({ userId: user.id, type: type as 'AVAILABLE' | 'PENDING' | 'RESERVED' | 'WITHDRAWAL_PENDING', currency: 'INR' })), skipDuplicates: true });
    const welcomeBonus = await grantWelcomeBonus(tx, user.id);
    const session = await tx.session.create({ data: { userId: user.id, accessTokenHash: hashToken(pair.accessToken), refreshTokenHash: hashToken(pair.refreshToken), accessExpiresAt: pair.accessExpiresAt, refreshExpiresAt: pair.refreshExpiresAt } });
    return { invalid: false as const, user, session, welcomeBonus };
  }, { isolationLevel: 'ReadCommitted' });
  if (result.invalid) throw new HttpError(401, 'LOGIN_INVALID', 'The phone number or password is incorrect.');
  res.json({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, accessExpiresInSeconds: 900, user: { id: result.user.id, publicId: result.user.publicId, displayName: result.user.displayName, status: result.user.status, referralCode: result.user.referralCode }, welcomeBonus: { status: result.welcomeBonus, amountPaise: result.welcomeBonus === 'CREDITED' ? env.welcomeBonusAmountPaise : 0 } });
}));

export async function createOtpChallenge(phoneE164: string, purpose: 'LOGIN' | 'REGISTER' | 'PASSWORD_RESET' | 'ADMIN_PASSWORD_RESET', referralCode?: string) {
  // Production OTP is allowed only through a configured server-side provider;
  // environment validation rejects all other real providers in production.
  if (env.otpProvider === 'disabled' || (env.otpProvider === 'demo' && !env.isTest)) throw new HttpError(503, 'OTP_PROVIDER_UNAVAILABLE', 'OTP delivery is disabled. Contact the app administrator.');
  if (env.otpProvider === 'console') throw new HttpError(503, 'OTP_CONSOLE_DISABLED', 'Console OTP delivery is unavailable because OTP codes are not written to logs or API responses.');
  if (env.otpProvider === 'android-gateway' && !env.smsGatewayConfigured) throw new HttpError(503, 'OTP_PROVIDER_UNAVAILABLE', 'The selected OTP provider is not configured. Contact the app administrator.');
  if (env.otpProvider === 'renflair-v1' && !env.renflairConfigured) throw new HttpError(503, 'OTP_PROVIDER_UNAVAILABLE', 'Renflair V1 is not configured. Contact the app administrator.');
  if (env.otpProvider === 'twilio') throw new HttpError(503, 'OTP_PROVIDER_UNAVAILABLE', 'The selected OTP provider has no implemented adapter. Contact the app administrator.');
  const db = databaseRequired();
  const now = new Date();
  const phoneLimitBypassed = (env.isTest && env.otpProvider === 'demo') || isOtpPhoneLimitExempt(phoneE164, env.otpRateLimitBypassPhone);
  if (!phoneLimitBypassed) {
    const recentCount = await db.otpChallenge.count({ where: { phoneE164, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } } });
    if (recentCount >= 5) throw new HttpError(429, 'OTP_PHONE_LIMIT', 'Too many OTP requests for this number. Try again later.');
    const last = await db.otpChallenge.findFirst({ where: { phoneE164, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (last && last.resendAt > now) throw new HttpError(429, 'OTP_COOLDOWN', 'Please wait before requesting another OTP.');
  }
  const isDemo = env.otpProvider === 'demo';
  const code = isDemo ? '123456' : randomOtp();
  const challenge = await db.otpChallenge.create({ data: { phoneE164, purpose, ...(purpose === 'REGISTER' && referralCode ? { referralCode } : {}), codeHash: hashOtp(phoneE164, code), expiresAt: new Date(now.getTime() + 5 * 60 * 1000), resendAt: new Date(now.getTime() + 60 * 1000), deliveryStatus: isDemo ? 'DEMO' : null } });
  if (isDemo) {
    logger.info({ challengeId: challenge.id, deliveryState: 'DEMO' }, 'Development demo OTP challenge created; no SMS was sent');
    return {
      challengeId: challenge.id,
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
      deliveryState: 'DEMO',
      gatewayStatus: 'NOT_SENT',
      message: 'Development demo mode is active. No SMS was sent; use the documented demo code.',
    };
  }
  try {
    const gateway = env.otpProvider === 'renflair-v1'
      ? await sendRenflairV1Otp({ phoneNumber: phoneE164, otp: code, requestId: challenge.id })
      : await sendGatewaySms({
        phoneNumber: phoneE164,
        message: `Your PaisaPay verification code is ${code}. It expires in 5 minutes. Never share this code.`,
        requestId: challenge.id,
      });
    await db.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        gatewayRequestId: gateway.requestId,
        gatewaySmsId: gateway.smsId === null ? null : BigInt(gateway.smsId),
        deliveryStatus: gateway.state,
      },
    });
    if (env.otpProvider === 'renflair-v1') {
      logger.info({ challengeId: challenge.id, deliveryState: gateway.state, provider: env.otpProvider, handsetDeliveryVerified: false }, 'Renflair accepted the OTP request; handset delivery is unconfirmed');
    } else {
      logger.info({ challengeId: challenge.id, deliveryState: gateway.state, provider: env.otpProvider }, 'OTP request accepted by SMS provider');
    }
    return {
      challengeId: challenge.id,
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
      deliveryState: gateway.state,
      gatewayStatus: gateway.status,
      message: gateway.status === 'PENDING' ? 'The gateway accepted the SMS request. This does not confirm SMS delivery.' : 'The gateway reported the current SMS state.',
    };
  } catch (error) {
    const gatewayError = error instanceof SmsGatewayError ? error : new SmsGatewayError('SMS_GATEWAY_UNAVAILABLE', 'SMS gateway is offline or unreachable.');
    await db.otpChallenge.update({ where: { id: challenge.id }, data: { gatewayRequestId: challenge.id, deliveryStatus: gatewayError.code === 'SMS_GATEWAY_REJECTED' || gatewayError.code === 'SMS_GATEWAY_BAD_RESPONSE' ? 'FAILED' : 'UNKNOWN' } });
    logger.warn({ challengeId: challenge.id, code: gatewayError.code }, 'OTP SMS delivery could not be confirmed');
    throw new HttpError(503, gatewayError.code, gatewayError.message);
  }
}

authRouter.post('/request-otp', requestLimit, asyncRoute(async (req, res) => {
  const input = z.object({ phoneE164: phone }).strict().parse(req.body);
  res.status(202).json(await createOtpChallenge(input.phoneE164, 'LOGIN'));
}));

authRouter.post('/register/request-otp', requestLimit, asyncRoute(async (req, res) => {
  const input = z.object({ phoneE164: phone, fullName: z.string().trim().min(2).max(80), referralCode: z.string().trim().min(4).max(60).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict().parse(req.body);
  const db = databaseRequired();
  if (await db.user.findUnique({ where: { phoneE164: input.phoneE164 }, select: { id: true } })) {
    throw new HttpError(409, 'REGISTRATION_UNAVAILABLE', 'Registration could not be started for this number. Sign in or use Forgot Password.');
  }
  if (input.referralCode && !(await db.user.findUnique({ where: { referralCode: input.referralCode }, select: { id: true } }))) {
    throw new HttpError(400, 'REFERRAL_INVALID', 'That referral code was not found. Check it or leave the field empty.');
  }
  res.status(202).json(await createOtpChallenge(input.phoneE164, 'REGISTER', input.referralCode));
}));

authRouter.post('/register/verify-otp', verifyLimit, asyncRoute(async (req, res) => {
  const input = z.object({
    challengeId: z.string().uuid(), phoneE164: phone, fullName: z.string().trim().min(2).max(80),
    password: z.string().min(8).max(128), code: z.string().regex(/^\d{6}$/),
    referralCode: z.string().trim().min(4).max(60).regex(/^[A-Za-z0-9_-]+$/).optional(),
  }).strict().parse(req.body);
  const db = databaseRequired();
  const passwordHash = await hashPassword(input.password);
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM otp_challenges WHERE id = ${input.challengeId}::uuid FOR UPDATE`;
    const challenge = await tx.otpChallenge.findUnique({ where: { id: input.challengeId } });
    if (!challenge || challenge.purpose !== 'REGISTER' || challenge.phoneE164 !== input.phoneE164 || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      throw new HttpError(401, 'OTP_INVALID', 'The registration code is invalid or expired. Request a new code.');
    }
    const isDemo = env.otpProvider === 'demo' && challenge.deliveryStatus === 'DEMO';
    if (!isDemo && !['ACCEPTED', 'SENT', 'DELIVERED'].includes(challenge.deliveryStatus ?? '')) throw new HttpError(401, 'OTP_NOT_DELIVERED', 'The code was not accepted by the SMS provider. Request a new code.');
    if (challenge.attempts >= 5) throw new HttpError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect codes. Request a new code.');
    if (!safeHashEqual(challenge.codeHash, hashOtp(input.phoneE164, input.code))) {
      await tx.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      return { invalid: true as const };
    }
    if (await tx.user.findUnique({ where: { phoneE164: input.phoneE164 }, select: { id: true } })) {
      await tx.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      return { invalid: true as const };
    }
    // Bind referral attribution to the OTP request so it survives app state
    // loss and cannot be swapped at verification time. Retain the verify-body
    // fallback for clients that predate this field.
    const referralCode = challenge.referralCode ?? input.referralCode;
    if (challenge.referralCode && input.referralCode && challenge.referralCode !== input.referralCode) {
      throw new HttpError(400, 'REFERRAL_CODE_MISMATCH', 'The referral code changed during registration. Request a new OTP to use a different code.');
    }
    const referrer = referralCode ? await tx.user.findUnique({ where: { referralCode }, select: { id: true, referralCode: true } }) : null;
    if (referralCode && !referrer) throw new HttpError(400, 'REFERRAL_INVALID', 'That referral code was not found. Check it or leave the field empty.');
    const user = await tx.user.create({ data: { phoneE164: input.phoneE164, publicId: newPublicUserId(), displayName: input.fullName, passwordHash, status: 'ACTIVE', welcomeBonusEligible: env.welcomeBonusEnabled, ...(referrer ? { referredById: referrer.id } : {}) } });
    if (referrer) await tx.referral.create({ data: { referrerId: referrer.id, inviteeId: user.id, referralCode: referrer.referralCode } });
    await tx.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    await tx.ledgerAccount.createMany({ data: ['AVAILABLE', 'PENDING', 'RESERVED', 'WITHDRAWAL_PENDING'].map((type) => ({ userId: user.id, type: type as 'AVAILABLE' | 'PENDING' | 'RESERVED' | 'WITHDRAWAL_PENDING', currency: 'INR' })), skipDuplicates: true });
    const welcomeBonus = await grantWelcomeBonus(tx, user.id);
    return { invalid: false as const, welcomeBonus, user };
  }, { isolationLevel: 'ReadCommitted' });
  if (result.invalid) throw new HttpError(401, 'REGISTRATION_INVALID', 'Registration could not be completed. Check the code and try again.');
  res.status(201).json({ ok: true, user: { publicId: result.user.publicId }, message: 'Registration complete. Sign in using your phone number and password.', welcomeBonus: { status: result.welcomeBonus, amountPaise: result.welcomeBonus === 'CREDITED' ? env.welcomeBonusAmountPaise : 0 } });
}));

authRouter.post('/forgot-password/request-otp', passwordResetLimit, asyncRoute(async (req, res) => {
  const input = z.object({ phoneE164: phone }).strict().parse(req.body);
  const db = databaseRequired();
  const user = await db.user.findUnique({ where: { phoneE164: input.phoneE164 }, select: { id: true } });
  let challengeId: string;
  if (user) {
    const challenge = await createOtpChallenge(input.phoneE164, 'PASSWORD_RESET');
    challengeId = challenge.challengeId;
  } else {
    // Keep the response shape and timing flow similar for unknown accounts,
    // while ensuring a decoy code is never accepted for password changes.
    const now = new Date();
    const recentCount = await db.otpChallenge.count({ where: { phoneE164: input.phoneE164, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } } });
    if (recentCount >= 5) throw new HttpError(429, 'OTP_PHONE_LIMIT', 'Too many OTP requests for this number. Try again later.');
    const last = await db.otpChallenge.findFirst({ where: { phoneE164: input.phoneE164, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (last && last.resendAt > now) throw new HttpError(429, 'OTP_COOLDOWN', 'Please wait before requesting another OTP.');
    const decoy = await db.otpChallenge.create({ data: {
      phoneE164: input.phoneE164, purpose: 'PASSWORD_RESET', codeHash: hashOtp(input.phoneE164, randomOtp()),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000), resendAt: new Date(now.getTime() + 60 * 1000), deliveryStatus: 'FAILED',
    } });
    challengeId = decoy.id;
  }
  res.status(202).json({ challengeId, expiresInSeconds: 300, resendAfterSeconds: 60, message: 'If a PaisaPay account exists for this number, a password reset OTP will be sent by SMS. Delivery depends on the SMS provider and mobile network.' });
}));

authRouter.get('/otp-status/:challengeId', statusLimit, asyncRoute(async (req, res) => {
  const challengeId = z.string().uuid().parse(req.params.challengeId);
  const db = databaseRequired();
  const challenge = await db.otpChallenge.findUnique({ where: { id: challengeId }, select: { id: true, gatewayRequestId: true, deliveryStatus: true } });
  if (!challenge) throw new HttpError(404, 'OTP_CHALLENGE_NOT_FOUND', 'OTP request was not found.');
  if (env.otpProvider === 'demo' && challenge.deliveryStatus === 'DEMO') {
    res.json({ challengeId: challenge.id, deliveryState: 'DEMO', gatewayStatus: 'NOT_SENT', message: 'Demo OTP only; no SMS was sent.' });
    return;
  }
  if (env.otpProvider === 'renflair-v1') {
    res.json({
      challengeId: challenge.id,
      deliveryState: challenge.deliveryStatus ?? 'UNKNOWN',
      gatewayStatus: challenge.deliveryStatus === 'ACCEPTED' ? 'ACCEPTED' : challenge.deliveryStatus ?? 'UNKNOWN',
      statusAvailable: false,
      message: challenge.deliveryStatus === 'ACCEPTED'
        ? 'Renflair V1 returned a JSON response to the request. The supplied API example does not define handset delivery status.'
        : 'The Renflair V1 request has no confirmed delivery state.',
    });
    return;
  }
  if (!challenge.gatewayRequestId || !challenge.deliveryStatus) {
    throw new HttpError(409, 'OTP_NOT_SUBMITTED', 'No SMS gateway submission is recorded for this OTP. Request a new code.');
  }
  try {
    const status = await getGatewaySmsStatus(challenge.gatewayRequestId);
    await db.otpChallenge.update({ where: { id: challenge.id }, data: { deliveryStatus: status.state } });
    res.json({ challengeId: challenge.id, deliveryState: status.state, gatewayStatus: status.status });
  } catch (error) {
    const gatewayError = error instanceof SmsGatewayError ? error : new SmsGatewayError('SMS_GATEWAY_UNAVAILABLE', 'SMS gateway is offline or unreachable.');
    logger.warn({ challengeId: challenge.id, code: gatewayError.code }, 'OTP SMS status could not be checked');
    throw new HttpError(503, gatewayError.code, gatewayError.message);
  }
}));

authRouter.post('/verify-otp', verifyLimit, asyncRoute(async (req, res) => {
  const input = z.object({ challengeId: z.string().uuid(), phoneE164: phone, code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  const db = databaseRequired();
  const pair = createTokenPair();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM otp_challenges WHERE id = ${input.challengeId}::uuid FOR UPDATE`;
    const challenge = await tx.otpChallenge.findUnique({ where: { id: input.challengeId } });
    if (!challenge || challenge.purpose !== 'LOGIN' || challenge.phoneE164 !== input.phoneE164 || challenge.consumedAt || challenge.expiresAt <= new Date()) throw new HttpError(401, 'OTP_INVALID', 'The code is invalid or expired. Request a new code.');
    // A generated OTP is usable only after the gateway acknowledged that it
    // accepted the send request. A timeout is ambiguous, so UNKNOWN is denied.
    const isActiveDemoChallenge = env.otpProvider === 'demo' && challenge.deliveryStatus === 'DEMO';
    if (!isActiveDemoChallenge && !['ACCEPTED', 'SENT', 'DELIVERED'].includes(challenge.deliveryStatus ?? '')) {
      throw new HttpError(401, 'OTP_NOT_DELIVERED', 'This OTP was not accepted by the SMS gateway. Request a new code.');
    }
    if (challenge.attempts >= 5) throw new HttpError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect codes. Request a new code.');
    if (!safeHashEqual(challenge.codeHash, hashOtp(input.phoneE164, input.code))) {
      await tx.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      return { invalidCode: true as const };
    }
    await tx.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    let user = await tx.user.upsert({ where: { phoneE164: input.phoneE164 }, create: { phoneE164: input.phoneE164, publicId: newPublicUserId(), welcomeBonusEligible: env.welcomeBonusEnabled }, update: {} });
    if (!user.publicId) user = await tx.user.update({ where: { id: user.id }, data: { publicId: newPublicUserId() } });
    await tx.ledgerAccount.createMany({ data: ['AVAILABLE', 'PENDING', 'RESERVED', 'WITHDRAWAL_PENDING'].map((type) => ({ userId: user.id, type: type as 'AVAILABLE' | 'PENDING' | 'RESERVED' | 'WITHDRAWAL_PENDING', currency: 'INR' })), skipDuplicates: true });
    const welcomeBonus = await grantWelcomeBonus(tx, user.id);
    const session = await tx.session.create({ data: { userId: user.id, accessTokenHash: hashToken(pair.accessToken), refreshTokenHash: hashToken(pair.refreshToken), accessExpiresAt: pair.accessExpiresAt, refreshExpiresAt: pair.refreshExpiresAt } });
    return { user, session, welcomeBonus };
  // The row lock serializes verification of a challenge. READ COMMITTED lets
  // a second concurrent verifier observe the first verifier's consumedAt
  // update instead of aborting with a serialization error.
  }, { isolationLevel: 'ReadCommitted' });
  if ('invalidCode' in result) throw new HttpError(401, 'OTP_INVALID', 'The code is incorrect.');
  res.json({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, accessExpiresInSeconds: 900, user: { id: result.user.id, publicId: result.user.publicId, displayName: result.user.displayName, status: result.user.status, referralCode: result.user.referralCode }, welcomeBonus: { status: result.welcomeBonus, amountPaise: result.welcomeBonus === 'CREDITED' ? env.welcomeBonusAmountPaise : 0 } });
}));

authRouter.post('/password/reset', passwordResetLimit, asyncRoute(async (req, res) => {
  const input = z.object({
    phoneE164: phone,
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(8).max(128),
  }).strict().parse(req.body);
  const db = databaseRequired();
  const passwordHash = await hashPassword(input.newPassword);
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM otp_challenges WHERE id = ${input.challengeId}::uuid FOR UPDATE`;
    const challenge = await tx.otpChallenge.findUnique({ where: { id: input.challengeId } });
    if (!challenge || challenge.purpose !== 'PASSWORD_RESET' || challenge.phoneE164 !== input.phoneE164 || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      throw new HttpError(401, 'PASSWORD_RESET_CODE_INVALID', 'The reset code is invalid or expired. Request a new code.');
    }
    const isTestDemo = env.isTest && env.otpProvider === 'demo' && challenge.deliveryStatus === 'DEMO';
    if (!isTestDemo && !['ACCEPTED', 'SENT', 'DELIVERED'].includes(challenge.deliveryStatus ?? '')) throw new HttpError(401, 'PASSWORD_RESET_CODE_INVALID', 'The reset code is invalid or expired. Request a new code.');
    if (challenge.attempts >= 5) throw new HttpError(429, 'PASSWORD_RESET_ATTEMPTS_EXCEEDED', 'Too many incorrect codes. Request a new code.');
    if (!safeHashEqual(challenge.codeHash, hashOtp(input.phoneE164, input.code))) {
      await tx.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      return false;
    }
    const user = await tx.user.findUnique({ where: { phoneE164: input.phoneE164 }, select: { id: true } });
    if (!user) throw new HttpError(401, 'PASSWORD_RESET_CODE_INVALID', 'The reset code is invalid or expired. Request a new code.');
    const now = new Date();
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, loginFailedAttempts: 0, loginLockedUntil: null } });
    await tx.otpChallenge.updateMany({ where: { phoneE164: input.phoneE164, purpose: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: now } });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    return true;
  }, { isolationLevel: 'ReadCommitted' });
  if (!result) throw new HttpError(401, 'PASSWORD_RESET_CODE_INVALID', 'The reset code is incorrect.');
  res.json({ ok: true, message: 'Password reset. Sign in with your new password.' });
}));

authRouter.post('/refresh', asyncRoute(async (req, res) => {
  const input = z.object({ refreshToken: z.string().min(20).max(200) }).parse(req.body);
  const db = databaseRequired();
  const oldHash = hashToken(input.refreshToken); const now = new Date();
  const session = await db.session.findUnique({ where: { refreshTokenHash: oldHash }, include: { user: true } });
  if (!session || session.revokedAt || session.refreshExpiresAt <= now) throw new HttpError(401, 'REFRESH_INVALID', 'Your session expired. Sign in again.');
  const pair = createTokenPair();
  const updated = await db.session.updateMany({ where: { id: session.id, refreshTokenHash: oldHash, revokedAt: null }, data: { accessTokenHash: hashToken(pair.accessToken), refreshTokenHash: hashToken(pair.refreshToken), accessExpiresAt: pair.accessExpiresAt, refreshExpiresAt: pair.refreshExpiresAt } });
  if (updated.count !== 1) throw new HttpError(401, 'REFRESH_REPLAYED', 'This session was already refreshed. Sign in again.');
  res.json({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, accessExpiresInSeconds: 900 });
}));

authRouter.post('/logout', asyncRoute(async (req, res) => {
  const input = z.object({ refreshToken: z.string().min(20).max(200).optional() }).parse(req.body ?? {});
  const auth = req.auth;
  if (auth) await databaseRequired().session.updateMany({ where: { id: auth.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  else if (input.refreshToken) await databaseRequired().session.updateMany({ where: { refreshTokenHash: hashToken(input.refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  res.status(204).end();
}));
