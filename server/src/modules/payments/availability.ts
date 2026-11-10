import { env } from '../../config/env.js';
import { prisma } from '../../lib/db.js';
import { cashfreeSandboxAvailable } from '../../integrations/payments/cashfree.js';

export const paymentMethodRules = [
  { name: 'Paytm', method: 'PAYTM' as const, buyEligible: true, sellEligible: true },
  { name: 'PhonePe', method: 'PHONEPE' as const, buyEligible: false, sellEligible: true },
  { name: 'Navi', method: 'NAVI' as const, buyEligible: false, sellEligible: true },
  { name: 'Cashfree', method: 'CASHFREE' as const, buyEligible: false, sellEligible: false },
];

/** Wallet-linking integrations have been removed from the client and API. */
export const walletLinkProviders: readonly string[] = [];

export function walletIntegrationInfo(name: string) {
  return {
    providerFlow: null,
    status: 'INTEGRATION_NOT_IMPLEMENTED',
    linkingDocumented: false,
    available: false,
    message: 'No authorized wallet-linking integration is implemented for this provider.',
  };
}

type MethodConfiguration = { enabled: boolean; providerApproved: boolean } | null;
type StoredMethodConfiguration = MethodConfiguration & { method: string };

export function getMethodAvailability(
  configuration: MethodConfiguration,
  conditions: { databaseAvailable: boolean; providerConfigured: boolean; providerOperational: boolean },
) {
  let status: string;
  let availabilityMessage: string;

  if (!conditions.databaseAvailable) {
    status = 'CONFIGURATION_UNAVAILABLE';
    availabilityMessage = 'Payment configuration could not be loaded. UPI payments are temporarily unavailable.';
  } else if (!configuration) {
    status = 'NOT_CONFIGURED';
    availabilityMessage = 'This payment method has no backend configuration.';
  } else if (!configuration.enabled) {
    status = 'DISABLED';
    availabilityMessage = 'This payment method is disabled in the PaisaPay configuration.';
  } else if (!configuration.providerApproved) {
    status = 'NOT_APPROVED';
    availabilityMessage = 'The payment provider has not been approved for this method.';
  } else if (!conditions.providerConfigured) {
    status = 'PROVIDER_NOT_CONFIGURED';
    availabilityMessage = 'No payment provider credentials are configured.';
  } else if (!conditions.providerOperational) {
    status = 'INTEGRATION_UNAVAILABLE';
    availabilityMessage = 'The approved payment integration is not operational.';
  } else {
    status = 'AVAILABLE';
    availabilityMessage = 'Payment method is available.';
  }

  return {
    enabled: configuration?.enabled ?? false,
    providerApproved: configuration?.providerApproved ?? false,
    providerConfigured: conditions.providerConfigured,
    integrationOperational: conditions.providerOperational,
    available: status === 'AVAILABLE',
    status,
    availabilityMessage,
  };
}

/** Counts only provider authorizations completed by a verified backend flow.
 * A saved account reference or user-controlled toggle is never an active wallet.
 */
export function summarizeWalletActivation(statuses: string[]) {
  const activeCount = statuses.filter((status) => status === 'AUTHORIZED_CONNECTED').length;
  return {
    activeCount,
    targetCount: null as number | null,
    progressPercent: null as number | null,
    booster: {
      configured: false,
      eligible: false,
      message: 'Withdrawal speed benefits are not configured for this account.',
    },
  };
}

export async function getPaymentMethodAvailability() {
  let configurations: StoredMethodConfiguration[] = [];
  let databaseAvailable = Boolean(prisma);

  if (prisma) {
    try {
      configurations = await prisma.paymentMethodConfiguration.findMany({
        select: { method: true, enabled: true, providerApproved: true },
      });
    } catch {
      databaseAvailable = false;
    }
  }

  const byMethod = new Map(configurations.map((item) => [item.method, item]));
  const receiverVpa = env.depositReceiverUpiId ?? null;
  const methods = paymentMethodRules.map((rule) => {
    const providerConfigured = rule.method === 'CASHFREE' && cashfreeSandboxAvailable();
    return {
      name: rule.name,
      method: rule.method,
      buyEnabled: rule.buyEligible,
      sellEnabled: rule.sellEligible,
      walletIntegration: walletIntegrationInfo(rule.name),
      ...getMethodAvailability(byMethod.get(rule.method) ?? null, {
        databaseAvailable,
        providerConfigured,
        // Cashfree availability is sandbox checkout only; flags and credentials
        // are additionally gated in the configuration above and deposit route.
        providerOperational: rule.method === 'CASHFREE' && cashfreeSandboxAvailable(),
      }),
    };
  });
  const livePaymentProviderAvailable = methods.some((method) => method.available && method.method !== 'CASHFREE');
  const financialBlockers = [
    ...(!env.financialOperationsEnabled ? ['Financial operations are disabled by the server safety gate.'] : []),
    ...(!livePaymentProviderAvailable ? ['No approved, operational live payment provider is available.'] : []),
    ...(!receiverVpa ? ['No authorized UPI recipient is configured.'] : []),
  ];
  const financialActionsAvailable = financialBlockers.length === 0;
  const financialReason = financialActionsAvailable ? null : financialBlockers.join(' ');

  return {
    currency: 'INR',
    // This is the same server-side gate enforced by every financial mutation
    // route. It is advisory for the client; route middleware remains decisive.
    financialOperations: {
      enabled: financialActionsAvailable,
      gateEnabled: env.financialOperationsEnabled,
      status: financialActionsAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
      reason: financialReason,
      blockers: financialBlockers,
      capabilities: {
        addMoney: {
          available: financialActionsAvailable,
          reason: financialReason,
        },
        withdraw: {
          available: financialActionsAvailable,
          reason: financialReason,
          type: 'P2P_OFFER_NOT_BANK_PAYOUT',
        },
        quickDeposit: {
          available: financialActionsAvailable,
          reason: financialReason,
        },
        p2pMatching: {
          available: financialActionsAvailable,
          reason: financialReason,
        },
      },
    },
    upiDeposit: {
      receiverVpa,
      minAmountPaise: env.minDepositPaise,
      maxAmountPaise: env.maxDepositPaise,
      rewardPercentBps: env.upiDepositRewardPercentBps,
      rewardEnabled: env.upiDepositRewardEnabled,
      rewardMessage: env.upiDepositRewardEnabled
        ? 'Development test rewards are funded from the local reward pool and are credited only after an eligible UPI deposit is independently verified, subject to available pool balance.'
        : 'A reward estimate can be shown, but no funded deposit reward program is active; no reward will be credited.',
      paymentInitiation: receiverVpa ? 'UPI_INTENT' : 'UNAVAILABLE',
      verificationMode: 'MANUAL_RECONCILIATION',
      automaticVerificationAvailable: false,
      message: receiverVpa
        ? 'UPI app handoff is available. Payment remains pending until Finance independently verifies the merchant receipt.'
        : 'UPI deposits are unavailable because no recipient is configured. No deposit request can be created.',
    },
    // A configured Cashfree sandbox is useful for checkout testing but is not
    // a live payment route and never credits redeemable funds.
    livePaymentsEnabled: false,
    sandboxPaymentsEnabled: methods.some((method) => method.method === 'CASHFREE' && method.available),
    availabilityMessage: !receiverVpa
      ? 'UPI deposits are unavailable because no recipient is configured. No approved, operational payment provider is configured.'
      : methods.some((method) => method.available)
      ? 'Cashfree sandbox checkout is enabled for testing only. It does not add redeemable balance.'
      : 'UPI payments are temporarily unavailable. No approved, operational payment provider is configured.',
    methods,
  };
}
