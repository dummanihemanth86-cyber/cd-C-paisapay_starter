import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../lib/http.js';

export const FINANCIAL_OPERATIONS_DISABLED_CODE = 'FINANCIAL_OPERATIONS_DISABLED';
export const MANUAL_UPI_OPERATIONS_DISABLED_CODE = 'MANUAL_UPI_OPERATIONS_DISABLED';

/** Stable policy surface used by regression tests and API documentation. */
export const FINANCIAL_OPERATION_ROUTE_MANIFEST = [
  ['POST', '/api/v1/withdrawals'],
  ['POST', '/api/v1/withdrawals/offers/:id/cancel'],
  ['POST', '/api/v1/deposits/quick-match'],
  ['POST', '/api/v1/deposits/orders/:id/confirm'],
  ['POST', '/api/v1/deposits/orders/:id/handoff-attempt'],
  ['POST', '/api/v1/deposits/orders/:id/payment-reference'],
  ['POST', '/api/v1/deposits/orders/:id/seller-received'],
  ['POST', '/api/v1/deposits/orders/:id/cancel'],
  ['POST', '/api/v1/orders/:id/dispute'],
  ['POST', '/api/v1/admin/p2p/offers/:id/cancel'],
  ['POST', '/api/v1/admin/p2p/claims/:id/review'],
  ['POST', '/api/v1/deposits'],
  ['POST', '/api/v1/admin/deposits/upi'],
  ['POST', '/api/v1/admin/deposits/:id/manual-claim'],
  ['POST', '/api/v1/deposits/:id/cancel'],
  ['POST', '/api/v1/deposits/:id/manual-verification'],
  ['POST', '/api/v1/admin/reconciliation/claims/:claimId/review'],
  ['POST', '/api/v1/webhooks/payments/:provider'],
  ['POST', '/api/v1/orders'],
  ['POST', '/api/v1/orders/:id/reservations'],
  ['POST', '/api/v1/orders/:id/cancel'],
  ['POST', '/api/v1/orders/:id/payment-submission'],
  ['PATCH', '/api/v1/admin/referrals/config'],
  ['PATCH', '/api/v1/admin/referrals/milestones/:key'],
  ['PATCH', '/api/v1/admin/reward-rules/:id'],
] as const;

export function assertFinancialOperationsEnabled(): void {
  if (!env.financialOperationsEnabled) {
    throw new HttpError(503, FINANCIAL_OPERATIONS_DISABLED_CODE, 'Financial operations are disabled on this server. No financial change was made.');
  }
}

/** Providerless UPI/P2P flow. It has its own explicit gate so the existing
 * manual matching system can run without enabling or pretending to configure
 * a payment gateway. Production startup additionally requires an approval
 * attestation in env.ts. */
export function assertManualUpiOperationsEnabled(): void {
  if (!env.manualUpiOperationsEnabled) {
    throw new HttpError(503, MANUAL_UPI_OPERATIONS_DISABLED_CODE, 'Manual UPI and P2P operations are disabled on this server. No financial change was made.');
  }
}

/** Verified manual UPI settlement may record only its configured follow-up
 * rewards/commission entries under the same manual UPI gate. */
export function assertFinancialOrManualUpiOperationsEnabled(): void {
  if (env.manualUpiOperationsEnabled) return;
  assertFinancialOperationsEnabled();
}

export const financialOperationsGate: RequestHandler = (_req, _res, next) => {
  try {
    assertFinancialOperationsEnabled();
    next();
  } catch (error) {
    next(error);
  }
};

export const manualUpiOperationsGate: RequestHandler = (_req, _res, next) => {
  try {
    assertManualUpiOperationsEnabled();
    next();
  } catch (error) {
    next(error);
  }
};
