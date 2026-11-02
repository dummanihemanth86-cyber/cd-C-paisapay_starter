import { Router } from 'express';
import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { databaseRequired } from '../../lib/db.js';
import { asyncRoute, HttpError } from '../../lib/http.js';
import { paiseJson } from '../../lib/money.js';
import { requireAuth } from '../../middleware/auth.js';
import { VIP_LEVEL_CONFIGURATION } from './vipConfig.js';
import { buildVipProgress } from './vipProgress.js';
import { REFERRAL_COMMISSION_PERCENT_BPS, INDIRECT_REFERRAL_COMMISSION_PERCENT_BPS } from './referralCommission.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

function encryptAccountNumber(accountNumber: string) {
  if (!env.bankAccountEncryptionKey) throw new HttpError(503, 'BANK_STORAGE_UNAVAILABLE', 'Encrypted bank-account storage is not configured on this server.');
  const key = Buffer.from(env.bankAccountEncryptionKey, 'hex');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
  const indexKey = createHmac('sha256', key).update('paisapay-bank-account-index-v1').digest();
  const hash = createHmac('sha256', indexKey).update(accountNumber).digest('hex');
  return { accountNumberCiphertext: ciphertext.toString('base64'), accountNumberNonce: nonce.toString('base64'), accountNumberTag: cipher.getAuthTag().toString('base64'), accountNumberHash: hash, accountLast4: accountNumber.slice(-4) };
}

function bankAccountResponse(account: { id: string; accountHolderName: string; bankName: string | null; accountLast4: string; ifsc: string; verificationStatus: string; verifiedAt: Date | null; createdAt: Date }) {
  return { id: account.id, accountHolderName: account.accountHolderName, bankName: account.bankName, maskedAccountNumber: `••••${account.accountLast4}`, ifsc: account.ifsc, verificationStatus: account.verificationStatus, verifiedAt: account.verifiedAt, createdAt: account.createdAt };
}

usersRouter.get('/me', asyncRoute(async (req, res) => {
  const user = await databaseRequired().user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { id: true, publicId: true, phoneE164: true, displayName: true, avatarId: true, status: true, referralCode: true, createdAt: true } });
  res.json({ user });
}));

usersRouter.get('/me/vip', asyncRoute(async (req, res) => {
  const db = databaseRequired();
  const userId = req.auth!.userId;
  const [configuredLevels, settledOffers, verifiedOrders, vipRewardEvents] = await Promise.all([
    db.vipLevel.findMany({ where: { enabled: true }, orderBy: { levelNumber: 'asc' } }),
    db.p2pWithdrawalOffer.aggregate({ where: { userId, status: 'SETTLED' }, _sum: { amountPaise: true } }),
    db.p2pDepositOrder.aggregate({ where: { status: 'COMPLETED', OR: [{ buyerUserId: userId }, { sellerUserId: userId }] }, _sum: { amountPaise: true } }),
    db.ledgerTransaction.findMany({ where: { eventType: 'VIP_LEVEL_REWARD', referenceType: 'VIP_LEVEL', referenceId: { startsWith: `${userId}:` } }, select: { referenceId: true, metadata: true } }),
  ]);
  const withdrawalVolumePaise = settledOffers._sum.amountPaise ?? 0n;
  const orderVolumePaise = verifiedOrders._sum.amountPaise ?? 0n;
  const credited = new Map(vipRewardEvents.map((entry) => {
    const levelNumber = Number(entry.referenceId.slice(`${userId}:`.length));
    const metadata = entry.metadata as { amountPaise?: string };
    return [levelNumber, metadata.amountPaise ?? '0'] as const;
  }));
  const progress = buildVipProgress({
    configuredLevels,
    settledWithdrawalPaise: withdrawalVolumePaise,
    verifiedOrderPaise: orderVolumePaise,
    creditedRewards: credited,
  });
  res.json({
    programStatus: configuredLevels.length >= VIP_LEVEL_CONFIGURATION.length ? 'ACTIVE' : 'SETUP_REQUIRED',
    currentLevel: progress.currentLevel,
    activeLevels: progress.activeLevels,
    levels: progress.levels,
    volume: { settledWithdrawalPaise: Number(withdrawalVolumePaise), verifiedOrderPaise: Number(orderVolumePaise), currency: 'INR' },
    rewardPolicy: 'Rewards are shown as pending until an approved, funded VIP reward pool is configured. Only ledger records marked CREDITED have been paid.',
  });
}));

usersRouter.patch('/me', asyncRoute(async (req, res) => {
  const input = z.object({
    displayName: z.string().trim().min(2).max(80).optional(),
    avatarId: z.enum(['boy_aarav', 'boy_veer', 'boy_kabir', 'girl_anya', 'girl_myra', 'girl_tara']).nullable().optional(),
    referralCode: z.string().trim().min(4).max(60).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'Provide a profile field to update.').parse(req.body);
  const db = databaseRequired();
  const user = await db.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    let referrerId: string | undefined;
    if (input.referralCode && !current.referredById) {
      const referrer = await tx.user.findUnique({ where: { referralCode: input.referralCode } });
      if (!referrer || referrer.id === current.id) throw new HttpError(400, 'REFERRAL_INVALID', 'Referral code is not valid.');
      const visited = new Set<string>();
      let ancestorId: string | null = referrer.id;
      while (ancestorId) {
        if (ancestorId === current.id || visited.has(ancestorId)) throw new HttpError(409, 'REFERRAL_CYCLE', 'This referral would create an invalid referral hierarchy.');
        visited.add(ancestorId);
        const ancestor: { referredById: string | null } | null = await tx.user.findUnique({ where: { id: ancestorId }, select: { referredById: true } });
        ancestorId = ancestor?.referredById ?? null;
      }
      referrerId = referrer.id;
      await tx.referral.create({ data: { referrerId, inviteeId: current.id, referralCode: input.referralCode } });
    }
    return tx.user.update({ where: { id: current.id }, data: { ...(input.displayName !== undefined ? { displayName: input.displayName } : {}), ...(input.avatarId !== undefined ? { avatarId: input.avatarId } : {}), ...(input.displayName !== undefined ? { status: 'ACTIVE' } : {}), ...(referrerId ? { referredById: referrerId } : {}) }, select: { id: true, phoneE164: true, displayName: true, avatarId: true, status: true, referralCode: true } });
  });
  res.json({ user });
}));

// Basic UPI ID format validation is not ownership verification. This API never
// asks for a UPI PIN/OTP and always reports UNVERIFIED until an approved
// verification provider is added.
const upiIdSchema = z.string().trim().min(3).max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,48}@[A-Za-z0-9][A-Za-z0-9.-]{1,48}$/, 'Enter a UPI ID in name@provider format.');

usersRouter.get('/me/upi', asyncRoute(async (req, res) => {
  const user = await databaseRequired().user.findUniqueOrThrow({
    where: { id: req.auth!.userId }, select: { upiId: true, upiDisplayName: true, upiIdVerifiedAt: true },
  });
  res.json({
    upiId: user.upiId,
    displayName: user.upiDisplayName,
    detailsStatus: user.upiId && user.upiDisplayName ? 'USER_CONFIRMED' : 'NOT_SET',
    verificationStatus: user.upiIdVerifiedAt ? 'VERIFIED' : user.upiId ? 'UNVERIFIED_FORMAT_ONLY' : 'NOT_SET',
    message: user.upiIdVerifiedAt ? 'Ownership was confirmed by an authorized verification flow.' : 'Saved details are user-provided; PaisaPay has not verified UPI ownership.',
  });
}));

usersRouter.patch('/me/upi', asyncRoute(async (req, res) => {
  const input = z.object({
    upiId: upiIdSchema,
    displayName: z.string().trim().min(2).max(100).optional(),
    // Accept common account-name field names from older mobile builds while
    // keeping displayName as the canonical API field.
    name: z.string().trim().min(2).max(100).optional(),
    accountName: z.string().trim().min(2).max(100).optional(),
  }).parse(req.body);
  const displayName = input.displayName ?? input.name ?? input.accountName;
  if (!displayName) throw new HttpError(400, 'UPI_NAME_REQUIRED', 'Enter the account name shown in your UPI app.');
  const updated = await databaseRequired().user.update({
    where: { id: req.auth!.userId }, data: { upiId: input.upiId, upiDisplayName: displayName, upiIdVerifiedAt: null },
    select: { upiId: true, upiDisplayName: true, upiIdVerifiedAt: true },
  });
  res.json({ upiId: updated.upiId, displayName: updated.upiDisplayName, detailsStatus: 'USER_CONFIRMED', verificationStatus: 'UNVERIFIED_FORMAT_ONLY', message: 'UPI name and ID saved and confirmed by you. PaisaPay has not verified ownership.' });
}));

usersRouter.delete('/me/upi', asyncRoute(async (req, res) => {
  await databaseRequired().user.update({
    where: { id: req.auth!.userId }, data: { upiId: null, upiDisplayName: null, upiIdVerifiedAt: null }, select: { id: true },
  });
  res.json({ upiId: null, displayName: null, detailsStatus: 'NOT_SET', verificationStatus: 'NOT_SET' });
}));

const ifscSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code.');
const bankAccountInput = z.object({
  accountHolderName: z.string().trim().min(2).max(100),
  accountNumber: z.string().regex(/^\d{8,20}$/),
  confirmAccountNumber: z.string().regex(/^\d{8,20}$/),
  ifsc: ifscSchema,
  bankName: z.string().trim().min(2).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.accountNumber !== value.confirmAccountNumber) ctx.addIssue({ code: 'custom', path: ['confirmAccountNumber'], message: 'Account numbers do not match.' });
});

usersRouter.get('/me/bank-accounts', asyncRoute(async (req, res) => {
  const accounts = await databaseRequired().bankAccount.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' } });
  res.json({ bankAccounts: accounts.map(bankAccountResponse), ownershipVerificationAvailable: false, message: 'Saved bank accounts are unverified until an authorized bank-verification service is configured.' });
}));

usersRouter.post('/me/bank-accounts', asyncRoute(async (req, res) => {
  const input = bankAccountInput.parse(req.body);
  const encrypted = encryptAccountNumber(input.accountNumber);
  try {
    const account = await databaseRequired().bankAccount.create({ data: { userId: req.auth!.userId, accountHolderName: input.accountHolderName, bankName: input.bankName?.trim() || null, ifsc: input.ifsc, ...encrypted } });
    res.status(201).json({ bankAccount: bankAccountResponse(account), message: 'Bank details saved encrypted. Format checks do not verify account ownership; this account cannot receive withdrawals until an authorized verification flow is available.' });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw new HttpError(409, 'BANK_ACCOUNT_ALREADY_SAVED', 'This bank account is already saved.');
    throw error;
  }
}));

usersRouter.patch('/me/bank-accounts/:id', asyncRoute(async (req, res) => {
  const input = z.object({ accountHolderName: z.string().trim().min(2).max(100).optional(), bankName: z.string().trim().min(2).max(100).nullable().optional(), ifsc: ifscSchema.optional() }).strict().refine((value) => Object.keys(value).length > 0).parse(req.body);
  const db = databaseRequired();
  const updated = await db.bankAccount.updateMany({ where: { id: req.params.id, userId: req.auth!.userId }, data: { ...input, verificationStatus: 'UNVERIFIED', verifiedAt: null } });
  if (updated.count !== 1) throw new HttpError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank account was not found.');
  const account = await db.bankAccount.findFirstOrThrow({ where: { id: req.params.id, userId: req.auth!.userId } });
  res.json({ bankAccount: bankAccountResponse(account), message: 'Bank details updated. Ownership remains unverified.' });
}));

usersRouter.delete('/me/bank-accounts/:id', asyncRoute(async (req, res) => {
  const deleted = await databaseRequired().bankAccount.deleteMany({ where: { id: req.params.id, userId: req.auth!.userId } });
  if (deleted.count !== 1) throw new HttpError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank account was not found.');
  res.json({ ok: true, message: 'Bank account removed.' });
}));

usersRouter.post('/me/bank-accounts/:id/verify', asyncRoute(async (req, res) => {
  const account = await databaseRequired().bankAccount.findFirst({ where: { id: req.params.id, userId: req.auth!.userId }, select: { id: true } });
  if (!account) throw new HttpError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank account was not found.');
  throw new HttpError(503, 'BANK_ACCOUNT_VERIFICATION_UNAVAILABLE', 'No authorized bank-account or penny-drop verification provider is configured. This account remains unverified.');
}));

usersRouter.get('/me/balance', asyncRoute(async (req, res) => {
  const db = databaseRequired();
  const [accounts, rewardProfit] = await Promise.all([
    db.ledgerAccount.findMany({ where: { userId: req.auth!.userId }, include: { entries: { select: { debitPaise: true, creditPaise: true } } } }),
    db.ledgerEntry.aggregate({
      where: {
        account: { userId: req.auth!.userId, type: 'AVAILABLE' },
        transaction: { eventType: { in: ['UPI_DEPOSIT_REWARD', 'P2P_VERIFIED_ORDER_REWARD'] } },
      },
      _sum: { creditPaise: true },
    }),
  ]);
  const balances = { availablePaise: 0n, pendingPaise: 0n, reservedPaise: 0n, withdrawalPendingPaise: 0n };
  for (const account of accounts) {
    const total = account.entries.reduce((sum, entry) => sum + entry.creditPaise - entry.debitPaise, 0n);
    if (account.type === 'AVAILABLE') balances.availablePaise = total;
    if (account.type === 'PENDING') balances.pendingPaise = total;
    if (account.type === 'RESERVED') balances.reservedPaise = total;
    if (account.type === 'WITHDRAWAL_PENDING') balances.withdrawalPendingPaise = total;
  }
  res.json({ currency: 'INR', availablePaise: paiseJson(balances.availablePaise), pendingPaise: paiseJson(balances.pendingPaise), reservedPaise: paiseJson(balances.reservedPaise), withdrawalPendingPaise: paiseJson(balances.withdrawalPendingPaise), rewardProfitPaise: paiseJson(rewardProfit._sum.creditPaise ?? 0n), authoritative: true });
}));

usersRouter.get('/me/transactions', asyncRoute(async (req, res) => {
  const rows = await databaseRequired().ledgerEntry.findMany({ where: { account: { userId: req.auth!.userId } }, include: { transaction: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ currency: 'INR', transactions: rows.map((row) => ({ id: row.id, type: row.debitPaise > 0n ? 'DEBIT' : 'CREDIT', amountPaise: paiseJson(row.debitPaise || row.creditPaise), reference: row.transaction.referenceId, description: row.transaction.eventType, displayDescription: row.transaction.eventType === 'WELCOME_BONUS' ? 'Development test welcome bonus (not redeemable)' : row.transaction.eventType, createdAt: row.createdAt })) });
}));

usersRouter.get('/me/referrals', asyncRoute(async (req, res) => {
  const db = databaseRequired();
  const direct = await db.user.findMany({ where: { referredById: req.auth!.userId }, select: { id: true, displayName: true, phoneE164: true, createdAt: true } });
  const indirect = direct.length ? await db.user.findMany({ where: { referredById: { in: direct.map((member) => member.id) } }, select: { id: true, displayName: true, phoneE164: true, createdAt: true } }) : [];
  const query = z.object({ period: z.enum(['today', '7d', '30d', 'all']).default('all') }).parse(req.query);
  const now = new Date();
  const since = query.period === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : query.period === '7d' ? new Date(now.getTime() - 7 * 86400000) : query.period === '30d' ? new Date(now.getTime() - 30 * 86400000) : null;
  const periodCreatedAt = since ? { gte: since } : undefined;
  const memberIds = [...direct, ...indirect].map((member) => member.id);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [me, program, milestoneRules, commissionAll, commissionStats, memberCommissionGroups, commissionPeriod, commissionToday, depositGroups, allDepositGroups, todayDepositGroups, todayDirect, todayIndirect] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { referralCode: true } }),
    db.referralProgramConfig.upsert({ where: { id: 1 }, create: { id: 1, directRateBps: REFERRAL_COMMISSION_PERCENT_BPS, indirectRateBps: INDIRECT_REFERRAL_COMMISSION_PERCENT_BPS }, update: {} }),
    db.referralMilestoneRule.findMany({ where: { enabled: true }, orderBy: { requiredReferrals: 'asc' } }),
    db.commissionEntry.findMany({ where: { userId: req.auth!.userId }, select: { id: true, amountPaise: true, status: true, kind: true, level: true, createdAt: true, qualifyingReference: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.commissionEntry.groupBy({ by: ['kind', 'status'], where: { userId: req.auth!.userId }, _sum: { amountPaise: true } }),
    db.commissionEntry.groupBy({ by: ['sourceUserId'], where: { userId: req.auth!.userId, status: { not: 'REVERSED' }, sourceUserId: { in: memberIds } }, _sum: { amountPaise: true } }),
    db.commissionEntry.aggregate({ where: { userId: req.auth!.userId, ...(periodCreatedAt ? { createdAt: periodCreatedAt } : {}), status: { not: 'REVERSED' } }, _sum: { amountPaise: true } }),
    db.commissionEntry.aggregate({ where: { userId: req.auth!.userId, createdAt: { gte: todayStart }, status: { not: 'REVERSED' } }, _sum: { amountPaise: true } }),
    memberIds.length ? db.deposit.groupBy({ by: ['userId'], where: { userId: { in: memberIds }, status: { in: ['PAYMENT_VERIFIED', 'COMPLETED'] }, currency: 'INR', ...(periodCreatedAt ? { createdAt: periodCreatedAt } : {}) }, _sum: { amountPaise: true }, _count: true }) : Promise.resolve([]),
    memberIds.length ? db.deposit.groupBy({ by: ['userId'], where: { userId: { in: memberIds }, status: { in: ['PAYMENT_VERIFIED', 'COMPLETED'] }, currency: 'INR' }, _sum: { amountPaise: true }, _count: true }) : Promise.resolve([]),
    memberIds.length ? db.deposit.groupBy({ by: ['userId'], where: { userId: { in: memberIds }, status: { in: ['PAYMENT_VERIFIED', 'COMPLETED'] }, currency: 'INR', createdAt: { gte: todayStart } }, _sum: { amountPaise: true }, _count: true }) : Promise.resolve([]),
    db.user.count({ where: { referredById: req.auth!.userId, createdAt: { gte: todayStart } } }),
    direct.length ? db.user.count({ where: { referredById: { in: direct.map((member) => member.id) }, createdAt: { gte: todayStart } } }) : Promise.resolve(0),
  ]);
  const depositsByUser = new Map(allDepositGroups.map((row) => [row.userId, row._sum.amountPaise ?? 0n]));
  const commissionBySource = new Map(memberCommissionGroups.filter((row) => row.sourceUserId).map((row) => [row.sourceUserId!, row._sum.amountPaise ?? 0n]));
  const teamDepositTotal = depositGroups.reduce((sum, row) => sum + (row._sum.amountPaise ?? 0n), 0n);
  const todayDepositTotal = todayDepositGroups.reduce((sum, row) => sum + (row._sum.amountPaise ?? 0n), 0n);
  const periodDepositCount = depositGroups.reduce((sum, row) => sum + row._count, 0);
  const todayDepositCount = todayDepositGroups.reduce((sum, row) => sum + row._count, 0);
  const lifetimeDepositCount = allDepositGroups.reduce((sum, row) => sum + row._count, 0);
  const totalBy = (kind: string, statuses: string[]) => commissionStats.filter((item) => item.kind === kind && statuses.includes(item.status)).reduce((sum, item) => sum + (item._sum.amountPaise ?? 0n), 0n);
  const todayCommissionPaise = commissionPeriod._sum.amountPaise ?? 0n;
  const actualTodayCommissionPaise = commissionToday._sum.amountPaise ?? 0n;
  const totalCommissionPaise = commissionStats.filter((item) => item.status !== 'REVERSED').reduce((sum, item) => sum + (item._sum.amountPaise ?? 0n), 0n);
  const earnedCommissionPaise = totalBy('DIRECT_COMMISSION', ['CREDITED', 'SETTLED']) + totalBy('INDIRECT_COMMISSION', ['CREDITED', 'SETTLED']) + totalBy('MILESTONE_REWARD', ['CREDITED', 'SETTLED']);
  const pendingCommissionPaise = commissionStats.filter((item) => item.status === 'PENDING').reduce((sum, item) => sum + (item._sum.amountPaise ?? 0n), 0n);
  const directCommissionPaise = totalBy('DIRECT_COMMISSION', ['CREDITED', 'SETTLED', 'PENDING']);
  const indirectCommissionPaise = totalBy('INDIRECT_COMMISSION', ['CREDITED', 'SETTLED', 'PENDING']);
  const milestoneEntries = new Map(commissionAll.filter((item) => item.kind === 'MILESTONE_REWARD').map((item) => [item.qualifyingReference, item]));
  const mask = (phone: string) => `${phone.slice(0, 3)}••••${phone.slice(-3)}`;
  res.json({
    referralCode: me.referralCode,
    referralLink: `paisapay://register?ref=${encodeURIComponent(me.referralCode)}`,
    period: query.period,
    directCount: direct.length,
    indirectCount: indirect.length,
    totalMembers: direct.length + indirect.length,
    todayNewMembers: todayDirect + todayIndirect,
    todayDirectMembers: todayDirect,
    todayIndirectMembers: todayIndirect,
    periodVerifiedDepositsPaise: paiseJson(teamDepositTotal),
    todayVerifiedDepositsPaise: paiseJson(todayDepositTotal),
    periodVerifiedDepositCount: periodDepositCount,
    todayVerifiedDepositCount: todayDepositCount,
    totalVerifiedDepositCount: lifetimeDepositCount,
    totalVerifiedDepositsPaise: paiseJson(allDepositGroups.reduce((sum, row) => sum + (row._sum.amountPaise ?? 0n), 0n)),
    totalEarningsPaise: paiseJson(earnedCommissionPaise),
    todayEarningsPaise: paiseJson(actualTodayCommissionPaise),
    periodEarningsPaise: paiseJson(todayCommissionPaise),
    directEarningsPaise: paiseJson(directCommissionPaise),
    indirectEarningsPaise: paiseJson(indirectCommissionPaise),
    earnedCommissionPaise: paiseJson(earnedCommissionPaise),
    pendingCommissionPaise: paiseJson(pendingCommissionPaise),
    accruedCommissionPaise: paiseJson(totalCommissionPaise),
    commissionPercentBps: program.directRateBps,
    commissionRates: { directBps: program.directRateBps, indirectBps: program.indirectRateBps },
    commissionBasis: 'Eligible successful INR transactions only after server-side verified deposit or Finance-verified P2P receipt.',
    commissionRuleConfigured: true,
    fundedProgram: false,
    payoutRulesConfigured: false,
    rewardFundingMessage: 'Referral commissions and milestone rewards remain pending. A funded, approved payout program is not configured; no wallet balance is credited.',
    milestones: milestoneRules.map((rule) => {
      const eligibleCount = rule.qualifyingTopUpPaise ? direct.filter((member) => (depositsByUser.get(member.id) ?? 0n) >= rule.qualifyingTopUpPaise!).length : 0;
      const entry = milestoneEntries.get(`REFERRAL:MILESTONE:${req.auth!.userId}:${rule.key}`);
      return { key: rule.key, requiredReferrals: rule.requiredReferrals, qualifyingTopUpPaise: rule.qualifyingTopUpPaise === null ? null : paiseJson(rule.qualifyingTopUpPaise), rewardAmountPaise: paiseJson(rule.rewardAmountPaise), qualifiedReferrals: eligibleCount, status: entry?.status ?? (eligibleCount >= rule.requiredReferrals && rule.qualifyingTopUpPaise ? 'ELIGIBLE_PENDING_REVIEW' : rule.qualifyingTopUpPaise ? 'IN_PROGRESS' : 'SETUP_REQUIRED') };
    }),
    commissionHistory: commissionAll.map((entry) => ({ id: entry.id, amountPaise: paiseJson(entry.amountPaise), status: entry.status, kind: entry.kind, level: entry.level, createdAt: entry.createdAt })),
    members: [
      ...direct.map((member) => ({ id: member.id, displayName: member.displayName, permittedIdentifier: mask(member.phoneE164), depth: 1, joinedAt: member.createdAt, verifiedTopUpPaise: paiseJson(depositsByUser.get(member.id) ?? 0n), earningsGeneratedPaise: paiseJson(commissionBySource.get(member.id) ?? 0n) })),
      ...indirect.map((member) => ({ id: member.id, displayName: member.displayName, permittedIdentifier: mask(member.phoneE164), depth: 2, joinedAt: member.createdAt, verifiedTopUpPaise: paiseJson(depositsByUser.get(member.id) ?? 0n), earningsGeneratedPaise: paiseJson(commissionBySource.get(member.id) ?? 0n) })),
    ],
  });
}));
