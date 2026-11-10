import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiGet } from './api';

const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const CLOSED_OFFER_STATUSES = ['SETTLED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'];

function remainingPendingPaise(offer) {
  const completed = (offer.orders || []).filter((order) => order.status === 'COMPLETED').reduce((sum, order) => sum + Number(order.amountPaise || 0), 0);
  return Math.max(0, Number(offer.amountPaise || 0) - completed);
}

function offerProgress(offer) {
  const orders = offer.orders || [];
  const completedPaise = orders.filter((order) => order.status === 'COMPLETED').reduce((sum, order) => sum + Number(order.amountPaise || 0), 0);
  const activeStatuses = ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING'];
  const heldStatuses = ['PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'DISPUTED'];
  const reservedPaise = orders.filter((order) => activeStatuses.includes(order.status)).reduce((sum, order) => sum + Number(order.amountPaise || 0), 0);
  const heldPaise = orders.filter((order) => heldStatuses.includes(order.status)).reduce((sum, order) => sum + Number(order.amountPaise || 0), 0);
  const availablePaise = Math.max(0, Number(offer.availableAmountPaise ?? (Number(offer.amountPaise || 0) - completedPaise - reservedPaise - heldPaise)));
  const buyerOrders = orders.filter((order) => [...activeStatuses, ...heldStatuses, 'COMPLETED'].includes(order.status));
  return { completedPaise, reservedPaise, heldPaise, availablePaise, buyerOrders, progress: Number(offer.amountPaise) > 0 ? Math.min(1, completedPaise / Number(offer.amountPaise)) : 0 };
}

function offerStatusLabel(offer) {
  const orders = offer.orders || [];
  if (orders.some((order) => ['PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'DISPUTED'].includes(order.status))) return 'PAYMENT REVIEW · FUNDS HELD';
  if (orders.some((order) => ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING'].includes(order.status))) return 'MATCHED · PAYMENT PENDING';
  if (['PENDING_MATCH', 'OPEN'].includes(offer.status)) return 'PENDING · WAITING FOR MATCH';
  if (offer.status === 'PARTIALLY_MATCHED') return 'PARTIALLY MATCHED';
  return offer.status.replace(/_/g, ' ');
}

export default function WithdrawalScreen({ amount, setAmount, create, cancelOffer, balance, bankAccounts = [], upiProfile, go, colors, working, note, financialOperationsEnabled, financialOperationsReason }) {
  const [offers, setOffers] = useState([]);
  const [expandedOfferIds, setExpandedOfferIds] = useState([]);
  const [activeTab, setActiveTab] = useState('withdraw');
  const upiId = upiProfile?.upiId;
  const upiName = upiProfile?.displayName;
  const hasUpiDetails = Boolean(upiId && upiName);
  const financialActionsDisabled = financialOperationsEnabled !== true;
  const amountPaise = Number(amount) * 100;
  const amountValid = Number.isSafeInteger(amountPaise) && amountPaise >= 10000 && amountPaise <= Number(balance || 0) && (amountPaise / 100) % 100 === 0;
  const load = useCallback(async () => {
    if (financialActionsDisabled) return;
    try { const result = await apiGet('/api/v1/withdrawals'); setOffers(result.offers || []); }
    catch (e) { note?.('Could not load withdrawals', e.message); }
  }, [financialActionsDisabled]);
  const hasLiveBuyerMatches = offers.some((offer) => ['PENDING_MATCH', 'OPEN', 'PARTIALLY_MATCHED', 'MATCHED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'DISPUTED'].includes(offer.status));
  useEffect(() => {
    if (financialActionsDisabled) return undefined;
    void load();
    const timer = setInterval(() => { void load(); }, hasLiveBuyerMatches ? 2000 : 15000);
    return () => clearInterval(timer);
  }, [financialActionsDisabled, load, hasLiveBuyerMatches]);
  const activeCount = useMemo(() => offers.filter((offer) => ['OPEN', 'PENDING_MATCH', 'PARTIALLY_MATCHED', 'MATCHED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'DISPUTED'].includes(offer.status)).length, [offers]);
  const pendingOffers = useMemo(() => offers.filter((offer) => !CLOSED_OFFER_STATUSES.includes(offer.status) && remainingPendingPaise(offer) > 0), [offers]);
  const historyOffers = useMemo(() => offers.filter((offer) => CLOSED_OFFER_STATUSES.includes(offer.status) || (offer.orders || []).some((order) => order.status === 'COMPLETED')), [offers]);
  const totalPendingOfferPaise = useMemo(() => pendingOffers.reduce((sum, offer) => sum + remainingPendingPaise(offer), 0), [pendingOffers]);
  const toggleOfferDetails = (offerId) => setExpandedOfferIds((current) => current.includes(offerId) ? current.filter((id) => id !== offerId) : [...current, offerId]);
  const confirmCancelOffer = (offer) => {
    if (financialActionsDisabled) return note?.('Financial actions unavailable', 'The server has disabled withdrawal changes. No cancellation was submitted.');
    Alert.alert('Cancel withdrawal request?', 'This cancels the offer and returns its unmatched amount to your available balance. Any already matched buyer amount stays reserved until that order is safely completed or Finance resolves it.', [
    { text: 'Keep request', style: 'cancel' },
    { text: 'Cancel request', style: 'destructive', onPress: async () => { const cancelled = await cancelOffer?.(offer); if (cancelled) await load(); } },
    ]);
  };

  return <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <Text style={[styles.title, { color: colors.ink }]}>Withdraw</Text>
    <Text style={[styles.subtitle, { color: colors.muted }]}>Your request stays pending. The offer amount is reserved from your available balance until it settles or is cancelled.</Text>
    {financialActionsDisabled && <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: colors.warningSurface }]}><Text style={{ color: colors.warningText, fontWeight: '900', fontSize: 12 }}>Withdrawals unavailable</Text><Text style={{ color: colors.warningText, fontSize: 11, lineHeight: 16, marginTop: 4 }}>{financialOperationsReason || 'The server has disabled withdrawal offer reads and changes.'} This page will not treat the unavailable response as an empty account or submit changes.</Text></View>}
    <View style={[styles.balanceCard, { backgroundColor: colors.navy }]}><Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text><Text style={styles.balance}>{money(balance)}</Text><Text style={styles.balanceHint}>Server-reported · INR · {activeCount} active offers</Text></View>

    <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: colors.card, borderColor: colors.line }]}>
      {[
        { id: 'withdraw', label: 'Withdraw' },
        { id: 'pending', label: `Pending${pendingOffers.length ? ` · ${pendingOffers.length}` : ''}` },
        { id: 'history', label: `History${historyOffers.length ? ` · ${historyOffers.length}` : ''}` },
      ].map((tab) => <TouchableOpacity key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab.id }} onPress={() => setActiveTab(tab.id)} style={[styles.tab, activeTab === tab.id && { backgroundColor: colors.blue }]}><Text style={[styles.tabText, { color: activeTab === tab.id ? '#FFFFFF' : colors.muted }]}>{tab.label}</Text></TouchableOpacity>)}
    </View>

    {activeTab === 'pending' && <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
      <View style={styles.row}><View><Text style={[styles.cardTitle, { color: colors.ink }]}>Pending withdrawal requests</Text><Text style={[styles.caption, { color: colors.muted }]}>{money(totalPendingOfferPaise)} awaiting matching or settlement</Text></View><TouchableOpacity onPress={load}><Text style={{ color: colors.cyan, fontWeight: '900' }}>Refresh</Text></TouchableOpacity></View>
      {!pendingOffers.length && <Text style={[styles.caption, { color: colors.muted, marginTop: 10 }]}>No pending withdrawal requests.</Text>}
      {pendingOffers.map((offer) => { const progress = offerProgress(offer); return <View key={`pending-${offer.id}`} style={[styles.pendingOffer, { borderColor: colors.line, backgroundColor: colors.surface }]}>
        <View style={styles.row}><Text style={[styles.cardTitle, { color: colors.ink }]}>{money(offer.amountPaise)} original</Text><Text style={[styles.status, { color: colors.warningText }]}>{offer.status === 'PENDING_MATCH' || offer.status === 'OPEN' ? 'WAITING FOR MATCH' : offer.status.replace(/_/g, ' ')}</Text></View>
        <Text style={[styles.caption, { color: colors.muted }]}>{offer.referenceId}</Text>
        <Text style={[styles.caption, { color: colors.muted }]}>{new Date(offer.createdAt).toLocaleString()}</Text>
        <View style={styles.offerSummary}><View style={[styles.summaryCell, { backgroundColor: colors.card }]}><Text style={[styles.summaryLabel, { color: colors.muted }]}>Completed</Text><Text style={[styles.summaryValue, { color: colors.green }]}>{money(progress.completedPaise)}</Text></View><View style={[styles.summaryCell, { backgroundColor: colors.card }]}><Text style={[styles.summaryLabel, { color: colors.muted }]}>Active matches</Text><Text style={[styles.summaryValue, { color: colors.cyan }]}>{money(progress.reservedPaise)}</Text></View><View style={[styles.summaryCell, { backgroundColor: colors.card }]}><Text style={[styles.summaryLabel, { color: colors.muted }]}>Held / disputed</Text><Text style={[styles.summaryValue, { color: progress.heldPaise ? colors.warningText : colors.ink }]}>{money(progress.heldPaise)}</Text></View><View style={[styles.summaryCell, { backgroundColor: colors.card }]}><Text style={[styles.summaryLabel, { color: colors.muted }]}>Available to match</Text><Text style={[styles.summaryValue, { color: colors.ink }]}>{money(progress.availablePaise)}</Text></View></View>
        <View style={[styles.progressTrack, { backgroundColor: colors.line }]}><View style={[styles.progressFill, { width: `${Math.round(progress.progress * 100)}%`, backgroundColor: colors.green }]} /></View><Text style={[styles.caption, { color: colors.muted }]}>{money(progress.completedPaise)} successfully completed · {progress.buyerOrders.length} matched order{progress.buyerOrders.length === 1 ? '' : 's'}</Text>
        {progress.buyerOrders.length > 0 && <>
          <TouchableOpacity onPress={() => toggleOfferDetails(offer.id)} style={[styles.detailsToggle, { borderColor: colors.line }]}><Text style={{ color: colors.cyan, fontSize: 10, fontWeight: '900' }}>{expandedOfferIds.includes(offer.id) ? 'Hide' : 'View'} matched order details · {progress.buyerOrders.length}</Text></TouchableOpacity>
          {expandedOfferIds.includes(offer.id) && progress.buyerOrders.map((item) => <View key={`pending-order-${item.id}`} style={[styles.buyerOrder, { borderColor: colors.line, backgroundColor: colors.card }]}><View style={styles.row}><Text style={[styles.caption, { color: colors.muted }]}>{item.referenceId}</Text><Text style={[styles.status, { color: item.status === 'COMPLETED' ? colors.green : ['PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'DISPUTED'].includes(item.status) ? colors.warningText : colors.cyan }]}>{item.status === 'COMPLETED' ? 'SUCCESS' : item.status.replace(/_/g, ' ')}</Text></View><Text style={[styles.buyerOrderAmount, { color: colors.ink }]}>{money(item.amountPaise)} · Buyer {item.buyer?.publicId || '—'} {item.buyer?.phoneMasked || ''}</Text><Text style={[styles.caption, { color: colors.muted }]}>Matched {new Date(item.createdAt).toLocaleString()} · Expires {item.expiresAt ? new Date(item.expiresAt).toLocaleString() : '—'}</Text><Text style={[styles.caption, { color: colors.muted }]}>Handoff: {item.handoffStatus?.replace(/_/g, ' ') || 'NOT STARTED'} · Payment: {item.verificationStatus?.replace(/_/g, ' ') || 'NOT SUBMITTED'}</Text>{['PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'DISPUTED'].includes(item.status) && <Text style={[styles.caption, { color: colors.warningText }]}>Held for Finance review; payment may have been sent.</Text>}</View>)}
        </>}
      </View>; })}
    </View>}

    {activeTab === 'withdraw' && <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
      <Text style={[styles.cardTitle, { color: colors.ink }]}>Withdrawal offer</Text><Text style={[styles.caption, { color: colors.muted }]}>Only amounts divisible by ₹100 are allowed.</Text>
      <View style={[styles.amountBox, { backgroundColor: colors.bg, borderColor: colors.line }]}><Text style={[styles.rupee, { color: colors.cyan }]}>₹</Text><TextInput accessibilityLabel="Withdrawal amount in rupees" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="100" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.ink }]} /></View>
      {!!amount && !amountValid && <Text style={[styles.caption, { color: colors.red, marginTop: 7 }]}>Enter a multiple of ₹100 from ₹100 up to your available balance.</Text>}
      <View style={[styles.destination, { borderColor: colors.line, backgroundColor: colors.surface }]}><View style={styles.row}><Text style={[styles.cardTitle, { color: colors.ink }]}>Payment method</Text><Text style={[styles.method, { color: colors.cyan }]}>UPI</Text></View>
        <Text style={[styles.caption, { color: colors.muted }]}>Account name (provided by you)</Text>
        {upiName ? <Text style={[styles.upi, { color: colors.ink }]}>{upiName}</Text> : <Text style={[styles.caption, { color: colors.muted, marginTop: 6 }]}>No account name saved.</Text>}
        <Text style={[styles.caption, { color: colors.muted, marginTop: 8 }]}>UPI ID</Text>
        {upiId ? <Text selectable style={[styles.upi, { color: colors.ink }]}>{upiId}</Text> : <Text style={[styles.caption, { color: colors.muted, marginTop: 6 }]}>No UPI ID saved.</Text>}
        <Text style={[styles.verify, { color: hasUpiDetails ? colors.green : colors.warningText }]}>{!hasUpiDetails ? 'Add both details to continue' : 'UPI details saved · ready for P2P offers'}</Text>
        <TouchableOpacity onPress={() => go('UPI')} style={[styles.outline, { borderColor: colors.line }]}><Text style={{ color: colors.cyan, fontWeight: '900' }}>{upiId ? 'Manage UPI details' : 'Save UPI details'}</Text></TouchableOpacity>
      </View>
      {!hasUpiDetails && <View style={[styles.notice, { backgroundColor: colors.warningSurface }]}><Text style={{ color: colors.warningText, fontSize: 11, lineHeight: 16 }}>Save both an account name and UPI ID to create an offer.</Text></View>}
      {hasUpiDetails && <View style={[styles.notice, { backgroundColor: colors.infoSurface || colors.warningSurface }]}><Text style={{ color: colors.infoText || colors.warningText, fontSize: 11, lineHeight: 16 }}>Your saved name and UPI ID can be used for P2P offers. PaisaPay does not check these details with your bank; please confirm they are correct in your UPI app. P2P offers are not bank payouts.</Text></View>}
      <TouchableOpacity accessibilityRole="button" disabled={!amountValid || !hasUpiDetails || working || financialActionsDisabled} onPress={create} style={[styles.submit, { backgroundColor: amountValid && hasUpiDetails && !working && !financialActionsDisabled ? colors.blue : colors.line }]}><Text style={styles.submitText}>{financialActionsDisabled ? 'Temporarily unavailable' : working ? 'Creating offer…' : 'Create withdrawal offer'}</Text></TouchableOpacity>
      <Text style={[styles.caption, { color: colors.muted, marginTop: 9 }]}>Creating the offer reserves its full amount from your available wallet balance. Completed portions settle separately; unresolved payment amounts remain held. This is a P2P offer, not a bank payout.</Text>
    </View>}

    {activeTab === 'history' && <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}><View style={styles.row}><Text style={[styles.cardTitle, { color: colors.ink }]}>Withdrawal history</Text><TouchableOpacity onPress={load}><Text style={{ color: colors.cyan, fontWeight: '900' }}>Refresh</Text></TouchableOpacity></View>
      {!historyOffers.length && <Text style={[styles.caption, { color: colors.muted, marginTop: 10 }]}>No completed, cancelled or expired withdrawal requests yet.</Text>}
      {historyOffers.map((offer) => <View key={offer.id} style={[styles.history, { borderColor: colors.line, backgroundColor: colors.surface }]}><View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.ink }]}>{money(offer.amountPaise)}</Text><Text style={[styles.caption, { color: colors.muted }]}>{offer.referenceId}</Text><Text style={[styles.caption, { color: colors.muted }]}>{new Date(offer.createdAt).toLocaleString()}</Text>{Number(offer.matchedAmountPaise || 0) > 0 && <Text style={[styles.caption, { color: colors.muted }]}>Matched {money(offer.matchedAmountPaise)} · Remaining {money(offer.remainingAmountPaise)}</Text>}{(offer.orders || []).filter((item) => ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_EXPIRED_REVIEW', 'PAYMENT_PROCESSING', 'DISPUTED', 'COMPLETED'].includes(item.status)).length > 0 && <TouchableOpacity onPress={() => toggleOfferDetails(offer.id)} style={[styles.detailsToggle, { borderColor: colors.line }]}><Text style={{ color: colors.cyan, fontSize: 10, fontWeight: '900' }}>{expandedOfferIds.includes(offer.id) ? 'Hide' : 'View'} matched order details · {(offer.orders || []).filter((item) => ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_EXPIRED_REVIEW', 'PAYMENT_PROCESSING', 'DISPUTED', 'COMPLETED'].includes(item.status)).length}</Text></TouchableOpacity>}{expandedOfferIds.includes(offer.id) && (offer.orders || []).filter((item) => ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_EXPIRED_REVIEW', 'PAYMENT_PROCESSING', 'DISPUTED', 'COMPLETED'].includes(item.status)).map((item) => <View key={item.id} style={[styles.buyerOrder, { borderColor: colors.line, backgroundColor: colors.card }]}><View style={styles.row}><Text style={[styles.caption, { color: colors.muted }]}>{item.referenceId}</Text><Text style={[styles.status, { color: item.status === 'PAYMENT_EXPIRED_REVIEW' ? colors.warningText : item.status === 'COMPLETED' ? colors.green : colors.cyan }]}>{item.status === 'PAYMENT_EXPIRED_REVIEW' ? 'EXPIRED · PAYMENT REVIEW · AMOUNT HELD' : item.status === 'COMPLETED' ? 'SUCCESS' : item.status.replace(/_/g, ' ')}</Text></View><Text style={[styles.buyerOrderAmount, { color: colors.ink }]}>{money(item.amountPaise)}</Text><Text style={[styles.caption, { color: colors.muted }]}>{new Date(item.createdAt).toLocaleString()}</Text>{item.status === 'PAYMENT_EXPIRED_REVIEW' && <Text style={[styles.caption, { color: colors.warningText }]}>Held for Finance review; payment may have been sent.</Text>}</View>)}</View><Text style={[styles.status, { color: offerStatusLabel(offer).includes('REVIEW') ? colors.warningText : colors.cyan }]}>{offerStatusLabel(offer)}</Text></View>)}
    </View>}
    {activeTab === 'withdraw' && <TouchableOpacity onPress={() => go('Bank Accounts')} style={[styles.outline, { borderColor: colors.line }]}><Text style={{ color: colors.ink, fontWeight: '800' }}>Saved bank accounts ({bankAccounts.length})</Text></TouchableOpacity>}
    {activeTab === 'history' && <TouchableOpacity onPress={() => go('Bills')} style={styles.activity}><Text style={{ color: colors.cyan, fontWeight: '900' }}>View wallet activity ›</Text></TouchableOpacity>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 30 }, title: { fontSize: 26, fontWeight: '900', letterSpacing: -0.4 }, subtitle: { fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 15 }, balanceCard: { padding: 18, borderRadius: 22, marginBottom: 13 }, balanceLabel: { color: '#B9D5FF', fontSize: 10, letterSpacing: 1, fontWeight: '900' }, balance: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 7 }, balanceHint: { color: '#9DB7D7', fontSize: 10, marginTop: 4 }, tabs: { flexDirection: 'row', borderWidth: 1, borderRadius: 15, padding: 4, marginBottom: 12 }, tab: { flex: 1, minHeight: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }, tabText: { fontSize: 11, fontWeight: '900' }, card: { borderWidth: 1, borderRadius: 21, padding: 15, marginBottom: 12 }, cardTitle: { fontSize: 14, fontWeight: '900' }, caption: { fontSize: 10, lineHeight: 15, marginTop: 4 }, pendingOffer: { borderWidth: 1, borderRadius: 15, padding: 11, marginTop: 9 }, buyerOrder: { borderWidth: 1, borderRadius: 11, padding: 8, marginTop: 7 }, buyerOrderAmount: { fontSize: 15, fontWeight: '900', marginTop: 2 }, detailsToggle: { minHeight: 34, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, amountBox: { minHeight: 60, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 15, marginTop: 13, paddingHorizontal: 13 }, rupee: { fontSize: 23, fontWeight: '900', marginRight: 8 }, input: { flex: 1, fontSize: 22, fontWeight: '900', paddingVertical: 8 }, destination: { borderWidth: 1, borderRadius: 15, padding: 12, marginTop: 12 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, method: { fontSize: 10, fontWeight: '900' }, upi: { fontSize: 15, fontWeight: '900', marginTop: 6 }, verify: { fontSize: 9, fontWeight: '900', marginTop: 6 }, outline: { minHeight: 42, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingHorizontal: 12 }, notice: { padding: 11, borderRadius: 13, marginTop: 11 }, submit: { minHeight: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 12 }, submitText: { color: '#fff', fontWeight: '900', fontSize: 13 }, history: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderWidth: 1, borderRadius: 15, padding: 11, marginTop: 9 }, cancelOfferButton: { minHeight: 36, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 9 }, status: { fontSize: 9, fontWeight: '900' }, activity: { alignItems: 'center', paddingVertical: 14 },
});
