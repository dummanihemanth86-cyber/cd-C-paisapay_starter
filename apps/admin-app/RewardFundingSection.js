import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

const { newIdempotencyKey } = require('../../shared/walletAdjustmentUi.cjs');
const { parseRupeesToPaise } = require('./rewardFundingUi.cjs');

function money(paise) {
  return `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function confirmDecision(title, message, confirmLabel) {
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: confirmLabel, onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

function Action({ title, onPress, disabled, secondary }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{title}</Text></Pressable>;
}

export default function RewardFundingSection({ request, token }) {
  const [dashboard, setDashboard] = useState(null); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [amount, setAmount] = useState(''); const [reason, setReason] = useState('Admin reward-reserve funding');
  const [paymentReference, setPaymentReference] = useState(''); const [verifiedAmount, setVerifiedAmount] = useState(''); const [verifiedVpa, setVerifiedVpa] = useState(''); const [receiverConfirmed, setReceiverConfirmed] = useState(false); const [decisionReason, setDecisionReason] = useState('Verified cleared receipt in receiver-side UPI history');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setDashboard(await request('/api/v1/admin/reward-fund/dashboard', { token })); }
    catch (e) { setError(e.status === 404 ? 'This server has not deployed the Reward Funding API and migration yet.' : (e.message || 'Could not load reward-funding status.')); }
    finally { setLoading(false); }
  }, [request, token]);
  useEffect(() => { void refresh(); }, [refresh]);

  const createFundingRequest = async () => {
    const amountPaise = parseRupeesToPaise(amount);
    if (amountPaise === null || amountPaise < 100 || amountPaise > 100_000_000_000) { setError('Enter a valid funding amount with no more than two decimal places, at least ₹1.'); return; }
    if (reason.trim().length < 8) { setError('Enter an audit reason of at least 8 characters.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request('/api/v1/admin/reward-fund/funding-requests', { token, method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() }, body: { amountPaise, reason: reason.trim() } });
      const intent = result.paymentIntent;
      if (intent?.recipientVpa) {
        const uri = `upi://pay?pa=${encodeURIComponent(intent.recipientVpa)}&pn=PaisaPay%20Reward%20Fund&am=${(Number(intent.amountPaise) / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(intent.transactionNote || 'PaisaPay reward fund')}`;
        try { await Linking.openURL(uri); setMessage('UPI app opened. Check recipient and amount. This request does not add reserve funds; verify the cleared receipt in receiver-side transaction history.'); }
        catch { setMessage('Funding request saved; no reserve funds were added. Open a UPI app and pay only to the configured recipient shown below.'); }
      }
      setAmount(''); await refresh();
    } catch (e) { setError(e.message || 'Could not create the funding request.'); }
    finally { setBusy(false); }
  };

  const submitReference = async (item) => {
    if (paymentReference.trim().length < 6) { setError('Enter the exact transaction reference from the receiver-side history.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request(`/api/v1/admin/reward-fund/funding-requests/${encodeURIComponent(item.id)}/submit`, { token, method: 'POST', body: { paymentReference: paymentReference.trim(), statementDate: new Date().toISOString().slice(0, 10) } });
      setMessage(result.message || 'Reference submitted as a claim; no reserve funds added.'); setPaymentReference(''); setVerifiedAmount(String(Number(item.amountPaise) / 100)); setVerifiedVpa(item.recipientVpa); setReceiverConfirmed(false); await refresh();
    } catch (e) { setError(e.message || 'Could not submit the transaction reference.'); }
    finally { setBusy(false); }
  };

  const decide = async (item, decision) => {
    const amountPaise = parseRupeesToPaise(verifiedAmount);
    if (decision === 'VERIFY') {
      if (!Number.isSafeInteger(amountPaise) || amountPaise !== Number(item.amountPaise)) { setError('The received amount must exactly match the request.'); return; }
      if (verifiedVpa.trim().toLowerCase() !== String(item.recipientVpa).toLowerCase()) { setError('The receiver-side UPI ID must match the configured recipient.'); return; }
      if (!receiverConfirmed) { setError('Confirm the cleared receipt in receiver-side transaction history before posting funding.'); return; }
      if (paymentReference.trim().length < 6) { setError('Re-enter the exact submitted UPI reference for verification.'); return; }
    }
    if (decisionReason.trim().length < 8) { setError('Enter an audit reason of at least 8 characters.'); return; }
    const confirmed = await confirmDecision(decision === 'VERIFY' ? 'Verify received funding?' : 'Reject funding request?', decision === 'VERIFY' ? `This records ${money(item.amountPaise)} in the reward reserve. Continue only after matching the cleared receiver-side credit and exact reference.` : 'Reject this request? No reserve or customer balance will change.', decision === 'VERIFY' ? 'Verify cleared receipt' : 'Reject request');
    if (!confirmed) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const body = decision === 'VERIFY'
        ? { decision, reason: decisionReason.trim(), paymentReference: paymentReference.trim(), receivedAmountPaise: amountPaise, receivedVpa: verifiedVpa.trim(), receiverConfirmed: true }
        : { decision, reason: decisionReason.trim() };
      const result = await request(`/api/v1/admin/reward-fund/funding-requests/${encodeURIComponent(item.id)}/decision`, { token, method: 'POST', body });
      setMessage(result.message || (decision === 'VERIFY' ? 'Verified receipt was posted to the reserve.' : 'Request rejected; no funding was posted.'));
      setPaymentReference(''); setReceiverConfirmed(false); await refresh();
    } catch (e) { setError(e.message || 'Could not save the funding decision.'); }
    finally { setBusy(false); }
  };

  const readiness = dashboard?.readiness;
  return <View>
    <View style={styles.card}><Text style={styles.eyebrow}>SUPER ADMIN · MAKER-CHECKER</Text><Text style={styles.title}>Reward Funding</Text><Text style={styles.note}>A funding request creator cannot approve or reject that request. A different active SUPER_ADMIN must review it. UTRs and screenshots are claims only; the server does not independently verify bank receipt. Manual receiver-side review must follow your documented reconciliation process.</Text><Action title={loading ? 'Refreshing…' : 'Refresh balance and history'} secondary onPress={refresh} disabled={loading}/></View>
    {readiness ? <View style={styles.grid}>{[['Available reserve', readiness.balancePaise], ['Total verified funding', readiness.totalFundedPaise], ['Rewards credited', readiness.totalRewardsCreditedPaise], ['Rewards pending funding', readiness.pendingRewardsPaise]].map(([label, value]) => <View key={label} style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{money(value)}</Text></View>)}<View style={styles.metric}><Text style={styles.metricLabel}>Rewarded orders</Text><Text style={styles.metricValue}>{String(readiness.rewardedOrders ?? 0)}</Text></View><View style={styles.metric}><Text style={styles.metricLabel}>Configured reward rate</Text><Text style={styles.metricValue}>{(Number(readiness.rewardRateBps || 0) / 100).toFixed(2)}%</Text></View></View> : null}
    {readiness ? <View style={styles.notice}><Text style={styles.noticeTitle}>Funding intake · {readiness.fundingIntake?.status || (readiness.fundingCanStart ? 'READY' : 'BLOCKED')}</Text><Text style={styles.noticeText}>{(readiness.fundingIntake?.blockers || []).join(' ') || 'Funding request creation is available when authorized.'}</Text><Text style={[styles.noticeTitle, { marginTop: 10 }]}>Reserve integrity · {readiness.reserveIntegrity?.status || (readiness.ledgerReconciled ? 'RECONCILED' : 'BLOCKED')}</Text><Text style={styles.noticeText}>{(readiness.reserveIntegrity?.blockers || []).join(' ') || 'Funding and reward allocation journals reconcile.'}</Text><Text style={[styles.noticeTitle, { marginTop: 10 }]}>Reward posting · {readiness.rewardPosting?.status || (readiness.activationReady ? 'READY' : 'BLOCKED')}</Text><Text style={styles.noticeText}>{(readiness.rewardPosting?.blockers || readiness.blockers || []).join(' ') || 'Reward posting is ready.'}</Text></View> : null}
    {readiness?.receiverVpa ? <View style={styles.card}><Text style={styles.label}>Configured UPI recipient</Text><Text style={styles.title}>{readiness.receiverVpa}</Text><Text style={styles.note}>Verify this exact recipient in receiver-side payment history.</Text></View> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}{message ? <Text style={styles.success}>{message}</Text> : null}
    <View style={styles.card}><Text style={styles.title}>Add reward funding</Text><Text style={styles.label}>Amount (₹)</Text><TextInput style={styles.input} value={amount} onChangeText={(value) => setAmount(value.replace(/[^0-9.]/g, '').slice(0, 14))} keyboardType="decimal-pad" placeholder="1000.00" placeholderTextColor="#7B8495"/><Text style={styles.label}>Audit reason</Text><TextInput style={styles.input} value={reason} onChangeText={setReason} maxLength={500} placeholder="Reason for funding" placeholderTextColor="#7B8495"/><Action title={busy ? 'Creating request…' : 'Create UPI funding request'} onPress={createFundingRequest} disabled={busy || !readiness?.fundingCanStart}/>{readiness && !readiness.fundingCanStart ? <Text style={styles.note}>Funding requests are disabled by server configuration or the recipient VPA is not configured.</Text> : null}</View>
    {(dashboard?.requests || []).map((item) => <View key={item.id} style={styles.card}><Text style={styles.eyebrow}>FUNDING REQUEST · {item.status}</Text><Text style={styles.title}>{money(item.amountPaise)}</Text><Text style={styles.note}>Maker · {item.maker?.displayName || item.maker?.publicId || '—'}{item.isMaker ? ' (you)' : ''} · Verifier · {item.verifiedBy?.displayName || item.verifiedBy?.publicId || 'pending'}</Text><Text style={styles.note}>Recipient · {item.recipientVpa}</Text><Text style={styles.note}>Request · {item.id}</Text><Text style={styles.note}>Created · {new Date(item.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}{item.paymentReferenceMasked ? ` · Reference ${item.paymentReferenceMasked}` : ''}</Text>
      {item.status === 'PENDING_PAYMENT' ? <><Text style={styles.label}>Transaction reference after payment</Text><TextInput style={styles.input} value={paymentReference} onChangeText={setPaymentReference} placeholder="Receiver-side transaction reference" placeholderTextColor="#7B8495" autoCapitalize="characters"/><Action title={busy ? 'Submitting…' : 'Submit reference for review'} onPress={() => submitReference(item)} disabled={busy || !readiness?.fundingWorkflowEnabled}/></> : null}
      {item.status === 'PENDING_VERIFICATION' ? <View style={styles.review}><Text style={styles.note}>Compare the claimed transaction with receiver-side account history. The submitted UTR/reference and screenshot are not independent verification by themselves.</Text>{item.isMaker ? <Text style={styles.noticeText}>You created this request. A different active SUPER_ADMIN must verify or reject it.</Text> : <><Text style={styles.label}>Exact transaction reference</Text><TextInput style={styles.input} value={paymentReference} onChangeText={setPaymentReference} placeholder="Re-enter submitted reference" placeholderTextColor="#7B8495" autoCapitalize="characters"/><Text style={styles.label}>Received amount (₹)</Text><TextInput style={styles.input} value={verifiedAmount} onChangeText={setVerifiedAmount} keyboardType="decimal-pad" placeholder="Exact received amount" placeholderTextColor="#7B8495"/><Text style={styles.label}>Received at this UPI ID</Text><TextInput style={styles.input} value={verifiedVpa} onChangeText={setVerifiedVpa} autoCapitalize="none" placeholder={item.recipientVpa} placeholderTextColor="#7B8495"/><Pressable style={styles.confirmRow} onPress={() => setReceiverConfirmed((value) => !value)}><Text style={[styles.checkbox, receiverConfirmed && styles.checked]}>{receiverConfirmed ? '✓' : ''}</Text><Text style={styles.note}>I manually checked the cleared exact amount and reference in receiver-side records</Text></Pressable><Text style={styles.label}>Audit reason</Text><TextInput style={styles.input} value={decisionReason} onChangeText={setDecisionReason} maxLength={500} placeholder="Reason for decision" placeholderTextColor="#7B8495"/><View style={styles.actions}><Action title={busy ? 'Saving…' : 'Verify and add funds'} onPress={() => decide(item, 'VERIFY')} disabled={busy || !receiverConfirmed}/><Action title="Reject request" secondary onPress={() => decide(item, 'REJECT')} disabled={busy}/></View></>}</View> : null}
    </View>)}
    <View style={styles.card}><Text style={styles.title}>Verified funding history</Text>{dashboard?.fundings?.length ? dashboard.fundings.map((item) => <View key={item.id} style={styles.row}><Text style={styles.label}>{money(item.amountPaise)} · VERIFIED</Text><Text style={styles.note}>{item.sourceAccountLabel} · {item.verifiedBy?.displayName || 'Super Admin'} · {new Date(item.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</Text><Text style={styles.note}>Reason · {item.reason}</Text></View>) : <Text style={styles.note}>No verified reserve funding is recorded.</Text>}</View>
    <View style={styles.card}><Text style={styles.title}>Reward reserve ledger</Text>{dashboard?.reserveLedger?.length ? dashboard.reserveLedger.map((item) => <View key={item.id} style={styles.row}><Text style={styles.label}>{item.direction === 'FUNDING' ? '+' : '−'}{money(item.amountPaise)} · {item.direction === 'FUNDING' ? 'Verified funding' : 'Reward allocation'}</Text><Text style={styles.note}>{item.eventType} · {item.referenceType} · {item.referenceId}</Text><Text style={styles.note}>{new Date(item.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</Text></View>) : <Text style={styles.note}>No reward reserve ledger entries are recorded.</Text>}</View>
    <View style={styles.card}><Text style={styles.title}>Recent P2P reward entries</Text>{dashboard?.rewards?.length ? dashboard.rewards.map((item) => <View key={item.id} style={styles.row}><Text style={styles.label}>{money(item.amountPaise)} · Reward {item.status} · Principal {item.principalStatus || 'UNKNOWN'}</Text><Text style={styles.note}>User · {item.user?.publicId || '—'} · Order · {item.referenceId} · {new Date(item.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</Text></View>) : <Text style={styles.note}>No P2P reward entries are recorded.</Text>}</View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E5EAF2' },
  eyebrow: { color: '#2563EB', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 6 }, title: { color: '#17243B', fontSize: 16, fontWeight: '900' }, note: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 6 }, label: { color: '#334155', fontSize: 12, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 12 }, metric: { flexGrow: 1, minWidth: '46%', backgroundColor: '#EFF6FF', borderRadius: 14, padding: 12 }, metricLabel: { color: '#64748B', fontSize: 10, fontWeight: '700' }, metricValue: { color: '#17243B', fontSize: 17, fontWeight: '900', marginTop: 7 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#D9E1EC', backgroundColor: '#FFFFFF', paddingHorizontal: 12, color: '#17243B', fontSize: 14 }, button: { minHeight: 46, flex: 1, borderRadius: 13, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 14 }, secondaryButton: { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }, buttonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12, textAlign: 'center' }, secondaryButtonText: { color: '#1D4ED8' }, disabled: { opacity: 0.5 },
  notice: { backgroundColor: '#FFF7E8', borderColor: '#F0D59A', borderWidth: 1, borderRadius: 13, padding: 14, marginBottom: 12 }, noticeTitle: { color: '#7A4B00', fontWeight: '900' }, noticeText: { color: '#765A26', fontSize: 12, lineHeight: 18, marginTop: 6 }, error: { color: '#B42318', backgroundColor: '#FEF2F2', padding: 12, borderRadius: 12, marginBottom: 10, fontSize: 12 }, success: { color: '#047857', backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, padding: 12, borderRadius: 12, marginBottom: 10, fontSize: 12 },
  review: { marginTop: 12, padding: 12, backgroundColor: '#F7F9FC', borderRadius: 13 }, confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 10 }, checkbox: { width: 24, height: 24, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 6, textAlign: 'center', textAlignVertical: 'center', color: '#64748B' }, checked: { color: '#FFFFFF', backgroundColor: '#159B72', overflow: 'hidden' }, actions: { flexDirection: 'row', gap: 8 }, row: { borderTopWidth: 1, borderTopColor: '#E5EAF2', marginTop: 10, paddingTop: 10 },
});
