import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/db.js';
import { hashToken } from '../lib/security.js';
import { hashPassword } from '../lib/password.js';

const integration = describe.skipIf(!prisma);

integration('UPI profile and manual deposit reconciliation (PostgreSQL integration)', () => {
  const db = prisma!;
  const previousDepositReceiver = env.depositReceiverUpiId;
  const previousFinancialOperationsEnabled = env.financialOperationsEnabled;
  const previousManualUpiOperationsEnabled = env.manualUpiOperationsEnabled;
  const customerPhone = `+919${randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '7')}`;
  const adminPhone = `+918${randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '6')}`;
  const referrerPhone = `+917${randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '5')}`;
  const ancestorPhone = `+916${randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '4')}`;
  const customerToken = randomUUID();
  const adminToken = randomUUID();
  const referrerToken = randomUUID();
  const ancestorToken = randomUUID();
  const adminPassword = `Test-${randomUUID()}-Admin!`;
  let customerId = '';
  let adminId = '';
  let referrerId = '';
  let ancestorId = '';
  let depositId = '';
  const depositIds: string[] = [];
  let receiverVpa = '';
  let bankAccountId = '';
  let originalProgram: { directRateBps: number; indirectRateBps: number } | null = null;
  let originalMilestone: { requiredReferrals: number; qualifyingTopUpPaise: bigint | null; rewardAmountPaise: bigint; enabled: boolean } | null = null;
  const bankNumber = `12345678${randomUUID().replace(/\D/g, '').padEnd(12, '7').slice(0, 12)}`;

  beforeAll(async () => {
    await db.$connect();
    env.financialOperationsEnabled = true;
    env.manualUpiOperationsEnabled = true;
    env.depositReceiverUpiId = 'test-only@okaxis';
    const [customer, admin, referrer, ancestor] = await Promise.all([
      db.user.create({ data: { phoneE164: customerPhone, displayName: 'UPI Test Customer' } }),
      db.user.create({ data: { phoneE164: adminPhone, displayName: 'Finance Test Reviewer', status: 'ACTIVE' } }),
      db.user.create({ data: { phoneE164: referrerPhone, displayName: 'Referral Direct', status: 'ACTIVE' } }),
      db.user.create({ data: { phoneE164: ancestorPhone, displayName: 'Referral Indirect', status: 'ACTIVE' } }),
    ]);
    customerId = customer.id;
    adminId = admin.id;
    referrerId = referrer.id;
    ancestorId = ancestor.id;
    await db.adminUser.create({ data: { userId: admin.id, role: 'ADMIN' } });
    await db.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(adminPassword) } });
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: customer.id }, data: { referredById: referrer.id } });
      await tx.user.update({ where: { id: referrer.id }, data: { referredById: ancestor.id } });
      await tx.referral.createMany({ data: [
        { referrerId: referrer.id, inviteeId: customer.id, referralCode: referrer.referralCode },
        { referrerId: ancestor.id, inviteeId: referrer.id, referralCode: ancestor.referralCode },
      ] });
      originalProgram = await tx.referralProgramConfig.upsert({ where: { id: 1 }, create: { id: 1, directRateBps: 40, indirectRateBps: 10 }, update: {} });
      originalMilestone = await tx.referralMilestoneRule.findUniqueOrThrow({ where: { key: 'TIER_5' }, select: { requiredReferrals: true, qualifyingTopUpPaise: true, rewardAmountPaise: true, enabled: true } });
    });
    const now = new Date();
    await db.session.createMany({ data: [
      { userId: customer.id, accessTokenHash: hashToken(customerToken), refreshTokenHash: hashToken(randomUUID()), accessExpiresAt: new Date(now.getTime() + 60_000), refreshExpiresAt: new Date(now.getTime() + 120_000) },
      { userId: admin.id, accessTokenHash: hashToken(adminToken), refreshTokenHash: hashToken(randomUUID()), accessExpiresAt: new Date(now.getTime() + 60_000), refreshExpiresAt: new Date(now.getTime() + 120_000) },
      { userId: referrer.id, accessTokenHash: hashToken(referrerToken), refreshTokenHash: hashToken(randomUUID()), accessExpiresAt: new Date(now.getTime() + 60_000), refreshExpiresAt: new Date(now.getTime() + 120_000) },
      { userId: ancestor.id, accessTokenHash: hashToken(ancestorToken), refreshTokenHash: hashToken(randomUUID()), accessExpiresAt: new Date(now.getTime() + 60_000), refreshExpiresAt: new Date(now.getTime() + 120_000) },
    ] });
    const depositResponse = await request(app).post('/api/v1/deposits')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `UPI_MANUAL_TEST:${randomUUID()}`)
      .send({ amountPaise: 10000, method: 'UPI' }).expect(201);
    depositId = depositResponse.body.deposit.id;
    depositIds.push(depositId);
    receiverVpa = depositResponse.body.deposit.receiverVpa;
  });

  afterAll(async () => {
    env.financialOperationsEnabled = previousFinancialOperationsEnabled;
    env.manualUpiOperationsEnabled = previousManualUpiOperationsEnabled;
    env.depositReceiverUpiId = previousDepositReceiver;
    if (!customerId || !adminId) return;
    await db.$transaction(async (tx) => {
      if (originalProgram) await tx.referralProgramConfig.update({ where: { id: 1 }, data: originalProgram });
      if (originalMilestone) await tx.referralMilestoneRule.update({ where: { key: 'TIER_5' }, data: originalMilestone });
    });
    const deposits = await db.deposit.findMany({ where: { id: { in: depositIds } }, select: { id: true, merchantReference: true, ledgerTransactionId: true } });
    await db.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({ where: { target: { in: depositIds.map((id) => `DEPOSIT:${id}`) } } });
      await tx.auditLog.deleteMany({ where: { target: { in: ['REFERRAL_PROGRAM:CONFIG', 'REFERRAL_MILESTONE:TIER_5', `USER:${referrerId}`] } } });
      await tx.commissionEntry.deleteMany({ where: { userId: { in: [customerId, referrerId, ancestorId] }, OR: [{ sourceUserId: { in: [customerId, referrerId] } }, { kind: 'MILESTONE_REWARD' }] } });
      await tx.notification.deleteMany({ where: { userId: { in: [customerId, adminId, referrerId, ancestorId] } } });
      await tx.manualPaymentClaim.deleteMany({ where: { depositId: { in: depositIds } } });
      await tx.referral.deleteMany({ where: { inviteeId: { in: [customerId, referrerId] } } });
      await tx.reconciliationRecord.deleteMany({ where: { provider: 'MANUAL_UPI', internalReference: { in: deposits.map((item) => item.merchantReference) } } });
      await tx.deposit.deleteMany({ where: { id: { in: depositIds } } });
      if (bankAccountId) await tx.bankAccount.deleteMany({ where: { id: bankAccountId } });
      const ledgerTransactionIds = deposits.map((item) => item.ledgerTransactionId).filter((id): id is string => Boolean(id));
      if (ledgerTransactionIds.length) {
        await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: ledgerTransactionIds } } });
        await tx.ledgerTransaction.deleteMany({ where: { id: { in: ledgerTransactionIds } } });
      }
      await tx.ledgerEntry.deleteMany({ where: { transaction: { referenceId: { in: depositIds } } } });
      await tx.ledgerTransaction.deleteMany({ where: { referenceId: { in: depositIds } } });
      await tx.session.deleteMany({ where: { userId: { in: [customerId, adminId, referrerId, ancestorId] } } });
      await tx.adminUser.deleteMany({ where: { userId: adminId } });
      await tx.ledgerEntry.deleteMany({ where: { account: { userId: { in: [customerId, referrerId, ancestorId] } } } });
      await tx.ledgerAccount.deleteMany({ where: { userId: { in: [customerId, referrerId, ancestorId] } } });
      await tx.user.updateMany({ where: { id: { in: [customerId, referrerId] } }, data: { referredById: null } });
      await tx.user.deleteMany({ where: { id: { in: [customerId, adminId, referrerId, ancestorId] } } });
    });
    await db.$disconnect();
  });

  it('saves a UPI ID as unverified, submits a claim, and credits only after Finance confirms receipt', async () => {
    const customerAuth = { Authorization: `Bearer ${customerToken}` };
    const adminAuth = { Authorization: `Bearer ${adminToken}` };

    // Finance can search masked user details while reconciling a payment, but
    // cannot perform Operations-only account status changes.
    await db.adminUser.update({ where: { userId: adminId }, data: { role: 'FINANCE' } });
    try {
      const access = await request(app).get('/api/v1/admin/me').set(adminAuth).expect(200);
      expect(access.body.role).toBe('FINANCE');
      expect(access.body.allowedSections).toContain('users');
      const users = await request(app).get(`/api/v1/admin/users?q=${encodeURIComponent(customerPhone)}`).set(adminAuth).expect(200);
      const listedCustomer = users.body.users.find((user: { id: string }) => user.id === customerId);
      expect(listedCustomer?.phoneMasked).toContain('****');
      const detail = await request(app).get(`/api/v1/admin/users/${customerId}`).set(adminAuth).expect(200);
      expect(detail.body.user.phoneMasked).toBe(listedCustomer.phoneMasked);
      expect(detail.body.user).not.toHaveProperty('phoneE164');
      await request(app).post(`/api/v1/admin/users/${customerId}/status`).set(adminAuth).send({ status: 'SUSPENDED', reason: 'Unauthorized finance account action.' }).expect(403);
    } finally {
      await db.adminUser.update({ where: { userId: adminId }, data: { role: 'ADMIN' } });
    }
    expect((await request(app).get('/api/v1/admin/me').set(customerAuth).expect(403)).body.error.code).toBe('ADMIN_REQUIRED');

    const configuration = await request(app).get('/api/v1/admin/referrals/config').set(adminAuth).expect(200);
    expect(configuration.body.config).toMatchObject({ directRateBps: originalProgram!.directRateBps, indirectRateBps: originalProgram!.indirectRateBps });
    await request(app).patch('/api/v1/admin/referrals/config').set(adminAuth).send({ directRateBps: 50, indirectRateBps: 20, reason: 'Exercise referral configuration audit.' }).expect(200);
    await request(app).patch('/api/v1/admin/referrals/config').set(adminAuth).send({ directRateBps: originalProgram!.directRateBps, indirectRateBps: originalProgram!.indirectRateBps, reason: 'Restore configured referral rates after integration test.' }).expect(200);
    await request(app).patch('/api/v1/admin/referrals/milestones/TIER_5').set(adminAuth).send({ requiredReferrals: 1, qualifyingTopUpPaise: 10000, rewardAmountPaise: 200000, enabled: true, reason: 'Exercise milestone progress from a verified top-up.' }).expect(200);

    const pendingDeposit = await db.deposit.findUniqueOrThrow({ where: { id: depositId } });
    expect(pendingDeposit.method).toBe('UPI');
    expect(pendingDeposit.status).toBe('PENDING_PAYMENT');
    expect(receiverVpa).toBe('test-only@okaxis');
    expect((await request(app).get('/api/v1/users/me/balance').set(customerAuth).expect(200)).body.availablePaise).toBe(0);

    const savedUpi = await request(app).patch('/api/v1/users/me/upi').set(customerAuth).send({ displayName: 'Customer Name', upiId: 'customer@bank' }).expect(200);
    expect(savedUpi.body.detailsStatus).toBe('USER_CONFIRMED');
    expect(savedUpi.body.verificationStatus).toBe('UNVERIFIED_FORMAT_ONLY');
    expect(savedUpi.body.displayName).toBe('Customer Name');
    const savedProfile = await request(app).get('/api/v1/users/me/upi').set(customerAuth).expect(200);
    expect(savedProfile.body.upiId).toBe('customer@bank');
    expect(savedProfile.body.displayName).toBe('Customer Name');
    expect(savedProfile.body.detailsStatus).toBe('USER_CONFIRMED');
    expect(savedProfile.body.verificationStatus).toBe('UNVERIFIED_FORMAT_ONLY');
    await request(app).patch('/api/v1/users/me/upi').set(customerAuth).send({ upiId: 'not an upi id' }).expect(400);
    await request(app).delete('/api/v1/users/me/upi').set(customerAuth).expect(200);

    const reference = randomUUID().replace(/\D/g, '').slice(0, 12).padEnd(12, '7');
    const screenshot = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SAAAAABJRU5ErkJggg==';
    await request(app).post(`/api/v1/deposits/${depositId}/manual-verification`).set(customerAuth).send({ transactionReference: `UPI${reference}`, evidenceImageBase64: screenshot, evidenceMimeType: 'image/png' }).expect(400);
    await request(app).post(`/api/v1/deposits/${depositId}/manual-verification`).set(customerAuth).send({ transactionReference: reference.slice(1), evidenceImageBase64: screenshot, evidenceMimeType: 'image/png' }).expect(400);
    const claimResponse = await request(app).post(`/api/v1/deposits/${depositId}/manual-verification`).set(customerAuth).send({ evidenceImageBase64: screenshot, evidenceMimeType: 'image/png' }).expect(202);
    expect(claimResponse.body.claim.status).toBe('PENDING_REVIEW');
    expect(claimResponse.body.deposit.status).toBe('PAYMENT_PROCESSING');
    expect((await request(app).get('/api/v1/admin/reconciliation/claims').set(customerAuth).expect(403)).body.error.code).toBe('ADMIN_REQUIRED');

    const list = await request(app).get('/api/v1/admin/reconciliation/claims?page=1&pageSize=100').set(adminAuth).expect(200);
    expect(list.body).toMatchObject({ page: 1, pageSize: 100 });
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    const listedClaim = list.body.claims.find((claim: { id: string }) => claim.id === claimResponse.body.claim.id);
    expect(listedClaim).toBeTruthy();
    expect(listedClaim.transactionReference).toBeNull();
    expect(listedClaim.evidenceMimeType).toBe('image/png');
    expect(listedClaim).not.toHaveProperty('evidenceImage');
    const pastEnd = await request(app).get(`/api/v1/admin/reconciliation/claims?page=${Math.ceil(list.body.total / 100) + 1}&pageSize=100`).set(adminAuth).expect(200);
    expect(pastEnd.body).toMatchObject({ claims: [], total: list.body.total, pageSize: 100 });
    const evidence = await request(app).get(`/api/v1/admin/reconciliation/claims/${claimResponse.body.claim.id}/evidence`).set(adminAuth).expect(200);
    expect(evidence.headers['content-type']).toMatch(/image\/png/);
    expect(evidence.headers['cache-control']).toContain('no-store');
    expect(evidence.body).toEqual(Buffer.from(screenshot, 'base64'));
    const reviewPath = `/api/v1/admin/reconciliation/claims/${claimResponse.body.claim.id}/review`;
    await request(app).post(reviewPath).set(adminAuth).send({
      decision: 'APPROVE', reason: 'Verified exact receipt in merchant bank records.', evidenceReference: 'BANK-STATEMENT-TEST-001',
      verifiedTransactionReference: reference, verifiedAmountPaise: 9999, verifiedCurrency: 'INR', receiverConfirmed: true,
    }).expect(409);
    expect((await db.deposit.findUniqueOrThrow({ where: { id: depositId } })).status).toBe('PAYMENT_PROCESSING');

    const approved = await request(app).post(reviewPath).set(adminAuth).send({
      decision: 'APPROVE', reason: 'Verified exact receipt in merchant bank records.', evidenceReference: 'BANK-STATEMENT-TEST-001',
      verifiedTransactionReference: reference, verifiedAmountPaise: 10000, verifiedCurrency: 'INR', receiverConfirmed: true,
    }).expect(200);
    expect(approved.body.claim.status).toBe('APPROVED');
    expect(approved.body.deposit.status).toBe('COMPLETED');
    const expectedRewardPaise = env.upiDepositRewardEnabled ? 1700 : 0;
    expect(approved.body.rewardAmountPaise).toBe(expectedRewardPaise);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `MANUAL_DEPOSIT:${depositId}` } })).toBe(1);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `UPI_DEPOSIT_REWARD:${depositId}` } })).toBe(env.upiDepositRewardEnabled ? 1 : 0);
    const balance = await request(app).get('/api/v1/users/me/balance').set(customerAuth).expect(200);
    expect(balance.body.availablePaise).toBe(10000 + expectedRewardPaise);
    expect(balance.body.rewardProfitPaise).toBe(expectedRewardPaise);
    expect(await db.ledgerTransaction.count({ where: { referenceId: depositId, eventType: 'UPI_DEPOSIT_REWARD' } })).toBe(env.upiDepositRewardEnabled ? 1 : 0);
    const referralEntries = await db.commissionEntry.findMany({ where: { sourceUserId: customerId }, orderBy: { level: 'asc' } });
    expect(referralEntries.map((entry) => ({ level: entry.level, kind: entry.kind, amountPaise: Number(entry.amountPaise), status: entry.status }))).toEqual([
      { level: 1, kind: 'DIRECT_COMMISSION', amountPaise: 40, status: 'PENDING' },
      { level: 2, kind: 'INDIRECT_COMMISSION', amountPaise: 10, status: 'PENDING' },
    ]);
    const directTeam = await request(app).get('/api/v1/users/me/referrals').set({ Authorization: `Bearer ${referrerToken}` }).expect(200);
    expect(directTeam.body).toMatchObject({ directCount: 1, indirectCount: 0, directEarningsPaise: 40, pendingCommissionPaise: 200040, fundedProgram: false });
    expect(directTeam.body.milestones.find((item: { key: string }) => item.key === 'TIER_5')).toMatchObject({ qualifiedReferrals: 1, requiredReferrals: 1, status: 'PENDING' });
    const indirectTeam = await request(app).get('/api/v1/users/me/referrals').set({ Authorization: `Bearer ${ancestorToken}` }).expect(200);
    expect(indirectTeam.body).toMatchObject({ directCount: 1, indirectCount: 1, indirectEarningsPaise: 10, pendingCommissionPaise: 10 });
    await request(app).post(reviewPath).set(adminAuth).send({
      decision: 'APPROVE', reason: 'Duplicate review attempt.', evidenceReference: 'BANK-STATEMENT-TEST-001',
      verifiedTransactionReference: reference, verifiedAmountPaise: 10000, verifiedCurrency: 'INR', receiverConfirmed: true,
    }).expect(409);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `MANUAL_DEPOSIT:${depositId}` } })).toBe(1);
    if (originalMilestone) await request(app).patch('/api/v1/admin/referrals/milestones/TIER_5').set(adminAuth).send({ requiredReferrals: originalMilestone.requiredReferrals, qualifyingTopUpPaise: originalMilestone.qualifyingTopUpPaise === null ? null : Number(originalMilestone.qualifyingTopUpPaise), rewardAmountPaise: Number(originalMilestone.rewardAmountPaise), enabled: originalMilestone.enabled, reason: 'Restore milestone configuration after integration test.' }).expect(200);
  });

  it('allows separate admin sign-in only for provisioned admins and creates a standard revocable session', async () => {
    const beforeUsers = await db.user.count();
    const beforeCustomerSessions = await db.session.count({ where: { userId: customerId } });
    const denied = await request(app).post('/api/v1/admin/auth/login').send({ phoneE164: customerPhone, password: adminPassword }).expect(401);
    expect(denied.body.error.code).toBe('ADMIN_LOGIN_INVALID');
    expect(await db.session.count({ where: { userId: customerId } })).toBe(beforeCustomerSessions);
    expect(await db.user.count()).toBe(beforeUsers);
    const beforeAdminSessions = await db.session.count({ where: { userId: adminId } });
    const wrongPassword = await request(app).post('/api/v1/admin/auth/login').send({ phoneE164: adminPhone, password: `${adminPassword}-wrong` }).expect(401);
    expect(wrongPassword.body.error.code).toBe('ADMIN_LOGIN_INVALID');
    expect(await db.session.count({ where: { userId: adminId } })).toBe(beforeAdminSessions);

    const signedIn = await request(app).post('/api/v1/admin/auth/login').send({ phoneE164: adminPhone, password: adminPassword }).expect(200);
    expect(signedIn.body.role).toBe('ADMIN');
    expect(signedIn.body.accessToken).toBeTruthy();
    expect(signedIn.body.refreshToken).toBeTruthy();
    const me = await request(app).get('/api/v1/admin/me').set('Authorization', `Bearer ${signedIn.body.accessToken}`).expect(200);
    expect(me.body.role).toBe('ADMIN');
    await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${signedIn.body.accessToken}`).send({ refreshToken: signedIn.body.refreshToken }).expect(204);
    await request(app).get('/api/v1/admin/me').set('Authorization', `Bearer ${signedIn.body.accessToken}`).expect(401);
  });

  it('sets a five-minute expiry, allows at most two active deposits, and frees a slot after cancel or expiry', async () => {
    const customerAuth = { Authorization: `Bearer ${customerToken}` };
    const create = () => request(app).post('/api/v1/deposits')
      .set(customerAuth)
      .set('Idempotency-Key', `UPI_EXPIRY_TEST:${randomUUID()}`)
      .send({ amountPaise: 10000, method: 'UPI' });

    const first = await create().expect(201);
    const firstId = first.body.deposit.id as string;
    depositIds.push(firstId);
    const expiresAt = new Date(first.body.deposit.expiresAt).getTime();
    const lifetimeMs = expiresAt - new Date(first.body.deposit.createdAt).getTime();
    expect(lifetimeMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1_000);
    expect(lifetimeMs).toBeLessThanOrEqual(5 * 60 * 1000 + 1_000);

    const second = await create().expect(201);
    const secondId = second.body.deposit.id as string;
    depositIds.push(secondId);
    const blocked = await create().expect(409);
    expect(blocked.body.error.code).toBe('PENDING_DEPOSIT_EXISTS');
    expect(blocked.body.pendingDeposits).toHaveLength(2);
    expect(blocked.body.pendingDeposits.map((item: { id: string }) => item.id)).toContain(firstId);
    expect(blocked.body.pendingDeposits.map((item: { id: string }) => item.id)).toContain(secondId);

    const cancelled = await request(app).post(`/api/v1/deposits/${firstId}/cancel`).set(customerAuth).expect(200);
    expect(cancelled.body.deposit.status).toBe('CANCELLED');

    const third = await create().expect(201);
    const thirdId = third.body.deposit.id as string;
    depositIds.push(thirdId);
    await db.deposit.update({ where: { id: secondId }, data: { expiresAt: new Date(Date.now() - 1) } });
    const history = await request(app).get('/api/v1/deposits').set(customerAuth).expect(200);
    expect(history.body.deposits.find((item: { id: string }) => item.id === secondId).status).toBe('EXPIRED');

    const claim = await request(app).post(`/api/v1/deposits/${secondId}/manual-verification`)
      .set(customerAuth).send({ transactionReference: randomUUID().replace(/\D/g, '').slice(0, 12).padEnd(12, '8'), evidenceImageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SAAAAABJRU5ErkJggg==', evidenceMimeType: 'image/png' }).expect(202);
    expect(claim.body.deposit.status).toBe('PAYMENT_PROCESSING');
    const rejected = await request(app).post(`/api/v1/admin/reconciliation/claims/${claim.body.claim.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'REJECT', reason: 'No matching receipt found.', evidenceReference: 'TEST-REVIEW-001' })
      .expect(200);
    expect(rejected.body.deposit.status).toBe('EXPIRED');

    const fresh = await create().expect(201);
    depositIds.push(fresh.body.deposit.id as string);
  });

  it.each([9900, 19900, 5500, 6600])('rejects a UPI deposit amount of %i paise because it is not a ₹100 multiple', async (amountPaise) => {
    const response = await request(app).post('/api/v1/deposits')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `UPI_INCREMENT_TEST:${randomUUID()}`)
      .send({ amountPaise, method: 'UPI' })
      .expect(400);
    expect(response.body.error.code).toBe('DEPOSIT_AMOUNT_INCREMENT_INVALID');
  });

  it('rejects UPI and quick deposits above ₹10,000', async () => {
    const standard = await request(app).post('/api/v1/deposits')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `UPI_MAX_TEST:${randomUUID()}`)
      .send({ amountPaise: 1_010_000, method: 'UPI' })
      .expect(400);
    expect(standard.body.error.code).toBe('DEPOSIT_AMOUNT_OUT_OF_RANGE');

    const quick = await request(app).post('/api/v1/deposits/quick-match')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `QUICK_DEPOSIT_MAX_TEST:${randomUUID()}`)
      .send({ amountPaise: 1_010_000 })
      .expect(400);
    expect(quick.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('encrypts bank accounts, masks them in responses, and never claims ownership verification', async () => {
    const customerAuth = { Authorization: `Bearer ${customerToken}` };
    const created = await request(app).post('/api/v1/users/me/bank-accounts').set(customerAuth).send({
      accountHolderName: 'UPI Test Customer', accountNumber: bankNumber, confirmAccountNumber: bankNumber,
      ifsc: 'HDFC0001234', bankName: 'Test Bank',
    }).expect(201);
    bankAccountId = created.body.bankAccount.id;
    expect(created.body.bankAccount.maskedAccountNumber).toBe(`••••${bankNumber.slice(-4)}`);
    expect(created.body.bankAccount.verificationStatus).toBe('UNVERIFIED');
    expect(JSON.stringify(created.body)).not.toContain(bankNumber);
    const listed = await request(app).get('/api/v1/users/me/bank-accounts').set(customerAuth).expect(200);
    expect(listed.body.bankAccounts[0].maskedAccountNumber).toBe(`••••${bankNumber.slice(-4)}`);
    await request(app).post(`/api/v1/users/me/bank-accounts/${bankAccountId}/verify`).set(customerAuth).expect(503);
    const updated = await request(app).patch(`/api/v1/users/me/bank-accounts/${bankAccountId}`).set(customerAuth).send({ ifsc: 'ICIC0001234' }).expect(200);
    expect(updated.body.bankAccount.verificationStatus).toBe('UNVERIFIED');
    await request(app).delete(`/api/v1/users/me/bank-accounts/${bankAccountId}`).set(customerAuth).expect(200);
    bankAccountId = '';
  });

  it('creates an Admin UPI deposit without credit and settles only after exact Finance receipt verification', async () => {
    const adminAuth = { Authorization: `Bearer ${adminToken}` };
    const customerAuth = { Authorization: `Bearer ${referrerToken}` };
    const idempotencyKey = `ADMIN_UPI_TEST_${randomUUID()}`;
    const created = await request(app).post('/api/v1/admin/deposits/upi')
      .set(adminAuth)
      .set('Idempotency-Key', idempotencyKey)
      .send({ userId: referrerId, amountPaise: 10_000 })
      .expect(201);
    const createdDepositId = created.body.deposit.id as string;
    depositIds.push(createdDepositId);
    expect(created.body.deposit).toMatchObject({ userId: referrerId, amountPaise: 10_000, currency: 'INR', method: 'UPI', status: 'PENDING_PAYMENT' });
    expect(created.body.paymentUri).toMatch(/^upi:\/\/pay\?/);
    expect(created.body).toMatchObject({ paymentStarted: false, automaticVerificationAvailable: false });
    expect((await request(app).get('/api/v1/users/me/balance').set(customerAuth).expect(200)).body.availablePaise).toBe(0);

    const replay = await request(app).post('/api/v1/admin/deposits/upi')
      .set(adminAuth)
      .set('Idempotency-Key', idempotencyKey)
      .send({ userId: referrerId, amountPaise: 10_000 })
      .expect(200);
    expect(replay.body.deposit.id).toBe(createdDepositId);
    expect(await db.deposit.count({ where: { idempotencyKey: `ADMIN_UPI:${adminId}:${referrerId}:${idempotencyKey}` } })).toBe(1);

    const reference = randomUUID().replace(/\D/g, '').slice(0, 12).padEnd(12, '8');
    const claimed = await request(app).post(`/api/v1/admin/deposits/${createdDepositId}/manual-claim`)
      .set(adminAuth)
      .send({ transactionReference: reference })
      .expect(202);
    expect(claimed.body.claim).toMatchObject({ status: 'PENDING_REVIEW', transactionReference: reference });
    expect(claimed.body.deposit.status).toBe('PAYMENT_PROCESSING');
    expect((await request(app).get('/api/v1/users/me/balance').set(customerAuth).expect(200)).body.availablePaise).toBe(0);

    const reviewPath = `/api/v1/admin/reconciliation/claims/${claimed.body.claim.id}/review`;
    await request(app).post(reviewPath).set(adminAuth).send({
      decision: 'APPROVE', reason: 'Isolated integration fixture for exact receiver-side verification.',
      evidenceReference: 'LOCAL_TEST_RECEIVER_RECORD', verifiedTransactionReference: reference,
      verifiedAmountPaise: 9_999, verifiedCurrency: 'INR', receiverConfirmed: true,
    }).expect(409);
    expect((await request(app).get('/api/v1/users/me/balance').set(customerAuth).expect(200)).body.availablePaise).toBe(0);

    const approved = await request(app).post(reviewPath).set(adminAuth).send({
      decision: 'APPROVE', reason: 'Isolated integration fixture for exact receiver-side verification.',
      evidenceReference: 'LOCAL_TEST_RECEIVER_RECORD', verifiedTransactionReference: reference,
      verifiedAmountPaise: 10_000, verifiedCurrency: 'INR', receiverConfirmed: true,
    }).expect(200);
    expect(approved.body.deposit.status).toBe('COMPLETED');
    const expectedRewardPaise = env.upiDepositRewardEnabled ? 1_700 : 0;
    expect((await request(app).get('/api/v1/users/me/balance').set(customerAuth).expect(200)).body.availablePaise).toBe(10_000 + expectedRewardPaise);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `MANUAL_DEPOSIT:${createdDepositId}` } })).toBe(1);
    await request(app).post(reviewPath).set(adminAuth).send({
      decision: 'APPROVE', reason: 'Duplicate verification must not settle twice.',
      evidenceReference: 'LOCAL_TEST_RECEIVER_RECORD', verifiedTransactionReference: reference,
      verifiedAmountPaise: 10_000, verifiedCurrency: 'INR', receiverConfirmed: true,
    }).expect(409);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `MANUAL_DEPOSIT:${createdDepositId}` } })).toBe(1);
  });

});
