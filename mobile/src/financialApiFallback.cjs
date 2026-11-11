const FINANCIAL_OPERATIONS_DISABLED_CODE = 'FINANCIAL_OPERATIONS_DISABLED';
const MANUAL_UPI_OPERATIONS_DISABLED_CODE = 'MANUAL_UPI_OPERATIONS_DISABLED';

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
  const capabilityNames = ['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching'];
  const hasServerCapabilities = source && typeof source.enabled === 'boolean'
    && capabilities && capabilityNames.every((name) => typeof capabilities[name]?.available === 'boolean');
  if (!hasServerCapabilities) {
    if (typeof config?.livePaymentsEnabled === 'boolean' || typeof config?.sandboxPaymentsEnabled === 'boolean') {
      const legacyReasons = [];
      if (config.livePaymentsEnabled === false) legacyReasons.push('Live payments are disabled in the legacy server configuration.');
      const availabilityMessage = typeof config?.availabilityMessage === 'string' ? config.availabilityMessage.trim() : '';
      if (availabilityMessage) legacyReasons.push(availabilityMessage);
      if (config?.upiDeposit && !config.upiDeposit.receiverVpa && !/recipient|receiver/i.test(availabilityMessage)) {
        legacyReasons.push('No authorized UPI recipient is configured.');
      }
      return {
        enabled: false,
        reason: `This server returned a legacy availability response. ${legacyReasons.join(' ')} Financial actions remain disabled until the API reports the required capabilities.`,
      };
    }
    return { enabled: false, reason: 'Availability could not be confirmed from the server. Financial actions remain disabled.' };
  }

  const serverAllowsAll = source.enabled === true && capabilityNames.every((name) => capabilities[name].available === true);
  const readsConfirmEnabled = ordersResult?.disabled === false && withdrawalsResult?.disabled === false;
  if (serverAllowsAll && readsConfirmEnabled) return { enabled: true, reason: '' };

  const capabilityReason = capabilityNames.map((name) => capabilities[name].reason).find(Boolean);
  return {
    enabled: false,
    reason: source.reason || capabilityReason || 'Financial operations are unavailable on this server.',
  };
}

module.exports = { FINANCIAL_OPERATIONS_DISABLED_CODE, MANUAL_UPI_OPERATIONS_DISABLED_CODE, financialOperationsEnabled, financialAvailability, loadFinancialResource, loadVersionedAvailability };
