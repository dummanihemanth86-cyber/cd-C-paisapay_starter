import { describe, expect, it } from 'vitest';
import { getMethodAvailability, manualP2pUnavailableReason, paymentMethodRules, summarizeWalletActivation, walletIntegrationInfo, walletLinkProviders } from '../modules/payments/availability.js';

const ready = { databaseAvailable: true, providerConfigured: true, providerOperational: true };

describe('payment method availability gates', () => {
  it('fails closed when a method has no stored configuration', () => {
    const result = getMethodAvailability(null, ready);
    expect(result.available).toBe(false);
    expect(result.status).toBe('NOT_CONFIGURED');
  });

  it('fails closed when the payment method is disabled', () => {
    const result = getMethodAvailability({ enabled: false, providerApproved: true }, ready);
    expect(result.available).toBe(false);
    expect(result.status).toBe('DISABLED');
  });

  it('fails closed when provider approval is missing', () => {
    const result = getMethodAvailability({ enabled: true, providerApproved: false }, ready);
    expect(result.available).toBe(false);
    expect(result.status).toBe('NOT_APPROVED');
  });

  it('fails closed when provider credentials are missing', () => {
    const result = getMethodAvailability({ enabled: true, providerApproved: true }, { ...ready, providerConfigured: false });
    expect(result.available).toBe(false);
    expect(result.status).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('fails closed when the provider integration is not operational', () => {
    const result = getMethodAvailability({ enabled: true, providerApproved: true }, { ...ready, providerOperational: false });
    expect(result.available).toBe(false);
    expect(result.status).toBe('INTEGRATION_UNAVAILABLE');
  });

  it('reports available only when all configuration, approval, and operational gates pass', () => {
    const result = getMethodAvailability({ enabled: true, providerApproved: true }, ready);
    expect(result.available).toBe(true);
    expect(result.status).toBe('AVAILABLE');
  });
});

describe('wallet activation summary', () => {
  it('does not count a saved reference as active or invent a booster target', () => {
    const result = summarizeWalletActivation(['REFERENCE_SAVED_NOT_CONNECTED', 'UNAVAILABLE']);
    expect(result.activeCount).toBe(0);
    expect(result.targetCount).toBeNull();
    expect(result.progressPercent).toBeNull();
    expect(result.booster.configured).toBe(false);
  });

  it('counts only backend-verified provider authorizations', () => {
    expect(summarizeWalletActivation(['AUTHORIZED_CONNECTED', 'REFERENCE_SAVED_NOT_CONNECTED']).activeCount).toBe(1);
  });
});

describe('manual UPI/P2P availability reasons', () => {
  it('reports the manual safety gate without unrelated recipient or provider blockers', () => {
    const reason = manualP2pUnavailableReason(true, false);
    expect(reason).toMatch(/manual UPI\/P2P operations are disabled by the server safety gate/i);
    expect(reason).not.toMatch(/recipient|provider/i);
  });

  it('reports database readiness separately and returns no blocker only when both checks pass', () => {
    expect(manualP2pUnavailableReason(false, true)).toMatch(/database-backed manual UPI\/P2P readiness/i);
    expect(manualP2pUnavailableReason(false, false)).toMatch(/safety gate/i);
    expect(manualP2pUnavailableReason(true, true)).toBeNull();
  });
});

describe('wallet-link provider readiness', () => {
  it('does not expose MobiKwik after its integration was removed', () => {
    const result = walletIntegrationInfo('MobiKwik');
    expect(result.providerFlow).toBeNull();
    expect(result.linkingDocumented).toBe(false);
    expect(result.available).toBe(false);
    expect(result.status).toBe('INTEGRATION_NOT_IMPLEMENTED');
    expect(paymentMethodRules.some((method) => method.name === 'MobiKwik')).toBe(false);
  });

  it('offers no wallet-link provider', () => {
    expect(walletLinkProviders).toEqual([]);
  });

  it('does not claim a provider without a supported flow can be linked', () => {
    const result = walletIntegrationInfo('Paytm');
    expect(result.linkingDocumented).toBe(false);
    expect(result.available).toBe(false);
    expect(result.status).toBe('INTEGRATION_NOT_IMPLEMENTED');
  });
});
