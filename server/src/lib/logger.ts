import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['req.headers.authorization', 'password', 'otp', 'token', 'DATABASE_URL'], censor: '[REDACTED]' },
});
