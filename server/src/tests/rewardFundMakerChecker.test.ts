import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { ADMIN_SETTLEMENT_CASH_ID } from '../modules/admin/walletCreditWorkflow.js';
import { decideRewardFundFundingRequest, REWARD_FUND_ACCOUNT_ID } from '../modules/admin/rewardFundFunding.js';

const makerId = '00000000-0000-4000-8000-000000000401';
const verifierId = '00000000-0000-4000-8000-000000000402';
const requestId = '00000000-0000-4000-8000-000000000403';
const reference = 'REWARD-FUND-TEST-REFERENCE';
const requestRow = {
  id: requestId, makerUserId: makerId, amountPaise: 100_000n, recipientVpa: 'reward-test@paisapay.invalid',
  reason: 'Isolated maker checker unit test', status: 'PENDING_VERIFICATION',
  paymentReferenceHash: createHash('sha256').update(reference.toUpperCase()).digest('hex'),
  paymentReferenceMasked: '••••ENCE', evidenceReference: 'receiver-side test record',
  statementDate: new Date('2026-11-28T00:00:00Z'), fundingRecord: null,
};

const previous = {
  rewardFundFundingEnabled: env.rewardFundFundingEnabled,
  rewardFundReceiverVpa: env.rewardFundReceiverVpa,
  p2pOrderRewardFundAccountId: env.p2pOrderRewardFundAccountId,
  p2pOrderRewardFundingSource: env.p2pOrderRewardFundingSource,
};

function makeTx(role = 'SUPER_ADMIN') {
  const auditRows: any[] = [];
  const tx = {
    user: { findUnique: async ({ where }: any) => ({ id: where.id, status: 'ACTIVE', adminRole: { role } }) },
    rewardFundFundingRequest: {
      findUnique: async () => requestRow,
      update: async ({ data }: any) => ({ ...requestRow, ...data }),
    },
    rewardFundFundingRecord: {
      findUnique: async () => null,
      create: async ({ data }: any) => ({ id: requestId, ...data }),
    },
    adminWalletFundingRequest: { findUnique: async () => null },
    adminPhonePeCreditRequest: { findFirst: async () => null },
    ledgerAccount: { upsert: async ({ where }: any) => where.id === ADMIN_SETTLEMENT_CASH_ID
      ? { id: ADMIN_SETTLEMENT_CASH_ID, type: 'SETTLEMENT_CASH', currency: 'INR' }
      : { id: REWARD_FUND_ACCOUNT_ID, type: 'REWARD_FUND', currency: 'INR' } },
    ledgerTransaction: {
      create: async () => ({ id: 'funding-ledger-id', createdAt: new Date() }),
      findUnique: async ({ where }: any) => where.id === 'funding-ledger-id' ? { id: 'funding-ledger-id', createdAt: new Date() } : null,
    },
    auditLog: { create: async ({ data }: any) => { auditRows.push(data); return { id: `audit-${auditRows.length}` }; } },
    $executeRaw: async () => 1,
    $queryRaw: async (parts: TemplateStringsArray) => {
      const sql = parts.join('');
      if (sql.includes('SELECT EXISTS')) return [{ reused: false }];
      return [{
        id: REWARD_FUND_ACCOUNT_ID, type: 'REWARD_FUND', currency: 'INR', balance: 0n,
        allCredits: 0n, allDebits: 0n, recordedFunding: 0n, fundingCredits: 0n,
        rewardDebits: 0n, liabilityCredits: 0n, walletAvailable: 0n, ledgerAvailable: 0n,
        walletPending: 0n, ledgerPending: 0n, walletReserved: 0n, ledgerReserved: 0n,
        fundingMismatchCount: 0, rewardMismatchCount: 0,
      }];
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, auditRows };
}

afterEach(() => Object.assign(env, previous));

describe('Reward Funding maker-checker service enforcement', () => {
  it('rejects the funding request maker before any decision or ledger write', async () => {
    env.rewardFundFundingEnabled = true;
    env.rewardFundReceiverVpa = requestRow.recipientVpa;
    env.p2pOrderRewardFundAccountId = REWARD_FUND_ACCOUNT_ID;
    env.p2pOrderRewardFundingSource = 'DEDICATED_REWARD_FUND';
    const { tx } = makeTx();
    await expect(decideRewardFundFundingRequest(tx, {
      requestId, verifierUserId: makerId, decision: 'VERIFY', reason: 'Verified receiver-side test receipt',
      paymentReference: reference, receivedAmountPaise: 100_000, receivedVpa: requestRow.recipientVpa, receiverConfirmed: true,
    })).rejects.toMatchObject({ code: 'REWARD_FUNDING_MAKER_CHECKER_REQUIRED' });
  });

  it('rejects a non-SUPER_ADMIN attempting a funding decision', async () => {
    env.rewardFundFundingEnabled = true;
    const { tx } = makeTx('FINANCE');
    await expect(decideRewardFundFundingRequest(tx, {
      requestId, verifierUserId: verifierId, decision: 'REJECT', reason: 'Not authorized to decide funding',
    })).rejects.toMatchObject({ code: 'SUPER_ADMIN_REQUIRED' });
  });

  it('allows a distinct active SUPER_ADMIN to verify and audits maker and verifier IDs', async () => {
    env.rewardFundFundingEnabled = true;
    env.rewardFundReceiverVpa = requestRow.recipientVpa;
    env.p2pOrderRewardFundAccountId = REWARD_FUND_ACCOUNT_ID;
    env.p2pOrderRewardFundingSource = 'DEDICATED_REWARD_FUND';
    const { tx, auditRows } = makeTx();
    const result = await decideRewardFundFundingRequest(tx, {
      requestId, verifierUserId: verifierId, decision: 'VERIFY', reason: 'Verified receiver-side test receipt',
      paymentReference: reference, receivedAmountPaise: 100_000, receivedVpa: requestRow.recipientVpa, receiverConfirmed: true,
    });
    expect(result.request.status).toBe('VERIFIED');
    expect(auditRows.map((row) => row.metadata)).toEqual(expect.arrayContaining([
      expect.objectContaining({ makerUserId: makerId, verifierUserId: verifierId, externalProviderVerification: false }),
    ]));
  });
});
