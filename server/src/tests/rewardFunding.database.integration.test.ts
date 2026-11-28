import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { hashToken } from '../lib/security.js';
import { prisma } from '../lib/db.js';
import { REWARD_FUND_ACCOUNT_ID } from '../modules/payments/rewardWallet.js';
import { grantVerifiedP2pOrderRewardResult, processPendingRewardAccruals } from '../modules/payments/depositReward.js';
import { decideRewardFundFundingRequest } from '../modules/admin/rewardFundFunding.js';
import { inspectRewardReserve } from '../modules/payments/rewardReserve.js';

const integration = describe.skipIf(!prisma);

integration('Admin reward funding and P2P rewards (isolated PostgreSQL integration)', () => {
  const db = prisma!;
  const prefix = `REWARD_DB_TEST:${randomUUID()}`;
  const phone = (digit: string) => `+${digit}${randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, digit)}`;
  const users: string[] = [];
  const requestIds: string[] = [];
  const offerIds: string[] = [];
  const orderIds: string[] = [];
  const tokens = { superAdmin: randomUUID(), checker: randomUUID(), finance: randomUUID() };
  const receiverVpa = 'reward-test@paisapay.invalid';
  let superAdminId = '';
  let checkerId = '';
  let financeId = '';
  let buyerId = '';
  let underfundedOrderId = '';
  const previous = {
    financialOperationsEnabled: env.financialOperationsEnabled,
    manualUpiOperationsEnabled: env.manualUpiOperationsEnabled,
    rewardFundFundingEnabled: env.rewardFundFundingEnabled,
    rewardFundReceiverVpa: env.rewardFundReceiverVpa,
    p2pOrderRewardEnabled: env.p2pOrderRewardEnabled,
    p2pOrderRewardPercentBps: env.p2pOrderRewardPercentBps,
    p2pOrderRewardFundAccountId: env.p2pOrderRewardFundAccountId,
    p2pOrderRewardFundingSource: env.p2pOrderRewardFundingSource,
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const idempotency = () => randomUUID();

  async function reserveBalance() {
    const [row] = await db.$queryRaw<Array<{ balance: bigint }>>`
      SELECT COALESCE(SUM(credit_paise - debit_paise), 0)::bigint AS balance
      FROM ledger_entries WHERE account_id = ${REWARD_FUND_ACCOUNT_ID}::uuid`;
    return row.balance;
  }

  async function createCompletedOrder(amountPaise: bigint, status = 'COMPLETED') {
    const offer = await db.p2pWithdrawalOffer.create({ data: {
      referenceId: `${prefix}:OFFER:${randomUUID()}`,
      userId: superAdminId,
      amountPaise,
      paymentMethod: 'UPI',
      fundingSource: 'CASH',
      payeeVpa: 'test-seller@paisapay.invalid',
      status: 'SETTLED',
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `${prefix}:OFFER:${randomUUID()}`,
    } });
    offerIds.push(offer.id);
    const order = await db.p2pDepositOrder.create({ data: {
      referenceId: `${prefix}:ORDER:${randomUUID()}`,
      buyerUserId: buyerId,
      sellerUserId: superAdminId,
      withdrawalOfferId: offer.id,
      amountPaise,
      status,
      idempotencyKey: `${prefix}:ORDER:${randomUUID()}`,
    } });
    orderIds.push(order.id);
    if (status === 'COMPLETED') {
      const providerReference = `${prefix}:RECEIPT:${randomUUID()}`;
      await db.p2pPaymentClaim.create({ data: {
        orderId: order.id, userId: buyerId, transactionReference: providerReference,
        claimedAmountPaise: amountPaise, claimedPaidAt: new Date(), status: 'APPROVED',
        reviewedByUserId: financeId, reviewReason: 'Isolated integration receiver-side review',
        evidenceReference: 'Isolated test fixture', verifiedAmountPaise: amountPaise,
        verifiedCurrency: 'INR', receiverConfirmed: true, reviewedAt: new Date(),
      } });
      await db.p2pDepositOrder.update({ where: { id: order.id }, data: { providerReference } });
      const [sellerReserved, buyerAvailable] = await Promise.all([
        db.ledgerAccount.upsert({ where: { userId_type_currency: { userId: superAdminId, type: 'RESERVED', currency: 'INR' } }, create: { userId: superAdminId, type: 'RESERVED', currency: 'INR' }, update: {} }),
        db.ledgerAccount.upsert({ where: { userId_type_currency: { userId: buyerId, type: 'AVAILABLE', currency: 'INR' } }, create: { userId: buyerId, type: 'AVAILABLE', currency: 'INR' }, update: {} }),
      ]);
      await db.ledgerTransaction.create({ data: {
        eventType: 'P2P_PAYMENT_VERIFIED', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: order.id,
        idempotencyKey: `P2P_PAYMENT_VERIFIED:${order.id}`, actorUserId: financeId,
        metadata: { amountPaise: amountPaise.toString(), currency: 'INR', providerReference, isolatedTestFixture: true },
        entries: { create: [ { accountId: sellerReserved.id, debitPaise: amountPaise }, { accountId: buyerAvailable.id, creditPaise: amountPaise } ] },
      } });
    }
    return order;
  }

  async function createSubmittedFunding(amountPaise: number) {
    const created = await request(app).post('/api/v1/admin/reward-fund/funding-requests')
      .set(auth(tokens.superAdmin)).set('Idempotency-Key', idempotency())
      .send({ amountPaise, reason: 'Isolated database funding concurrency/release test' }).expect(201);
    const requestId = created.body.request.id as string;
    requestIds.push(requestId);
    const paymentReference = `${prefix}:UTR:${randomUUID()}`;
    await request(app).post(`/api/v1/admin/reward-fund/funding-requests/${requestId}/submit`)
      .set(auth(tokens.superAdmin)).send({ paymentReference, statementDate: new Date().toISOString().slice(0, 10) }).expect(202);
    return { requestId, paymentReference, amountPaise };
  }

  function fundingVerification(funding: { amountPaise: number; paymentReference: string }) {
    return {
      decision: 'VERIFY' as const,
      reason: 'Isolated test receiver-side history verification',
      paymentReference: funding.paymentReference,
      receivedAmountPaise: funding.amountPaise,
      receivedVpa: receiverVpa,
      receiverConfirmed: true,
    };
  }

  function verifyFunding(funding: { requestId: string; amountPaise: number; paymentReference: string }) {
    return request(app).post(`/api/v1/admin/reward-fund/funding-requests/${funding.requestId}/decision`)
      .set(auth(tokens.checker)).send(fundingVerification(funding));
  }

  beforeAll(async () => {
    await db.$connect();
    // These are process-local test settings only. The external test shell keeps
    // every reward and funding flag false; no service deployment is changed.
    env.financialOperationsEnabled = false;
    env.manualUpiOperationsEnabled = true;
    env.rewardFundFundingEnabled = true;
    env.rewardFundReceiverVpa = receiverVpa;
    env.p2pOrderRewardEnabled = true;
    env.p2pOrderRewardPercentBps = 620;
    env.p2pOrderRewardFundAccountId = REWARD_FUND_ACCOUNT_ID;
    env.p2pOrderRewardFundingSource = 'DEDICATED_REWARD_FUND';

    const [superAdmin, checker, finance, buyer] = await Promise.all([
      db.user.create({ data: { phoneE164: phone('9'), displayName: 'Reward DB Test Super Admin', status: 'ACTIVE' } }),
      db.user.create({ data: { phoneE164: phone('5'), displayName: 'Reward DB Test Checker', status: 'ACTIVE' } }),
      db.user.create({ data: { phoneE164: phone('8'), displayName: 'Reward DB Test Finance', status: 'ACTIVE' } }),
      db.user.create({ data: { phoneE164: phone('7'), displayName: 'Reward DB Test Buyer', status: 'ACTIVE' } }),
    ]);
    superAdminId = superAdmin.id; checkerId = checker.id; financeId = finance.id; buyerId = buyer.id;
    users.push(superAdminId, checkerId, financeId, buyerId);
    await db.adminUser.createMany({ data: [
      { userId: superAdminId, role: 'SUPER_ADMIN' },
      { userId: checkerId, role: 'SUPER_ADMIN' },
      { userId: financeId, role: 'FINANCE' },
    ] });
    const now = new Date();
    await db.session.createMany({ data: [
      { userId: superAdminId, accessTokenHash: hashToken(tokens.superAdmin), refreshTokenHash: hashToken(randomUUID()), accessExpiresAt: new Date(now.getTime() + 3_600_000), refreshExpiresAt: new Date(now.getTime() + 7_200_000) },
      { userId: checkerId, accessTokenHash: hashToken(tokens.checker), refreshTokenHash: hashToken(randomUUID()), accessExpiresAt: new Date(now.getTime() + 3_600_000), refreshExpiresAt: new Date(now.getTime() + 7_200_000) },
      { userId: financeId, accessTokenHash: hashToken(tokens.finance), refreshTokenHash: hashToken(randomUUID()), accessExpiresAt: new Date(now.getTime() + 3_600_000), refreshExpiresAt: new Date(now.getTime() + 7_200_000) },
    ] });
  });

  afterAll(async () => {
    Object.assign(env, previous);
    try {
      await db.$transaction(async (tx) => {
        const fundingRows = requestIds.length ? await tx.rewardFundFundingRecord.findMany({ where: { fundingRequestId: { in: requestIds } }, select: { id: true, ledgerTransactionId: true } }) : [];
        const rewardTransactions = orderIds.length ? await tx.ledgerTransaction.findMany({ where: { referenceType: 'P2P_DEPOSIT_ORDER', referenceId: { in: orderIds } }, select: { id: true } }) : [];
        const ledgerTransactionIds = [...new Set([...fundingRows.map((row) => row.ledgerTransactionId), ...rewardTransactions.map((row) => row.id)])];
        await tx.auditLog.deleteMany({ where: { OR: [
          { actorId: { in: users } },
          { target: { startsWith: `${prefix}:` } },
          { target: { in: [...requestIds.map((id) => `REWARD_FUND_FUNDING_REQUEST:${id}`), ...orderIds.map((id) => `P2P_DEPOSIT_ORDER:${id}`), ...fundingRows.map((row) => `REWARD_FUND_FUNDING_RECORD:${row.id}`)] } },
        ] } });
        await tx.rewardLedgerEntry.deleteMany({ where: { wallet: { userId: { in: users } } } });
        await tx.rewardWallet.deleteMany({ where: { userId: { in: users } } });
        await tx.rewardFundFundingRecord.deleteMany({ where: { fundingRequestId: { in: requestIds } } });
        await tx.rewardFundFundingRequest.deleteMany({ where: { id: { in: requestIds } } });
        await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: ledgerTransactionIds } } });
        await tx.ledgerTransaction.deleteMany({ where: { id: { in: ledgerTransactionIds } } });
        await tx.p2pPaymentClaim.deleteMany({ where: { orderId: { in: orderIds } } });
        await tx.p2pDepositOrder.deleteMany({ where: { id: { in: orderIds } } });
        await tx.p2pWithdrawalOffer.deleteMany({ where: { id: { in: offerIds } } });
        await tx.session.deleteMany({ where: { userId: { in: users } } });
        await tx.adminUser.deleteMany({ where: { userId: { in: users } } });
        await tx.ledgerEntry.deleteMany({ where: { account: { userId: { in: users } } } });
        await tx.ledgerAccount.deleteMany({ where: { userId: { in: users } } });
        await tx.user.deleteMany({ where: { id: { in: users } } });
      });
    } finally {
      await db.$disconnect();
    }
  });

  it('verifies Super Admin funding, posts a ₹1,000 reserve, and safely rewards completed P2P orders', async () => {
    const superAdminAuth = auth(tokens.superAdmin);
    const checkerAuth = auth(tokens.checker);
    const financeAuth = auth(tokens.finance);
    const created = await request(app).post('/api/v1/admin/reward-fund/funding-requests')
      .set(superAdminAuth).set('Idempotency-Key', idempotency())
      .send({ amountPaise: 100_000, reason: 'Isolated database funding flow test' }).expect(201);
    const fundingRequestId = created.body.request.id as string;
    requestIds.push(fundingRequestId);
    expect(created.body).toMatchObject({ request: { amountPaise: 100_000, status: 'PENDING_PAYMENT', recipientVpa: receiverVpa } });
    expect(await reserveBalance()).toBe(0n);

    const paymentReference = `${prefix}:UTR:${randomUUID()}`;
    await request(app).post(`/api/v1/admin/reward-fund/funding-requests/${fundingRequestId}/submit`)
      .set(superAdminAuth).send({ paymentReference, statementDate: new Date().toISOString().slice(0, 10) }).expect(202)
      .then((response) => expect(response.body.request.status).toBe('PENDING_VERIFICATION'));
    expect(await reserveBalance()).toBe(0n);

    await request(app).post(`/api/v1/admin/reward-fund/funding-requests/${fundingRequestId}/decision`)
      .set(financeAuth).send({ decision: 'VERIFY', reason: 'Unauthorized finance check' }).expect(403);
    await request(app).post(`/api/v1/admin/reward-fund/funding-requests/${fundingRequestId}/decision`)
      .set(superAdminAuth).send({ decision: 'VERIFY', reason: 'Maker cannot verify self', paymentReference: `${prefix}:UTR:${randomUUID()}`, receivedAmountPaise: 100_000, receivedVpa: receiverVpa, receiverConfirmed: true }).expect(403);
    expect(await reserveBalance()).toBe(0n);

    const verifiedBody = {
      decision: 'VERIFY',
      reason: 'Isolated test receiver-side verification state',
      paymentReference,
      receivedAmountPaise: 100_000,
      receivedVpa: receiverVpa,
      receiverConfirmed: true,
    };
    const verified = await request(app).post(`/api/v1/admin/reward-fund/funding-requests/${fundingRequestId}/decision`)
      .set(checkerAuth).send(verifiedBody).expect(200);
    expect(verified.body).toMatchObject({ request: { status: 'VERIFIED', amountPaise: 100_000 }, fundingRecord: { amountPaise: 100_000 }, replayed: false });
    expect(await reserveBalance()).toBe(100_000n);
    const verifyReplay = await request(app).post(`/api/v1/admin/reward-fund/funding-requests/${fundingRequestId}/decision`)
      .set(checkerAuth).send(verifiedBody).expect(200);
    expect(verifyReplay.body.replayed).toBe(true);
    expect(await db.rewardFundFundingRecord.count({ where: { fundingRequestId } })).toBe(1);

    const duplicateUtrRequest = await request(app).post('/api/v1/admin/reward-fund/funding-requests')
      .set(superAdminAuth).set('Idempotency-Key', idempotency())
      .send({ amountPaise: 100_000, reason: 'Duplicate reference prevention test' }).expect(201);
    requestIds.push(duplicateUtrRequest.body.request.id);
    const duplicateReference = await request(app).post(`/api/v1/admin/reward-fund/funding-requests/${duplicateUtrRequest.body.request.id}/submit`)
      .set(superAdminAuth).send({ paymentReference, statementDate: new Date().toISOString().slice(0, 10) }).expect(409);
    expect(duplicateReference.body.error.code).toBe('REWARD_FUNDING_REFERENCE_ALREADY_USED');
    expect(await reserveBalance()).toBe(100_000n);

    const completedOrder = await createCompletedOrder(10_000n);
    const input = { orderId: completedOrder.id, userId: buyerId, actorUserId: superAdminId, amountPaise: 10_000n };
    const firstReward = await db.$transaction((tx) => grantVerifiedP2pOrderRewardResult(tx, input));
    expect(firstReward).toMatchObject({ status: 'CREDITED', rewardPaise: 620n, pendingPaise: 0n, percentageBps: 620 });
    const replayReward = await db.$transaction((tx) => grantVerifiedP2pOrderRewardResult(tx, input));
    expect(replayReward).toMatchObject({ status: 'CREDITED', rewardPaise: 620n });
    expect(await reserveBalance()).toBe(99_380n);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `P2P_ORDER_REWARD:${completedOrder.id}` } })).toBe(1);

    const underfundedOrder = await createCompletedOrder(20_000_000n);
    underfundedOrderId = underfundedOrder.id;
    const underfunded = await db.$transaction((tx) => grantVerifiedP2pOrderRewardResult(tx, {
      orderId: underfundedOrder.id, userId: buyerId, actorUserId: superAdminId, amountPaise: 20_000_000n,
    }));
    expect(underfunded).toMatchObject({ status: 'PENDING_FUNDING', rewardPaise: 0n, pendingPaise: 1_240_000n });
    expect(await reserveBalance()).toBe(99_380n);

    for (const status of ['CANCELLED', 'REFUNDED', 'PAYMENT_SUBMITTED']) {
      const ineligibleOrder = await createCompletedOrder(10_000n, status);
      await expect(db.$transaction((tx) => grantVerifiedP2pOrderRewardResult(tx, {
        orderId: ineligibleOrder.id, userId: buyerId, actorUserId: superAdminId, amountPaise: 10_000n,
      }))).rejects.toMatchObject({ code: 'P2P_REWARD_ORDER_NOT_SETTLED' });
    }

    const concurrentOrder = await createCompletedOrder(10_000n);
    const concurrentInput = { orderId: concurrentOrder.id, userId: buyerId, actorUserId: superAdminId, amountPaise: 10_000n };
    const concurrentResults = await Promise.all([
      db.$transaction((tx) => grantVerifiedP2pOrderRewardResult(tx, concurrentInput)),
      db.$transaction((tx) => grantVerifiedP2pOrderRewardResult(tx, concurrentInput)),
    ]);
    expect(concurrentResults.every((result) => result.status === 'CREDITED')).toBe(true);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `P2P_ORDER_REWARD:${concurrentOrder.id}` } })).toBe(1);
    expect(await reserveBalance()).toBe(98_760n);

    const wallet = await db.rewardWallet.findUniqueOrThrow({ where: { userId: buyerId } });
    expect(wallet).toMatchObject({ availablePaise: 1_240n, pendingPaise: 1_240_000n, reservedPaise: 0n, totalEarnedPaise: 1_240n });
    const rewardEntries = await db.rewardLedgerEntry.findMany({ where: { walletId: wallet.id } });
    expect(rewardEntries.reduce((sum, entry) => sum + entry.availableDeltaPaise, 0n)).toBe(wallet.availablePaise);
    expect(rewardEntries.reduce((sum, entry) => sum + entry.pendingDeltaPaise, 0n)).toBe(wallet.pendingPaise);
    expect(await db.auditLog.count({ where: { action: 'P2P_VERIFIED_ORDER_REWARD_GRANTED', target: { in: [`P2P_DEPOSIT_ORDER:${completedOrder.id}`, `P2P_DEPOSIT_ORDER:${concurrentOrder.id}`] } } })).toBe(2);
    const principalCashEntries = await db.ledgerEntry.count({ where: {
      account: { userId: buyerId, type: 'AVAILABLE' },
      transaction: { eventType: 'P2P_PAYMENT_VERIFIED', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: { in: orderIds } },
    } });
    expect(principalCashEntries).toBe(3);
    const cashRewardEntries = await db.ledgerEntry.count({ where: {
      account: { userId: buyerId, type: 'AVAILABLE' },
      transaction: { eventType: 'P2P_ORDER_REWARD', referenceType: 'P2P_DEPOSIT_ORDER', referenceId: { in: orderIds } },
    } });
    expect(cashRewardEntries).toBe(0);

    const dashboard = await request(app).get('/api/v1/admin/reward-fund/dashboard').set(superAdminAuth).expect(200);
    expect(dashboard.body.readiness).toMatchObject({ balancePaise: '98760', recordedFundingPaise: '100000', totalRewardsCreditedPaise: '1240', ledgerReconciled: true, fundingWorkflowEnabled: true, rewardEnabled: true });
    expect(dashboard.body.fundings).toHaveLength(1);
    expect(dashboard.body.rewards.filter((entry: { status: string }) => entry.status === 'CREDITED')).toHaveLength(2);
  });

  it('rolls back a funding verification and serializes concurrent retries to one funding ledger post', async () => {
    const funding = await createSubmittedFunding(100_000);
    const verification = fundingVerification(funding);
    const reserveBefore = await reserveBalance();
    const fundingLedgerCountBefore = await db.ledgerTransaction.count({ where: { eventType: 'REWARD_FUNDING' } });

    await expect(db.$transaction(async (tx) => {
      await decideRewardFundFundingRequest(tx, {
        requestId: funding.requestId,
        verifierUserId: checkerId,
        ...verification,
      });
      throw new Error('ROLLBACK_REWARD_FUNDING_VERIFICATION_TEST');
    })).rejects.toThrow('ROLLBACK_REWARD_FUNDING_VERIFICATION_TEST');

    const rolledBackRequest = await db.rewardFundFundingRequest.findUniqueOrThrow({ where: { id: funding.requestId } });
    expect(rolledBackRequest.status).toBe('PENDING_VERIFICATION');
    expect(await db.rewardFundFundingRecord.count({ where: { fundingRequestId: funding.requestId } })).toBe(0);
    expect(await db.ledgerTransaction.count({ where: { eventType: 'REWARD_FUNDING' } })).toBe(fundingLedgerCountBefore);
    expect(await reserveBalance()).toBe(reserveBefore);

    const decisions = await Promise.all([verifyFunding(funding), verifyFunding(funding)]);
    expect(decisions.map((response) => response.status)).toEqual([200, 200]);
    expect(decisions.map((response) => response.body.replayed).sort()).toEqual([false, true]);

    const record = await db.rewardFundFundingRecord.findUniqueOrThrow({ where: { fundingRequestId: funding.requestId } });
    const ledgerPost = await db.ledgerTransaction.findUniqueOrThrow({
      where: { id: record.ledgerTransactionId }, include: { entries: { include: { account: true } } },
    });
    expect(await db.rewardFundFundingRecord.count({ where: { fundingRequestId: funding.requestId } })).toBe(1);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: ledgerPost.idempotencyKey } })).toBe(1);
    expect(ledgerPost.entries).toHaveLength(2);
    expect(ledgerPost.entries.map((entry) => entry.account.type).sort()).toEqual(['REWARD_FUND', 'SETTLEMENT_CASH']);
    expect(await reserveBalance()).toBe(reserveBefore + 100_000n);
  });

  it('releases pending rewards after verified funding and ignores duplicate release attempts', async () => {
    expect(underfundedOrderId).not.toBe('');
    const pendingKey = `P2P_ORDER_REWARD_PENDING:${underfundedOrderId}`;
    const creditedKey = `P2P_ORDER_REWARD:${underfundedOrderId}`;
    const pending = await db.rewardLedgerEntry.findUniqueOrThrow({ where: { idempotencyKey: pendingKey } });
    const amountPaise = Number(pending.amountPaise);
    const walletBefore = await db.rewardWallet.findUniqueOrThrow({ where: { userId: buyerId } });
    expect(walletBefore.pendingPaise).toBe(pending.amountPaise);
    const reserveBefore = await reserveBalance();

    const funding = await createSubmittedFunding(amountPaise);
    const verification = await verifyFunding(funding).expect(200);
    expect(verification.body.pendingRewardsProcessed).toBe(1);
    expect(verification.body.pendingRewardPaise).toBe(amountPaise);
    expect(await reserveBalance()).toBe(reserveBefore);

    const walletAfter = await db.rewardWallet.findUniqueOrThrow({ where: { userId: buyerId } });
    expect(walletAfter).toMatchObject({
      availablePaise: walletBefore.availablePaise + pending.amountPaise,
      pendingPaise: 0n,
      reservedPaise: 0n,
      totalEarnedPaise: walletBefore.totalEarnedPaise + pending.amountPaise,
    });
    expect(await db.rewardLedgerEntry.count({ where: { idempotencyKey: creditedKey } })).toBe(1);
    expect(await db.rewardLedgerEntry.count({ where: { referenceId: underfundedOrderId } })).toBe(2);

    const duplicateRelease = await db.$transaction((tx) => processPendingRewardAccruals(tx, checkerId));
    expect(duplicateRelease).toEqual({ processed: 0, creditedPaise: 0n });
    expect(await db.rewardLedgerEntry.count({ where: { idempotencyKey: creditedKey } })).toBe(1);
    const reserve = await db.$transaction((tx) => inspectRewardReserve(tx));
    expect(reserve.reconciled).toBe(true);
  });

  it('blocks spendable reward credit when the reward reserve fails reconciliation', async () => {
    const order = await createCompletedOrder(10_000n);
    const wallet = await db.rewardWallet.findUniqueOrThrow({ where: { userId: buyerId } });
    const rewardLedgerCountBefore = await db.rewardLedgerEntry.count({ where: { walletId: wallet.id } });
    const reserveBefore = await reserveBalance();
    await db.rewardWallet.update({ where: { id: wallet.id }, data: { availablePaise: { increment: 1n } } });

    try {
      const reserve = await db.$transaction((tx) => inspectRewardReserve(tx));
      expect(reserve.reconciled).toBe(false);
      const result = await db.$transaction((tx) => grantVerifiedP2pOrderRewardResult(tx, {
        orderId: order.id, userId: buyerId, actorUserId: superAdminId, amountPaise: 10_000n,
      }));
      expect(result).toMatchObject({ status: 'BLOCKED', rewardPaise: 0n, pendingPaise: 0n });
      expect(await db.rewardLedgerEntry.count({ where: { walletId: wallet.id } })).toBe(rewardLedgerCountBefore);
      expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `P2P_ORDER_REWARD:${order.id}` } })).toBe(0);
      expect(await reserveBalance()).toBe(reserveBefore);
    } finally {
      await db.rewardWallet.update({ where: { id: wallet.id }, data: { availablePaise: { decrement: 1n } } });
    }
  });
});
