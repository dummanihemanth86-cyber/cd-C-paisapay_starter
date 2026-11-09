import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AdminUpdateBanner from './AdminUpdateBanner';
const { createAdminSessionStorage } = require('./adminSessionStorage.cjs');
import responseHelpers from './responseHelpers.cjs';
const { adminRecordDetailPath } = require('../../shared/adminRecordNavigation.cjs');
const { financialActionState } = require('../../shared/adminFinancialUx.cjs');
const { parseRupeesToPaise, walletAdjustmentUiState, newIdempotencyKey } = require('../../shared/walletAdjustmentUi.cjs');
const { adminPhoneInputDigits, normalizeAdminPhone } = require('./adminPasswordResetUi.cjs');
const { requestAdminPasswordResetOtp: requestAdminResetFlow, submitAdminPasswordReset: submitAdminResetFlow, adminPasswordResetActionState, adminPasswordResetErrorMessage } = require('./adminPasswordResetFlow.cjs');
const { canDecideWalletRequest, canRequestWalletCredit, canDirectWalletCredit } = require('./walletCreditCapabilities.cjs');


const API = (process.env.EXPO_PUBLIC_API_URL || 'https://paisapay-api-staging.onrender.com').trim().replace(/\/$/, '');
if (!__DEV__ && !API.startsWith('https://')) throw new Error('PaisaPay Admin production builds require an HTTPS API URL.');
if (!__DEV__) {
  try {
    const apiOrigin = new URL(API);
    if (apiOrigin.origin !== API) throw new Error('PaisaPay Admin production API URL must be an HTTPS origin without a path.');
  } catch (error) {
    throw new Error(error?.message || 'PaisaPay Admin production API URL is invalid.');
  }
}
const ACCESS_KEY = 'paisapay.admin.access';
const REFRESH_KEY = 'paisapay.admin.refresh';
const IS_EXPO_GO = isRunningInExpoGo();
// expo-notifications logs a warning as soon as its package is evaluated in Expo Go.
// Require it only in a native/development build, where remote push is supported.
const Notifications = IS_EXPO_GO || Platform.OS === 'web' ? null : require('expo-notifications');
if (Notifications) Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
const adminSessionStorage = createAdminSessionStorage({
  platform: Platform.OS,
  secureStore: SecureStore,
  getWebStorage: () => typeof window === 'undefined' ? null : window.sessionStorage,
});
const ADMIN_BUILD_CODE = Number(process.env.EXPO_PUBLIC_ADMIN_BUILD_CODE || Constants.expoConfig?.android?.versionCode || 0);
const IS_STAGING_BUILD = process.env.EXPO_PUBLIC_ADMIN_DEPLOYMENT_ENV === 'staging' || API === 'https://paisapay-api-staging.onrender.com';
const { asArray, asRecord, normalizeListPayload, normalizeP2pPayload, normalizeSupportTicket } = responseHelpers;
const { paginationState, formatPaise } = responseHelpers;
const { createAdminApiClient } = require('./sessionApiClient.cjs');
const NAV = [
  ['overview', 'Dashboard', '/api/v1/admin/overview'],
  ['users', 'Users', '/api/v1/admin/users'],
  ['deposits', 'Deposits', '/api/v1/admin/deposits'],
  ['withdrawals', 'Withdrawals', '/api/v1/admin/withdrawals'],
  ['p2p', 'Quick Deposit / P2P', '/api/v1/admin/p2p/overview'],
  ['alerts', 'Admin Alerts', '/api/v1/admin/push-events'],
  ['transactions', 'Transactions', '/api/v1/admin/transactions'],
  ['ledger', 'Wallet Ledger', '/api/v1/admin/wallets/ledger'],
  ['walletAdjustments', 'Wallet Adjustment', null],
  ['walletCredits', 'Super Admin Credits', null],
  ['walletCreditApprovals', 'Credit Approvals', null],
  ['walletCreditRejections', 'Credit Rejections', null],
  ['walletFunding', 'Funding Evidence', null],
  ['walletFundingApprovals', 'Funding Approvals', null],
  ['walletFundingRejections', 'Funding Rejections', null],
  ['walletReconciliation', 'Wallet Reconciliation', null],
  ['settings', 'Settings', '/api/v1/admin/settings'],
  ['providers', 'Payment Providers', '/api/v1/admin/providers'],
  ['commissions', 'Commissions', '/api/v1/admin/commissions'],
  ['referrals', 'Referral & Team', '/api/v1/admin/referrals'],
  ['rewardRules', 'Reward Rules', '/api/v1/admin/reward-rules'],
  ['notifications', 'Announcements', '/api/v1/admin/notifications'],
  ['reports', 'CSV Reports', '/api/v1/admin/transactions'],
  ['disputes', 'Disputes', '/api/v1/admin/disputes'],
  ['support', 'Support', '/api/v1/admin/support/tickets'],
  ['reconciliation', 'Reconciliation', '/api/v1/admin/reconciliation/claims'],
  ['admins', 'Admin Roles', '/api/v1/admin/admins'],
  ['audit', 'Audit Logs', '/api/v1/admin/audit-logs'],
  ['health', 'System Health', '/api/v1/admin/system-health'],
];
const COLORS = { bg: '#F7F9FC', navy: '#FFFFFF', panel: '#FFFFFF', panelRaised: '#EFF6FF', blue: '#2563EB', cyan: '#2563EB', text: '#17243B', muted: '#64748B', border: '#E5EAF2', danger: '#DC4242', green: '#159B72', gold: '#D99018' };

function Button({ title, onPress, disabled, secondary }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{title}</Text></Pressable>; }
function confirmAdminAction(title, message, buttons, options) {
  if (Platform.OS !== 'web') return Alert.alert(title, message, buttons, options);
  const accepted = typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`);
  const selected = accepted
    ? [...buttons].reverse().find((button) => button.style !== 'cancel')
    : buttons.find((button) => button.style === 'cancel');
  selected?.onPress?.();
}
function PaginationBar({ page, pageCount, total, hasPrevious, hasNext, busy, onPrevious, onNext }) {
  return <View style={styles.pagination}><Button title="Previous" secondary disabled={!hasPrevious || busy} onPress={onPrevious}/><Text style={styles.paginationLabel}>Page {page} of {pageCount} · {total} records</Text><Button title="Next" secondary disabled={!hasNext || busy} onPress={onNext}/></View>;
}
function FinancialActionNotice({ title, reason }) {
  return <View style={styles.financialNotice} accessibilityRole="summary"><Text style={styles.financialNoticeTitle}>{title}</Text><Text style={styles.financialNoticeText}>{reason}</Text></View>;
}
function WalletAdjustmentAdminSection({ request, access, profile, setInfo, setError }) {
  const [targetPublicId, setTargetPublicId] = useState('');
  const [rupees, setRupees] = useState('');
  const [direction, setDirection] = useState('CREDIT');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const confirmationOpen = useRef(false);
  const requestInFlight = useRef(false);
  const submissionKey = useRef('');
  const submissionFingerprint = useRef('');
  const gate = walletAdjustmentUiState(profile?.role, profile?.walletAdjustmentAllowed, profile?.walletAdjustmentsEnabled);
  const amountPaise = parseRupeesToPaise(rupees);
  const submit = async () => {
    if (!gate.enabled || requestInFlight.current) return;
    if (!/^[A-Za-z0-9_-]{1,10}$/.test(targetPublicId.trim()) || amountPaise === null || reason.trim().length < 8) {
      setError('Enter a valid public user ID, amount up to ₹10,000, and a reason of at least 8 characters.');
      return;
    }
    const fingerprint = JSON.stringify([targetPublicId.trim(), direction, amountPaise, reason.trim()]);
    if (submissionFingerprint.current !== fingerprint) { submissionFingerprint.current = fingerprint; submissionKey.current = newIdempotencyKey(); }
    requestInFlight.current = true; setSubmitting(true); setError('');
    try {
      const result = await request('/api/v1/admin/wallet-adjustments', {
        token: access, method: 'POST', headers: { 'Idempotency-Key': submissionKey.current },
        body: { targetPublicId: targetPublicId.trim(), direction, amountPaise, reason: reason.trim() },
      });
      setInfo(`${result.message} Ledger transaction ${result.adjustment?.id || 'recorded'}.`);
      submissionKey.current = ''; submissionFingerprint.current = '';
      setTargetPublicId(''); setRupees(''); setReason('');
    } catch (error) { setError(error.message); }
    finally { requestInFlight.current = false; setSubmitting(false); }
  };
  const confirm = () => confirmAdminAction('Confirm wallet adjustment', `${direction} ₹${(amountPaise / 100).toFixed(2)} for user ${targetPublicId.trim()}? The backend records an immutable, audited ledger transaction.`, [
    { text: 'Back', style: 'cancel', onPress: () => { confirmationOpen.current = false; } }, { text: 'Confirm', style: 'destructive', onPress: () => { confirmationOpen.current = false; void submit(); } },
  ]);
  return <View style={styles.card}>
    <Text style={styles.cardEyebrow}>PRIVATE · SINGLE CONFIGURED ADMIN</Text>
    <Text style={styles.cardTitle}>Wallet adjustment</Text>
    <FinancialActionNotice title={gate.enabled ? 'Wallet adjustment is enabled' : 'Wallet adjustment unavailable'} reason={gate.reason || 'Each change is balanced against the pre-funded adjustment ledger account and audited.'} />
    <Text style={styles.label}>Target public user ID</Text>
    <TextInput style={styles.input} value={targetPublicId} onChangeText={setTargetPublicId} maxLength={10} autoCapitalize="none" editable={gate.enabled && !submitting} placeholder="Public user ID" placeholderTextColor={COLORS.muted}/>
    <Text style={styles.label}>Adjustment direction</Text>
    <View style={styles.decisionRow}><Button title="Credit" secondary={direction !== 'CREDIT'} disabled={!gate.enabled || submitting} onPress={() => setDirection('CREDIT')}/><Button title="Debit" secondary={direction !== 'DEBIT'} disabled={!gate.enabled || submitting} onPress={() => setDirection('DEBIT')}/></View>
    <Text style={styles.label}>Amount (INR · max ₹10,000)</Text>
    <TextInput style={styles.input} value={rupees} onChangeText={setRupees} editable={gate.enabled && !submitting} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={COLORS.muted}/>
    <Text style={styles.label}>Mandatory transaction reason (8–500 characters)</Text>
    <TextInput style={[styles.input, styles.multiline]} value={reason} onChangeText={setReason} editable={gate.enabled && !submitting} multiline maxLength={500} placeholder="Explain the reason for this adjustment" placeholderTextColor={COLORS.muted}/>
    <Button title={submitting ? 'Recording…' : `Record ${direction.toLowerCase()}`} disabled={!gate.enabled || submitting || confirmationOpen.current || amountPaise === null} onPress={() => { if (confirmationOpen.current || requestInFlight.current) return; confirmationOpen.current = true; confirm(); }}/>
    <Text style={styles.cardNote}>No target-user OTP is requested. Credits require sufficient funds in the dedicated adjustment account; debits cannot spend reserved funds.</Text>
  </View>;
}
function SuperAdminWalletCreditsSection({ request, access, profile, setInfo, setError, loadSection }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [credits, setCredits] = useState([]);
  const [creditRequests, setCreditRequests] = useState([]);
  const [rupees, setRupees] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const submissionKey = useRef('');
  const submissionFingerprint = useRef('');
  const directCreditEnabled = canDirectWalletCredit(profile);
  const creditEnabled = directCreditEnabled || canRequestWalletCredit(profile);
  const amountPaise = parseRupeesToPaise(rupees);
  const search = async () => {
    if (profile?.role !== 'SUPER_ADMIN') return;
    if (query.trim().length < 3) { setSearchError('Enter at least 3 characters of a public ID, account ID, name, or phone number.'); return; }
    setBusy(true); setSearchError(''); setSelected(null); setCredits([]); setCreditRequests([]);
    try {
      const result = await request(`/api/v1/admin/users?page=1&pageSize=25&q=${encodeURIComponent(query.trim())}`, { token: access });
      setMatches(asArray(result.users));
      if (!result.users?.length) setSearchError('No users matched this search.');
    } catch (error) { setSearchError(error.message); }
    finally { setBusy(false); }
  };
  const select = async (user) => {
    setBusy(true); setSearchError('');
    try {
      const [detail, history] = await Promise.all([
        request(`/api/v1/admin/users/${encodeURIComponent(user.id)}`, { token: access }),
        request(`/api/v1/admin/users/${encodeURIComponent(user.id)}/wallet/credits?page=1&pageSize=100`, { token: access }),
      ]);
      setSelected(detail.user || user); setCredits(asArray(history.credits)); setCreditRequests(asArray(history.requests));
    } catch (error) { setSearchError(error.message); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!creditEnabled || !selected || busy) return;
    if (amountPaise === null || amountPaise < 10000 || amountPaise > 1000000 || reason.trim().length < 8) {
      setSearchError('Enter a credit from ₹100 to ₹10,000 and a reason of at least 8 characters.'); return;
    }
    const fingerprint = JSON.stringify([selected.id, amountPaise, reason.trim()]);
    if (submissionFingerprint.current !== fingerprint) { submissionFingerprint.current = fingerprint; submissionKey.current = newIdempotencyKey(); }
    setBusy(true); setSearchError('');
    try {
      const result = await request(directCreditEnabled ? '/api/v1/admin/wallet/credits/direct' : '/api/v1/admin/wallet/credits/requests', {
        token: access, method: 'POST', headers: { 'Idempotency-Key': submissionKey.current }, body: { targetUserId: selected.id, verifiedPublicId: selected.publicId, verifiedPhoneMasked: selected.phoneMasked, verifiedWalletBalancePaise: Number(selected.walletBalancePaise), amountPaise, reason: reason.trim() },
      });
      setInfo(directCreditEnabled
        ? `${result.message} New wallet balance ${formatPaise(result.balancePaise)}. Ledger transaction ${result.credit?.id || 'recorded'}.`
        : `${result.message} Request ${result.request?.id || 'submitted'}.`);
      submissionKey.current = ''; submissionFingerprint.current = ''; setRupees(''); setReason(''); await select(selected); await loadSection('walletCredits');
    } catch (error) { setSearchError(error.message); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!selected || busy) return;
    setBusy(true); setSearchError('');
    try {
      const latest = await request(`/api/v1/admin/users/${encodeURIComponent(selected.id)}`, { token: access });
      const verified = latest.user;
      if (!verified || verified.id !== selected.id || verified.publicId !== selected.publicId || verified.phoneMasked !== selected.phoneMasked || Number(verified.walletBalancePaise) !== Number(selected.walletBalancePaise)) {
        if (verified) setSelected(verified);
        setSearchError('User identity or balance changed since these details were loaded. Review the refreshed details and confirm again.');
        return;
      }
      setSelected(verified);
      confirmAdminAction(directCreditEnabled ? 'Confirm direct staging credit' : 'Confirm wallet credit request', `${directCreditEnabled ? 'Post' : 'Request'} ${formatPaise(amountPaise)} for ${verified.displayName || 'PaisaPay user'}?\nPublic ID: ${verified.publicId}\nAccount ID: ${verified.id}\nPhone: ${verified.phoneMasked}\nCurrent available balance: ${formatPaise(verified.walletBalancePaise)}\n${directCreditEnabled ? 'A real ledger credit will post immediately from the funded staging adjustment account.' : 'A different SUPER_ADMIN must approve. No balance changes until approval posts a ledger transaction.'}`, [
        { text: 'Cancel', style: 'cancel' }, { text: directCreditEnabled ? 'Credit wallet' : 'Submit request', onPress: () => { void submit(); } },
      ]);
    } catch (error) { setSearchError(error.message); }
    finally { setBusy(false); }
  };
  return <View>
    <View style={styles.card}><Text style={styles.cardEyebrow}>{directCreditEnabled ? 'SUPER ADMIN · STAGING DIRECT CREDIT' : 'SUPER ADMIN · MAKER'}</Text><Text style={styles.cardTitle}>{directCreditEnabled ? 'Direct wallet credit' : 'Request a wallet credit'}</Text><Text style={styles.cardNote}>Search by public ID, phone number, account UUID, or name. Confirm the returned account details and balance. {directCreditEnabled ? 'This staging-only action posts immediately from the verified funded adjustment account and records a ledger transaction and audit entry.' : 'A separate active SUPER_ADMIN must approve a request before it can post.'}</Text>{!creditEnabled ? <FinancialActionNotice title="Credit requests are disabled" reason={[!profile?.walletAdjustmentsEnabled && 'WALLET_ADJUSTMENTS_ENABLED is false', !profile?.adminWalletCreditsEnabled && 'ADMIN_WALLET_CREDITS_ENABLED is false', ...(profile?.walletCreditBlockers || []), ...(profile?.stagingDirectWalletCreditBlockers || [])].filter(Boolean).join('; ') || 'The deployed service requires explicit finance and security authorization before these controls can be enabled.'}/> : null}
      <Text style={styles.label}>User lookup</Text><TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="User ID, phone, or name" placeholderTextColor={COLORS.muted} autoCapitalize="none" onSubmitEditing={search}/><Button title={busy ? 'Searching…' : 'Search users'} onPress={search} disabled={busy}/>
      {matches.map(user => <Pressable key={user.id} style={styles.detailGroup} onPress={() => select(user)}><Text style={styles.detailSectionTitle}>{user.displayName || 'PaisaPay user'} · {user.publicId || user.id}</Text><Text style={styles.rowDetail}>{user.phoneMasked} · {user.status} · Balance {formatPaise(user.walletBalancePaise)}</Text></Pressable>)}
      {selected ? <><View style={styles.detailGroup}><Text style={styles.detailSectionTitle}>Verified account details</Text><DetailFields value={selected}/><Text style={styles.detailValue}>Current available balance · {formatPaise(selected.walletBalancePaise)}</Text><Text style={styles.detailValue}>Reserved balance · {formatPaise(selected.reservedBalancePaise)}</Text></View>
        <Text style={styles.label}>Credit amount (₹100–₹10,000)</Text><TextInput style={styles.input} value={rupees} onChangeText={setRupees} keyboardType="decimal-pad" placeholder="100.00" placeholderTextColor={COLORS.muted}/><Text style={styles.label}>Required reason (8–500 characters)</Text><TextInput style={[styles.input, styles.multiline]} value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="Explain why this credit is requested" placeholderTextColor={COLORS.muted}/><Button title={busy ? 'Submitting…' : `${directCreditEnabled ? 'Direct credit' : 'Request'} ${amountPaise == null ? '' : formatPaise(amountPaise)}`} onPress={confirm} disabled={!creditEnabled || busy || amountPaise === null || amountPaise < 10000 || amountPaise > 1000000 || reason.trim().length < 8}/>
        <Text style={styles.label}>Credit requests and decisions</Text>{creditRequests.length ? creditRequests.map(item => <View key={item.id} style={styles.row}><Text style={styles.rowTitle}>{formatPaise(item.amountPaise)} · {item.displayStatus === 'APPROVED' ? 'APPROVED · ledger posting missing' : item.displayStatus === 'COMPLETED' ? 'COMPLETED · approved and posted' : item.displayStatus === 'REJECTED' ? 'REJECTED' : 'PENDING APPROVAL'}</Text><Text style={styles.rowDetail}>{item.reason} · Requested {new Date(item.createdAt).toLocaleString()}</Text>{item.checkerUser ? <Text style={styles.rowDetail}>Checked by {item.checkerUser.displayName || item.checkerUser.publicId} · {item.decisionReason || 'No decision reason returned'}</Text> : !item.checkerUser && item.status === 'APPROVED' ? <Text style={styles.rowDetail}>Authorized direct staging credit · no checker approval</Text> : null}{item.ledgerTransactionId ? <Text style={styles.rowDetail}>Ledger transaction · {item.ledgerTransactionId}</Text> : null}</View>) : <Text style={styles.cardNote}>No Admin credit requests recorded for this user.</Text>}
        <Text style={styles.label}>Completed Admin credit ledger history</Text>{credits.length ? credits.map(item => <View key={item.id} style={styles.row}><Text style={styles.rowTitle}>{formatPaise(item.amountPaise)} · {new Date(item.createdAt).toLocaleString()}</Text><Text style={styles.rowDetail}>{item.reason} · {item.transactionReference}</Text></View>) : <Text style={styles.cardNote}>No Admin credits have been posted to this wallet.</Text>}
      </> : null}
      {searchError ? <Text style={styles.error}>{searchError}</Text> : null}
    </View>
  </View>;
}
function WalletCreditControlsSection({ section, request, access, profile, payload, setInfo, setError, loadSection }) {
  const [form, setForm] = useState({ amount: '', source: '', bankReference: '', evidenceReference: '', evidenceSha256: '', statementDate: new Date().toISOString().slice(0, 10), reason: '' });
  const [decisionReasons, setDecisionReasons] = useState({});
  const [busyId, setBusyId] = useState('');
  const fundingEnabled = profile?.role === 'SUPER_ADMIN' && profile?.walletFundingRequestsEnabled === true;
  const format = (paise) => formatPaise(Number(paise || 0));
  const decide = async (kind, row, decision) => {
    if (profile?.role !== 'SUPER_ADMIN') return;
    const decisionReason = (decisionReasons[row.id] || '').trim();
    if (decisionReason.length < 8) { setError('Enter an approval or rejection reason of at least 8 characters.'); return; }
    if (kind === 'funding' && decision === 'APPROVE') {
      confirmAdminAction('Verify actual funding', 'Confirm that you independently checked the original bank statement, cleared cash receipt, source account and exact amount. This posts an accounting journal.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'I verified the cleared funds', onPress: () => void sendDecision(kind, row, decision, decisionReason, true) },
      ]);
      return;
    }
    if (kind === 'credit' && decision === 'APPROVE') {
      confirmAdminAction('Approve wallet credit', `Approve ${format(row.amountPaise)} for ${row.targetUser?.publicId || row.targetUserId}? This posts only if the adjustment fund has enough ledger balance.`, [
        { text: 'Cancel', style: 'cancel' }, { text: 'Approve credit', onPress: () => void sendDecision(kind, row, decision, decisionReason, false) },
      ]);
      return;
    }
    confirmAdminAction('Reject request', 'Reject this pending request? Rejection creates an audit record and no ledger entries.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: () => void sendDecision(kind, row, decision, decisionReason, false) },
    ]);
  };
  const sendDecision = async (kind, row, decision, decisionReason, evidenceVerified) => {
    setBusyId(row.id); setError('');
    try {
      const root = kind === 'funding' ? 'funding' : 'credits';
      const result = await request(`/api/v1/admin/wallet/${root}/requests/${encodeURIComponent(row.id)}/decision`, { token: access, method: 'POST', body: { decision, reason: decisionReason, ...(kind === 'funding' ? { evidenceVerified } : {}) } });
      setInfo(result.message); await loadSection(section);
    } catch (error) { setError(error.message); }
    finally { setBusyId(''); }
  };
  const createFunding = async () => {
    const amountPaise = parseRupeesToPaise(form.amount);
    if (!fundingEnabled || amountPaise === null || amountPaise < 1 || form.source.trim().length < 3 || form.bankReference.trim().length < 6 || form.evidenceReference.trim().length < 3 || !/^[a-fA-F0-9]{64}$/.test(form.evidenceSha256) || form.reason.trim().length < 8) { setError('Enter amount, bank source label, unique bank reference, evidence reference and SHA-256, date, and a reason of at least 8 characters.'); return; }
    setBusyId('funding'); setError('');
    try {
      const result = await request('/api/v1/admin/wallet/funding/requests', { token: access, method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() }, body: { amountPaise, sourceAccountLabel: form.source.trim(), externalReference: form.bankReference.trim(), evidenceReference: form.evidenceReference.trim(), evidenceSha256: form.evidenceSha256.toLowerCase(), statementDate: form.statementDate, reason: form.reason.trim() } });
      setInfo(result.message); setForm({ ...form, amount: '', bankReference: '', evidenceReference: '', evidenceSha256: '', reason: '' }); await loadSection(section);
    } catch (error) { setError(error.message); }
    finally { setBusyId(''); }
  };
  const rows = Array.isArray(payload?.requests) ? payload.requests : [];
  const isCredit = section === 'walletCreditApprovals' || section === 'walletCreditRejections';
  const isFunding = section === 'walletFundingApprovals' || section === 'walletFundingRejections';
  if (section === 'walletFunding') return <View style={styles.card}><Text style={styles.cardEyebrow}>SUPER ADMIN · FUNDING MAKER</Text><Text style={styles.cardTitle}>Record real adjustment-fund receipt</Text><Text style={styles.cardNote}>Only submit a cleared receipt that exists in the organization’s bank statement. This does not create funds. A different SUPER_ADMIN must independently verify the original statement and approve.</Text>{!fundingEnabled ? <FinancialActionNotice title="Funding workflow disabled" reason="Server-side funding and credit feature gates are off. No funding request can be submitted."/> : null}
    {[['Amount received (₹)', 'amount'], ['Source bank account label (no account number)', 'source'], ['Bank statement transaction reference', 'bankReference'], ['Evidence record reference', 'evidenceReference'], ['Evidence file SHA-256', 'evidenceSha256'], ['Statement date (YYYY-MM-DD)', 'statementDate'], ['Accounting reason', 'reason']].map(([label, key]) => <View key={key}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input, key === 'reason' && styles.multiline]} value={form[key]} onChangeText={value => setForm(prev => ({ ...prev, [key]: value }))} editable={fundingEnabled && busyId !== 'funding'} multiline={key === 'reason'} maxLength={key === 'reason' ? 500 : 200} autoCapitalize="none" placeholder={key === 'evidenceSha256' ? '64-character SHA-256' : ''} placeholderTextColor={COLORS.muted}/></View>)}
    <Button title={busyId === 'funding' ? 'Submitting…' : 'Submit funding evidence'} onPress={createFunding} disabled={!fundingEnabled || busyId === 'funding'}/>{payload?.requests?.length ? <DetailFields value={payload.requests}/> : null}</View>;
  if (section === 'walletReconciliation') return <View style={styles.card}><Text style={styles.cardEyebrow}>READ ONLY · LEDGER</Text><Text style={styles.cardTitle}>Wallet funding reconciliation</Text><Text style={styles.cardNote}>Totals are computed from posted ledger entries. The bank statement must still be reconciled independently by finance.</Text>{payload ? <DetailFields value={payload}/> : <Text style={styles.cardNote}>Loading reconciliation…</Text>}</View>;
  if (!isCredit && !isFunding) return null;
  const action = section === 'walletCreditApprovals' || section === 'walletFundingApprovals' ? 'APPROVE' : 'REJECT';
  const kind = isFunding ? 'funding' : 'credit';
  const decisionEnabled = canDecideWalletRequest(profile, kind);
  const decisionBlockers = kind === 'credit' ? profile?.walletCreditBlockers : profile?.walletFundingBlockers;
  return <View style={styles.card}><Text style={styles.cardEyebrow}>SUPER ADMIN · INDEPENDENT CHECKER</Text><Text style={styles.cardTitle}>{action === 'APPROVE' ? `Pending ${kind} approvals` : `Pending ${kind} rejections`}</Text><Text style={styles.cardNote}>Only a different active SUPER_ADMIN can decide. {kind === 'funding' ? 'Approval requires independently verifying cleared bank funds.' : 'Approval creates balanced ledger entries only within the funded adjustment balance.'}</Text>{!decisionEnabled ? <FinancialActionNotice title={`${kind === 'credit' ? 'Credit' : 'Funding'} decisions are disabled`} reason={Array.isArray(decisionBlockers) && decisionBlockers.length ? decisionBlockers.join('; ') : 'The server readiness capability is disabled. No decision can be recorded.'}/> : null}{rows.length ? rows.map(row => <View key={row.id} style={styles.detailGroup}><Text style={styles.detailSectionTitle}>{kind === 'credit' ? `${format(row.amountPaise)} · ${row.targetUser?.publicId || row.targetUserId}` : `${format(row.amountPaise)} · ${row.sourceAccountLabel}`}</Text><DetailFields value={row}/><Text style={styles.label}>Decision reason (8–500 characters)</Text><TextInput style={styles.input} value={decisionReasons[row.id] || ''} onChangeText={value => setDecisionReasons(prev => ({ ...prev, [row.id]: value }))} maxLength={500} placeholder={action === 'APPROVE' ? 'Approval basis' : 'Reason for rejection'} placeholderTextColor={COLORS.muted}/><Button title={busyId === row.id ? 'Saving…' : action === 'APPROVE' ? `Approve ${kind}` : `Reject ${kind}`} secondary={action === 'REJECT'} disabled={busyId === row.id || !decisionEnabled} onPress={() => decide(kind, row, action)}/></View>) : <Text style={styles.cardNote}>No pending {kind} requests.</Text>}</View>;
}
function SecureEvidenceImage({ uri, accessToken, requestRaw, onZoom }) {
  const [sourceUri, setSourceUri] = useState('');
  const [failure, setFailure] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailure(''); setSourceUri('');
    const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image data could not be decoded.'));
      reader.onerror = () => reject(new Error('Image data could not be read.'));
      reader.readAsDataURL(blob);
    });
    requestRaw(uri, { token: accessToken, accept: 'image/jpeg, image/png' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Evidence request failed (${response.status}).`);
        const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!['image/jpeg', 'image/png'].includes(mime)) throw new Error('The server did not return a JPEG or PNG image.');
        const blob = await response.blob();
        if (!blob.size) throw new Error('The uploaded image is empty.');
        return readAsDataUrl(blob);
      })
      .then((dataUrl) => { if (active) setSourceUri(dataUrl); })
      .catch((error) => { if (active) setFailure(error.message || 'Could not load the uploaded image.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uri, accessToken, requestRaw, attempt]);
  if (loading) return <View style={styles.evidenceState}><ActivityIndicator color={COLORS.blue}/><Text style={styles.cardNote}>Loading secure payment image…</Text></View>;
  if (failure) return <View style={styles.evidenceFailure}><Text style={styles.evidenceFailureText}>{failure}</Text><Button title="Retry image" secondary onPress={() => setAttempt((value) => value + 1)}/></View>;
  return <Pressable accessibilityRole="button" accessibilityLabel="Zoom payment screenshot" onPress={() => onZoom(sourceUri)}><Image source={{ uri: sourceUri }} resizeMode="contain" style={styles.claimImage} onError={() => { setSourceUri(''); setFailure('The uploaded image could not be rendered on this device.'); }}/></Pressable>;
}
function AppBody() {
  const [phone, setPhone] = useState(''); const [password, setPassword] = useState(''); const [adminResetMode, setAdminResetMode] = useState(false); const [adminResetPhone, setAdminResetPhone] = useState(''); const [adminResetChallengeId, setAdminResetChallengeId] = useState(''); const [adminResetCode, setAdminResetCode] = useState(''); const [adminResetPassword, setAdminResetPassword] = useState(''); const [adminResetMessage, setAdminResetMessage] = useState(''); const [access, setAccess] = useState(''); const [profile, setProfile] = useState(null); const [section, setSection] = useState('overview'); const [payload, setPayload] = useState(null); const [payloadSection, setPayloadSection] = useState(null); const [query, setQuery] = useState(''); const [statusFilter, setStatusFilter] = useState(''); const [listPage, setListPage] = useState(1); const [listPageSize, setListPageSize] = useState(25); const [reportKind, setReportKind] = useState('registrations'); const [reportFrom, setReportFrom] = useState(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)); const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10)); const [reportStatus, setReportStatus] = useState(''); const [busy, setBusy] = useState(false); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState(''); const [info, setInfo] = useState(''); const [modal, setModal] = useState(null); const [detailsModal, setDetailsModal] = useState(null); const [reason, setReason] = useState(''); const [claimDecision, setClaimDecision] = useState(''); const [evidenceRef, setEvidenceRef] = useState(''); const [transactionRef, setTransactionRef] = useState(''); const [verifiedPayeeVpa, setVerifiedPayeeVpa] = useState(''); const [verifiedRupees, setVerifiedRupees] = useState(''); const [receiverConfirmed, setReceiverConfirmed] = useState(false); const [paymentNotReceivedConfirmed, setPaymentNotReceivedConfirmed] = useState(false);
  const [adminResetPhoneE164, setAdminResetPhoneE164] = useState(''); const [adminResetRequestId, setAdminResetRequestId] = useState(''); const [adminResetExpiresAt, setAdminResetExpiresAt] = useState(0); const [adminResetResendAt, setAdminResetResendAt] = useState(0); const [resetClock, setResetClock] = useState(Date.now());
  const busyRef = useRef(busy); busyRef.current = busy;
  const [announcementTitle, setAnnouncementTitle] = useState(''); const [announcementBody, setAnnouncementBody] = useState(''); const [announcementReason, setAnnouncementReason] = useState(''); const [announcementAudience, setAnnouncementAudience] = useState('ALL_ACTIVE'); const [announcementUserIds, setAnnouncementUserIds] = useState(''); const [confirmAll, setConfirmAll] = useState(false); const [rewardDrafts, setRewardDrafts] = useState({}); const [supportModal, setSupportModal] = useState(null); const [supportReply, setSupportReply] = useState(''); const [supportReason, setSupportReason] = useState(''); const [chartRange, setChartRange] = useState('daily'); const [pushSetupStatus, setPushSetupStatus] = useState('Checking device registration…'); const [zoomEvidence, setZoomEvidence] = useState(null);
  const pushTokenRef = useRef(null); const registeredForAccessRef = useRef(null); const pendingPushClaimRef = useRef(null);
  const sessionRef = useRef({ accessToken: '', refreshToken: '' });
  useEffect(() => {
    if (!adminResetChallengeId) return undefined;
    const updateClock = () => setResetClock(Date.now());
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, [adminResetChallengeId]);
  const clientRef = useRef(null);
  const persistSession = useCallback(async (session) => {
    sessionRef.current = session;
    await Promise.all([adminSessionStorage.setItemAsync(ACCESS_KEY, session.accessToken), adminSessionStorage.setItemAsync(REFRESH_KEY, session.refreshToken)]);
    setAccess(session.accessToken);
  }, []);
  const clearLocalSession = useCallback(async (reason) => {
    sessionRef.current = { accessToken: '', refreshToken: '' };
    await Promise.all([adminSessionStorage.deleteItemAsync(ACCESS_KEY), adminSessionStorage.deleteItemAsync(REFRESH_KEY)]);
    setAccess(''); setProfile(null); setPayload(null); setPayloadSection(null); setPassword(''); setModal(null); setDetailsModal(null); setSupportModal(null);
    if (reason?.code !== 'SESSION_CLEARED') setError('Admin session expired. Sign in again.');
  }, []);
  if (!clientRef.current) clientRef.current = createAdminApiClient({ apiBase: API, getSession: () => sessionRef.current, onSessionChange: persistSession, onSessionExpired: clearLocalSession, timeoutMs: 20_000 });
  const request = useCallback((path, options) => clientRef.current.request(path, options), []);
  const requestRaw = useCallback((url, options) => clientRef.current.requestRaw(url, options), []);
  const loadSection = useCallback(async (key, token = access, requestedPage = listPage) => {
    const item = NAV.find(x => x[0] === key); if (!item || !token) return;
    setBusy(true); setError(''); if (key === 'reports') setPayloadSection(null);
    if (key === 'walletAdjustments') { setPayload({ ready: true }); setPayloadSection(key); setBusy(false); return; }
    if (key === 'walletCredits') { setPayload({ ready: true }); setPayloadSection(key); setBusy(false); return; }
    const queryParams = new URLSearchParams();
    if (query.trim() && key !== 'overview' && key !== 'ledger') queryParams.set('q', query.trim());
    if (statusFilter.trim() && key !== 'overview' && key !== 'ledger') queryParams.set('status', statusFilter.trim().toUpperCase());
    if (['users','deposits','withdrawals','transactions','ledger','referrals','commissions','disputes','support','admins','audit','alerts','p2p'].includes(key)) { queryParams.set('page', String(requestedPage)); queryParams.set('pageSize', String(listPageSize)); }
    const suffix = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const fetchSectionPayload = async (activeToken) => {
      if (key === 'walletCreditApprovals' || key === 'walletCreditRejections') return request('/api/v1/admin/wallet/credits/requests?status=PENDING_APPROVAL&page=1&pageSize=100', { token: activeToken });
      if (key === 'walletFunding' || key === 'walletFundingApprovals' || key === 'walletFundingRejections') return request('/api/v1/admin/wallet/funding/requests?status=PENDING_APPROVAL&page=1&pageSize=100', { token: activeToken });
      if (key === 'walletReconciliation') return request('/api/v1/admin/wallet/reconciliation', { token: activeToken });
      if (key === 'reconciliation' && !financialActionState('paymentVerification', profile?.role, profile?.financialOperationsEnabled).enabled) return { claims: [] };
      if (key === 'p2p') {
        const offersParams = new URLSearchParams({ page: String(requestedPage), pageSize: String(listPageSize) });
        if (query.trim()) offersParams.set('q', query.trim());
        const [offers, orders] = await Promise.all([
          request(`/api/v1/admin/p2p/offers?${offersParams.toString()}`, { token: activeToken }),
          request(`/api/v1/admin/p2p/orders${suffix}`, { token: activeToken }),
        ]);
        let overview = { offers: {}, orders: {}, pendingClaims: 0 };
        if (['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(profile?.role)) overview = await request('/api/v1/admin/p2p/overview', { token: activeToken });
        let claims = { claims: [] };
        if (financialActionState('paymentVerification', profile?.role, profile?.financialOperationsEnabled).enabled) {
          try { claims = await request(`/api/v1/admin/p2p/claims?page=${requestedPage}&pageSize=${listPageSize}`, { token: activeToken }); }
          catch (claimsError) { if (!/permission|role/i.test(claimsError.message)) throw claimsError; }
        }
        return normalizeP2pPayload(overview, offers, orders, claims);
      }
      if (key === 'reports') {
        const params = new URLSearchParams({ report: reportKind, from: reportFrom, to: reportTo });
        if (reportStatus) params.set('status', reportStatus);
        return request(`/api/v1/admin/reports?${params.toString()}`, { token: activeToken });
      }
      return normalizeListPayload(key, await request(`${item[2]}${suffix}`, { token: activeToken }));
    };
    try {
      setPayload(await fetchSectionPayload(token)); setPayloadSection(key);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); setRefreshing(false); }
  }, [access, listPage, listPageSize, profile?.role, query, statusFilter, reportKind, reportFrom, reportTo, reportStatus, request]);
  const signOut = useCallback(async () => {
    try {
      await clientRef.current.logout(async (current) => {
        if (current.accessToken && pushTokenRef.current) {
          try { await request('/api/v1/admin/push-devices', { token: current.accessToken, method: 'DELETE', body: { expoPushToken: pushTokenRef.current } }); } catch {}
        }
        if (current.refreshToken) await request('/api/v1/auth/logout', { token: current.accessToken, method: 'POST', body: { refreshToken: current.refreshToken } });
      });
    } catch {}
    pushTokenRef.current = null; registeredForAccessRef.current = null;
    setPushSetupStatus('Sign in to register this device.');
  }, [request]);
  useEffect(() => { let active = true; (async () => {
    const storedAccess = await adminSessionStorage.getItemAsync(ACCESS_KEY); const storedRefresh = await adminSessionStorage.getItemAsync(REFRESH_KEY);
    if (!active || !storedAccess || !storedRefresh) return;
    sessionRef.current = { accessToken: storedAccess, refreshToken: storedRefresh };
    try {
      const me = await request('/api/v1/admin/me');
      if (!active) return;
      const activeSession = sessionRef.current;
      setAccess(activeSession.accessToken); setProfile(me);
      await loadSection('overview', activeSession.accessToken);
    } catch (e) { if (active) setError(e.message); }
  })(); return () => { active = false; }; }, []);
  const login = async () => {
    setBusy(true); setError('');
    try {
      const phoneE164 = normalizeAdminPhone(phone); if (!phoneE164) throw new Error('Enter a valid 10-digit Indian mobile number.');
      const result = await request('/api/v1/admin/auth/login', { method: 'POST', body: { phoneE164, password } });
      await persistSession({ accessToken: result.accessToken, refreshToken: result.refreshToken }); setPassword('');
      const me = await request('/api/v1/admin/me'); setProfile(me); setSection('overview'); await loadSection('overview', result.accessToken);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const requestAdminResetOtp = async () => {
    setBusy(true); setError(''); setAdminResetMessage('');
    try {
      const result = await requestAdminResetFlow(request, adminResetPhoneE164 || adminResetPhone);
      setAdminResetPhoneE164(result.phoneE164);
      setAdminResetPhone(adminPhoneInputDigits(result.phoneE164));
      setAdminResetChallengeId(result.challengeId);
      setAdminResetRequestId(result.requestId);
      setAdminResetExpiresAt(result.expiresAt);
      setAdminResetResendAt(result.resendAt);
      setAdminResetMessage(result.message);
    } catch (e) { setError(adminPasswordResetErrorMessage(e)); } finally { setBusy(false); }
  };
  const resetAdminPassword = async () => {
    setBusy(true); setError(''); setAdminResetMessage('');
    try {
      const result = await submitAdminResetFlow(request, {
        phoneE164: adminResetPhoneE164 || adminResetPhone,
        challengeId: adminResetChallengeId,
        code: adminResetCode,
        newPassword: adminResetPassword,
        expiresAt: adminResetExpiresAt,
      });
      setAdminResetMessage(result.message || 'Password reset. Sign in using your new password.');
      setAdminResetMode(false); setAdminResetPhoneE164(''); setAdminResetChallengeId(''); setAdminResetCode(''); setAdminResetPassword(''); setAdminResetRequestId(''); setAdminResetExpiresAt(0); setAdminResetResendAt(0); setPassword('');
    } catch (e) { setError(adminPasswordResetErrorMessage(e)); } finally { setBusy(false); }
  };
  const openPushClaim = useCallback(async (claimId) => {
    if (!claimId) return;
    if (!access || !profile) { pendingPushClaimRef.current = claimId; setListPage(1); setSection('p2p'); return; }
    const reviewState = financialActionState('paymentVerification', profile.role, profile.financialOperationsEnabled);
    if (!reviewState.visible) { setError('This account cannot review payment proofs.'); return; }
    if (!reviewState.enabled) { setSection('p2p'); setInfo(reviewState.reason); return; }
    setListPage(1); setSection('p2p'); setBusy(true); setError('');
    try {
      const result = await request(`/api/v1/admin/p2p/claims/${encodeURIComponent(claimId)}`);
      const activeToken = sessionRef.current.accessToken;
      await loadSection('p2p', activeToken);
      const claim = result.claim;
      if (claim.status === 'PENDING_REVIEW') {
        setReason(''); setClaimDecision(''); setEvidenceRef(''); setTransactionRef(claim.transactionReference || '');
        setVerifiedRupees((Number(claim.order?.amountPaise || 0) / 100).toFixed(2)); setVerifiedPayeeVpa(claim.order?.withdrawalOffer?.payeeVpa || '');
        setReceiverConfirmed(false); setPaymentNotReceivedConfirmed(false); setModal({ type: 'p2p-claim', p2pClaim: claim });
      } else setDetailsModal({ title: 'Payment claim already processed', record: claim });
    } catch (e) { if (e.status === 401) pendingPushClaimRef.current = claimId; setError(e.message); }
    finally { setBusy(false); }
  }, [access, profile, loadSection, request]);
  const registerPushDevice = useCallback(async (adminAccess) => {
    if (registeredForAccessRef.current === adminAccess) return;
    if (IS_EXPO_GO) { setPushSetupStatus('Remote push is unavailable in Expo Go. Admin Alerts remain available in this app; install the Android Development Build for push.'); return; }
    if (Platform.OS !== 'android') { setPushSetupStatus('Push setup is configured for Android admin builds.'); return; }
    if (Constants.isDevice === false) { setPushSetupStatus('Remote push registration requires a physical Android device.'); return; }
    const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) { setPushSetupStatus('Push not configured: set EXPO_PUBLIC_EAS_PROJECT_ID and use an Android development/production build.'); return; }
    try {
      await Notifications.setNotificationChannelAsync('payment-verification', { name: 'Payment verification', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250], lightColor: '#2563EB' });
      let permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) { setPushSetupStatus('Notifications are disabled for this device. Enable them in Android Settings.'); return; }
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      const expoPushToken = result.data;
      await request('/api/v1/admin/push-devices', { token: adminAccess, method: 'POST', body: { expoPushToken, platform: 'android' } });
      pushTokenRef.current = expoPushToken; registeredForAccessRef.current = adminAccess; setPushSetupStatus('This Android device is registered for admin alerts.');
    } catch (e) { setPushSetupStatus(`Push registration unavailable: ${e.message}`); }
  }, []);
  useEffect(() => {
    if (access && profile) void registerPushDevice(access);
  }, [access, profile, registerPushDevice]);
  useEffect(() => {
    if (!Notifications) return undefined;
    const handleResponse = (response) => {
      const data = response?.notification?.request?.content?.data;
      if (data?.type === 'P2P_PAYMENT_PROOF_SUBMITTED' && data?.claimId) void openPushClaim(String(data.claimId));
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    void Notifications.getLastNotificationResponseAsync().then(handleResponse).catch(() => {});
    return () => subscription.remove();
  }, [openPushClaim]);
  useEffect(() => {
    if (!access || !profile || !pendingPushClaimRef.current) return;
    const claimId = pendingPushClaimRef.current; pendingPushClaimRef.current = null; void openPushClaim(claimId);
  }, [access, profile, openPushClaim]);
  const closeModal = () => { setModal(null); setReason(''); setClaimDecision(''); setEvidenceRef(''); setTransactionRef(''); setVerifiedPayeeVpa(''); setVerifiedRupees(''); setReceiverConfirmed(false); setPaymentNotReceivedConfirmed(false); };
  const changeUserStatus = async () => {
    if (!modal?.user || reason.trim().length < 8) { setError('Enter a reason with at least 8 characters.'); return; }
    setBusy(true); setError('');
    try { const nextStatus = modal.user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED'; await request(`/api/v1/admin/users/${encodeURIComponent(modal.user.id)}/status`, { token: access, method: 'POST', body: { status: nextStatus, reason: reason.trim() } }); closeModal(); setInfo(`User status changed to ${nextStatus}. The backend recorded the action.`); await loadSection('users'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const reviewClaim = async () => {
    if (!modal?.claim || !claimDecision || reason.trim().length < 8 || evidenceRef.trim().length < 3) { setError('Choose a decision and enter a reason and evidence reference.'); return; }
    const body = { decision: claimDecision, reason: reason.trim(), evidenceReference: evidenceRef.trim() };
    if (claimDecision === 'APPROVE') {
      const m = verifiedRupees.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/); const paise = m ? Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0')) : 0;
      if (!Number.isSafeInteger(paise) || paise <= 0 || !transactionRef.trim() || !receiverConfirmed) { setError('For approval, confirm receiver receipt, INR amount and verified transaction reference from merchant records.'); return; }
      body.verifiedTransactionReference = transactionRef.trim(); body.verifiedAmountPaise = paise; body.verifiedCurrency = 'INR'; body.receiverConfirmed = true;
    }
    const returnSection = modal.returnSection || 'reconciliation';
    setBusy(true); setError('');
    try { await request(`/api/v1/admin/reconciliation/claims/${encodeURIComponent(modal.claim.id)}/review`, { token: access, method: 'POST', body }); closeModal(); setInfo(`Claim ${claimDecision.toLowerCase()} decision saved. Any wallet credit was performed only by backend verification rules.`); await loadSection(returnSection); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const reviewP2pClaim = async () => {
    if (!modal?.p2pClaim || !claimDecision || reason.trim().length < 8 || evidenceRef.trim().length < 3) { setError('Choose a decision and enter a review reason and evidence reference.'); return; }
    if (claimDecision === 'REJECT' && !paymentNotReceivedConfirmed) { setError('Confirm from recipient-side records that payment was not received and no late payment is pending.'); return; }
    const body = { decision: claimDecision, reason: reason.trim(), evidenceReference: evidenceRef.trim() };
    if (claimDecision === 'REJECT') body.paymentNotReceivedConfirmed = true;
    if (claimDecision === 'APPROVE') {
      const m = verifiedRupees.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/); const paise = m ? Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0')) : 0;
      if (!Number.isSafeInteger(paise) || paise <= 0 || !transactionRef.trim() || !verifiedPayeeVpa.trim() || !receiverConfirmed) { setError('Confirm exact receiver-side receipt, transaction reference, amount, and recipient from trusted records.'); return; }
      body.verifiedTransactionReference = transactionRef.trim(); body.verifiedAmountPaise = paise; body.verifiedCurrency = 'INR'; body.verifiedPayeeVpa = verifiedPayeeVpa.trim(); body.receiverConfirmed = true;
    }
    setBusy(true); setError('');
    try { const result = await request(`/api/v1/admin/p2p/claims/${encodeURIComponent(modal.p2pClaim.id)}/review`, { token: access, method: 'POST', body }); closeModal(); setInfo(result.message || `P2P claim ${claimDecision === 'APPROVE' ? 'approved' : 'rejected'} and audit recorded.`); await loadSection('p2p'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const sendAnnouncement = async () => {
    if (announcementTitle.trim().length < 3 || announcementBody.trim().length < 3 || announcementReason.trim().length < 8) { setError('Enter a title, message, and audit reason.'); return; }
    const ids = announcementUserIds.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
    if (announcementAudience === 'ALL_ACTIVE' && !confirmAll) { setError('Confirm before sending to all active users.'); return; }
    if (announcementAudience === 'USER_IDS' && !ids.length) { setError('Enter at least one user UUID.'); return; }
    setBusy(true); setError('');
    try { const result = await request('/api/v1/admin/notifications', { token: access, method: 'POST', body: { title: announcementTitle.trim(), body: announcementBody.trim(), audience: announcementAudience, ...(announcementAudience === 'USER_IDS' ? { userIds: ids } : { confirmAll }), reason: announcementReason.trim() } }); setInfo(`In-app announcement saved for ${result.recipientCount} active user(s). No SMS or push messages were sent.`); setAnnouncementTitle(''); setAnnouncementBody(''); setAnnouncementReason(''); setConfirmAll(false); await loadSection('notifications'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const updateReward = async (rule) => {
    const draft = rewardDrafts[rule.id] || {}; const amountText = draft.amount ?? String((Number(rule.amountPaise) / 100).toFixed(2));
    const match = amountText.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/); const amountPaise = match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : NaN;
    const why = (draft.reason || '').trim();
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 0 || why.length < 8) { setError('Enter a valid INR reward amount and an audit reason of at least 8 characters.'); return; }
    setBusy(true); setError('');
    try { await request(`/api/v1/admin/reward-rules/${encodeURIComponent(rule.id)}`, { token: access, method: 'PATCH', body: { name: draft.name ?? rule.name, eligibility: rule.eligibility || {}, amountPaise, fundingSource: draft.fundingSource ?? rule.fundingSource ?? null, enabled: draft.enabled ?? rule.enabled, reason: why } }); setInfo('Reward rule updated and audited. This only changes eligibility configuration; it does not pay or credit rewards.'); await loadSection('rewardRules'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const exportCsv = async (name, data) => {
    const safeKey = (key) => !/password|otp|token|secret|api.?key|phoneE164|evidenceImage|base64|privateKey/i.test(key);
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) { setError('There are no records to export for this dataset.'); return; }
    const columns = [...new Set(rows.flatMap(row => Object.keys(row || {}).filter(safeKey)))];
    const csvCell = (value) => { let text = String(value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value); if (/^\s*[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
    const csv = [columns.map(csvCell).join(','), ...rows.map(row => columns.map(key => csvCell(safeKey(key) ? row?.[key] : '')).join(','))].join('\r\n');
    try { await Share.share({ title: `${name}.csv`, message: csv }); }
    catch { setError('Could not open the Android share sheet for CSV export.'); }
  };
  const openSupportTicket = async (row) => {
    setBusy(true); setError('');
    try { const result = await request(adminRecordDetailPath('support', row.id), { token: access }); setSupportModal(normalizeSupportTicket(result.ticket)); setSupportReply(''); setSupportReason(''); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const sendSupportReply = async () => {
    if (!supportModal || supportReply.trim().length < 2 || supportReason.trim().length < 8) { setError('Enter a reply and an audit reason (at least 8 characters).'); return; }
    setBusy(true); setError('');
    try { await request(`/api/v1/admin/support/tickets/${encodeURIComponent(supportModal.id)}/reply`, { token: access, method: 'POST', body: { message: supportReply.trim(), reason: supportReason.trim() } }); const result = await request(`/api/v1/admin/support/tickets/${encodeURIComponent(supportModal.id)}`, { token: access }); setSupportModal(normalizeSupportTicket(result.ticket)); setSupportReply(''); setInfo('Reply sent as an in-app notification and recorded in the audit log.'); await loadSection('support'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const setSupportStatus = async (status) => {
    if (!supportModal || supportReason.trim().length < 8) { setError('Enter an audit reason (at least 8 characters) before changing ticket status.'); return; }
    setBusy(true); setError('');
    try { await request(`/api/v1/admin/support/tickets/${encodeURIComponent(supportModal.id)}/status`, { token: access, method: 'PATCH', body: { status, reason: supportReason.trim() } }); const result = await request(`/api/v1/admin/support/tickets/${encodeURIComponent(supportModal.id)}`, { token: access }); setSupportModal(normalizeSupportTicket(result.ticket)); setInfo(`Support ticket changed to ${status}.`); await loadSection('support'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const allowed = profile?.allowedSections || [];
  const paymentReview = financialActionState('paymentVerification', profile?.role, profile?.financialOperationsEnabled);
  const quickDeposit = financialActionState('quickDeposit', profile?.role, profile?.financialOperationsEnabled);
  const withdrawalReview = financialActionState('withdrawalVerification', profile?.role, profile?.financialOperationsEnabled);
  const payoutProcessing = financialActionState('payoutProcessing', profile?.role, profile?.financialOperationsEnabled);
  const adminResetSecondsLeft = Math.max(0, Math.ceil((adminResetExpiresAt - resetClock) / 1000));
  const adminResetResendSeconds = Math.max(0, Math.ceil((adminResetResendAt - resetClock) / 1000));
  const adminResetAction = adminPasswordResetActionState({ busy, challengeId: adminResetChallengeId, resendSeconds: adminResetResendSeconds });
  const walletAdjustment = financialActionState('walletAdjustment', profile?.role, profile?.financialOperationsEnabled);
  const sections = useMemo(() => NAV.filter(([key]) => allowed.includes(key)), [allowed]);
  useEffect(() => { if (access && profile) loadSection(section, access, listPage); }, [section, access, profile, listPage, listPageSize]);
  useEffect(() => {
    if (!access || !profile || section !== 'p2p') return undefined;
    const timer = setInterval(() => { if (!busyRef.current) void loadSection('p2p'); }, 4000);
    return () => clearInterval(timer);
  }, [section, access, profile, loadSection]);
  if (!access || !profile) return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.loginWrap} keyboardShouldPersistTaps="handled"><View style={styles.loginGlow} /><View style={styles.loginBrandRow}><View style={styles.brandMark}><Image source={require('./assets/paisapay-admin-emblem.png')} resizeMode="contain" style={{width: 54, height: 54, borderRadius: 18}} accessibilityLabel="PaisaPay Admin security emblem" /></View><View><Text style={styles.brandEyebrow}>PAISAPAY · CONTROL</Text><Text style={styles.brand}>Admin Console</Text></View></View><Text style={styles.subtitle}>Secure access for authorized administrators.</Text><View style={styles.loginPanel}><View style={styles.loginPanelHeader}><Text style={styles.loginPanelTitle}>{adminResetMode ? 'Reset Admin password' : 'Welcome back'}</Text><Text style={styles.loginPanelNote}>{adminResetMode ? 'A one-time six-digit code is sent only to the registered mobile number of an active Admin account.' : 'Your role and permissions are verified by the server.'}</Text></View>{error ? <Text style={styles.error}>{error}</Text> : null}{adminResetMessage ? <Text style={styles.loginSuccess}>{adminResetMessage}</Text> : null}{adminResetMode ? <><Text style={styles.label}>Admin mobile number</Text><View style={styles.phoneInputWrap}><Text style={styles.phonePrefix}>+91</Text><TextInput style={styles.phoneNumberInput} value={adminResetPhone} onChangeText={(value) => setAdminResetPhone(adminPhoneInputDigits(value))} placeholder="10-digit Admin mobile number" placeholderTextColor={COLORS.muted} keyboardType="phone-pad" autoComplete="tel" maxLength={16} editable={!busy && !adminResetChallengeId}/></View>{adminResetChallengeId ? <><Text style={styles.loginPanelNote}>{adminResetSecondsLeft > 0 ? `Code expires in ${adminResetSecondsLeft}s.` : 'This code expired. Request a new code.'} Renflair does not confirm that SMS reaches the phone.</Text>{adminResetRequestId ? <Text style={styles.cardNote}>Support reference: {adminResetRequestId}</Text> : null}<Text style={styles.label}>SMS code</Text><TextInput style={styles.input} value={adminResetCode} onChangeText={(value) => setAdminResetCode(value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" placeholderTextColor={COLORS.muted} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} editable={!busy && adminResetSecondsLeft > 0}/><Text style={styles.label}>New password</Text><TextInput style={styles.input} value={adminResetPassword} onChangeText={setAdminResetPassword} placeholder="At least 12 characters" placeholderTextColor={COLORS.muted} secureTextEntry autoComplete="new-password" maxLength={128} onSubmitEditing={resetAdminPassword} editable={!busy && adminResetSecondsLeft > 0}/><Button title={busy ? 'Resetting…' : 'Reset Admin password'} onPress={resetAdminPassword} disabled={busy || adminResetSecondsLeft <= 0 || !adminResetCode || !adminResetPassword}/><Button title={adminResetAction === 'loading' ? 'Requesting new code…' : adminResetAction === 'cooldown' ? `Resend in ${adminResetResendSeconds}s` : 'Resend code'} onPress={requestAdminResetOtp} disabled={adminResetAction === 'loading' || adminResetAction === 'cooldown'}/></> : <Button title={busy ? 'Requesting code…' : 'Send reset code'} onPress={requestAdminResetOtp} disabled={busy || adminResetPhone.length !== 10}/>}<Pressable style={styles.loginLinkButton} onPress={() => { setAdminResetMode(false); setAdminResetPhoneE164(''); setAdminResetChallengeId(''); setAdminResetCode(''); setAdminResetPassword(''); setAdminResetRequestId(''); setAdminResetExpiresAt(0); setAdminResetResendAt(0); setError(''); setAdminResetMessage(''); }}><Text style={styles.loginLink}>Back to Admin sign in</Text></Pressable></> : <><Text style={styles.label}>Mobile number</Text><View style={styles.phoneInputWrap}><Text style={styles.phonePrefix}>+91</Text><TextInput style={styles.phoneNumberInput} value={phone} onChangeText={(value) => setPhone(adminPhoneInputDigits(value))} placeholder="10-digit mobile number" placeholderTextColor={COLORS.muted} keyboardType="phone-pad" autoComplete="username" maxLength={16}/></View><Text style={styles.label}>Password</Text><TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Administrator password" placeholderTextColor={COLORS.muted} secureTextEntry autoComplete="current-password" onSubmitEditing={login}/><Button title={busy ? 'Signing in…' : 'Sign in securely'} onPress={login} disabled={busy || !phone || !password}/><Pressable style={styles.loginLinkButton} onPress={() => { setAdminResetPhone(adminPhoneInputDigits(phone)); setAdminResetPhoneE164(''); setAdminResetChallengeId(''); setAdminResetCode(''); setAdminResetPassword(''); setAdminResetRequestId(''); setAdminResetExpiresAt(0); setAdminResetResendAt(0); setAdminResetMode(true); setError(''); setAdminResetMessage(''); }}><Text style={styles.loginLink}>Forgot Admin password?</Text></Pressable><Text style={styles.footnote}>Admin accounts are provisioned by authorized administrators. The app does not contain default credentials.</Text></>} </View><View style={styles.loginSecurity}><Text style={styles.loginSecurityIcon}>✦</Text><Text style={styles.loginSecurityText}>Protected admin session · encrypted token storage</Text></View></ScrollView></KeyboardAvoidingView>;
  const current = NAV.find(x => x[0] === section);
  // Render only known collection-shaped API fields here. Pagination/config objects are
  // metadata, not rows, and treating them as arrays caused malformed response crashes.
  const rows = payload && typeof payload === 'object' ? Object.entries(payload).filter(([, value]) => Array.isArray(value)) : [];
  const depositRows = asArray(payload?.deposits);
  const depositPaging = paginationState(payload?.total, payload?.page ?? listPage, payload?.pageSize ?? listPageSize);
  const listPaging = paginationState(payload?.total, payload?.page ?? listPage, payload?.pageSize ?? listPageSize);
  const searchSection = () => { if (listPage === 1) void loadSection(section, access, 1); else setListPage(1); };
  const selectSection = (key) => { setListPage(1); setSection(key); };
  const openUserDetails = async (row) => {
    if (!row?.id) return setDetailsModal({ title: 'User details', record: row });
    setBusy(true); setError('');
    try { const result = await request(adminRecordDetailPath('users', row.id), { token: access }); setDetailsModal({ title: `User · ${result.user?.publicId || row.publicId || row.id}`, record: result.user || row }); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <View style={styles.flex}><View style={styles.top}><View style={styles.topBrandRow}><View style={styles.topBrandMark}><Image source={require('./assets/paisapay-admin-emblem.png')} resizeMode="contain" style={{width: 36, height: 36, borderRadius: 12}} accessibilityLabel="PaisaPay Admin security emblem" /></View><View style={styles.topBrandCopy}><Text style={styles.brandSmall}>PAISAPAY · ADMIN</Text><Text style={styles.topTitle}>Control Center</Text></View><View style={styles.livePill}><View style={styles.liveDot}/><Text style={styles.liveText}>SECURE</Text></View></View><View style={styles.roleLine}><Text style={styles.role}>{profile.role?.replace(/_/g, ' ')} · Server authorized</Text></View></View><View style={styles.session}><View><Text style={styles.sessionEyebrow}>WORKSPACE</Text><Text style={styles.sessionText}>{current?.[1] || 'Dashboard'}</Text></View><Pressable style={styles.signoutButton} onPress={signOut}><Text style={styles.signout}>Log out</Text></Pressable></View>{error ? <Text style={styles.errorInline}>{error}</Text> : null}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nav} contentContainerStyle={styles.navContent}>{sections.map(([key, title]) => <Pressable key={key} onPress={() => selectSection(key)} style={[styles.navItem, section === key && styles.navActive]}><Text style={[styles.navText, section === key && styles.navTextActive]}>{title}</Text></Pressable>)}</ScrollView>
    {section !== 'overview' && section !== 'walletAdjustments' ? <View style={styles.searchPanel}><TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search ID, reference, name, or phone" placeholderTextColor={COLORS.muted} returnKeyType="search" onSubmitEditing={searchSection} /><TextInput style={styles.statusInput} value={statusFilter} onChangeText={setStatusFilter} placeholder="Status filter" placeholderTextColor={COLORS.muted} autoCapitalize="characters" onSubmitEditing={searchSection} /><Pressable style={styles.searchButton} onPress={searchSection}><Text style={styles.searchButtonText}>Search</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Rows per page ${listPageSize}; tap to change`} style={styles.searchButton} onPress={() => { const next = listPageSize === 25 ? 50 : listPageSize === 50 ? 100 : 25; setListPageSize(next); setListPage(1); }}><Text style={styles.searchButtonText}>{listPageSize}/page</Text></Pressable></View> : null}
    <ScrollView style={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadSection(section, access, listPage); }} />}>
      {info ? <Text style={styles.successInline}>{info}</Text> : null}
      {section === 'deposits' && paymentReview.visible && !paymentReview.enabled ? <FinancialActionNotice title="Payment verification unavailable" reason={paymentReview.reason} /> : null}
      {section === 'deposits' && !paymentReview.visible ? <FinancialActionNotice title="Payment review is Finance-only" reason="Your role can inspect deposit records, but only Finance, Admin, and Super Admin can review payment claims." /> : null}
      {section === 'reconciliation' && paymentReview.visible && !paymentReview.enabled ? <FinancialActionNotice title="Payment verification unavailable" reason={paymentReview.reason} /> : null}
      {section === 'p2p' && quickDeposit.visible ? <FinancialActionNotice title="Quick Deposit matching is unavailable in Admin" reason={quickDeposit.reason} /> : null}
      {section === 'p2p' && paymentReview.visible && !paymentReview.enabled ? <FinancialActionNotice title="Payment verification unavailable" reason={paymentReview.reason} /> : null}
      {section === 'p2p' && !paymentReview.visible ? <FinancialActionNotice title="Payment claims are restricted to Finance" reason="This role can monitor P2P offers and orders, but only Finance, Admin, and Super Admin roles can view payment claims or review them." /> : null}
      {section === 'withdrawals' && withdrawalReview.visible ? <FinancialActionNotice title="Withdrawal verification is read-only" reason={withdrawalReview.reason} /> : null}
      {section === 'ledger' && walletAdjustment.visible ? <FinancialActionNotice title="Wallet adjustments unavailable" reason={walletAdjustment.reason} /> : null}
      {section === 'walletAdjustments' ? <WalletAdjustmentAdminSection request={request} access={access} profile={profile} setInfo={setInfo} setError={setError} /> : null}
      {section === 'walletCredits' ? <SuperAdminWalletCreditsSection request={request} access={access} profile={profile} setInfo={setInfo} setError={setError} loadSection={loadSection} /> : null}
      {['walletCreditApprovals','walletCreditRejections','walletFunding','walletFundingApprovals','walletFundingRejections','walletReconciliation'].includes(section) ? <WalletCreditControlsSection section={section} request={request} access={access} profile={profile} payload={payloadSection === section ? payload : null} setInfo={setInfo} setError={setError} loadSection={loadSection}/> : null}
      {section === 'health' && payoutProcessing.visible ? <FinancialActionNotice title="Payout processing unavailable" reason={payoutProcessing.reason} /> : null}
      {busy ? <ActivityIndicator color={COLORS.blue} size="large" style={{ marginTop: 30 }} /> : null}
      {section === 'overview' && payloadSection === section && payload ? <><View style={styles.card}><Text style={styles.cardEyebrow}>LIVE · DATABASE</Text><Text style={styles.cardTitle}>Operations overview</Text><Text style={styles.cardNote}>Tap a metric to open its related records. Figures come from the PaisaPay backend. Gross transaction volume and ledger balances are separate measures.</Text></View><View style={styles.grid}>{Object.entries(payload.metrics || {}).filter(([, v]) => typeof v === 'number' || typeof v === 'string' || v === null).map(([k, v]) => <Pressable key={k} onPress={() => selectSection(k.toLowerCase().includes('deposit') ? 'deposits' : k.toLowerCase().includes('withdraw') ? 'withdrawals' : k.toLowerCase().includes('user') ? 'users' : 'transactions')} style={({ pressed }) => [styles.metric, pressed && styles.pressed]}><Text style={styles.metricLabel}>{k.replace(/([A-Z])/g, ' $1').replace(/Paise$/i, '')}</Text><Text style={styles.metricValue}>{v === null ? 'Not configured' : /Paise$/i.test(k) ? `₹${(Number(v) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : String(v)}</Text><Text style={styles.metricHint}>View records ›</Text></Pressable>)}</View><View style={styles.card}><Text style={styles.cardTitle}>Transaction and registration trends</Text><View style={styles.decisionRow}>{[['daily','7 days'],['weekly','4 weeks'],['monthly','12 months']].map(([key,title]) => <Button key={key} title={chartRange === key ? `✓ ${title}` : title} secondary onPress={() => setChartRange(key)}/>)}</View><View style={styles.chartLegend}><Text style={styles.rowDetail}>● Deposits</Text><Text style={[styles.rowDetail,{color:COLORS.gold}]}>● Withdrawals</Text><Text style={[styles.rowDetail,{color:COLORS.green}]}>● New users</Text></View>{(payload.charts?.[chartRange] || []).map((point, index, list) => { const max = Math.max(1, ...list.map(x => Number(x.depositsPaise) + Number(x.withdrawalsPaise))); const dep = Math.max(4, 92 * Number(point.depositsPaise) / max); const wd = Math.max(4, 92 * Number(point.withdrawalsPaise) / max); const users = Math.min(24, Number(point.registrations) * 3); return <View key={`${point.date}-${index}`} style={styles.chartRow}><Text style={styles.chartDate}>{new Date(point.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</Text><View style={styles.chartTrack}><View style={[styles.chartDeposit,{width:`${dep}%`}]}/><View style={[styles.chartWithdraw,{width:`${wd}%`}]}/></View><Text style={styles.chartUsers}>{Number(point.registrations)} users</Text></View>; })}</View></> : null}
      {section === 'alerts' && payloadSection === section && payload ? <><View style={styles.card}><Text style={styles.cardEyebrow}>DURABLE IN-APP INBOX</Text><Text style={styles.cardTitle}>Admin payment alerts</Text><Text style={styles.cardNote}>{pushSetupStatus} Push payloads include only a claim ID; latest details are fetched from the authenticated API when opened.</Text></View>{payload.events?.length ? payload.events.map(event => <Pressable key={event.id} style={styles.card} onPress={() => event.claimId ? openPushClaim(event.claimId) : setDetailsModal({ title: event.title, record: event })}><Text style={styles.cardEyebrow}>{String(event.type).replace(/_/g, ' ')}</Text><Text style={styles.cardTitle}>{event.title}</Text><Text style={styles.cardNote}>{event.body}</Text><Text style={styles.rowDetail}>{new Date(event.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · {event.deliveries?.filter(x => x.status === 'ACCEPTED').length || 0} device(s) accepted</Text><Text style={styles.detailLink}>{event.claimId ? 'Open latest verification record ›' : 'View alert ›'}</Text></Pressable>) : <View style={styles.card}><Text style={styles.cardNote}>No admin alerts have been recorded.</Text></View>}</> : null}
      {section === 'deposits' && payloadSection === section && payload ? <><View style={styles.card}><Text style={styles.cardEyebrow}>ALL PUBLIC USERS · SERVER DATA</Text><Text style={styles.cardTitle}>Deposit requests</Text><Text style={styles.cardNote}>Showing page {depositPaging.page} of {depositPaging.pageCount} · {depositPaging.total} deposits across all users. Search by public user ID, deposit ID, provider reference, or merchant reference. Phone numbers are masked.</Text><Text style={styles.cardNote}>Payment screenshots and entered UTRs are supporting claims only. Approve only after independently confirming the receiver-side transaction.</Text></View>{depositRows.length ? depositRows.map((deposit) => <View key={deposit.id} style={styles.card}><Pressable onPress={() => setDetailsModal({ title: 'Deposit request', record: deposit })}><Text style={styles.cardEyebrow}>{deposit.user?.displayName || 'PaisaPay user'} · {deposit.user?.publicId || 'ID unavailable'} · {deposit.user?.phoneMasked || ''}</Text><Text style={styles.cardTitle}>₹{(Number(deposit.amountPaise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text><Text style={styles.rowDetail}>{deposit.status} · {deposit.method} · {new Date(deposit.createdAt).toLocaleString()}</Text><Text style={styles.rowDetail}>Deposit: {deposit.id} · Reference: {deposit.merchantReference || deposit.providerReference || 'Not available'}</Text><Text style={styles.detailLink}>View deposit details ›</Text></Pressable>{deposit.manualPaymentClaim ? <View style={styles.detailGroup}><Text style={styles.detailSectionTitle}>Customer UTR claim · {deposit.manualPaymentClaim.status}</Text><Text style={styles.rowDetail}>UTR: {deposit.manualPaymentClaim.transactionReference} · Evidence: {deposit.manualPaymentClaim.evidenceMimeType ? 'Image attached' : 'No image'}</Text>{deposit.manualPaymentClaim.status === 'PENDING_REVIEW' && financialActionState('paymentVerification', profile.role, profile.financialOperationsEnabled).enabled ? <Pressable style={styles.smallAction} onPress={() => { const claim = { ...deposit.manualPaymentClaim, deposit: { id: deposit.id, amountPaise: deposit.amountPaise, currency: deposit.currency, merchantReference: deposit.merchantReference, status: deposit.status }, user: deposit.user }; setReason(''); setClaimDecision(''); setEvidenceRef(''); setTransactionRef(claim.transactionReference || ''); setVerifiedRupees((Number(deposit.amountPaise || 0) / 100).toFixed(2)); setReceiverConfirmed(false); setModal({ type: 'claim', claim, returnSection: 'deposits' }); }}><Text style={styles.smallActionText}>Inspect evidence & review</Text></Pressable> : null}</View> : <Text style={styles.cardNote}>No customer UTR claim attached.</Text>}</View>) : <View style={styles.card}><Text style={styles.cardNote}>No deposits match these filters.</Text></View>}</> : null}
      {section === 'p2p' && payloadSection === section && payload ? <>
        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>LIVE · P2P MARKETPLACE</Text>
          <Text style={styles.cardTitle}>Quick Deposit operations</Text>
          <Text style={styles.cardNote}>Orders, withdrawal offers and payment claims returned by the PaisaPay backend. Buyer contact details are masked. Payment evidence is a claim and must be checked against trusted recipient-side records.</Text>
        </View>
        <View style={styles.grid}>
          {[
            ['Open offers', payload.offers?.open ?? payload.offers?.OPEN ?? '—'],
            ['Total offers', payload.offerTotal],
            ['Matching orders', payload.orderTotal],
            ['Pending claims', payload.pendingClaims],
          ].map(([label, value]) => <View key={label} style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{String(value)}</Text></View>)}
        </View>
        {payload.claims.length ? <>
          <View style={styles.card}><Text style={styles.cardEyebrow}>FINANCE QUEUE</Text><Text style={styles.cardTitle}>Payment proofs awaiting review ({payload.claims.length})</Text><Text style={styles.cardNote}>Review only after independently confirming the actual payment, recipient and exact amount. Screenshots and UTRs alone are not payment verification.</Text></View>
          {payload.claims.map((claim) => <View key={claim.id} style={styles.card}>
            <Text style={styles.cardEyebrow}>{claim.order?.referenceId || claim.orderId || 'Order reference unavailable'} · {claim.status}</Text>
            <Text style={styles.cardTitle}>₹{(Number(claim.claimedAmountPaise ?? claim.order?.amountPaise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
            <Text style={styles.rowDetail}>Buyer · {claim.user?.publicId || 'ID unavailable'} · {claim.user?.phoneMasked || ''}</Text>
            <Text style={styles.rowDetail}>Seller · {claim.order?.seller?.publicId || 'ID unavailable'} · UTR · {claim.transactionReference || 'Not submitted'}</Text>
            <Text style={styles.rowDetail}>Submitted · {claim.createdAt ? new Date(claim.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'} · Evidence · {claim.evidenceAttached ? 'Uploaded securely' : 'Not attached'}</Text>
            <Pressable style={styles.smallAction} onPress={() => { setReason(''); setClaimDecision(''); setEvidenceRef(''); setTransactionRef(claim.transactionReference || ''); setVerifiedRupees((Number(claim.order?.amountPaise || 0) / 100).toFixed(2)); setVerifiedPayeeVpa(''); setReceiverConfirmed(false); setPaymentNotReceivedConfirmed(false); setModal({ type: 'p2p-claim', p2pClaim: claim }); }}><Text style={styles.smallActionText}>Review payment proof</Text></Pressable>
          </View>)}
        </> : <View style={styles.card}><Text style={styles.cardTitle}>{paymentReview.enabled ? 'No payment proofs awaiting review' : paymentReview.visible ? 'Payment review is unavailable' : 'Payment claims are Finance-only'}</Text><Text style={styles.cardNote}>{paymentReview.enabled ? 'New submitted claims appear here after the backend saves them.' : paymentReview.visible ? paymentReview.reason : 'Your role can monitor P2P offers and orders, but cannot view or review payment claims.'}</Text></View>}
        {payload.claimTotal > 0 ? <PaginationBar page={payload.claimPage} pageCount={Math.max(1, Math.ceil(payload.claimTotal / payload.claimPageSize))} total={payload.claimTotal} hasPrevious={payload.claimPage > 1} hasNext={payload.claimPage * payload.claimPageSize < payload.claimTotal} busy={busy} onPrevious={() => setListPage((value) => Math.max(1, value - 1))} onNext={() => setListPage((value) => value + 1)}/> : null}
        <View style={styles.card}><Text style={styles.cardEyebrow}>BUYER ORDERS</Text><Text style={styles.cardTitle}>Quick Deposit orders ({payload.orderRecords.length})</Text></View>
        {payload.orderRecords.length ? payload.orderRecords.map((order) => <Pressable key={order.id} style={styles.card} onPress={() => setDetailsModal({ title: 'Quick Deposit order', record: order })}>
          <Text style={styles.cardEyebrow}>{order.referenceId || order.id} · {order.status || 'STATUS UNAVAILABLE'}</Text>
          <Text style={styles.cardTitle}>₹{(Number(order.amountPaise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
          <Text style={styles.rowDetail}>Buyer · {order.buyer?.publicId || 'ID unavailable'} · {order.buyer?.phoneMasked || ''}</Text>
          <Text style={styles.rowDetail}>Seller · {order.seller?.publicId || 'ID unavailable'} · {order.seller?.phoneMasked || ''}</Text>
          <Text style={styles.rowDetail}>Offer · {order.withdrawalOffer?.referenceId || order.withdrawalOfferId || '—'} · Payment · {order.claims?.[0]?.status || order.status}</Text>
          <Text style={styles.detailLink}>View order and matching details ›</Text>
        </Pressable>) : <View style={styles.card}><Text style={styles.cardNote}>No Quick Deposit orders match the current search or status filter.</Text></View>}
        <View style={styles.card}><Text style={styles.cardEyebrow}>SELLER OFFERS</Text><Text style={styles.cardTitle}>Withdrawal offers ({payload.offerRecords.length})</Text></View>
        {payload.offerRecords.length ? payload.offerRecords.map((offer) => <Pressable key={offer.id} style={styles.card} onPress={() => setDetailsModal({ title: 'Withdrawal offer', record: offer })}>
          <Text style={styles.cardEyebrow}>{offer.referenceId || offer.id} · {offer.status || 'STATUS UNAVAILABLE'}</Text>
          <Text style={styles.cardTitle}>₹{(Number(offer.amountPaise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text>
          <Text style={styles.rowDetail}>Seller · {offer.user?.displayName || offer.user?.publicId || 'PaisaPay user'} · {offer.user?.phoneMasked || ''}</Text>
          <Text style={styles.rowDetail}>Completed ₹{(Number(offer.completedAmountPaise || 0) / 100).toFixed(2)} · Matched ₹{(Number(offer.activeReservedPaise || 0) / 100).toFixed(2)} · Held ₹{(Number(offer.disputedHeldPaise || 0) / 100).toFixed(2)}</Text>
          <Text style={styles.rowDetail}>Available ₹{(Number(offer.availableAmountPaise || 0) / 100).toFixed(2)} · {offer.orders?.length || 0} linked order(s)</Text>
          <Text style={styles.detailLink}>View offer and order details ›</Text>
        </Pressable>) : <View style={styles.card}><Text style={styles.cardNote}>No withdrawal offers match the current search.</Text></View>}
        <View style={styles.pagination}><Button title="Previous offers/orders" secondary onPress={() => setListPage((value) => Math.max(1, value - 1))} disabled={listPage <= 1 || busy}/><Text style={styles.rowDetail}>Page {listPage} · {payload.orderTotal} orders / {payload.offerTotal} offers</Text><Button title="Next offers/orders" secondary onPress={() => setListPage((value) => value + 1)} disabled={busy || (listPage * listPageSize >= payload.orderTotal && listPage * listPageSize >= payload.offerTotal)}/></View>
      </> : null}
      {section !== 'overview' && section !== 'deposits' && section !== 'p2p' && section !== 'reports' && section !== 'alerts' && section !== 'settings' && payloadSection === section && payload ? rows.length ? rows.map(([key, value]) => <View key={key} style={styles.card}><Text style={styles.cardTitle}>{key}</Text>{value.length ? value.map((row, i) => <View key={row?.id || row?.referenceId || i} style={styles.row}><Pressable onPress={() => section === 'users' ? openUserDetails(row) : section === 'support' ? openSupportTicket(row) : setDetailsModal({ title: key, record: row })}><Text style={styles.rowTitle}>{row?.referenceId || row?.publicId || row?.displayName || row?.id || `Record ${i + 1}`}</Text><Text style={styles.rowDetail}>{row?.status || row?.role || row?.action || JSON.stringify(row).slice(0, 180)}</Text><Text style={styles.detailLink}>{section === 'support' ? 'Open ticket details ›' : 'Tap to view full details ›'}</Text></Pressable>{section === 'users' && ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'].includes(profile.role) && row?.id ? <Pressable style={styles.smallAction} onPress={() => { setReason(''); setModal({ type: 'user-status', user: row }); }}><Text style={styles.smallActionText}>{row.status === 'SUSPENDED' ? 'Reactivate account' : 'Suspend account'}</Text></Pressable> : null}{section === 'support' && row?.id ? <Pressable style={styles.smallAction} onPress={() => openSupportTicket(row)}><Text style={styles.smallActionText}>Open & respond</Text></Pressable> : null}{section === 'reconciliation' && row?.id && row.status === 'PENDING_REVIEW' && paymentReview.enabled ? <><Text style={styles.cardNote}>Claimed UTR: {row.transactionReference} · Claimed amount: ₹{(row.deposit.amountPaise / 100).toFixed(2)} · {row.user.phoneMasked}</Text><Pressable style={styles.smallAction} onPress={() => { setReason(''); setModal({ type: 'claim', claim: row }); }}><Text style={styles.smallActionText}>Review claim</Text></Pressable></> : null}</View>) : <Text style={styles.cardNote}>No records returned.</Text>}</View>) : <View style={styles.card}><Text style={styles.cardTitle}>Service response</Text><Text style={styles.cardNote}>{JSON.stringify(payload, null, 2).slice(0, 2500)}</Text></View> : null}
      {section === 'notifications' ? <View style={styles.card}><Text style={styles.cardEyebrow}>IN-APP ONLY · AUDITED</Text><Text style={styles.cardTitle}>Create announcement</Text><Text style={styles.cardNote}>This writes an in-app notification to active accounts. It does not send SMS or push notifications. All-active sends require confirmation and every send is audited.</Text><Text style={styles.label}>Title</Text><TextInput style={styles.input} value={announcementTitle} onChangeText={setAnnouncementTitle} maxLength={100} placeholder="Announcement title" placeholderTextColor={COLORS.muted}/><Text style={styles.label}>Message</Text><TextInput style={[styles.input, styles.multiline]} multiline value={announcementBody} onChangeText={setAnnouncementBody} maxLength={1000} placeholder="Message shown in PaisaPay" placeholderTextColor={COLORS.muted}/><View style={styles.decisionRow}><Button title={announcementAudience === 'ALL_ACTIVE' ? '✓ All active' : 'All active'} secondary onPress={() => setAnnouncementAudience('ALL_ACTIVE')}/><Button title={announcementAudience === 'USER_IDS' ? '✓ Selected IDs' : 'Selected IDs'} secondary onPress={() => setAnnouncementAudience('USER_IDS')}/></View>{announcementAudience === 'USER_IDS' ? <><Text style={styles.label}>User UUIDs (comma or newline separated, up to 1,000)</Text><TextInput style={[styles.input, styles.multiline]} multiline value={announcementUserIds} onChangeText={setAnnouncementUserIds} placeholder="Paste UUIDs returned by the admin API" placeholderTextColor={COLORS.muted}/></> : <Pressable style={styles.confirmRow} onPress={() => setConfirmAll(!confirmAll)}><Text style={[styles.confirmBox, confirmAll && styles.checkedBox]}>{confirmAll ? '✓' : ''}</Text><Text style={styles.cardNote}>I confirm this announcement is intended for all active users</Text></Pressable>}<Text style={styles.label}>Audit reason</Text><TextInput style={styles.input} value={announcementReason} onChangeText={setAnnouncementReason} maxLength={500} placeholder="Reason for sending" placeholderTextColor={COLORS.muted}/><Button title={busy ? 'Sending…' : 'Send in-app announcement'} onPress={sendAnnouncement} disabled={busy}/></View> : null}
      {section === 'rewardRules' && payloadSection === section && payload?.rules ? <><View style={styles.card}><Text style={styles.cardEyebrow}>CONFIGURATION ONLY</Text><Text style={styles.cardTitle}>Reward rules</Text><Text style={styles.cardNote}>Editing rules does not create a reward credit. Payout funding is not configured. Only Super Admin can save changes; all changes are audited.</Text></View>{payload.rules.map(rule => { const draft = rewardDrafts[rule.id] || {}; return <View key={rule.id} style={styles.card}><Text style={styles.cardTitle}>{rule.name}</Text><Text style={styles.cardNote}>Status: {rule.enabled ? 'Enabled' : 'Disabled'} · Funding: {rule.fundingSource || 'not configured'}</Text><Text style={styles.label}>Reward amount (₹)</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={draft.amount ?? String((Number(rule.amountPaise) / 100).toFixed(2))} onChangeText={value => setRewardDrafts(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], amount: value } }))}/><Text style={styles.label}>Audit reason</Text><TextInput style={styles.input} value={draft.reason || ''} onChangeText={value => setRewardDrafts(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], reason: value } }))} placeholder="Why is this rule changing?" placeholderTextColor={COLORS.muted}/><Button title={busy ? 'Saving…' : 'Save rule'} onPress={() => updateReward(rule)} disabled={busy}/><DetailFields value={{ eligibility: rule.eligibility, updatedAt: rule.updatedAt }}/></View>; })}</> : null}
      {section === 'reports' ? <><View style={styles.card}><Text style={styles.cardEyebrow}>AGGREGATE SERVER REPORTS</Text><Text style={styles.cardTitle}>Operational reports</Text><Text style={styles.cardNote}>Reports use aggregate counts only; no names, phone numbers, transaction references or uploaded evidence are exported. Financial record amounts sum request/order amounts across selected statuses; they are not verified payments, payouts, wallet balances, or revenue. Financial reports remain blocked by the server safety gate while financial operations are disabled.</Text>{[['registrations','Registrations'],['deposits','Deposits'],['withdrawals','Withdrawals'],['p2p-orders','P2P orders'],['support-tickets','Support tickets']].map(([kind,label]) => <Button key={kind} title={label} secondary={reportKind !== kind} onPress={() => { setReportKind(kind); setReportStatus(''); }} />)}<Text style={styles.label}>From date (YYYY-MM-DD)</Text><TextInput style={styles.input} value={reportFrom} onChangeText={setReportFrom} autoCapitalize="none"/><Text style={styles.label}>To date (YYYY-MM-DD)</Text><TextInput style={styles.input} value={reportTo} onChangeText={setReportTo} autoCapitalize="none"/><Text style={styles.label}>Status filter (optional)</Text><TextInput style={styles.input} value={reportStatus} onChangeText={setReportStatus} autoCapitalize="characters" placeholder="For example: ACTIVE" placeholderTextColor={COLORS.muted}/><Button title={busy ? 'Loading…' : 'Generate report'} onPress={() => loadSection('reports', access, 1)} disabled={busy}/></View>{payloadSection === section && payload ? <><View style={styles.card}><Text style={styles.cardTitle}>Report summary</Text><Text style={styles.rowDetail}>Date range · {payload.from} to {payload.to} UTC</Text><Text style={styles.rowDetail}>Total records · {payload.total}</Text>{payload.totalAmountPaise != null ? <Text style={styles.rowDetail}>Record amount · {formatPaise(payload.totalAmountPaise)}</Text> : null}<Button title="Share report CSV" onPress={() => exportCsv(`paisapay-${reportKind}`, [{ section: 'summary', dateRange: `${payload.from} to ${payload.to} UTC`, status: reportStatus || 'ALL', count: payload.total, amountPaise: payload.totalAmountPaise ?? '' }, ...payload.daily.map((row) => ({ section: 'daily', ...row })), ...payload.statusBreakdown.map((row) => ({ section: 'status', ...row }))])} disabled={!payload.total && !payload.daily?.length}/></View><View style={styles.card}><Text style={styles.cardTitle}>Daily totals</Text>{payload.daily?.length ? payload.daily.map((row) => <Text key={row.date} style={styles.rowDetail}>{row.date} · {row.count}{row.amountPaise != null ? ` · ${formatPaise(row.amountPaise)}` : ''}</Text>) : <Text style={styles.cardNote}>No daily records in this range.</Text>}</View><View style={styles.card}><Text style={styles.cardTitle}>Status totals</Text>{payload.statusBreakdown?.length ? payload.statusBreakdown.map((row) => <Text key={row.status} style={styles.rowDetail}>{row.status} · {row.count}{row.amountPaise != null ? ` · ${formatPaise(row.amountPaise)}` : ''}</Text>) : <Text style={styles.cardNote}>No status totals.</Text>}</View></> : null}</> : null}
      {section === 'health' && payloadSection === section && payload ? <View style={styles.card}><Text style={styles.cardEyebrow}>LIVE BACKEND CHECK</Text><Text style={styles.cardTitle}>System health</Text><Text style={styles.cardNote}>Current API, database, and provider status returned by the authenticated backend health endpoint.</Text><DetailFields value={payload}/></View> : null}
      {section === 'settings' && payloadSection === section && payload ? <View style={styles.card}><Text style={styles.cardEyebrow}>READ ONLY · FINANCIAL SAFETY</Text><Text style={styles.cardTitle}>Server settings and wallet funding diagnostics</Text><Text style={styles.cardNote}>This view reports deployed controls; it cannot change financial settings or fund an adjustment account.</Text><DetailFields value={payload}/></View> : null}
      {payloadSection === section && payload && !['overview','walletAdjustments','p2p','deposits','alerts','reports','health','notifications','rewardRules'].includes(section) ? <PaginationBar page={listPaging.page} pageCount={listPaging.pageCount} total={listPaging.total} hasPrevious={listPaging.hasPrevious} hasNext={listPaging.hasNext} busy={busy} onPrevious={() => setListPage((value) => Math.max(1, value - 1))} onNext={() => setListPage((value) => value + 1)}/> : null}
      {section === 'deposits' && payloadSection === section && payload ? <PaginationBar page={depositPaging.page} pageCount={depositPaging.pageCount} total={depositPaging.total} hasPrevious={depositPaging.hasPrevious} hasNext={depositPaging.hasNext} busy={busy} onPrevious={() => setListPage((value) => Math.max(1, value - 1))} onNext={() => setListPage((value) => value + 1)}/> : null}
      {section === 'alerts' && payloadSection === section && payload ? <PaginationBar page={listPaging.page} pageCount={listPaging.pageCount} total={listPaging.total} hasPrevious={listPaging.hasPrevious} hasNext={listPaging.hasNext} busy={busy} onPrevious={() => setListPage((value) => Math.max(1, value - 1))} onNext={() => setListPage((value) => value + 1)}/> : null}
      <Text style={styles.securityNote}>Financial state changes remain backend controlled. This app has no direct wallet-balance editing action.</Text>
    </ScrollView>
    <Modal visible={Boolean(modal)} transparent animationType="slide" onRequestClose={closeModal}><View style={styles.modalShade}><ScrollView style={styles.modalCard} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled"><Text style={styles.cardTitle}>{modal?.type === 'user-status' ? `${modal.user.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'} account` : modal?.type === 'p2p-claim' ? 'Review P2P payment claim' : 'Review payment claim'}</Text>{modal?.type === 'user-status' ? <><Text style={styles.cardNote}>This action will be recorded in the backend audit log. Do not suspend an account without a documented reason.</Text><TextInput style={[styles.input, styles.multiline]} multiline value={reason} onChangeText={setReason} placeholder="Required reason (at least 8 characters)" placeholderTextColor={COLORS.muted}/><Button title={busy ? 'Saving…' : 'Confirm status change'} onPress={changeUserStatus} disabled={busy}/></> : <><Text style={styles.cardNote}>A submitted reference or screenshot is only a claim. Approve only after independently confirming receiver-side merchant/bank records, exact INR amount, and payee.</Text>{modal?.type === 'p2p-claim' ? <View style={styles.detailGroup}><Text style={styles.detailSectionTitle}>Order & timeline</Text><Text style={styles.rowDetail}>Order ID · {modal.p2pClaim.order?.id || '—'}</Text><Text style={styles.rowDetail}>Order reference · {modal.p2pClaim.order?.referenceId || '—'}</Text><Text style={styles.rowDetail}>Withdrawal offer ID · {modal.p2pClaim.order?.withdrawalOffer?.id || '—'}</Text><Text style={styles.rowDetail}>Matched · {modal.p2pClaim.order?.timestamps?.matchedAt ? new Date(modal.p2pClaim.order.timestamps.matchedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text><Text style={styles.rowDetail}>Payment handoff · {modal.p2pClaim.order?.timestamps?.paymentHandoffInitiatedAt ? new Date(modal.p2pClaim.order.timestamps.paymentHandoffInitiatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text><Text style={styles.rowDetail}>Proof submitted · {modal.p2pClaim.createdAt ? new Date(modal.p2pClaim.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text><Text style={styles.rowDetail}>Expires · {modal.p2pClaim.order?.expiresAt ? new Date(modal.p2pClaim.order.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text><Text style={styles.rowDetail}>Cancellation requested · {modal.p2pClaim.order?.timestamps?.cancellationRequestedAt ? new Date(modal.p2pClaim.order.timestamps.cancellationRequestedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text></View> : null}{modal?.type === 'p2p-claim' && modal.p2pClaim.evidenceAttached ? <View style={styles.evidencePanel}><Text style={styles.detailLabel}>Buyer screenshot · supporting claim only</Text><SecureEvidenceImage uri={`${API}/api/v1/admin/p2p/claims/${encodeURIComponent(modal.p2pClaim.id)}/evidence`} accessToken={access} requestRaw={requestRaw} onZoom={(uri) => setZoomEvidence({ uri })}/><Text style={styles.cardNote}>Review against receiver-side records; screenshot alone is not payment proof.</Text><Text style={styles.cardNote}>Claimed amount: {modal.p2pClaim.claimedAmountPaise == null ? '—' : `₹${(Number(modal.p2pClaim.claimedAmountPaise) / 100).toFixed(2)}`} · Paid at: {modal.p2pClaim.claimedPaidAt ? new Date(modal.p2pClaim.claimedPaidAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'} · Proof submitted: {modal.p2pClaim.createdAt ? new Date(modal.p2pClaim.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text></View> : null}{modal?.type === 'claim' && modal.claim.evidenceMimeType ? <View style={styles.evidencePanel}><Text style={styles.detailLabel}>Customer screenshot · supporting evidence only</Text><SecureEvidenceImage uri={`${API}/api/v1/admin/reconciliation/claims/${encodeURIComponent(modal.claim.id)}/evidence`} accessToken={access} requestRaw={requestRaw} onZoom={(uri) => setZoomEvidence({ uri })}/><Text style={styles.cardNote}>Do not approve from this image alone. Match the transaction against the actual receiver-side records.</Text></View> : null}<View style={styles.decisionRow}><Button title="Approve verified receipt" onPress={() => setClaimDecision('APPROVE')}/><Button title="Reject claim" secondary onPress={() => setClaimDecision('REJECT')}/></View>{claimDecision ? <><Text style={styles.label}>Reason</Text><TextInput style={[styles.input, styles.multiline]} multiline value={reason} onChangeText={setReason} placeholder="Document review decision (8+ characters)" placeholderTextColor={COLORS.muted}/><Text style={styles.label}>Evidence reference</Text><TextInput style={styles.input} value={evidenceRef} onChangeText={setEvidenceRef} placeholder="Merchant/bank record reference" placeholderTextColor={COLORS.muted}/>{claimDecision === 'APPROVE' ? <><Text style={styles.label}>Verified transaction reference</Text><TextInput style={styles.input} value={transactionRef} onChangeText={setTransactionRef} placeholder="Exact transaction reference" placeholderTextColor={COLORS.muted}/><Text style={styles.label}>Verified amount (₹)</Text><TextInput style={styles.input} value={verifiedRupees} onChangeText={setVerifiedRupees} keyboardType="decimal-pad" placeholder="Exact INR amount" placeholderTextColor={COLORS.muted}/>{modal?.type === 'p2p-claim' ? <><Text style={styles.label}>Actual receiver UPI ID from trusted records</Text><TextInput style={styles.input} value={verifiedPayeeVpa} onChangeText={setVerifiedPayeeVpa} placeholder="Receiver VPA" placeholderTextColor={COLORS.muted} autoCapitalize="none"/></> : null}<Pressable style={styles.confirmRow} onPress={() => setReceiverConfirmed(!receiverConfirmed)}><Text style={[styles.confirmBox, receiverConfirmed && styles.checkedBox]}>{receiverConfirmed ? '✓' : ''}</Text><Text style={styles.cardNote}>I independently confirmed receipt to the correct recipient</Text></Pressable></> : null}{claimDecision === 'REJECT' && modal?.type === 'p2p-claim' ? <Pressable style={styles.confirmRow} onPress={() => setPaymentNotReceivedConfirmed(!paymentNotReceivedConfirmed)}><Text style={[styles.confirmBox, paymentNotReceivedConfirmed && styles.checkedBox]}>{paymentNotReceivedConfirmed ? '✓' : ''}</Text><Text style={styles.cardNote}>I checked recipient-side records and confirm no payment was received and no late payment is pending. This releases the reservation.</Text></Pressable> : null}<Button title={busy ? 'Submitting…' : `Submit ${claimDecision.toLowerCase()} decision`} onPress={modal?.type === 'p2p-claim' ? reviewP2pClaim : reviewClaim} disabled={busy}/></> : null}</>}{error ? <Text style={styles.error}>{error}</Text> : null}<Button title="Close" onPress={closeModal} secondary/></ScrollView></View></Modal>
    <Modal visible={Boolean(supportModal)} transparent animationType="slide" onRequestClose={() => setSupportModal(null)}><View style={styles.modalShade}><ScrollView style={styles.modalCard} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled"><Text style={styles.cardEyebrow}>SUPPORT INBOX</Text><Text style={styles.cardTitle}>{supportModal?.subject}</Text><Text style={styles.cardNote}>{supportModal?.user?.displayName || supportModal?.user?.publicId} · {supportModal?.user?.phoneMasked} · {supportModal?.status}</Text>{supportModal?.messages?.map(message => <View key={message.id} style={styles.detailGroup}><Text style={styles.detailSectionTitle}>{message.authorId === profile?.userId ? 'Admin reply' : 'Customer message'} · {new Date(message.createdAt).toLocaleString()}</Text><Text style={styles.detailValue}>{message.message}</Text></View>)}<Text style={styles.label}>Reply (sent as in-app notice)</Text><TextInput style={[styles.input, styles.multiline]} multiline value={supportReply} onChangeText={setSupportReply} placeholder="Write a support reply" placeholderTextColor={COLORS.muted}/><Text style={styles.label}>Audit reason</Text><TextInput style={styles.input} value={supportReason} onChangeText={setSupportReason} placeholder="Reason for reply/status update" placeholderTextColor={COLORS.muted}/><Button title={busy ? 'Sending…' : 'Send reply'} onPress={sendSupportReply} disabled={busy}/><View style={styles.decisionRow}><Button title="Mark in progress" secondary onPress={() => setSupportStatus('IN_PROGRESS')} disabled={busy}/><Button title="Resolve ticket" secondary onPress={() => setSupportStatus('RESOLVED')} disabled={busy}/></View>{error ? <Text style={styles.error}>{error}</Text> : null}<Button title="Close" secondary onPress={() => setSupportModal(null)}/></ScrollView></View></Modal>
    <Modal visible={Boolean(zoomEvidence)} transparent animationType="fade" onRequestClose={() => setZoomEvidence(null)}><Pressable style={styles.zoomShade} onPress={() => setZoomEvidence(null)}><Image source={zoomEvidence || undefined} resizeMode="contain" style={styles.zoomImage}/><Text style={styles.zoomHint}>Tap anywhere to close</Text></Pressable></Modal>
    <Modal visible={Boolean(detailsModal)} transparent animationType="fade" onRequestClose={() => setDetailsModal(null)}><View style={styles.modalShade}><ScrollView style={styles.modalCard} contentContainerStyle={{ paddingBottom: 24 }}><Text style={styles.cardEyebrow}>RECORD DETAILS</Text><Text style={styles.cardTitle}>{detailsModal?.title || 'Details'}</Text><DetailFields value={detailsModal?.record} /><Button title="Close details" onPress={() => setDetailsModal(null)} secondary/></ScrollView></View></Modal>
    </View>;
}
export default function App() { return <SafeAreaProvider><SafeAreaView style={styles.safe}><StatusBar barStyle="dark-content" backgroundColor={COLORS.navy}/><AdminUpdateBanner apiBase={API} currentBuildCode={ADMIN_BUILD_CODE} stagingBuild={IS_STAGING_BUILD}/><AppBody/></SafeAreaView></SafeAreaProvider>; }

function DetailFields({ value, depth = 0 }) {
  if (value == null) return <Text style={styles.cardNote}>No additional details returned by the server.</Text>;
  if (Array.isArray(value)) return value.length ? value.map((item, index) => <View key={index} style={styles.detailGroup}><Text style={styles.detailSectionTitle}>Item {index + 1}</Text><DetailFields value={item} depth={depth + 1}/></View>) : <Text style={styles.cardNote}>None</Text>;
  if (typeof value !== 'object') return <Text style={styles.detailValue}>{String(value)}</Text>;
  const hidden = /password|otp|token|secret|api.?key|phoneE164|evidenceImage|base64|privateKey/i;
  const entries = Object.entries(value).filter(([key]) => !hidden.test(key));
  if (!entries.length) return <Text style={styles.cardNote}>No displayable details.</Text>;
  return <View style={depth ? styles.detailNested : styles.detailList}>{entries.map(([key, item]) => {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase());
    const formatted = /Paise$/i.test(key) && (typeof item === 'number' || typeof item === 'string' && /^\d+$/.test(item)) ? `₹${(Number(item) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
    return <View key={key} style={styles.detailEntry}><Text style={styles.detailLabel}>{label}</Text>{item && typeof item === 'object' ? <DetailFields value={item} depth={depth + 1}/> : <Text selectable style={styles.detailValue}>{formatted ?? (typeof item === 'boolean' ? item ? 'Yes' : 'No' : item == null || item === '' ? '—' : String(item))}</Text>}</View>;
  })}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg }, safe: { flex: 1, backgroundColor: COLORS.bg },
  loginWrap: { flexGrow: 1, justifyContent: 'center', padding: 22, overflow: 'hidden' },
  loginGlow: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: '#EFF6FF', opacity: 0.35, top: -110, right: -100 },
  loginBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 10 },
  brandMark: { width: 66, height: 66, borderRadius: 22, backgroundColor: COLORS.blue, borderWidth: 1, borderColor: '#BFDBFE', alignItems: 'center', justifyContent: 'center', marginBottom: 0, elevation: 12, shadowColor: COLORS.blue, shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  brandP: { color: '#fff', fontWeight: '900', fontSize: 40 }, brandEyebrow: { color: COLORS.cyan, fontSize: 10, letterSpacing: 2, fontWeight: '900', marginBottom: 5 },
  brand: { fontSize: 26, fontWeight: '900', color: COLORS.text, letterSpacing: -0.5 },
  subtitle: { color: COLORS.muted, fontSize: 14, marginTop: 8, marginBottom: 22, lineHeight: 21 },
  loginPanel: { backgroundColor: COLORS.panel, borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, padding: 20, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
  loginPanelHeader: { borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 16, marginBottom: 2 }, loginPanelTitle: { color: COLORS.text, fontSize: 20, fontWeight: '900' }, loginPanelNote: { color: COLORS.muted, fontSize: 12, marginTop: 5, lineHeight: 18 },
  label: { fontWeight: '800', color: COLORS.text, marginBottom: 8, marginTop: 16, fontSize: 13 },
  input: { backgroundColor: '#FFFFFF', borderColor: COLORS.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 15, height: 54, fontSize: 15, color: COLORS.text }, multiline: { height: 90, paddingTop: 14, textAlignVertical: 'top' },
  phoneInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: COLORS.border, borderWidth: 1, borderRadius: 14, minHeight: 54, paddingHorizontal: 14 }, phonePrefix: { color: COLORS.text, fontSize: 15, fontWeight: '800', paddingRight: 12, borderRightWidth: 1, borderRightColor: COLORS.border }, phoneNumberInput: { flex: 1, height: 52, paddingHorizontal: 12, fontSize: 15, color: COLORS.text },
  button: { backgroundColor: COLORS.blue, borderRadius: 15, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 22, paddingHorizontal: 12, elevation: 5, shadowColor: COLORS.blue, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  buttonText: { color: '#fff', fontWeight: '900', fontSize: 15, textAlign: 'center', letterSpacing: 0.2 }, secondaryButton: { backgroundColor: COLORS.panelRaised, borderWidth: 1, borderColor: COLORS.border, elevation: 0 }, secondaryButtonText: { color: COLORS.text }, disabled: { opacity: 0.5 }, pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  footnote: { color: COLORS.muted, fontSize: 11, textAlign: 'center', marginTop: 16, lineHeight: 17 },
  loginLinkButton: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 12 }, loginLink: { color: '#1D4ED8', fontSize: 13, fontWeight: '800' }, loginSuccess: { color: '#047857', backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12, fontSize: 13 },
  loginSecurity: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 }, loginSecurityIcon: { color: COLORS.green, fontSize: 15 }, loginSecurityText: { color: COLORS.muted, fontSize: 11 },
  error: { color: '#B42318', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12, marginBottom: 4, fontSize: 13 },
  top: { backgroundColor: COLORS.navy, paddingHorizontal: 18, paddingTop: 15, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  topBrandRow: { flexDirection: 'row', alignItems: 'center' }, topBrandMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.blue, borderWidth: 1, borderColor: '#BFDBFE', alignItems: 'center', justifyContent: 'center', marginRight: 12, elevation: 6 }, topBrandP: { color: '#fff', fontWeight: '900', fontSize: 26 }, topBrandCopy: { flex: 1 },
  brandSmall: { color: COLORS.cyan, fontSize: 9, letterSpacing: 1.8, fontWeight: '900' }, topTitle: { color: COLORS.text, fontSize: 20, fontWeight: '900', marginTop: 3, letterSpacing: -0.3 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' }, liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green }, liveText: { color: '#047857', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  roleLine: { marginLeft: 54, marginTop: -1 }, role: { color: '#64748B', fontSize: 11, marginTop: 3, textTransform: 'capitalize' },
  session: { paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sessionEyebrow: { color: COLORS.muted, fontSize: 9, letterSpacing: 1.3, fontWeight: '900', marginBottom: 3 }, sessionText: { color: COLORS.text, fontSize: 17, fontWeight: '900' },
  searchPanel: { flexDirection: 'row', gap: 7, paddingHorizontal: 14, paddingBottom: 10, alignItems: 'center' }, searchInput: { flex: 1, minWidth: 0, backgroundColor: COLORS.panel, color: COLORS.text, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, height: 42, fontSize: 11 }, statusInput: { width: 90, backgroundColor: COLORS.panel, color: COLORS.text, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 9, height: 42, fontSize: 10 }, searchButton: { height: 42, borderRadius: 12, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }, searchButtonText: { color: '#1D4ED8', fontSize: 10, fontWeight: '900' }, pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, paddingVertical: 12 }, paginationLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '700', textAlign: 'center', flex: 1 },
  signoutButton: { borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: '#FFFFFF', borderColor: COLORS.border, borderWidth: 1 }, signout: { color: '#DC4242', fontWeight: '800', fontSize: 12 },
  nav: { maxHeight: 54, flexGrow: 0 }, navContent: { paddingHorizontal: 14, gap: 8, alignItems: 'center' }, navItem: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 13, backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border }, navActive: { backgroundColor: '#EFF6FF', borderColor: COLORS.blue }, navText: { color: COLORS.muted, fontWeight: '800', fontSize: 11 }, navTextActive: { color: '#1D4ED8' },
  content: { flex: 1, paddingHorizontal: 15, paddingTop: 14 }, card: { backgroundColor: COLORS.panel, borderRadius: 19, padding: 16, marginBottom: 12, borderColor: COLORS.border, borderWidth: 1, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  cardEyebrow: { color: COLORS.cyan, fontSize: 9, letterSpacing: 1.5, fontWeight: '900', marginBottom: 6 }, cardTitle: { color: COLORS.text, fontWeight: '900', fontSize: 16, textTransform: 'capitalize' }, cardNote: { color: COLORS.muted, fontSize: 12, marginTop: 6, lineHeight: 18 }, metricHint: { color: COLORS.cyan, fontSize: 10, fontWeight: '800', marginTop: 9 }, detailLink: { color: COLORS.cyan, fontSize: 10, fontWeight: '800', marginTop: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metric: { width: '48%', flexGrow: 1, backgroundColor: COLORS.panelRaised, borderRadius: 17, padding: 14, borderColor: COLORS.border, borderWidth: 1, minHeight: 88 }, metricLabel: { color: COLORS.muted, fontSize: 11, textTransform: 'capitalize', fontWeight: '700' }, metricValue: { color: COLORS.text, fontSize: 21, fontWeight: '900', marginTop: 9 },
  chartLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 }, chartRow: { minHeight: 25, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }, chartDate: { color: COLORS.muted, width: 48, fontSize: 9 }, chartTrack: { flex: 1, height: 16, justifyContent: 'center', gap: 2 }, chartDeposit: { height: 6, borderRadius: 5, backgroundColor: COLORS.cyan }, chartWithdraw: { height: 5, borderRadius: 5, backgroundColor: COLORS.gold, opacity: 0.9 }, chartUsers: { color: COLORS.muted, width: 52, fontSize: 9, textAlign: 'right' },
  row: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 10 }, rowTitle: { color: COLORS.text, fontWeight: '800', fontSize: 13 }, rowDetail: { color: COLORS.muted, fontSize: 11, marginTop: 5, lineHeight: 16 },
  detailList: { marginTop: 16, gap: 10 }, detailNested: { marginTop: 7, padding: 10, backgroundColor: '#F7F9FC', borderRadius: 11, borderWidth: 1, borderColor: COLORS.border, gap: 9 }, detailEntry: { paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border }, detailLabel: { color: COLORS.muted, fontSize: 10, textTransform: 'capitalize', fontWeight: '700' }, detailValue: { color: COLORS.text, fontSize: 12, lineHeight: 18, marginTop: 4 }, detailGroup: { marginTop: 12, padding: 12, backgroundColor: '#F7F9FC', borderRadius: 13, borderWidth: 1, borderColor: COLORS.border }, detailSectionTitle: { color: COLORS.cyan, fontSize: 11, fontWeight: '900', marginBottom: 6 },
  smallAction: { alignSelf: 'flex-start', marginTop: 9, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }, smallActionText: { color: '#1D4ED8', fontWeight: '900', fontSize: 11 },
  financialNotice: { backgroundColor: '#FFF7E8', borderColor: '#F0D59A', borderWidth: 1, borderRadius: 13, padding: 14, marginBottom: 12 }, financialNoticeTitle: { color: '#7A4B00', fontWeight: '900', fontSize: 13, marginBottom: 5 }, financialNoticeText: { color: '#765A26', fontSize: 12, lineHeight: 18 },
  unavailable: { color: COLORS.muted, fontSize: 11, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFFFF', borderRadius: 11, borderWidth: 1, borderColor: COLORS.border, marginBottom: 7 },
  securityNote: { color: '#047857', fontSize: 11, backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, padding: 12, borderRadius: 13, marginVertical: 14, lineHeight: 17 },
  errorInline: { color: '#B42318', paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#FEF2F2', marginHorizontal: 14, marginBottom: 5, borderRadius: 12, fontSize: 12 }, successInline: { color: '#047857', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, marginBottom: 12, fontSize: 12 },
  zoomShade: { flex: 1, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center', padding: 12 }, zoomImage: { width: '100%', height: '88%' }, zoomHint: { color: '#FFFFFF', marginTop: 10, fontSize: 12 },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0F172A66' }, modalCard: { maxHeight: '88%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 25, borderWidth: 1, borderColor: COLORS.border }, decisionRow: { flexDirection: 'row', gap: 10 }, evidencePanel: { marginTop: 12, padding: 10, backgroundColor: '#F7F9FC', borderRadius: 13, borderWidth: 1, borderColor: COLORS.border }, claimImage: { width: '100%', height: 220, marginTop: 8, backgroundColor: '#FFFFFF', borderRadius: 9 }, evidenceState: { height: 220, marginTop: 8, borderRadius: 9, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }, evidenceFailure: { minHeight: 120, marginTop: 8, borderRadius: 9, backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, padding: 12, justifyContent: 'center' }, evidenceFailureText: { color: '#B42318', fontSize: 12, lineHeight: 18 }, confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }, confirmBox: { width: 24, height: 24, borderRadius: 7, textAlign: 'center', textAlignVertical: 'center', color: COLORS.muted, overflow: 'hidden', backgroundColor: COLORS.panel, borderColor: COLORS.border, borderWidth: 1 }, checkedBox: { color: '#FFFFFF', backgroundColor: COLORS.green },
});
