import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

export const prisma = env.databaseUrl
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) })
  : null;

export function databaseRequired() {
  if (!prisma) {
    const error = new Error('Database is not configured. Set DATABASE_URL and restart the server.');
    Object.assign(error, { statusCode: 503, code: 'DATABASE_NOT_CONFIGURED' });
    throw error;
  }
  return prisma;
}

export async function closeDatabase() {
  await prisma?.$disconnect();
}
