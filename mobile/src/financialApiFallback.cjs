const FINANCIAL_OPERATIONS_DISABLED_CODE = 'FINANCIAL_OPERATIONS_DISABLED';
const MANUAL_UPI_OPERATIONS_DISABLED_CODE = 'MANUAL_UPI_OPERATIONS_DISABLED';
const CAPABILITY_NAMES = ['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'];
const UNCONFIRMED_AVAILABILITY_REASON = 'Availability could not be confirmed from the server. Financial actions remain disabled.';
const LEGACY_P2P_REASON = 'The server has not confirmed manual UPI/P2P availability. Matching and withdrawal offers remain disabled.';

function describeFinancialUnavailableReason(reason) {
  return String(reason || '')
    .replace(/\bfinancial operations are disabled by the server safety gate\b/gi, 'Financial actions are unavailable under the server safety settings')
    .replace(/\b(?:database-backed )?payment configuration is unavailable\b/gi, 'Payment configuration could not be loaded.');
}

async function loadFinancialResource(request, fallback) {
  try {
    return { value: await request(), disabled: false };
  } catch (error) {
    if (error?.status === 503 && [FINANCIAL_OPERATIONS_DISABLED_CODE, MANUAL_UPI_OPERATIONS_DISABLED_CODE].includes(error?.code)) {
      return { value: fallback, disabled: true };
    }
    throw error;
  }
}

function financialOperationsEnabled(ordersResult, withdrawalsResult) {
  return Boolean(
    ordersResult && withdrawalsResult &&
    ordersResult.disabled === false && withdrawalsResult.disabled === false,
  );
}

async function loadVersionedAvailability(request) {
  try {
    const response = await request();
    if (response?.apiVersion === '2.0.0' && response?.schemaVersion === 2
      && response?.financialOperations && typeof response.financialOperations.enabled === 'boolean'
      && response.financialOperations.capabilities
      && ['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'].every((name) => typeof response.financialOperations.capabilities[name]?.available === 'boolean')) {
      return response;
    }
  } catch {
    // Older API deployments do not expose v2; the caller can safely fall back
    // to v1, whose capability checks remain fail-closed.
  }
  return null;
}

function financialAvailability(config, ordersResult, withdrawalsResult) {
  const source = config?.financialOperations;
  const capabilities = source?.capabilities;
  const hasServerCapabilities = source && typeof source.enabled === 'boolean'
    && capabilities && CAPABILITY_NAMES.every((name) => typeof capabilities[name]?.available === 'boolean');
  if (!hasServerCapabilities) {
    if (typeof config?.livePaymentsEnabled === 'boolean' || typeof config?.sandboxPaymentsEnabled === 'boolean') {
      const legacyReasons = [];
      if (config.livePaymentsEnabled === false) legacyReasons.push('Live payments are disabled in the legacy server configuration.');
      const availabilityMessage = typeof config?.availabilityMessage === 'string' ? describeFinancialUnavailableReason(config.availabilityMessage.trim()) : '';
      if (availabilityMessage) legacyReasons.push(availabilityMessage);
      if (config?.upiDeposit && !config.upiDeposit.receiverVpa && !/recipient|receiver/i.test(availabilityMessage)) {
        legacyReasons.push('No authorized UPI recipient is configured.');
      }
      const reason = describeFinancialUnavailableReason(`This server returned a legacy availability response. ${legacyReasons.join(' ')} Financial actions remain disabled until the API reports the required capabilities.`);
      const p2pReason = config?.manualUpiOperationsEnabled === false
        ? 'Manual UPI/P2P operations are disabled by the server safety gate.'
        : LEGACY_P2P_REASON;
      return {
        enabled: false,
        reason,
        capabilityReasons: {
          addMoney: describeFinancialUnavailableReason(config?.upiDeposit?.message || reason),
          withdraw: p2pReason,
          quickDeposit: p2pReason,
          p2pMatching: p2pReason,
          available: Object.fromEntries(CAPABILITY_NAMES.map((name) => [name, false])),
        },
      };
    }
    return {
      enabled: false,
      reason: UNCONFIRMED_AVAILABILITY_REASON,
      capabilityReasons: {
        ...Object.fromEntries(CAPABILITY_NAMES.map((name) => [name, name === 'addMoney' ? UNCONFIRMED_AVAILABILITY_REASON : LEGACY_P2P_REASON])),
        available: Object.fromEntries(CAPABILITY_NAMES.map((name) => [name, false])),
      },
    };
  }

  // The versioned availability response is the server's authoritative
  // capability contract. Read endpoints load history and offers; their
  // response can fail independently and must not override a confirmed
  // capability. Mutation endpoints still enforce the server-side safety gate.
  const globalReason = describeFinancialUnavailableReason(source.reason ||
    'Financial actions are unavailable under the current server settings.');
  const available = Object.fromEntries(CAPABILITY_NAMES.map((name) => [
    name,
    source.enabled === true
      && capabilities[name].available === true,
  ]));
  const capabilityReasons = Object.fromEntries(CAPABILITY_NAMES.map((name) => {
    if (capabilities[name].available === false) return [name, describeFinancialUnavailableReason(capabilities[name].reason || source.reason || 'This feature is disabled by the server.')];
    if (!available[name]) return [name, globalReason];
    return [name, ''];
  }));
  capabilityReasons.available = available;
  const allAvailable = CAPABILITY_NAMES.every((name) => available[name]);
  if (allAvailable) return { enabled: true, reason: '', capabilityReasons };

  return {
    enabled: false,
    reason: globalReason,
    capabilityReasons,
  };
}

module.exports = { FINANCIAL_OPERATIONS_DISABLED_CODE, MANUAL_UPI_OPERATIONS_DISABLED_CODE, financialOperationsEnabled, financialAvailability, loadFinancialResource, loadVersionedAvailability };
