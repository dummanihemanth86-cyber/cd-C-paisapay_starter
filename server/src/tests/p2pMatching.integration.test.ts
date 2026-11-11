import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { prisma } from '../lib/db.js';
import { env } from '../config/env.js';
import { hashToken } from '../lib/security.js';

const integration = describe.skipIf(!prisma);

integration('P2P withdrawal offers and quick deposit matching (PostgreSQL integration)', () => {
  const db = prisma!;
  const previousFinancialOperationsEnabled = env.financialOperationsEnabled;
  const previousManualUpiOperationsEnabled = env.manualUpiOperationsEnabled;
  const sellerPhone = `+917${randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '7')}`;
  const buyerPhone = `+916${randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '6')}`;
  const adminPhone = `+915${randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '5')}`;
  const tokens = [randomUUID(), randomUUID(), randomUUID()];
  let sellerId = '';
  let buyerId = '';
  let adminId = '';
  const offerIds: string[] = [];
  const orderIds: string[] = [];
  const claimIds: string[] = [];
  const transactionReferences: string[] = [];
  // Keep integration-test ledger rows isolated from any persistent/system account.
  const clearingAccountId = randomUUID();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const key = (name: string) => `P2P_TEST:${name}:${randomUUID()}`;
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SAAAAABJRU5ErkJggg==';
  const paymentProof = (transactionReference: string, claimedAmountPaise = 10000) => ({ transactionReference, evidenceImageBase64: tinyPng, evidenceMimeType: 'image/png', claimedAmountPaise, claimedPaidAt: new Date().toISOString() });
  const createOffer = (token: string, amountPaise = 50000) => request(app).post('/api/v1/withdrawals').set(auth(token)).set('Idempotency-Key', key('offer')).send({ amountPaise });

  beforeAll(async () => {
    await db.$connect();
    env.financialOperationsEnabled = true;
    env.manualUpiOperationsEnabled = true;
    const [seller, buyer, admin] = await Promise.all([
      db.user.create({ data: { phoneE164: sellerPhone, displayName: 'P2P Seller', status: 'ACTIVE', upiId: 'seller@testbank', upiDisplayName: 'Seller Account Name' } }),
      db.user.create({ data: { phoneE164: buyerPhone, displayName: 'P2P Buyer', status: 'ACTIVE' } }),
      db.user.create({ data: { phoneE164: adminPhone, displayName: 'P2P Reviewer', status: 'ACTIVE' } }),
    ]);
    sellerId = seller.id; buyerId = buyer.id; adminId = admin.id;
    await db.user.update({ where: { id: buyerId }, data: { referredById: adminId } });
    await db.referral.create({ data: { referrerId: adminId, inviteeId: buyerId, referralCode: admin.referralCode } });
    await db.adminUser.create({ data: { userId: adminId, role: 'FINANCE' } });
    const now = new Date();
    await db.session.createMany({ data: [sellerId, buyerId, adminId].map((userId, index) => ({ userId, accessTokenHash: hashToken(tokens[index]), refreshTokenHash: hashToken(randomUUID()), accessExpiresAt: new Date(now.getTime() + 60_000), refreshExpiresAt: new Date(now.getTime() + 120_000) })) });
    const [sellerAvailable] = await Promise.all([
      db.ledgerAccount.upsert({ where: { userId_type_currency: { userId: sellerId, type: 'AVAILABLE', currency: 'INR' } }, create: { userId: sellerId, type: 'AVAILABLE', currency: 'INR' }, update: {} }),
      db.ledgerAccount.upsert({ where: { userId_type_currency: { userId: sellerId, type: 'RESERVED', currency: 'INR' } }, create: { userId: sellerId, type: 'RESERVED', currency: 'INR' }, update: {} }),
      db.ledgerAccount.upsert({ where: { userId_type_currency: { userId: buyerId, type: 'AVAILABLE', currency: 'INR' } }, create: { userId: buyerId, type: 'AVAILABLE', currency: 'INR' }, update: {} }),
      db.ledgerAccount.upsert({ where: { userId_type_currency: { userId: adminId, type: 'AVAILABLE', currency: 'INR' } }, create: { userId: adminId, type: 'AVAILABLE', currency: 'INR' }, update: {} }),
    ]);
    const clearing = await db.ledgerAccount.upsert({ where: { id: clearingAccountId }, create: { id: clearingAccountId, type: 'SETTLEMENT_CASH', currency: 'INR' }, update: {} });
    await db.ledgerTransaction.create({ data: { eventType: 'P2P_TEST_FUNDING', referenceType: 'P2P_TEST_FUNDING', referenceId: sellerId, idempotencyKey: `P2P_TEST_FUNDING:${sellerId}`, metadata: { developmentOnly: true }, entries: { create: [{ accountId: clearing.id, debitPaise: 100000000n }, { accountId: sellerAvailable.id, creditPaise: 100000000n }] } } });
  });

  afterAll(async () => {
    env.financialOperationsEnabled = previousFinancialOperationsEnabled;
    env.manualUpiOperationsEnabled = previousManualUpiOperationsEnabled;
    if (!sellerId || !buyerId || !adminId) return;
    await db.$transaction(async (tx) => {
      const linkedOrders = await tx.p2pDepositOrder.findMany({ where: { OR: [{ withdrawalOfferId: { in: offerIds } }, { buyerUserId: { in: [sellerId, buyerId, adminId] } }, { sellerUserId: { in: [sellerId, buyerId, adminId] } }] }, select: { id: true } });
      const allOrderIds = [...new Set([...orderIds, ...linkedOrders.map((order) => order.id)])];
      await tx.auditLog.deleteMany({ where: { target: { in: [...offerIds.map((id) => `P2P_WITHDRAWAL_OFFER:${id}`), ...orderIds.map((id) => `P2P_DEPOSIT_ORDER:${id}`)] } } });
      await tx.notification.deleteMany({ where: { userId: { in: [sellerId, buyerId, adminId] } } });
      await tx.p2pPaymentClaim.deleteMany({ where: { OR: [{ id: { in: claimIds } }, { orderId: { in: allOrderIds } }] } });
      await tx.commissionEntry.deleteMany({ where: { qualifyingReference: { in: orderIds.map((id) => `REFERRAL:P2P_ORDER:${id}`) } } });
      await tx.referral.deleteMany({ where: { inviteeId: buyerId } });
      await tx.reconciliationRecord.deleteMany({ where: { provider: 'MANUAL_P2P_UPI', providerReference: { in: transactionReferences } } });
      await tx.auditLog.deleteMany({ where: { target: { in: allOrderIds.map((id) => `P2P_DEPOSIT_ORDER:${id}`) } } });
      await tx.ledgerEntry.deleteMany({ where: { transaction: { referenceId: { in: [...offerIds, ...allOrderIds] } } } });
      await tx.ledgerTransaction.deleteMany({ where: { referenceId: { in: [...offerIds, ...allOrderIds] } } });
      await tx.p2pDepositOrder.deleteMany({ where: { id: { in: allOrderIds } } });
      await tx.p2pWithdrawalOffer.deleteMany({ where: { id: { in: offerIds } } });
      await tx.ledgerEntry.deleteMany({ where: { transaction: { referenceType: 'P2P_TEST_FUNDING', referenceId: sellerId } } });
      await tx.ledgerTransaction.deleteMany({ where: { referenceType: 'P2P_TEST_FUNDING', referenceId: sellerId } });
      await tx.session.deleteMany({ where: { userId: { in: [sellerId, buyerId, adminId] } } });
      await tx.adminUser.deleteMany({ where: { userId: adminId } });
      await tx.ledgerEntry.deleteMany({ where: { account: { userId: { in: [sellerId, buyerId, adminId] } } } });
      await tx.ledgerAccount.deleteMany({ where: { userId: { in: [sellerId, buyerId, adminId] } } });
      await tx.user.deleteMany({ where: { id: { in: [sellerId, buyerId, adminId] } } });
      await tx.ledgerEntry.deleteMany({ where: { accountId: clearingAccountId } });
      await tx.ledgerAccount.deleteMany({ where: { id: clearingAccountId } });
    });
    await db.$disconnect();
  });

  it('matches oldest exact offers, hides own offers, reveals payee only after confirmation, and settles atomically after Finance verifies receipt', async () => {
    const sellerAuth = auth(tokens[0]); const buyerAuth = auth(tokens[1]); const adminAuth = auth(tokens[2]);
    await request(app).post('/api/v1/withdrawals').set(sellerAuth).set('Idempotency-Key', key('invalid-increment')).send({ amountPaise: 11700 }).expect(400);
    const created = await createOffer(tokens[0]).expect(201);
    const offer = created.body.withdrawalOffer;
    offerIds.push(offer.id);
    expect(offer.status).toBe('OPEN');
    expect(created.body.withdrawalOffer.payeeVpa).toBeUndefined();
    expect((await request(app).get('/api/v1/withdrawals/marketplace').set(sellerAuth).expect(200)).body.offers.some((row: { id: string }) => row.id === offer.id)).toBe(false);
    const visible = await request(app).get('/api/v1/withdrawals/marketplace').set(buyerAuth).expect(200);
    expect(visible.body.offers.some((row: { id: string }) => row.id === offer.id)).toBe(true);
    await request(app).post('/api/v1/deposits/quick-match').set(sellerAuth).set('Idempotency-Key', key('self')).send({ amountPaise: 50000, withdrawalOfferId: offer.id }).expect(409);
    await request(app).post('/api/v1/deposits/quick-match').set(buyerAuth).set('Idempotency-Key', key('no-exact-match')).send({ amountPaise: 100000, withdrawalOfferId: offer.id }).expect(409);

    const matched = await request(app).post('/api/v1/deposits/quick-match').set(buyerAuth).set('Idempotency-Key', key('match')).send({ amountPaise: 50000, withdrawalOfferId: offer.id });
    expect(matched.status, JSON.stringify(matched.body)).toBe(201);
    const order = matched.body.order; orderIds.push(order.id);
    expect(order.status).toBe('MATCHED');
    expect(matched.body.reward).toMatchObject({ percentBps: 600, estimatedPaise: 3000 });
    expect(JSON.stringify(matched.body)).not.toContain('seller@testbank');
    expect((await request(app).get('/api/v1/withdrawals/marketplace').set(buyerAuth).expect(200)).body.offers.some((row: { id: string }) => row.id === offer.id)).toBe(false);

    const confirmed = await request(app).post(`/api/v1/deposits/orders/${order.id}/confirm`).set(buyerAuth).send({}).expect(200);
    expect(confirmed.body.serverTime).toBeTruthy();
    expect(confirmed.body.paymentDetails.payeeVpa).toBe('seller@testbank');
    expect(confirmed.body.paymentDetails.payeeName).toBe('Seller Account Name');
    expect(confirmed.body.paymentDetails.ownershipStatus).toBe('UNVERIFIED_USER_PROVIDED');
    expect(confirmed.body.order.paymentDetailsShownAt).toBeTruthy();
    const handoff = await request(app).post(`/api/v1/deposits/orders/${order.id}/handoff-attempt`).set(buyerAuth).send({ outcome: 'OPENED' });
    expect(handoff.status, JSON.stringify(handoff.body)).toBe(202);
    expect(handoff.body.paymentConfirmed).toBe(false);
    expect(handoff.body.order.paymentHandoffStartedAt).toBeTruthy();
    const buyerOrdersWithTimestamps = (await request(app).get('/api/v1/deposits/orders/my').set(buyerAuth).expect(200)).body.orders;
    const timelineOrder = buyerOrdersWithTimestamps.find((row: { id: string }) => row.id === order.id);
    expect(timelineOrder.timestamps).toMatchObject({ orderCreatedAt: expect.any(String), matchedAt: expect.any(String), payNowClickedAt: expect.any(String), paymentDetailsViewedAt: expect.any(String), paymentHandoffInitiatedAt: expect.any(String), expiresAt: expect.any(String) });
    const adminOrders = await request(app).get(`/api/v1/admin/p2p/orders?page=1&pageSize=1&status=PAYMENT_PENDING&q=${encodeURIComponent(order.referenceId)}`).set(adminAuth).expect(200);
    expect(adminOrders.body.orders[0]).toMatchObject({ id: order.id, status: 'PAYMENT_PENDING', amountPaise: 50000, buyer: { phoneMasked: expect.any(String) }, seller: { phoneMasked: expect.any(String) } });
    expect(adminOrders.body).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(adminOrders.body.orders[0].timeline.some((event: { action: string }) => event.action === 'P2P_PAYMENT_HANDOFF_OPENED')).toBe(true);
    const adminOrdersPastEnd = await request(app).get(`/api/v1/admin/p2p/orders?page=2&pageSize=1&status=PAYMENT_PENDING&q=${encodeURIComponent(order.referenceId)}`).set(adminAuth).expect(200);
    expect(adminOrdersPastEnd.body).toMatchObject({ orders: [], page: 2, pageSize: 1, total: 1 });
    const adminOffers = await request(app).get(`/api/v1/admin/p2p/offers?q=${encodeURIComponent(offer.referenceId)}`).set(adminAuth).expect(200);
    expect(adminOffers.body.offers[0]).toMatchObject({ amountPaise: 50000, activeReservedPaise: 50000, availableAmountPaise: 0 });
    const postPayCancel = await request(app).post(`/api/v1/deposits/orders/${order.id}/cancel`).set(buyerAuth).send({}).expect(200);
    expect(postPayCancel.body.order).toMatchObject({ status: 'CANCELLED_PAYMENT_HOLD', holdForSettlement: true });
    const financeReference = `UPI-P2P-TEST-${randomUUID()}`;
    await request(app).post(`/api/v1/deposits/orders/${order.id}/payment-reference`).set(buyerAuth).send(paymentProof('')).expect(400);
    const submittedResponse = await request(app).post(`/api/v1/deposits/orders/${order.id}/payment-reference`).set(buyerAuth).send(paymentProof(financeReference, 50000));
    expect(submittedResponse.status, JSON.stringify(submittedResponse.body)).toBe(202);
    const submitted = submittedResponse;
    claimIds.push(submitted.body.claim.id); transactionReferences.push(financeReference);
    expect(submitted.body.order.status).toBe('PAYMENT_PROCESSING');
    const buyerAvailableBefore = await db.ledgerEntry.aggregate({ where: { account: { userId: buyerId, type: 'AVAILABLE' } }, _sum: { creditPaise: true, debitPaise: true } });
    expect(Number(buyerAvailableBefore._sum.creditPaise ?? 0n) - Number(buyerAvailableBefore._sum.debitPaise ?? 0n)).toBe(0);
    const claimId = submitted.body.claim.id as string;
    const adminClaims = await request(app).get('/api/v1/admin/p2p/claims').set(adminAuth).expect(200);
    expect(adminClaims.body.claims.some((row: { id: string }) => row.id === claimId)).toBe(true);
    const adminEvents = await request(app).get('/api/v1/admin/push-events').set(adminAuth).expect(200);
    const proofEvent = adminEvents.body.events.find((row: { claimId: string }) => row.claimId === claimId);
    expect(proofEvent).toMatchObject({ type: 'P2P_PAYMENT_PROOF_SUBMITTED', title: expect.any(String) });
    expect(proofEvent.body).not.toMatch(/₹|UTR|@/i);
    const claimDetails = await request(app).get(`/api/v1/admin/p2p/claims/${claimId}`).set(adminAuth).expect(200);
    expect(claimDetails.body.claim).toMatchObject({ id: claimId, order: { id: order.id, amountPaise: 50000 } });
    await request(app).get('/api/v1/admin/p2p/claims').set(buyerAuth).expect(403);
    await request(app).get('/api/v1/admin/push-events').set(buyerAuth).expect(403);
    await request(app).get(`/api/v1/admin/p2p/claims/${claimId}/evidence`).set(buyerAuth).expect(403);
    const privateEvidence = await request(app).get(`/api/v1/admin/p2p/claims/${claimId}/evidence`).set(adminAuth).expect(200);
    expect(privateEvidence.headers['content-type']).toContain('image/png');
    expect(privateEvidence.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(privateEvidence.body).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(adminClaims.body.claims.find((row: { id: string }) => row.id === claimId)).toMatchObject({ claimedAmountPaise: 50000, evidenceAttached: true, order: { id: order.id, withdrawalOffer: { id: offer.id }, timestamps: { matchedAt: expect.any(String), expiresAt: expect.any(String) } } });

    const reviewPath = `/api/v1/admin/p2p/claims/${claimId}/review`;
    const evidence = { decision: 'APPROVE', reason: 'Verified seller receipt in authorized bank records.', evidenceReference: `P2P-BANK-REVIEW-${randomUUID()}`, verifiedTransactionReference: financeReference, verifiedAmountPaise: 50000, verifiedCurrency: 'INR', verifiedPayeeVpa: 'other@testbank', receiverConfirmed: true };
    await request(app).post(reviewPath).set(adminAuth).send(evidence).expect(409);
    const validEvidence = { ...evidence, verifiedPayeeVpa: 'seller@testbank' };
    const missingSellerReceipt = await request(app).post(reviewPath).set(adminAuth).send(validEvidence).expect(409);
    expect(missingSellerReceipt.body.error.code).toBe('SELLER_RECEIPT_CONFIRMATION_REQUIRED');
    await request(app).post(`/api/v1/deposits/orders/${order.id}/seller-received`).set(buyerAuth).send({ transactionReference: financeReference }).expect(404);
    const receiptAck = await request(app).post(`/api/v1/deposits/orders/${order.id}/seller-received`).set(sellerAuth).send({ transactionReference: financeReference }).expect(202);
    expect(receiptAck.body).toMatchObject({ paymentVerified: false, ledgerSettled: false, confirmation: { status: 'SELLER_ACKNOWLEDGED' } });
    await request(app).post(reviewPath).set(adminAuth).send({ ...validEvidence, decision: 'REJECT', paymentNotReceivedConfirmed: true }).expect(409);
    const replayedAck = await request(app).post(`/api/v1/deposits/orders/${order.id}/seller-received`).set(sellerAuth).send({ transactionReference: financeReference }).expect(200);
    expect(replayedAck.body.ledgerSettled).toBe(false);
    const approved = await request(app).post(reviewPath).set(adminAuth).send(validEvidence).expect(200);
    expect(approved.body.orderStatus).toBe('COMPLETED');
    expect(approved.body.credited).toBe(true);
    expect(approved.body.referralCommissionPaise).toBe(200);
    expect(approved.body.referralCommissionStatus).toBe('PENDING');
    expect(await db.commissionEntry.count({ where: { qualifyingReference: `REFERRAL:P2P_ORDER:${order.id}` } })).toBe(1);
    const team = await request(app).get('/api/v1/users/me/referrals').set(adminAuth).expect(200);
    expect(team.body.commissionPercentBps).toBe(40);
    expect(team.body.pendingCommissionPaise).toBe(200);
    expect(team.body.commissionRuleConfigured).toBe(true);
    expect(team.body.commissionHistory).toHaveLength(1);
    expect(team.body.commissionHistory[0]).toMatchObject({ amountPaise: 200, status: 'PENDING', kind: 'DIRECT_COMMISSION' });
    expect((await db.p2pWithdrawalOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe('SETTLED');
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `P2P_PAYMENT_VERIFIED:${order.id}` } })).toBe(1);
    const buyerAvailable = await db.ledgerEntry.aggregate({ where: { account: { userId: buyerId, type: 'AVAILABLE' } }, _sum: { creditPaise: true, debitPaise: true } });
    const sellerReserved = await db.ledgerEntry.aggregate({ where: { account: { userId: sellerId, type: 'RESERVED' } }, _sum: { creditPaise: true, debitPaise: true } });
    expect([0, 3000]).toContain(approved.body.rewardPaise);
    expect(Number(buyerAvailable._sum.creditPaise ?? 0n) - Number(buyerAvailable._sum.debitPaise ?? 0n)).toBe(50000 + approved.body.rewardPaise);
    expect(Number(sellerReserved._sum.creditPaise ?? 0n) - Number(sellerReserved._sum.debitPaise ?? 0n)).toBe(0);
    const settledSellerOffer = (await request(app).get('/api/v1/withdrawals').set(sellerAuth).expect(200)).body.offers.find((row: { id: string }) => row.id === offer.id);
    expect(settledSellerOffer).toMatchObject({ completedAmountPaise: 50000, activeReservedPaise: 0, availableAmountPaise: 0 });
    await request(app).post(reviewPath).set(adminAuth).send({ ...evidence, verifiedPayeeVpa: 'seller@testbank' }).expect(409);
  });

  it('keeps an OPEN offer matchable while its seller is offline and shows the order after reconnect', async () => {
    const created = await createOffer(tokens[0], 50000).expect(201);
    const offer = created.body.withdrawalOffer;
    offerIds.push(offer.id);
    expect(offer.status).toBe('OPEN');
    expect(await db.p2pWithdrawalOffer.findUnique({ where: { id: offer.id }, select: { id: true, status: true } })).toMatchObject({ id: offer.id, status: 'OPEN' });

    // No seller API request is made between offer creation and the buyer match.
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('seller-offline-match')).send({ amountPaise: 10000, withdrawalOfferId: offer.id }).expect(201);
    orderIds.push(matched.body.order.id);
    expect(matched.body.withdrawalOffer).toMatchObject({ id: offer.id, remainingAmountPaise: 40000 });

    // Seller reconnects later and reads the persisted offer and order state.
    const sellerOffers = (await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers;
    expect(sellerOffers.find((row: { id: string }) => row.id === offer.id)).toMatchObject({ status: 'PARTIALLY_MATCHED', activeReservedPaise: 10000, availableAmountPaise: 40000 });
    expect(await db.notification.count({ where: { userId: sellerId, title: 'Withdrawal offer matched' } })).toBeGreaterThan(0);
  });

  it('moves a cancelled buyer to a different offer when the client excludes the previous match', async () => {
    const first = await createOffer(tokens[0], 10000).expect(201);
    const second = await createOffer(tokens[0], 10000).expect(201);
    const firstOfferId = first.body.withdrawalOffer.id as string;
    const secondOfferId = second.body.withdrawalOffer.id as string;
    offerIds.push(firstOfferId, secondOfferId);
    const initialMatch = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('cancel-rematch-first')).send({ amountPaise: 10000, withdrawalOfferId: firstOfferId }).expect(201);
    orderIds.push(initialMatch.body.order.id);
    await request(app).post(`/api/v1/deposits/orders/${initialMatch.body.order.id}/cancel`).set(auth(tokens[1])).send({}).expect(200);
    const rematch = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('cancel-rematch-second')).send({ amountPaise: 10000, withdrawalOfferId: secondOfferId, excludeWithdrawalOfferId: firstOfferId }).expect(201);
    orderIds.push(rematch.body.order.id);
    expect(rematch.body.withdrawalOffer.id).toBe(secondOfferId);
    expect(rematch.body.order.status).toBe('MATCHED');
  });

  it('makes a cancelled buyer slice immediately available for the next buyer on the same ₹500 offer', async () => {
    const created = await createOffer(tokens[0], 50000).expect(201);
    const offerId = created.body.withdrawalOffer.id as string;
    offerIds.push(offerId);
    const buyerBMatch = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('buyer-b-100')).send({ amountPaise: 10000, withdrawalOfferId: offerId }).expect(201);
    const buyerBOrder = buyerBMatch.body.order; orderIds.push(buyerBOrder.id);
    expect(buyerBOrder.amountPaise).toBe(10000);
    await request(app).post(`/api/v1/deposits/orders/${buyerBOrder.id}/cancel`).set(auth(tokens[1])).send({}).expect(200);

    const buyerCMatch = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[2])).set('Idempotency-Key', key('buyer-c-100')).send({ amountPaise: 10000, withdrawalOfferId: offerId }).expect(201);
    orderIds.push(buyerCMatch.body.order.id);
    expect(buyerCMatch.body.withdrawalOffer).toMatchObject({ id: offerId, remainingAmountPaise: 40000 });
    const sellerOffers = (await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers;
    const sellerOffer = sellerOffers.find((offer: { id: string }) => offer.id === offerId);
    expect(sellerOffer).toMatchObject({ completedAmountPaise: 0, activeReservedPaise: 10000, matchedAmountPaise: 10000, remainingAmountPaise: 40000, availableAmountPaise: 40000 });
    expect(sellerOffer.orders.some((order: { status: string }) => order.status === 'CANCELLED')).toBe(true);
    expect(await db.notification.count({ where: { userId: sellerId, title: 'Buyer cancelled before payment' } })).toBeGreaterThan(0);
  });

  it('closes an admin-rejected payment claim as REJECTED, notifies the buyer and reopens the seller offer', async () => {
    const created = await createOffer(tokens[0], 10000).expect(201);
    const offerId = created.body.withdrawalOffer.id as string;
    offerIds.push(offerId);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('reject-and-refresh')).send({ amountPaise: 10000, withdrawalOfferId: offerId }).expect(201);
    const orderId = matched.body.order.id as string;
    orderIds.push(orderId);
    await request(app).post(`/api/v1/deposits/orders/${orderId}/confirm`).set(auth(tokens[1])).send({}).expect(200);
    const transactionReference = `UPI-${randomUUID()}`;
    const submitted = await request(app).post(`/api/v1/deposits/orders/${orderId}/payment-reference`).set(auth(tokens[1])).send(paymentProof(transactionReference, 10000)).expect(202);
    claimIds.push(submitted.body.claim.id);
    transactionReferences.push(transactionReference);
    const reviewPath = `/api/v1/admin/p2p/claims/${submitted.body.claim.id}/review`;
    const rejectBody = { decision: 'REJECT', reason: 'No matching receipt was found.', evidenceReference: 'BANK-REVIEW-REJECT-01' };
    await request(app).post(reviewPath).set(auth(tokens[2])).send(rejectBody).expect(400);
    expect((await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers.find((row: { id: string }) => row.id === offerId)).toMatchObject({ disputedHeldPaise: 0, activeReservedPaise: 10000, availableAmountPaise: 0 });
    await request(app).post(reviewPath).set(auth(tokens[2])).send({ ...rejectBody, paymentNotReceivedConfirmed: true }).expect(200);
    const buyerOrders = (await request(app).get('/api/v1/deposits/orders/my').set(auth(tokens[1])).expect(200)).body.orders;
    const rejected = buyerOrders.find((item: { id: string }) => item.id === orderId);
    expect(rejected).toMatchObject({ status: 'REJECTED', claims: [{ status: 'REJECTED', reviewReason: 'No matching receipt was found.' }] });
    expect(await db.notification.count({ where: { userId: buyerId, title: 'Your deposit was rejected' } })).toBeGreaterThan(0);
    const marketplace = await request(app).get('/api/v1/withdrawals/marketplace').set(auth(tokens[1])).expect(200);
    expect(marketplace.body.offers.some((offer: { id: string }) => offer.id === offerId)).toBe(true);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `P2P_PAYMENT_VERIFIED:${orderId}` } })).toBe(0);
  });

  it('rejects normal cancellation after proof submission and releases the allocation only after Finance confirms non-receipt', async () => {
    const created = await createOffer(tokens[0], 50000).expect(201);
    const offerId = created.body.withdrawalOffer.id as string; offerIds.push(offerId);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('proof-cancel-hold')).send({ amountPaise: 10000, withdrawalOfferId: offerId }).expect(201);
    const orderId = matched.body.order.id as string; orderIds.push(orderId);
    await request(app).post(`/api/v1/deposits/orders/${orderId}/confirm`).set(auth(tokens[1])).send({}).expect(200);
    const reference = `UPI-PROOF-CANCEL-${randomUUID()}`;
    const submitted = await request(app).post(`/api/v1/deposits/orders/${orderId}/payment-reference`).set(auth(tokens[1])).send(paymentProof(reference)).expect(202);
    claimIds.push(submitted.body.claim.id); transactionReferences.push(reference);
    expect(submitted.body).toMatchObject({ order: { status: 'PAYMENT_PROCESSING' }, claim: { status: 'PENDING_REVIEW', evidenceAttached: true } });
    await request(app).post(`/api/v1/deposits/orders/${orderId}/payment-reference`).set(auth(tokens[1])).send(paymentProof(reference)).expect(409);
    await request(app).post(`/api/v1/deposits/orders/${orderId}/cancel`).set(auth(tokens[1])).send({}).expect(409);
    const stillHeld = (await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers.find((row: { id: string }) => row.id === offerId);
    expect(stillHeld).toMatchObject({ activeReservedPaise: 10000, disputedHeldPaise: 0, availableAmountPaise: 40000 });
    const rejected = await request(app).post(`/api/v1/admin/p2p/claims/${submitted.body.claim.id}/review`).set(auth(tokens[2])).send({ decision: 'REJECT', reason: 'Receiver records confirm no payment was received.', evidenceReference: `FIN-REJECT-${randomUUID()}`, paymentNotReceivedConfirmed: true }).expect(200);
    expect(rejected.body).toMatchObject({ orderStatus: 'REJECTED', credited: false, rematchableAmountPaise: 50000 });
    const reopened = (await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers.find((row: { id: string }) => row.id === offerId);
    expect(reopened).toMatchObject({ disputedHeldPaise: 0, activeReservedPaise: 0, availableAmountPaise: 50000 });
    const rematch = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[2])).set('Idempotency-Key', key('proof-cancel-rematch')).send({ amountPaise: 10000, withdrawalOfferId: offerId }).expect(201);
    orderIds.push(rematch.body.order.id);
  });

  it('repairs a legacy rejected claim stuck in PAYMENT_PROCESSING exactly once', async () => {
    const created = await createOffer(tokens[0], 50000).expect(201);
    const offerId = created.body.withdrawalOffer.id as string; offerIds.push(offerId);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('legacy-rejected')).send({ amountPaise: 10000, withdrawalOfferId: offerId }).expect(201);
    const orderId = matched.body.order.id as string; orderIds.push(orderId);
    await request(app).post(`/api/v1/deposits/orders/${orderId}/confirm`).set(auth(tokens[1])).send({}).expect(200);
    const ref = `UPI-${randomUUID()}`;
    const submitted = await request(app).post(`/api/v1/deposits/orders/${orderId}/payment-reference`).set(auth(tokens[1])).send(paymentProof(ref, 10000)).expect(202);
    claimIds.push(submitted.body.claim.id); transactionReferences.push(ref);
    await db.p2pPaymentClaim.update({ where: { id: submitted.body.claim.id }, data: { status: 'REJECTED', reviewedByUserId: adminId, reviewedAt: new Date(), reviewReason: 'Finance found no matching receipt.' } });
    await request(app).get('/api/v1/withdrawals/marketplace').set(auth(tokens[2])).expect(200);
    const cancelled = await db.p2pDepositOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(cancelled.status).toBe('REJECTED');
    expect(await db.auditLog.count({ where: { action: 'P2P_LEGACY_REJECTED_CLAIM_RECONCILED', target: `P2P_DEPOSIT_ORDER:${orderId}` } })).toBe(1);
    await request(app).get('/api/v1/withdrawals/marketplace').set(auth(tokens[2])).expect(200);
    expect(await db.auditLog.count({ where: { action: 'P2P_LEGACY_REJECTED_CLAIM_RECONCILED', target: `P2P_DEPOSIT_ORDER:${orderId}` } })).toBe(1);
  });

  it('labels a legacy after-Pay-Now cancellation as cancelled review, while keeping its amount held', async () => {
    const created = await createOffer(tokens[0], 10000).expect(201);
    const offerId = created.body.withdrawalOffer.id as string; offerIds.push(offerId);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('legacy-cancel-hold')).send({ amountPaise: 10000, withdrawalOfferId: offerId }).expect(201);
    const orderId = matched.body.order.id as string; orderIds.push(orderId);
    await request(app).post(`/api/v1/deposits/orders/${orderId}/confirm`).set(auth(tokens[1])).send({}).expect(200);
    await db.p2pDepositOrder.update({ where: { id: orderId }, data: { status: 'PAYMENT_EXPIRED_REVIEW' } });
    await db.auditLog.create({ data: { actorId: buyerId, action: 'P2P_PAYMENT_WINDOW_CANCELLED_REVIEW', target: `P2P_DEPOSIT_ORDER:${orderId}`, reason: 'Legacy buyer cancelled after seller details were shown.' } });
    const orders = (await request(app).get('/api/v1/deposits/orders/my').set(auth(tokens[1])).expect(200)).body.orders;
    expect(orders.find((row: { id: string }) => row.id === orderId).status).toBe('CANCELLED_PAYMENT_HOLD');
    const sellerOffer = (await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers.find((offer: { id: string }) => offer.id === offerId);
    expect(sellerOffer).toMatchObject({ status: 'PAYMENT_REVIEW', activeReservedPaise: 0, disputedHeldPaise: 10000, availableAmountPaise: 0 });
    expect((await db.p2pDepositOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('CANCELLED_PAYMENT_HOLD');
    expect(await db.ledgerTransaction.count({ where: { eventType: 'P2P_WITHDRAWAL_CANCELLED', referenceType: 'P2P_WITHDRAWAL_OFFER', referenceId: offerId } })).toBe(0);
  });

  it('allows user-provided unverified UPI details, but requires both name and ID', async () => {
    const offersBefore = await db.p2pWithdrawalOffer.count({ where: { userId: sellerId } });
    await db.user.update({ where: { id: sellerId }, data: { upiDisplayName: null } });
    await createOffer(tokens[0]).expect(409);
    expect(await db.p2pWithdrawalOffer.count({ where: { userId: sellerId } })).toBe(offersBefore);
    await db.user.update({ where: { id: sellerId }, data: { upiDisplayName: 'Seller Account Name' } });
    const result = await createOffer(tokens[0]).expect(201);
    offerIds.push(result.body.withdrawalOffer.id);
    expect(result.body.withdrawalOffer.payeeVerificationStatus).toBe('USER_PROVIDED');
    await request(app).post(`/api/v1/withdrawals/offers/${result.body.withdrawalOffer.id}/cancel`).set(auth(tokens[0])).send({}).expect(200);
  });

  it('reserves the seller funds atomically as soon as a withdrawal offer is created', async () => {
    const before = await db.ledgerEntry.aggregate({ where: { account: { userId: sellerId, type: 'AVAILABLE' } }, _sum: { creditPaise: true, debitPaise: true } });
    const availableBefore = (before._sum.creditPaise ?? 0n) - (before._sum.debitPaise ?? 0n);
    const created = await createOffer(tokens[0], 50000).expect(201);
    const offerId = created.body.withdrawalOffer.id as string; offerIds.push(offerId);
    const after = await db.ledgerEntry.aggregate({ where: { account: { userId: sellerId, type: 'AVAILABLE' } }, _sum: { creditPaise: true, debitPaise: true } });
    const availableAfter = (after._sum.creditPaise ?? 0n) - (after._sum.debitPaise ?? 0n);
    expect(availableBefore - availableAfter).toBe(50000n);
  });

  it('splits a ₹5,000 withdrawal offer into smaller ₹100-step buyer matches without exceeding the offer', async () => {
    const initial = await db.ledgerEntry.aggregate({ where: { account: { userId: sellerId, type: 'AVAILABLE' } }, _sum: { creditPaise: true, debitPaise: true } });
    const initialAvailable = Number(initial._sum.creditPaise ?? 0n) - Number(initial._sum.debitPaise ?? 0n);
    const created = await request(app).post('/api/v1/withdrawals').set(auth(tokens[0])).set('Idempotency-Key', key('partial-offer')).send({ amountPaise: 500000 }).expect(201);
    const offer = created.body.withdrawalOffer; offerIds.push(offer.id);
    const before = await db.ledgerEntry.aggregate({ where: { account: { userId: sellerId, type: 'AVAILABLE' } }, _sum: { creditPaise: true, debitPaise: true } });
    const availableBeforeMatch = Number(before._sum.creditPaise ?? 0n) - Number(before._sum.debitPaise ?? 0n);
    expect(initialAvailable - availableBeforeMatch).toBe(500000);
    expect(created.body.withdrawalOffer.status).toBe('OPEN');

    const partialAmounts = [10000, 20000, 100000, 200000, 170000];
    let remaining = 500000;
    for (const [index, amountPaise] of partialAmounts.entries()) {
      const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key(`partial-match-${index}`)).send({ amountPaise, withdrawalOfferId: offer.id }).expect(201);
      orderIds.push(matched.body.order.id);
      expect(matched.body.order.amountPaise).toBe(amountPaise);
      remaining -= amountPaise;
      expect(matched.body.withdrawalOffer.remainingAmountPaise).toBe(remaining);
    }
    const fifth = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[2])).set('Idempotency-Key', key('partial-overfill')).send({ amountPaise: 10000, withdrawalOfferId: offer.id }).expect(409);
    expect(fifth.body.error.code).toBe('NO_MATCHING_WITHDRAWAL_OFFERS');
    const after = await db.ledgerEntry.aggregate({ where: { account: { userId: sellerId, type: 'AVAILABLE' } }, _sum: { creditPaise: true, debitPaise: true } });
    const availableAfterMatch = Number(after._sum.creditPaise ?? 0n) - Number(after._sum.debitPaise ?? 0n);
    expect(availableBeforeMatch - availableAfterMatch).toBe(0);
    expect(await db.p2pDepositOrder.aggregate({ where: { withdrawalOfferId: offer.id }, _sum: { amountPaise: true } })).toMatchObject({ _sum: { amountPaise: 500000n } });
  });

  it('returns an unconfirmed expired match to matching and reports the 6% estimate', async () => {
    const created = await createOffer(tokens[0], 10000).expect(201);
    const offer = created.body.withdrawalOffer; offerIds.push(offer.id);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('expiry-match')).send({ amountPaise: 10000, withdrawalOfferId: offer.id }).expect(201);
    const order = matched.body.order; orderIds.push(order.id);
    expect(matched.body.reward).toMatchObject({ percentBps: 600, estimatedPaise: 600 });
    await db.p2pDepositOrder.update({ where: { id: order.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    const mine = await request(app).get('/api/v1/deposits/orders/my').set(auth(tokens[1])).expect(200);
    expect(mine.body.orders.find((row: { id: string }) => row.id === order.id).status).toBe('EXPIRED');
    const marketplace = await request(app).get('/api/v1/withdrawals/marketplace').set(auth(tokens[1])).expect(200);
    expect(marketplace.body.offers.some((row: { id: string }) => row.id === offer.id)).toBe(true);
  });

  it('expires a confirmed order before UPI handoff and releases its allocation for matching', async () => {
    const created = await createOffer(tokens[0], 10000).expect(201);
    const offer = created.body.withdrawalOffer; offerIds.push(offer.id);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('confirmed-expiry')).send({ amountPaise: 10000, withdrawalOfferId: offer.id }).expect(201);
    const order = matched.body.order; orderIds.push(order.id);
    expect(new Date(order.expiresAt).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    await request(app).post(`/api/v1/deposits/orders/${order.id}/confirm`).set(auth(tokens[1])).send({}).expect(200);
    await request(app).post(`/api/v1/deposits/orders/${order.id}/handoff-attempt`).set(auth(tokens[1])).send({ outcome: 'UNAVAILABLE' }).expect(202);
    await db.p2pDepositOrder.update({ where: { id: order.id }, data: { expiresAt: new Date(Date.now() - 1) } });

    const buyerOrders = (await request(app).get('/api/v1/deposits/orders/my').set(auth(tokens[1])).expect(200)).body.orders;
    expect(buyerOrders.find((row: { id: string }) => row.id === order.id).status).toBe('EXPIRED');
    const sellerOffers = (await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers;
    expect(sellerOffers.find((row: { id: string }) => row.id === offer.id)).toMatchObject({ activeReservedPaise: 0, disputedHeldPaise: 0, availableAmountPaise: 10000 });
    const marketplace = await request(app).get('/api/v1/withdrawals/marketplace').set(auth(tokens[2])).expect(200);
    expect(marketplace.body.offers.some((row: { id: string }) => row.id === offer.id)).toBe(true);
  });

  it('cancels after payment details response but before UPI handoff and makes the amount available again', async () => {
    const created = await createOffer(tokens[0], 10000).expect(201);
    const offer = created.body.withdrawalOffer; offerIds.push(offer.id);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('cancel-before-handoff')).send({ amountPaise: 10000, withdrawalOfferId: offer.id }).expect(201);
    const order = matched.body.order; orderIds.push(order.id);
    await request(app).post(`/api/v1/deposits/orders/${order.id}/confirm`).set(auth(tokens[1])).send({}).expect(200);
    await request(app).post(`/api/v1/deposits/orders/${order.id}/handoff-attempt`).set(auth(tokens[1])).send({ outcome: 'UNAVAILABLE' }).expect(202);
    const cancelled = await request(app).post(`/api/v1/deposits/orders/${order.id}/cancel`).set(auth(tokens[1])).send({}).expect(200);
    expect(cancelled.body.order).toMatchObject({ status: 'CANCELLED', holdForSettlement: false });
    const sellerOffer = (await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers.find((row: { id: string }) => row.id === offer.id);
    expect(sellerOffer).toMatchObject({ activeReservedPaise: 0, disputedHeldPaise: 0, availableAmountPaise: 10000 });
    const rematched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[2])).set('Idempotency-Key', key('rematch-after-no-handoff')).send({ amountPaise: 10000, withdrawalOfferId: offer.id });
    expect(rematched.status, JSON.stringify(rematched.body)).toBe(201);
    orderIds.push(rematched.body.order.id);
  });

  it('derives stale MATCHED offer state from order allocations and reopens a cancelled slice', async () => {
    const created = await createOffer(tokens[0], 50000).expect(201);
    const offerId = created.body.withdrawalOffer.id as string; offerIds.push(offerId);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('stale-status')).send({ amountPaise: 10000, withdrawalOfferId: offerId }).expect(201);
    const orderId = matched.body.order.id as string; orderIds.push(orderId);
    await request(app).post(`/api/v1/deposits/orders/${orderId}/cancel`).set(auth(tokens[1])).send({}).expect(200);
    await db.p2pWithdrawalOffer.update({ where: { id: offerId }, data: { status: 'MATCHED' } });
    const sellerOffers = (await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers;
    expect(sellerOffers.find((offer: { id: string }) => offer.id === offerId)).toMatchObject({ status: 'PENDING_MATCH', activeReservedPaise: 0, disputedHeldPaise: 0, availableAmountPaise: 50000 });
    const marketplace = await request(app).get('/api/v1/withdrawals/marketplace').set(auth(tokens[2])).expect(200);
    expect(marketplace.body.offers.find((offer: { id: string }) => offer.id === offerId)).toMatchObject({ status: 'OPEN', remainingAmountPaise: 50000 });
  });

  it('lets a buyer close after Pay Now but does not release or rematch a possibly paid offer', async () => {
    const created = await createOffer(tokens[0], 10000).expect(201);
    const offer = created.body.withdrawalOffer; offerIds.push(offer.id);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('cancel-after-paynow')).send({ amountPaise: 10000, withdrawalOfferId: offer.id }).expect(201);
    const order = matched.body.order; orderIds.push(order.id);
    await request(app).post(`/api/v1/deposits/orders/${order.id}/confirm`).set(auth(tokens[1])).send({}).expect(200);
    await request(app).post(`/api/v1/deposits/orders/${order.id}/handoff-attempt`).set(auth(tokens[1])).send({ outcome: 'OPENED' }).expect(202);
    const cancelled = await request(app).post(`/api/v1/deposits/orders/${order.id}/cancel`).set(auth(tokens[1])).send({}).expect(200);
    expect(cancelled.body.order).toMatchObject({ status: 'CANCELLED_PAYMENT_HOLD', holdForSettlement: true });
    expect(cancelled.body.message).toContain('Order cancelled');
    const sellerOffer = (await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers.find((row: { id: string }) => row.id === offer.id);
    expect(sellerOffer).toMatchObject({ status: 'PAYMENT_REVIEW', activeReservedPaise: 0, disputedHeldPaise: 10000, sellerFundsReservedPaise: 10000, availableAmountPaise: 0 });
    const nextMatch = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[2])).set('Idempotency-Key', key('no-rematch-after-paynow')).send({ amountPaise: 10000, withdrawalOfferId: offer.id }).expect(409);
    expect(nextMatch.body.error.code).toBe('NO_MATCHING_WITHDRAWAL_OFFERS');
  });

  it('expires after recorded UPI handoff and retains the allocation for payment resolution', async () => {
    const created = await createOffer(tokens[0], 10000).expect(201);
    const offer = created.body.withdrawalOffer; offerIds.push(offer.id);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('expiry-after-handoff')).send({ amountPaise: 10000, withdrawalOfferId: offer.id }).expect(201);
    const order = matched.body.order; orderIds.push(order.id);
    await request(app).post(`/api/v1/deposits/orders/${order.id}/confirm`).set(auth(tokens[1])).send({}).expect(200);
    await request(app).post(`/api/v1/deposits/orders/${order.id}/handoff-attempt`).set(auth(tokens[1])).send({ outcome: 'OPENED' }).expect(202);
    await db.p2pDepositOrder.update({ where: { id: order.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    const rows = (await request(app).get('/api/v1/deposits/orders/my').set(auth(tokens[1])).expect(200)).body.orders;
    expect(rows.find((row: { id: string }) => row.id === order.id).status).toBe('PAYMENT_EXPIRED_REVIEW');
    const sellerOffer = (await request(app).get('/api/v1/withdrawals').set(auth(tokens[0])).expect(200)).body.offers.find((row: { id: string }) => row.id === offer.id);
    expect(sellerOffer).toMatchObject({ activeReservedPaise: 0, disputedHeldPaise: 10000, availableAmountPaise: 0 });
  });

  it('cancels or expires only unmatched offers and returns reserved money to available balance', async () => {
    const created = await createOffer(tokens[0], 10000).expect(201);
    const offer = created.body.withdrawalOffer; offerIds.push(offer.id);
    const cancelled = await request(app).post(`/api/v1/withdrawals/offers/${offer.id}/cancel`).set(auth(tokens[0])).send({}).expect(200);
    expect(cancelled.body.offer.status).toBe('CANCELLED');
    const adminOfferResult = await createOffer(tokens[0], 10000).expect(201);
    const adminOffer = adminOfferResult.body.withdrawalOffer; offerIds.push(adminOffer.id);
    await request(app).post(`/api/v1/admin/p2p/offers/${adminOffer.id}/cancel`).set(auth(tokens[2])).send({ reason: 'Invalid offer reported by account monitoring.' }).expect(200);
    expect(await db.auditLog.count({ where: { action: 'P2P_WITHDRAWAL_OFFER_ADMIN_CANCELLED', target: `P2P_WITHDRAWAL_OFFER:${adminOffer.id}` } })).toBe(1);
    const before = await db.ledgerEntry.aggregate({ where: { account: { userId: sellerId, type: 'AVAILABLE' } }, _sum: { creditPaise: true, debitPaise: true } });
    const availableBeforeExpiry = Number(before._sum.creditPaise ?? 0n) - Number(before._sum.debitPaise ?? 0n);
    const expiring = await createOffer(tokens[0], 10000).expect(201);
    const expiringOffer = expiring.body.withdrawalOffer; offerIds.push(expiringOffer.id);
    await db.p2pWithdrawalOffer.update({ where: { id: expiringOffer.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    await request(app).get('/api/v1/withdrawals/marketplace').set(auth(tokens[1])).expect(200);
    expect((await db.p2pWithdrawalOffer.findUniqueOrThrow({ where: { id: expiringOffer.id } })).status).toBe('EXPIRED');
    const after = await db.ledgerEntry.aggregate({ where: { account: { userId: sellerId, type: 'AVAILABLE' } }, _sum: { creditPaise: true, debitPaise: true } });
    expect(Number(after._sum.creditPaise ?? 0n) - Number(after._sum.debitPaise ?? 0n)).toBe(availableBeforeExpiry);
  });

  it('lets a seller cancel an offer remainder while preserving matched buyer funds and Finance resolution', async () => {
    const reservedBefore = await db.ledgerEntry.aggregate({ where: { account: { userId: sellerId, type: 'RESERVED' } }, _sum: { creditPaise: true, debitPaise: true } });
    const reservedBeforePaise = Number(reservedBefore._sum.creditPaise ?? 0n) - Number(reservedBefore._sum.debitPaise ?? 0n);
    const created = await createOffer(tokens[0], 50000).expect(201);
    const offer = created.body.withdrawalOffer; offerIds.push(offer.id);
    const matched = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[1])).set('Idempotency-Key', key('seller-cancel-after-match')).send({ amountPaise: 10000, withdrawalOfferId: offer.id }).expect(201);
    const order = matched.body.order; orderIds.push(order.id);

    const cancelled = await request(app).post(`/api/v1/withdrawals/offers/${offer.id}/cancel`).set(auth(tokens[0])).send({}).expect(200);
    expect(cancelled.body.offer.status).toBe('CANCELLED');
    expect(cancelled.body.message).toContain('Existing matched buyer orders remain reserved');
    const reserved = await db.ledgerEntry.aggregate({ where: { account: { userId: sellerId, type: 'RESERVED' } }, _sum: { creditPaise: true, debitPaise: true } });
    expect(Number(reserved._sum.creditPaise ?? 0n) - Number(reserved._sum.debitPaise ?? 0n) - reservedBeforePaise).toBe(10000);
    const stillMatchable = await request(app).post('/api/v1/deposits/quick-match').set(auth(tokens[2])).set('Idempotency-Key', key('cancelled-offer-not-matchable')).send({ amountPaise: 10000, withdrawalOfferId: offer.id }).expect(409);
    expect(stillMatchable.body.error.code).toBe('NO_MATCHING_WITHDRAWAL_OFFERS');

    await request(app).post(`/api/v1/deposits/orders/${order.id}/confirm`).set(auth(tokens[1])).send({}).expect(200);
    await request(app).post(`/api/v1/deposits/orders/${order.id}/handoff-attempt`).set(auth(tokens[1])).send({ outcome: 'OPENED' }).expect(202);
    const reference = `CANCELLED-OFFER-${randomUUID()}`;
    const claim = await request(app).post(`/api/v1/deposits/orders/${order.id}/payment-reference`).set(auth(tokens[1])).send(paymentProof(reference, 10000)).expect(202);
    claimIds.push(claim.body.claim.id); transactionReferences.push(reference);
    await request(app).post(`/api/v1/deposits/orders/${order.id}/seller-received`).set(auth(tokens[0])).send({ transactionReference: reference }).expect(202);
    const review = await request(app).post(`/api/v1/admin/p2p/claims/${claim.body.claim.id}/review`).set(auth(tokens[2])).send({ decision: 'APPROVE', reason: 'Receipt independently checked against bank records.', evidenceReference: `FIN-${randomUUID()}`, verifiedTransactionReference: reference, verifiedAmountPaise: 10000, verifiedCurrency: 'INR', verifiedPayeeVpa: 'seller@testbank', receiverConfirmed: true }).expect(200);
    expect(review.body).toMatchObject({ orderStatus: 'COMPLETED', credited: true, offerStatus: 'CANCELLED' });
  });

  it('allows only one of concurrent buyers to match a single offer', async () => {
    const created = await createOffer(tokens[0], 10000).expect(201);
    const offer = created.body.withdrawalOffer; offerIds.push(offer.id);
    const buyers = [tokens[1], tokens[2]];
    const responses = await Promise.all(buyers.map((token) => request(app).post('/api/v1/deposits/quick-match').set(auth(token)).set('Idempotency-Key', key('concurrent')).send({ amountPaise: 10000, withdrawalOfferId: offer.id })));
    const winners = responses.filter((response) => response.status === 201);
    const losers = responses.filter((response) => response.status === 409);
    expect(winners).toHaveLength(1);
    expect(losers, JSON.stringify(responses.map((response) => ({ status: response.status, body: response.body })))).toHaveLength(1);
    const order = winners[0].body.order; orderIds.push(order.id);
    const token = winners[0].body.order.buyerUserId === adminId ? tokens[2] : tokens[1];
    await request(app).post(`/api/v1/deposits/orders/${order.id}/cancel`).set(auth(token)).send({}).expect(200);
  });
});
