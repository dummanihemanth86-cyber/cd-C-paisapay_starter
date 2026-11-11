const FINANCE_ROLES = new Set(['FINANCE', 'ADMIN', 'SUPER_ADMIN']);
const P2P_READ_ROLES = new Set(['OPERATIONS', 'FINANCE', 'ADMIN', 'SUPER_ADMIN']);

const ACTIONS = {
  quickDeposit: {
    roles: P2P_READ_ROLES,
    implemented: false,
    reason: 'Admin Quick Deposit is read-only. Matching is a customer action and is disabled by the server financial-operations safety gate.',
  },
  paymentVerification: {
    roles: FINANCE_ROLES,
    implemented: true,
    manualGate: true,
    reason: 'Manual UPI payment review is unavailable while the server manual UPI safety gate is disabled. Submitted UTRs and screenshots are claims, not independent verification.',
  },
  withdrawalVerification: {
    roles: P2P_READ_ROLES,
    implemented: false,
    reason: 'Withdrawal verification actions are not implemented. Withdrawal records are available for read-only review.',
  },
  payoutProcessing: {
    roles: FINANCE_ROLES,
    implemented: false,
    reason: 'Payout processing is unavailable because no authorized payout integration is configured.',
  },
  walletAdjustment: {
    roles: FINANCE_ROLES,
    implemented: false,
    reason: 'Direct Admin wallet credit/debit is not available. The wallet ledger is read-only; credits must come from authorized, verified backend flows.',
  },
};

function canViewFinancialAction(action, role) {
  return Boolean(ACTIONS[action]?.roles.has(String(role || '').toUpperCase()));
}

function financialActionState(action, role, financialOperationsEnabled, manualUpiOperationsEnabled) {
  const definition = ACTIONS[action];
  const visible = canViewFinancialAction(action, role);
  const gateAllows = definition?.manualGate
    ? manualUpiOperationsEnabled === true
    : !definition?.gate || financialOperationsEnabled === true;
  const enabled = Boolean(visible && definition?.implemented && gateAllows);
  let reason = '';
  if (visible && !enabled) {
    if (definition?.manualGate && manualUpiOperationsEnabled == null) {
      reason = 'The server has not confirmed manual UPI review availability. This action stays disabled until its status is available.';
    } else if (definition?.manualGate && manualUpiOperationsEnabled === true) {
      reason = '';
    } else if (definition?.manualGate) {
      reason = definition?.reason || 'This action is unavailable.';
    } else if (definition?.gate && financialOperationsEnabled == null) {
      reason = 'The server has not confirmed financial-operation availability. This action stays disabled until its status is available.';
    } else if (definition?.gate && financialOperationsEnabled === true) {
      reason = '';
    } else {
      reason = definition?.reason || 'This action is unavailable.';
    }
  }
  return { visible, enabled, reason };
}

module.exports = { ACTIONS, canViewFinancialAction, financialActionState };
