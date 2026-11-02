import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { apiGet } from './api';

const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const terminalSuccess = ['COMPLETED', 'PAID', 'PAYMENT_VERIFIED', 'SUCCESS', 'LEDGER_POSTED'];
const terminalFailure = ['FAILED', 'CANCELLED', 'REVERSED'];

function stateTone(status, colors) {
  const value = String(status || 'PENDING').toUpperCase();
  if (terminalSuccess.includes(value)) return colors.green;
  if (terminalFailure.includes(value)) return colors.red;
  return colors.gold;
}

export default function UltraActivity({ deposits = [], withdrawals = [], activity = [], balance, pendingBalance, reservedBalance, withdrawalPendingBalance, go, colors }) {
  const [filter, setFilter] = useState('Deposits');
  const [selectedDeposit, setSelectedDeposit] = useState(null);
  const [depositDetail, setDepositDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const rows = useMemo(() => [
    ...deposits.map((deposit) => ({ kind: 'Deposit', title: 'UPI deposit', reference: deposit.merchantReference || deposit.id, status: deposit.status, amount: money(deposit.amountPaise), createdAt: deposit.createdAt, depositId: deposit.id, deposit })),
    ...withdrawals.map((withdrawal) => ({ kind: 'Withdrawal', title: 'Withdrawal request', reference: withdrawal.referenceId || withdrawal.id, status: withdrawal.status, amount: `−${money(withdrawal.amountPaise)}`, createdAt: withdrawal.createdAt })),
    ...activity.map((entry) => {
      const description = `${entry.label || ''} ${entry.displayDescription || ''} ${entry.description || ''} ${entry.type || ''} ${entry.detail || ''}`;
      const kind = /withdraw|payout|debit/i.test(description) ? 'Withdrawal' : /deposit/i.test(description) ? 'Deposit' : 'Payment';
      const reference = entry.reference || String(entry.detail || '').split(' · ')[0] || 'No reference';
      const deposit = kind === 'Deposit' ? deposits.find((item) => item.id === reference || item.merchantReference === reference) : null;
      const referenceIsDepositId = typeof reference === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference);
      return { kind, title: entry.displayDescription || entry.label || entry.description || 'Wallet activity', reference, status: entry.status || 'LEDGER_POSTED', amount: entry.amount || money(entry.amountPaise), createdAt: entry.createdAt, depositId: deposit?.id || (kind === 'Deposit' && referenceIsDepositId ? reference : undefined), deposit, ledgerEntry: entry };
    }),
  ].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()), [deposits, withdrawals, activity]);
  const visible = rows.filter((row) => {
    const status = String(row.status || '').toUpperCase();
    if (filter === 'Deposits' || filter === 'Withdrawals') return row.kind === filter.slice(0, -1);
    if (filter === 'Successful') return terminalSuccess.includes(status);
    if (filter === 'Pending') return !terminalSuccess.includes(status) && !terminalFailure.includes(status);
    if (filter === 'Failed') return terminalFailure.includes(status);
    return false;
  });
  const filters = ['Deposits', 'Withdrawals', 'Successful', 'Pending', 'Failed'];

  const openDeposit = async (row) => {
    setSelectedDeposit(row);
    setDepositDetail(row.deposit || row.ledgerEntry || row);
    setDetailError('');
    if (!row.depositId) return;
    setDetailLoading(true);
    try {
      const result = await apiGet(`/api/v1/deposits/${encodeURIComponent(row.depositId)}`);
      setDepositDetail({ ...(row.deposit || {}), ...(result.deposit || {}) });
    } catch (error) {
      setDetailError(error.message || 'Latest details could not be loaded. Showing the last available activity data.');
    } finally { setDetailLoading(false); }
  };
  const closeDeposit = () => { setSelectedDeposit(null); setDepositDetail(null); setDetailError(''); };
  const detailValue = depositDetail || selectedDeposit?.deposit || selectedDeposit?.ledgerEntry || {};
  const detailStatus = String(detailValue.status || selectedDeposit?.status || 'PENDING').toUpperCase();

  return <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
    <View style={styles.heading}><Text style={[styles.title, { color: colors.ink }]}>Activity</Text><Text style={[styles.subtitle, { color: colors.muted }]}>Wallet balance and transaction history</Text></View>
    <View style={[styles.balanceCard, { backgroundColor: colors.card, borderColor: colors.line }]}>
      <Text style={[styles.label, { color: colors.muted }]}>AVAILABLE BALANCE</Text><Text style={[styles.balance, { color: colors.ink }]}>{money(balance)}</Text>
      <View style={styles.balanceRow}><Text style={[styles.balanceSmall, { color: colors.muted }]}>Pending {money(pendingBalance)}</Text><Text style={[styles.balanceSmall, { color: colors.muted }]}>Reserved {money(reservedBalance)}</Text></View>
      <Text style={[styles.balanceSmall, { color: colors.muted, marginTop: 4 }]}>Withdrawals pending {money(withdrawalPendingBalance)}</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      {filters.map((name) => <TouchableOpacity key={name} onPress={() => setFilter(name)} style={[styles.filter, { backgroundColor: filter === name ? colors.blue : colors.card, borderColor: filter === name ? colors.blue : colors.line }]}><Text style={{ color: filter === name ? '#FFFFFF' : colors.textSecondary, fontSize: 11, fontWeight: '800' }}>{name}</Text></TouchableOpacity>)}
    </ScrollView>
    {visible.length ? visible.map((row, index) => {
      const content = <>
        <View style={[styles.icon, { backgroundColor: colors.softSurface }]}><Text style={{ color: colors.cyan, fontSize: 18, fontWeight: '900' }}>{row.kind === 'Withdrawal' ? '↑' : row.kind === 'Deposit' ? '↓' : '↔'}</Text></View>
        <View style={{ flex: 1, marginLeft: 11 }}><Text style={[styles.rowTitle, { color: colors.ink }]} numberOfLines={1}>{row.title}</Text><Text style={[styles.rowReference, { color: colors.muted }]} numberOfLines={1}>{row.reference}</Text><Text style={{ color: stateTone(row.status, colors), fontSize: 10, fontWeight: '900', marginTop: 5 }}>{String(row.status || 'PENDING').replaceAll('_', ' ')}</Text></View>
        <View style={{ alignItems: 'flex-end' }}><Text style={[styles.amount, { color: colors.ink }]}>{row.amount}</Text><Text style={[styles.date, { color: colors.muted }]}>{row.createdAt ? new Date(row.createdAt).toLocaleDateString('en-IN') : '—'}</Text>{row.kind === 'Deposit' && <Text style={[styles.openHint, { color: colors.blue }]}>Details ›</Text>}</View>
      </>;
      return row.kind === 'Deposit'
        ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`View deposit details for ${row.reference}`} activeOpacity={0.75} onPress={() => void openDeposit(row)} key={`${row.kind}-${row.reference}-${index}`} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.line }]}>{content}</TouchableOpacity>
        : <View key={`${row.kind}-${row.reference}-${index}`} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.line }]}>{content}</View>;
    }) : <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.line }]}><Text style={{ color: colors.ink, fontWeight: '900', fontSize: 15 }}>Nothing to show</Text><Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>No entries match this filter.</Text></View>}
    <View style={[styles.notice, { backgroundColor: colors.warningSurface }]}><Text style={{ color: colors.warningText, fontWeight: '800', fontSize: 12 }}>Payment verification</Text><Text style={{ color: colors.warningText, fontSize: 11, lineHeight: 17, marginTop: 5 }}>A submitted UPI payment remains pending until trusted merchant reconciliation confirms receipt. The app does not treat a client success screen as proof.</Text><TouchableOpacity onPress={() => go('Deposit History')} style={{ marginTop: 10 }}><Text style={{ color: colors.blue, fontWeight: '900', fontSize: 12 }}>Open deposit details ›</Text></TouchableOpacity></View>
    <Modal visible={Boolean(selectedDeposit)} transparent animationType="slide" onRequestClose={closeDeposit}>
      <View style={styles.modalBackdrop}><View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.line }]}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}><View><Text style={[styles.modalTitle, { color: colors.ink }]}>Deposit details</Text><Text style={[styles.modalSubtitle, { color: colors.muted }]}>Status and payment reference information</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close deposit details" onPress={closeDeposit} style={[styles.closeButton, { backgroundColor: colors.softSurface }]}><Text style={{ color: colors.ink, fontSize: 20, fontWeight: '700' }}>×</Text></TouchableOpacity></View>
        {detailLoading && <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={{ color: colors.muted, fontSize: 11, marginLeft: 9 }}>Refreshing details…</Text></View>}
        {!!detailError && <Text style={[styles.detailError, { color: colors.gold }]}>{detailError}</Text>}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
          <View style={[styles.detailHero, { backgroundColor: colors.softSurface }]}><Text style={[styles.detailAmount, { color: colors.ink }]}>{money(detailValue.amountPaise ?? selectedDeposit?.amountPaise)}</Text><Text style={[styles.statusPill, { color: stateTone(detailStatus, colors), backgroundColor: colors.card }]}>{detailStatus.replaceAll('_', ' ')}</Text></View>
          <DetailRow label="Deposit reference" value={detailValue.merchantReference || selectedDeposit?.reference || detailValue.reference || '—'} colors={colors} />
          <DetailRow label="Payment method" value={detailValue.method || 'UPI'} colors={colors} />
          <DetailRow label="Currency" value={detailValue.currency || 'INR'} colors={colors} />
          <DetailRow label="Created" value={detailValue.createdAt ? new Date(detailValue.createdAt).toLocaleString('en-IN') : '—'} colors={colors} />
          <DetailRow label="Last updated" value={detailValue.updatedAt ? new Date(detailValue.updatedAt).toLocaleString('en-IN') : '—'} colors={colors} />
          {detailValue.expiresAt && <DetailRow label="Payment deadline" value={new Date(detailValue.expiresAt).toLocaleString('en-IN')} colors={colors} />}
          {(detailValue.providerReference || detailValue.paymentReference) && <DetailRow label="Provider reference" value={detailValue.providerReference || detailValue.paymentReference} colors={colors} />}
          {detailValue.manualPaymentClaim?.status && <DetailRow label="Manual review" value={String(detailValue.manualPaymentClaim.status).replaceAll('_', ' ')} colors={colors} />}
          {detailValue.failureReason && <DetailRow label="Status note" value={detailValue.failureReason} colors={colors} />}
          <View style={[styles.detailNotice, { backgroundColor: colors.warningSurface }]}><Text style={{ color: colors.warningText, fontSize: 11, lineHeight: 17 }}>Deposit status comes from PaisaPay. A submitted UPI payment is not confirmed until trusted reconciliation verifies receipt.</Text></View>
        </ScrollView>
        <TouchableOpacity onPress={closeDeposit} style={[styles.doneButton, { backgroundColor: colors.blue }]}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '900' }}>Done</Text></TouchableOpacity>
      </View></View>
    </Modal>
  </ScrollView>;
}

function DetailRow({ label, value, colors }) {
  return <View style={[styles.detailRow, { borderBottomColor: colors.line }]}><Text style={[styles.detailLabel, { color: colors.muted }]}>{label}</Text><Text selectable style={[styles.detailValue, { color: colors.ink }]}>{String(value ?? '—')}</Text></View>;
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 28 }, heading: { marginBottom: 16 }, title: { fontSize: 26, fontWeight: '900', letterSpacing: -0.4 }, subtitle: { fontSize: 12, marginTop: 5 },
  balanceCard: { borderWidth: 1, borderRadius: 21, padding: 17, marginBottom: 15 }, label: { fontSize: 10, fontWeight: '900', letterSpacing: 1 }, balance: { fontSize: 28, fontWeight: '900', marginTop: 7 }, balanceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 11 }, balanceSmall: { fontSize: 11, fontWeight: '700' },
  filters: { gap: 7, paddingBottom: 13 }, filter: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 9 }, row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 18, padding: 13, marginBottom: 9 }, icon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, rowTitle: { fontSize: 12, fontWeight: '900' }, rowReference: { fontSize: 10, marginTop: 4 }, amount: { fontSize: 12, fontWeight: '900' }, date: { fontSize: 9, marginTop: 6 }, openHint: { fontSize: 9, fontWeight: '900', marginTop: 5 },
  empty: { minHeight: 130, borderWidth: 1, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }, notice: { borderRadius: 17, padding: 14, marginTop: 6 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(3, 10, 25, 0.55)', justifyContent: 'flex-end' }, modalSheet: { maxHeight: '84%', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18 }, modalHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 4, backgroundColor: '#94A3B8', opacity: 0.6, marginBottom: 15 }, modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }, modalTitle: { fontSize: 20, fontWeight: '900' }, modalSubtitle: { fontSize: 11, marginTop: 3 }, closeButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, loading: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }, detailError: { fontSize: 11, lineHeight: 16, paddingBottom: 8 }, detailHero: { borderRadius: 18, padding: 16, alignItems: 'center', marginBottom: 10 }, detailAmount: { fontSize: 27, fontWeight: '900' }, statusPill: { fontSize: 10, fontWeight: '900', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20, overflow: 'hidden', marginTop: 8 }, detailRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth }, detailLabel: { fontSize: 10, fontWeight: '700' }, detailValue: { fontSize: 12, fontWeight: '800', marginTop: 4 }, detailNotice: { borderRadius: 13, padding: 12, marginTop: 14 }, doneButton: { minHeight: 46, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 11 },
});
