import { z } from 'zod';

export const reportKinds = ['registrations', 'deposits', 'withdrawals', 'p2p-orders', 'support-tickets'] as const;
export type ReportKind = typeof reportKinds[number];

const statusByReport: Record<ReportKind, readonly string[]> = {
  registrations: ['PENDING_PROFILE', 'ACTIVE', 'SUSPENDED', 'CLOSED'],
  deposits: ['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_VERIFIED', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'REVERSED'],
  withdrawals: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED'],
  'p2p-orders': ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_SUBMITTED', 'PAYMENT_PROCESSING', 'PAYMENT_UNDER_REVIEW', 'PAYMENT_REVIEW', 'PAYMENT_UNCERTAIN', 'PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'COMPLETED', 'SETTLED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'DISPUTED', 'FAILED'],
  'support-tickets': ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Use a valid YYYY-MM-DD date.');

export const reportQuerySchema = z.object({
  report: z.enum(reportKinds),
  from: isoDate,
  to: isoDate,
  status: z.string().trim().min(1).max(40).optional(),
}).strict().superRefine((value, context) => {
  const from = Date.parse(`${value.from}T00:00:00.000Z`);
  const to = Date.parse(`${value.to}T00:00:00.000Z`);
  const days = Math.floor((to - from) / 86_400_000) + 1;
  if (days < 1) context.addIssue({ code: 'custom', path: ['to'], message: 'The end date must be on or after the start date.' });
  if (days > 366) context.addIssue({ code: 'custom', path: ['to'], message: 'Date ranges may not exceed 366 days.' });
  if (value.status && !statusByReport[value.report].includes(value.status)) {
    context.addIssue({ code: 'custom', path: ['status'], message: `Status is not valid for ${value.report}.` });
  }
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export const reportStatuses = (kind: ReportKind): readonly string[] => statusByReport[kind];

export interface ReportAggregateRow {
  day: string;
  status: string;
  recordCount: number | bigint;
  amountPaise: string | null;
}

export function formatReportResult(input: ReportQuery, rows: ReportAggregateRow[]) {
  const from = new Date(`${input.from}T00:00:00.000Z`);
  const to = new Date(`${input.to}T00:00:00.000Z`);
  const totalsByStatus = new Map<string, { count: number; amount: bigint }>();
  const daily = new Map<string, { count: number; amount: bigint }>();
  let totalAmount = 0n;
  let total = 0;
  for (const row of rows) {
    const count = Number(row.recordCount);
    const amount = BigInt(row.amountPaise || '0');
    const status = totalsByStatus.get(row.status) || { count: 0, amount: 0n };
    status.count += count;
    status.amount += amount;
    totalsByStatus.set(row.status, status);
    const day = daily.get(row.day) || { count: 0, amount: 0n };
    day.count += count;
    day.amount += amount;
    daily.set(row.day, day);
    total += count;
    totalAmount += amount;
  }
  const days = Array.from({ length: Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1 }, (_, index) => {
    const date = new Date(from.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    const value = daily.get(date) || { count: 0, amount: 0n };
    return { date, count: value.count, ...(hasMoney(input.report) ? { amountPaise: value.amount.toString() } : {}) };
  });
  return {
    report: input.report,
    from: input.from,
    to: input.to,
    statusFilter: input.status || null,
    total,
    ...(hasMoney(input.report) ? { totalAmountPaise: totalAmount.toString() } : {}),
    statusBreakdown: [...totalsByStatus.entries()].map(([status, value]) => ({ status, count: value.count, ...(hasMoney(input.report) ? { amountPaise: value.amount.toString() } : {}) })),
    daily: days,
  };
}

export function hasMoney(kind: ReportKind): boolean {
  return kind === 'deposits' || kind === 'withdrawals' || kind === 'p2p-orders';
}

export function safeSettingsSnapshot(input: {
  nodeEnv: string;
  financialOperationsEnabled: boolean;
  paymentProvider: string;
  otpProvider: string;
  databaseConfigured: boolean;
  walletAdjustmentEnabled: boolean;
  walletAdjustmentAdminConfigured: boolean;
  walletFundingEnabled?: boolean;
  walletCreditsEnabled?: boolean;
  activeSuperAdminCount?: number;
  independentCheckerAvailable?: boolean;
  walletCreditBlockers?: string[];
  walletCreditReadiness?: string;
  makerCheckerMigration?: string;
  walletLedgerIntegrity?: string;
  creditRequestLedgerLinks?: string;
  fundingRequestLedgerLinks?: string;
  fundingProvenance?: string;
  activeSuperAdminCountStatus?: string;
  externalBankReconciliation?: string;
  walletProductionApproved?: boolean;
  settlementCashAccount?: { status: 'PROVISIONED' | 'MISSING' | 'CHECK_FAILED'; balancePaise: string | null };
  adjustmentFundAccount: { status: 'PROVISIONED' | 'MISSING' | 'CHECK_FAILED'; balancePaise: string | null };
}) {
  const funded = input.adjustmentFundAccount.status === 'PROVISIONED' && BigInt(input.adjustmentFundAccount.balancePaise ?? '0') > 0n;
  const independentApprovalAvailable = (input.activeSuperAdminCount ?? 0) >= 2;
  const cashAccount = input.settlementCashAccount ?? { status: 'MISSING' as const, balancePaise: null };
  const financialControlsReady = input.walletAdjustmentEnabled && input.walletFundingEnabled === true && input.walletCreditsEnabled === true && input.walletProductionApproved === true && funded && independentApprovalAvailable && cashAccount.status === 'PROVISIONED' && input.walletCreditReadiness === 'READY';
  return {
    environment: input.nodeEnv,
    financialOperationsEnabled: input.financialOperationsEnabled,
    paymentProvider: input.paymentProvider,
    otpProvider: input.otpProvider,
    databaseConfigured: input.databaseConfigured,
    financialSafety: {
      financialOperationsEnabled: input.financialOperationsEnabled,
      walletAdjustmentsEnabled: input.walletAdjustmentEnabled,
      dedicatedAdminAdjustmentAccount: input.adjustmentFundAccount.status,
      adjustmentFundBalancePaise: input.adjustmentFundAccount.balancePaise,
      adjustmentFundHasFunds: funded,
      singleAdminAdjustmentAccountConfigured: input.walletAdjustmentAdminConfigured,
      independentApprovalImplemented: true,
      independentApprovalAvailable,
      independentCheckerAvailable: input.independentCheckerAvailable ?? independentApprovalAvailable,
      walletCreditBlockers: input.walletCreditBlockers ?? [],
      walletCreditReadiness: input.walletCreditReadiness ?? (financialControlsReady ? 'PREREQUISITES_PRESENT_REQUIRES_EXPLICIT_APPROVAL' : 'BLOCKED'),
      makerCheckerMigration: input.makerCheckerMigration ?? 'UNKNOWN',
      walletLedgerIntegrity: input.walletLedgerIntegrity ?? 'UNKNOWN',
      creditRequestLedgerLinks: input.creditRequestLedgerLinks ?? 'UNKNOWN',
      fundingRequestLedgerLinks: input.fundingRequestLedgerLinks ?? 'UNKNOWN',
      fundingProvenance: input.fundingProvenance ?? 'UNKNOWN',
      activeSuperAdminCountStatus: input.activeSuperAdminCountStatus ?? 'UNKNOWN',
      externalBankReconciliation: input.externalBankReconciliation ?? 'NOT_VERIFIED',
      walletProductionApproved: input.walletProductionApproved ?? false,
      activeSuperAdminCount: input.activeSuperAdminCount ?? 0,
      fundingWorkflowEnabled: input.walletFundingEnabled === true,
      creditWorkflowEnabled: input.walletCreditsEnabled === true,
      settlementCashAccount: cashAccount,
      adminAdjustmentControlsReady: financialControlsReady,
      superAdminWalletCreditsEnabled: financialControlsReady,
      superAdminCreditPrerequisitesReady: financialControlsReady,
      productionEnablementSupported: true,
      explanation: 'Maker-checker requests, funding journals, reconciliation, and audit are implemented. The dedicated Admin workflow remains separate from general payment and payout operations. Production use still requires a legitimate cleared source, external statement reconciliation, distinct maker/checker people, explicit production approval, and passing migration and ledger-integrity checks.',
    },
    editableSettings: [] as string[],
    message: 'System configuration is read-only here. Secrets and financial-operation controls cannot be edited in the Admin UI.',
  };
}
