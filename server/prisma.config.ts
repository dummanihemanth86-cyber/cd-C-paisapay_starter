import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // Client generation does not need a live database URL. Migrations will fail
  // clearly until DATABASE_URL is configured.
  // Use a direct connection for migrations. Neon CLI supplies
  // DATABASE_URL_UNPOOLED; Render may instead set DIRECT_DATABASE_URL.
  // The application runtime continues to use the pooled DATABASE_URL.
  datasource: {
    url: process.env.DIRECT_DATABASE_URL
      ?? process.env.DATABASE_URL_UNPOOLED
      ?? process.env.DATABASE_URL
      ?? '',
  },
});
