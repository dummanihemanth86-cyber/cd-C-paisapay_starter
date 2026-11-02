import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { VIP_LEVEL_CONFIGURATION } from '../src/modules/users/vipConfig.js';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before configuring VIP levels.');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  for (const level of VIP_LEVEL_CONFIGURATION) {
    await prisma.vipLevel.upsert({
      where: { levelNumber: level.levelNumber },
      create: {
        levelNumber: level.levelNumber,
        displayName: level.displayName,
        eligibility: { metric: level.metric, targetPaise: String(level.targetPaise) },
        benefits: { rewardPaise: String(level.rewardPaise), rewardStatus: 'PENDING_FUNDED_PROGRAM' },
        enabled: true,
      },
      update: {
        displayName: level.displayName,
        eligibility: { metric: level.metric, targetPaise: String(level.targetPaise) },
        benefits: { rewardPaise: String(level.rewardPaise), rewardStatus: 'PENDING_FUNDED_PROGRAM' },
        enabled: true,
      },
    });
  }
  console.info('Configured VIP levels 1–5. This changes program configuration only; it creates no wallet credits.');
} finally {
  await prisma.$disconnect();
}
