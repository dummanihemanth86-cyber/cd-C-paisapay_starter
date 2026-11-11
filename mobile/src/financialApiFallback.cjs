const FINANCIAL_OPERATIONS_DISABLED_CODE = 'FINANCIAL_OPERATIONS_DISABLED';

async function loadFinancialResource(request, fallback) {
  try {
    return { value: await request(), disabled: false };
  } catch (error) {
    if (error?.status === 503 && error?.code === FINANCIAL_OPERATIONS_DISABLED_CODE) {
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

module.exports = { FINANCIAL_OPERATIONS_DISABLED_CODE, financialOperationsEnabled, financialAvailability, loadFinancialResource, loadVersionedAvailability };
