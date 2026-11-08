import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const stagingApi = 'https://paisapay-api-staging.onrender.com';
const liveCreditOptIn = process.env.PAISAPAY_STAGING_WALLET_CREDIT_E2E === 'I_CONFIRM_100_INR_STAGING_CREDIT';
const testCreditPaise = 10_000; // Fixed at the minimum supported amount: ₹100.

type ApiResult = { status: number; body: any };

async function api(path: string, token: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResult> {
  const response = await fetch(`${stagingApi}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  let body: any = null;
  try { body = await response.json(); } catch { /* status and safe error code are enough */ }
  return { status: response.status, body };
}

function requireOk(result: ApiResult, label: string) {
  if (result.status < 200 || result.status >= 300) {
    const code = typeof result.body?.error?.code === 'string' ? result.body.error.code : 'UNKNOWN_ERROR';
    throw new Error(`${label} failed with HTTP ${result.status} (${code}). No credentials or response body were logged.`);
  }
  return result.body;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in the private test environment.`);
  return value;
}

describe('PaisaPay staging wallet credit end-to-end (posts a real ₹100 staging credit)', () => {
  it.skipIf(!liveCreditOptIn)('verifies request, replay, independent approval, balance, ledger history, and duplicate protection', async () => {
    const makerToken = required('PAISAPAY_STAGING_CREDIT_MAKER_ACCESS_TOKEN');
    const checkerToken = required('PAISAPAY_STAGING_CREDIT_CHECKER_ACCESS_TOKEN');
    const targetUserId = required('PAISAPAY_STAGING_CREDIT_TARGET_USER_ID');
    const expectedPublicId = required('PAISAPAY_STAGING_CREDIT_TARGET_PUBLIC_ID');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
      throw new Error('PAISAPAY_STAGING_CREDIT_TARGET_USER_ID must be a UUID.');
    }

    const maker = requireOk(await api('/api/v1/admin/me', makerToken), 'Maker authentication');
    const checker = requireOk(await api('/api/v1/admin/me', checkerToken), 'Checker authentication');
    expect(maker.role).toBe('SUPER_ADMIN');
    expect(checker.role).toBe('SUPER_ADMIN');
    expect(checker.userId).not.toBe(maker.userId);
    expect(maker.walletCreditRequestsEnabled).toBe(true);

    const settings = requireOk(await api('/api/v1/admin/settings', makerToken), 'Wallet readiness');
    const safety = settings.financialSafety;
    expect(settings.paymentProvider).toBe('disabled');
    expect(safety.financialOperationsEnabled).toBe(false);
    expect(safety.walletCreditReadiness).toBe('READY');
    expect(safety.walletCreditBlockers).toEqual([]);
    expect(safety.walletLedgerIntegrity).toBe('BALANCED');
    expect(safety.creditRequestLedgerLinks).toBe('RECONCILED');
    expect(safety.fundingProvenance).toBe('RECONCILED');
    expect(safety.adjustmentFundHasFunds).toBe(true);
    expect(BigInt(safety.adjustmentFundBalancePaise)).toBeGreaterThanOrEqual(2n * BigInt(testCreditPaise));

    const search = requireOk(await api(`/api/v1/admin/users?page=1&pageSize=25&q=${encodeURIComponent(targetUserId)}`, makerToken), 'User ID search');
    expect(search.users.some((row: any) => row.id === targetUserId)).toBe(true);
    const detail = requireOk(await api(`/api/v1/admin/users/${encodeURIComponent(targetUserId)}`, makerToken), 'Staging test account lookup');
    const user = detail.user;
    expect(user.id).toBe(targetUserId);
    expect(user.publicId).toBe(expectedPublicId);
    expect(user.status).toBe('ACTIVE');
    expect(user.adminRole).toBeFalsy();
    expect(String(user.displayName ?? '').toUpperCase()).toContain('STAGING CREDIT TEST');
    const beforeBalance = Number(user.walletBalancePaise);
    expect(Number.isSafeInteger(beforeBalance)).toBe(true);

    const idempotencyKey = randomUUID();
    const reason = `Approved staging E2E credit ${idempotencyKey}`;
    const requestBody = {
      targetUserId,
      verifiedPublicId: user.publicId,
      verifiedPhoneMasked: user.phoneMasked,
      verifiedWalletBalancePaise: beforeBalance,
      amountPaise: testCreditPaise,
      reason,
    };
    const created = requireOk(await api('/api/v1/admin/wallet/credits/requests', makerToken, {
      method: 'POST', body: requestBody, headers: { 'Idempotency-Key': idempotencyKey },
    }), 'Credit request creation');
    expect(created.replayed).toBe(false);
    expect(created.request.status).toBe('PENDING_APPROVAL');

    const replay = requireOk(await api('/api/v1/admin/wallet/credits/requests', makerToken, {
      method: 'POST', body: requestBody, headers: { 'Idempotency-Key': idempotencyKey },
    }), 'Idempotent credit request replay');
    expect(replay.replayed).toBe(true);
    expect(replay.request.id).toBe(created.request.id);

    const pendingDetail = requireOk(await api(`/api/v1/admin/users/${encodeURIComponent(targetUserId)}`, makerToken), 'Pre-approval balance check');
    expect(Number(pendingDetail.user.walletBalancePaise)).toBe(beforeBalance);

    const approval = requireOk(await api(`/api/v1/admin/wallet/credits/requests/${encodeURIComponent(created.request.id)}/decision`, checkerToken, {
      method: 'POST', body: { decision: 'APPROVE', reason: `Independent staging checker ${idempotencyKey}` },
    }), 'Independent checker approval');
    expect(approval.request.status).toBe('APPROVED');
    expect(approval.request.checkerUserId).toBe(checker.userId);
    expect(approval.request.makerUserId).toBe(maker.userId);

    const duplicateApproval = await api(`/api/v1/admin/wallet/credits/requests/${encodeURIComponent(created.request.id)}/decision`, checkerToken, {
      method: 'POST', body: { decision: 'APPROVE', reason: `Duplicate staging approval ${idempotencyKey}` },
    });
    expect(duplicateApproval.status).toBe(409);
    expect(duplicateApproval.body?.error?.code).toBe('CREDIT_REQUEST_ALREADY_DECIDED');

    const [afterDetail, history, ledger, afterSettings] = await Promise.all([
      api(`/api/v1/admin/users/${encodeURIComponent(targetUserId)}`, checkerToken),
      api(`/api/v1/admin/users/${encodeURIComponent(targetUserId)}/wallet/credits?page=1&pageSize=100`, checkerToken),
      api(`/api/v1/admin/wallets/ledger?userId=${encodeURIComponent(targetUserId)}&page=1&pageSize=100`, checkerToken),
      api('/api/v1/admin/settings', checkerToken),
    ]);
    const updatedUser = requireOk(afterDetail, 'Post-approval wallet balance');
    const creditHistory = requireOk(history, 'Credit transaction history');
    const ledgerHistory = requireOk(ledger, 'User wallet ledger history');
    const finalSettings = requireOk(afterSettings, 'Post-credit ledger reconciliation');
    expect(Number(updatedUser.user.walletBalancePaise)).toBe(beforeBalance + testCreditPaise);
    const completedRequest = creditHistory.requests.find((row: any) => row.id === created.request.id);
    expect(completedRequest).toMatchObject({ status: 'APPROVED', displayStatus: 'COMPLETED', ledgerTransactionId: approval.credit.id });
    expect(creditHistory.credits.filter((row: any) => row.id === approval.credit.id)).toHaveLength(1);
    const userCreditEntries = ledgerHistory.entries.filter((row: any) => row.transaction?.id === approval.credit.id && row.accountType === 'AVAILABLE');
    expect(userCreditEntries).toHaveLength(1);
    expect(userCreditEntries[0]).toMatchObject({ creditPaise: testCreditPaise, debitPaise: 0 });
    expect(finalSettings.financialSafety.walletLedgerIntegrity).toBe('BALANCED');
    expect(finalSettings.financialSafety.creditRequestLedgerLinks).toBe('RECONCILED');

    const rejectedRequestKey = randomUUID();
    const rejectedRequest = requireOk(await api('/api/v1/admin/wallet/credits/requests', makerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': rejectedRequestKey },
      body: {
        targetUserId,
        verifiedPublicId: updatedUser.user.publicId,
        verifiedPhoneMasked: updatedUser.user.phoneMasked,
        verifiedWalletBalancePaise: Number(updatedUser.user.walletBalancePaise),
        amountPaise: testCreditPaise,
        reason: `Staging E2E rejection path ${rejectedRequestKey}`,
      },
    }), 'Rejection-path request creation');
    const rejection = requireOk(await api(`/api/v1/admin/wallet/credits/requests/${encodeURIComponent(rejectedRequest.request.id)}/decision`, checkerToken, {
      method: 'POST', body: { decision: 'REJECT', reason: `Independent staging rejection ${rejectedRequestKey}` },
    }), 'Independent checker rejection');
    expect(rejection.request.status).toBe('REJECTED');
    const afterRejection = requireOk(await api(`/api/v1/admin/users/${encodeURIComponent(targetUserId)}`, checkerToken), 'Post-rejection balance check');
    expect(Number(afterRejection.user.walletBalancePaise)).toBe(beforeBalance + testCreditPaise);
  }, 120_000);
});
