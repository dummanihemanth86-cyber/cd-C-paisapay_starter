import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

export const newOpaqueToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHmac('sha256', env.sessionHashSecret).update(token).digest('hex');
export const hashOtp = (phone: string, otp: string) => createHmac('sha256', env.sessionHashSecret).update(`${phone}:${otp}`).digest('hex');
export function safeHashEqual(left: string, right: string) {
  const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export const randomOtp = () => randomInt(0, 1_000_000).toString().padStart(6, '0');
export const uuidRef = (prefix: string) => `${prefix}-${randomBytes(12).toString('hex').toUpperCase()}`;
