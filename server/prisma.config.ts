import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { assertProductionDatabaseUrl } from './src/config/databaseUrlSecurity.js';

const configuredDatabaseUrls = [
  ['DIRECT_DATABASE_URL', process.env.DIRECT_DATABASE_URL],
  ['DATABASE_URL_UNPOOLED', process.env.DATABASE_URL_UNPOOLED],
  ['DATABASE_URL', process.env.DATABASE_URL],
] as const;
const migrationDatabaseUrl = configuredDatabaseUrls.find(([, value]) => value?.trim())?.[1];

if (process.env.NODE_ENV === 'production') {
  if (!migrationDatabaseUrl) throw new Error('A production PostgreSQL URL is required for Prisma migrations.');
  for (const [name, value] of configuredDatabaseUrls) {
    if (value?.trim()) assertProductionDatabaseUrl(name, value);
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // Client generation does not need a live database URL. Migrations will fail
  // clearly until DATABASE_URL is configured.
  // Prefer a direct/unpooled endpoint for migrations when the provider
  // supplies one. Render can set DIRECT_DATABASE_URL; Neon supplies
  // DATABASE_URL_UNPOOLED. Otherwise, use DATABASE_URL for both.
  datasource: {
    url: migrationDatabaseUrl ?? '',
  },
});
