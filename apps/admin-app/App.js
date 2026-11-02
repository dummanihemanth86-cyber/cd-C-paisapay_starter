import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import responseHelpers from './responseHelpers.cjs';


const API = (process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/$/, '');
if (!API) throw new Error('PaisaPay Admin API is not configured. Set EXPO_PUBLIC_API_URL for this app build.');
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
const Notifications = IS_EXPO_GO ? null : require('expo-notifications');
if (Notifications) Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
const { asArray, asRecord, ensureApiObject, normalizeListPayload, normalizeP2pPayload, normalizeSupportTicket } = responseHelpers;
const NAV = [
  ['overview', 'Dashboard', '/api/v1/admin/overview'],
  ['users', 'Users', '/api/v1/admin/users'],
  ['deposits', 'Deposits', '/api/v1/admin/deposits'],
  ['withdrawals', 'Withdrawals', '/api/v1/admin/withdrawals'],
  ['p2p', 'Quick Deposit / P2P', '/api/v1/admin/p2p/overview'],
  ['alerts', 'Admin Alerts', '/api/v1/admin/push-events'],
  ['transactions', 'Transactions', '/api/v1/admin/transactions'],
  ['ledger', 'Wallet Ledger', '/api/v1/admin/wallets/ledger'],
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
const UNAVAILABLE = ['KYC Management', 'Bird Assistant Management', 'Joke Management', 'Provider payouts', 'Dispute resolution', 'Admin role changes', 'PDF reports'];
const COLORS = { bg: '#F7F9FC', navy: '#FFFFFF', panel: '#FFFFFF', panelRaised: '#EFF6FF', blue: '#2563EB', cyan: '#2563EB', text: '#17243B', muted: '#64748B', border: '#E5EAF2', danger: '#DC4242', green: '#159B72', gold: '#D99018' };

async function request(path, { token, method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new Error(`Cannot reach PaisaPay API at ${API}. Check server, Wi-Fi and firewall.`); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const backendError = data?.error;
    const fieldErrors = Array.isArray(backendError?.fields)
      ? backendError.fields.map((item) => item?.field && item?.message ? `${item.field}: ${item.message}` : item?.message).filter(Boolean).join(' · ')
      : '';
    const message = backendError?.message || `Request failed (${response.status}).`;
    const code = backendError?.code ? ` [${backendError.code}]` : '';
    throw new Error(`${message}${code}${fieldErrors ? ` ${fieldErrors}` : ''}`);
  }
  return ensureApiObject(data);
}

function Button({ title, onPress, disabled, secondary }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, disabled && styles.disabled, pressed && styles.pressed]}><Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{title}</Text></Pressable>; }
function SecureEvidenceImage({ uri, accessToken, onZoom }) {
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
    fetch(uri, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'image/jpeg, image/png' } })
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
  }, [uri, accessToken, attempt]);
  if (loading) return <View style={styles.evidenceState}><ActivityIndicator color={COLORS.blue}/><Text style={styles.cardNote}>Loading secure payment image…</Text></View>;
  if (failure) return <View style={styles.evidenceFailure}><Text style={styles.evidenceFailureText}>{failure}</Text><Button title="Retry image" secondary onPress={() => setAttempt((value) => value + 1)}/></View>;
  return <Pressable accessibilityRole="button" accessibilityLabel="Zoom payment screenshot" onPress={() => onZoom(sourceUri)}><Image source={{ uri: sourceUri }} resizeMode="contain" style={styles.claimImage} onError={() => { setSourceUri(''); setFailure('The uploaded image could not be rendered on this device.'); }}/></Pressable>;
}
function AppBody() {
  const [phone, setPhone] = useState(''); const [password, setPassword] = useState(''); const [access, setAccess] = useState(''); const [refresh, setRefresh] = useState(''); const [profile, setProfile] = useState(null); const [section, setSection] = useState('overview'); const [payload, setPayload] = useState(null); const [payloadSection, setPayloadSection] = useState(null); const [query, setQuery] = useState(''); const [statusFilter, setStatusFilter] = useState(''); const [busy, setBusy] = useState(false); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState(''); const [info, setInfo] = useState(''); const [modal, setModal] = useState(null); const [detailsModal, setDetailsModal] = useState(null); const [reason, setReason] = useState(''); const [claimDecision, setClaimDecision] = useState(''); const [evidenceRef, setEvidenceRef] = useState(''); const [transactionRef, setTransactionRef] = useState(''); const [verifiedPayeeVpa, setVerifiedPayeeVpa] = useState(''); const [verifiedRupees, setVerifiedRupees] = useState(''); const [receiverConfirmed, setReceiverConfirmed] = useState(false); const [paymentNotReceivedConfirmed, setPaymentNotReceivedConfirmed] = useState(false);
  const busyRef = useRef(busy); busyRef.current = busy;
  const [announcementTitle, setAnnouncementTitle] = useState(''); const [announcementBody, setAnnouncementBody] = useState(''); const [announcementReason, setAnnouncementReason] = useState(''); const [announcementAudience, setAnnouncementAudience] = useState('ALL_ACTIVE'); const [announcementUserIds, setAnnouncementUserIds] = useState(''); const [confirmAll, setConfirmAll] = useState(false); const [rewardDrafts, setRewardDrafts] = useState({}); const [supportModal, setSupportModal] = useState(null); const [supportReply, setSupportReply] = useState(''); const [supportReason, setSupportReason] = useState(''); const [chartRange, setChartRange] = useState('daily'); const [pushSetupStatus, setPushSetupStatus] = useState('Checking device registration…'); const [zoomEvidence, setZoomEvidence] = useState(null);
  const pushTokenRef = useRef(null); const registeredForAccessRef = useRef(null); const pendingPushClaimRef = useRef(null);
  const loadSection = useCallback(async (key, token = access) => {
    const item = NAV.find(x => x[0] === key); if (!item || !token) return;
    setBusy(true); setError('');
    const queryParams = new URLSearchParams();
    if (query.trim() && key !== 'overview' && key !== 'ledger') queryParams.set('q', query.trim());
    if (statusFilter.trim() && key !== 'overview' && key !== 'ledger') queryParams.set('status', statusFilter.trim().toUpperCase());
    if (['users','deposits','withdrawals','transactions','ledger','referrals','commissions','disputes','support','admins','audit'].includes(key)) { queryParams.set('page', '1'); queryParams.set('pageSize', '50'); }
    const suffix = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const fetchSectionPayload = async (activeToken) => {
      if (key === 'p2p') {
        const [offers, orders] = await Promise.all([
          request(`/api/v1/admin/p2p/offers${suffix}`, { token: activeToken }),
          request(`/api/v1/admin/p2p/orders${suffix}`, { token: activeToken }),
        ]);
        let overview = { offers: {}, orders: {}, pendingClaims: 0 };
        if (['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(profile?.role)) overview = await request('/api/v1/admin/p2p/overview', { token: activeToken });
        let claims = { claims: [] };
        if (['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(profile?.role)) {
          try { claims = await request('/api/v1/admin/p2p/claims', { token: activeToken }); }
          catch (claimsError) { if (!/permission|role/i.test(claimsError.message)) throw claimsError; }
        }
        return normalizeP2pPayload(overview, offers, orders, claims);
      }
      if (key === 'reports') {
        const [transactions, deposits, withdrawals, commissions] = await Promise.all([
          request('/api/v1/admin/transactions?page=1&pageSize=100', { token: activeToken }),
          request('/api/v1/admin/deposits?page=1&pageSize=100', { token: activeToken }),
          request('/api/v1/admin/withdrawals?page=1&pageSize=100', { token: activeToken }),
          request('/api/v1/admin/commissions?page=1&pageSize=100', { token: activeToken }),
        ]);
        return { transactions: asArray(transactions.transactions), deposits: asArray(deposits.deposits), withdrawals: asArray(withdrawals.withdrawals), commissions: asArray(commissions.commissions), note: 'First 100 records per dataset. Use the related screens to filter and paginate.' };
      }
      return normalizeListPayload(key, await request(`${item[2]}${suffix}`, { token: activeToken }));
    };
    try {
      setPayload(await fetchSectionPayload(token)); setPayloadSection(key);
    }
    catch (e) {
      if (/session expired|sign in/i.test(e.message) && refresh) {
        try {
          const rotated = await request('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: refresh } });
          await SecureStore.setItemAsync(ACCESS_KEY, rotated.accessToken); await SecureStore.setItemAsync(REFRESH_KEY, rotated.refreshToken);
          setAccess(rotated.accessToken); setRefresh(rotated.refreshToken); setPayload(await fetchSectionPayload(rotated.accessToken)); setPayloadSection(key);
        } catch (refreshError) { await signOut(); setError(refreshError.message); }
      } else setError(e.message);
    } finally { setBusy(false); setRefreshing(false); }
  }, [access, refresh, profile?.role, query, statusFilter]);
  const loadMoreDeposits = async () => {
    const currentDeposits = asArray(payload?.deposits);
    const total = Number.isSafeInteger(Number(payload?.total)) && Number(payload.total) >= 0 ? Number(payload.total) : currentDeposits.length;
    if (!payload || currentDeposits.length >= total || busy) return;
    const nextPage = Number(payload.page || 1) + 1;
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: '50' });
      if (query.trim()) params.set('q', query.trim());
      if (statusFilter.trim()) params.set('status', statusFilter.trim().toUpperCase());
      const result = normalizeListPayload('deposits', await request(`/api/v1/admin/deposits?${params.toString()}`, { token: access }));
      setPayload((current) => ({ ...result, deposits: [...asArray(current?.deposits), ...result.deposits] })); setPayloadSection('deposits');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const signOut = useCallback(async () => { if (access) { if (pushTokenRef.current) { try { await request('/api/v1/admin/push-devices', { token: access, method: 'DELETE', body: { expoPushToken: pushTokenRef.current } }); } catch {} pushTokenRef.current = null; registeredForAccessRef.current = null; } try { await request('/api/v1/auth/logout', { token: access, method: 'POST', body: { refreshToken: refresh } }); } catch {} } await SecureStore.deleteItemAsync(ACCESS_KEY); await SecureStore.deleteItemAsync(REFRESH_KEY); setAccess(''); setRefresh(''); setProfile(null); setPayload(null); setPayloadSection(null); setPassword(''); setPushSetupStatus('Sign in to register this device.'); }, [access, refresh]);
  useEffect(() => { (async () => {
    const storedAccess = await SecureStore.getItemAsync(ACCESS_KEY); const storedRefresh = await SecureStore.getItemAsync(REFRESH_KEY);
    if (!storedAccess || !storedRefresh) return;
    try {
      let activeAccess = storedAccess;
      let me;
      try { me = await request('/api/v1/admin/me', { token: activeAccess }); }
      catch {
        const rotated = await request('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: storedRefresh } });
        activeAccess = rotated.accessToken;
        await SecureStore.setItemAsync(ACCESS_KEY, rotated.accessToken); await SecureStore.setItemAsync(REFRESH_KEY, rotated.refreshToken);
        setRefresh(rotated.refreshToken);
        me = await request('/api/v1/admin/me', { token: activeAccess });
      }
      setAccess(activeAccess); setRefresh((await SecureStore.getItemAsync(REFRESH_KEY)) || storedRefresh); setProfile(me); await loadSection('overview', activeAccess);
    } catch { await SecureStore.deleteItemAsync(ACCESS_KEY); await SecureStore.deleteItemAsync(REFRESH_KEY); }
  })(); }, []);
  const login = async () => {
    setBusy(true); setError('');
    try {
      const normalized = phone.replace(/\D/g, '').slice(-10); if (normalized.length !== 10) throw new Error('Enter a valid 10-digit mobile number.');
      const result = await request('/api/v1/admin/auth/login', { method: 'POST', body: { phoneE164: `+91${normalized}`, password } });
      await SecureStore.setItemAsync(ACCESS_KEY, result.accessToken); await SecureStore.setItemAsync(REFRESH_KEY, result.refreshToken);
      setAccess(result.accessToken); setRefresh(result.refreshToken); setPassword('');
      const me = await request('/api/v1/admin/me', { token: result.accessToken }); setProfile(me); setSection('overview'); await loadSection('overview', result.accessToken);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const openPushClaim = useCallback(async (claimId) => {
    if (!claimId) return;
    if (!access || !profile) { pendingPushClaimRef.current = claimId; setSection('p2p'); return; }
    if (!['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(profile.role)) { setError('This account cannot review payment proofs.'); return; }
    setSection('p2p'); setBusy(true); setError('');
    try {
      let activeToken = access;
      let result;
      try { result = await request(`/api/v1/admin/p2p/claims/${encodeURIComponent(claimId)}`, { token: activeToken }); }
      catch (initialError) {
        if (!refresh || !/session expired|sign in/i.test(initialError.message)) throw initialError;
        const rotated = await request('/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: refresh } });
        activeToken = rotated.accessToken;
        await SecureStore.setItemAsync(ACCESS_KEY, rotated.accessToken); await SecureStore.setItemAsync(REFRESH_KEY, rotated.refreshToken);
        setAccess(rotated.accessToken); setRefresh(rotated.refreshToken);
        result = await request(`/api/v1/admin/p2p/claims/${encodeURIComponent(claimId)}`, { token: activeToken });
      }
      await loadSection('p2p', activeToken);
      const claim = result.claim;
      if (claim.status === 'PENDING_REVIEW') {
        setReason(''); setClaimDecision(''); setEvidenceRef(''); setTransactionRef(claim.transactionReference || '');
        setVerifiedRupees((Number(claim.order?.amountPaise || 0) / 100).toFixed(2)); setVerifiedPayeeVpa(claim.order?.withdrawalOffer?.payeeVpa || '');
        setReceiverConfirmed(false); setPaymentNotReceivedConfirmed(false); setModal({ type: 'p2p-claim', p2pClaim: claim });
      } else setDetailsModal({ title: 'Payment claim already processed', record: claim });
    } catch (e) {
      if (/session expired|sign in/i.test(e.message)) { pendingPushClaimRef.current = claimId; await signOut(); setError('Admin session expired. Sign in again to open this payment verification.'); }
      else setError(e.message);
    }
    finally { setBusy(false); }
  }, [access, refresh, profile, loadSection, signOut]);
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
    try { const result = await request(`/api/v1/admin/support/tickets/${encodeURIComponent(row.id)}`, { token: access }); setSupportModal(normalizeSupportTicket(result.ticket)); setSupportReply(''); setSupportReason(''); }
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
  const sections = useMemo(() => NAV.filter(([key]) => allowed.includes(key)), [allowed]);
  useEffect(() => { if (access && profile) loadSection(section); }, [section, access, profile]);
  useEffect(() => {
    if (!access || !profile || section !== 'p2p') return undefined;
    const timer = setInterval(() => { if (!busyRef.current) void loadSection('p2p'); }, 4000);
    return () => clearInterval(timer);
  }, [section, access, profile, loadSection]);
  if (!access || !profile) return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.loginWrap} keyboardShouldPersistTaps="handled"><View style={styles.loginGlow} /><View style={styles.loginBrandRow}><View style={styles.brandMark}><Text style={styles.brandP}>P</Text></View><View><Text style={styles.brandEyebrow}>PAISAPAY · CONTROL</Text><Text style={styles.brand}>Admin Console</Text></View></View><Text style={styles.subtitle}>Secure access for authorized administrators.</Text><View style={styles.loginPanel}><View style={styles.loginPanelHeader}><Text style={styles.loginPanelTitle}>Welcome back</Text><Text style={styles.loginPanelNote}>Your role and permissions are verified by the server.</Text></View>{error ? <Text style={styles.error}>{error}</Text> : null}<Text style={styles.label}>Mobile number</Text><TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="10-digit mobile number" placeholderTextColor={COLORS.muted} keyboardType="phone-pad" autoComplete="username"/><Text style={styles.label}>Password</Text><TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Administrator password" placeholderTextColor={COLORS.muted} secureTextEntry autoComplete="current-password" onSubmitEditing={login}/><Button title={busy ? 'Signing in…' : 'Sign in securely'} onPress={login} disabled={busy || !phone || !password}/><Text style={styles.footnote}>Admin accounts are provisioned by authorized administrators. The app does not contain default credentials.</Text></View><View style={styles.loginSecurity}><Text style={styles.loginSecurityIcon}>✦</Text><Text style={styles.loginSecurityText}>Protected admin session · encrypted token storage</Text></View></ScrollView></KeyboardAvoidingView>;
  const current = NAV.find(x => x[0] === section);
  // Render only known collection-shaped API fields here. Pagination/config objects are
  // metadata, not rows, and treating them as arrays caused malformed response crashes.
  const rows = payload && typeof payload === 'object' ? Object.entries(payload).filter(([, value]) => Array.isArray(value)) : [];
  const depositRows = asArray(payload?.deposits);
  const depositTotal = Number.isSafeInteger(Number(payload?.total)) && Number(payload.total) >= 0 ? Number(payload.total) : depositRows.length;
  return <View style={styles.flex}><View style={styles.top}><View style={styles.topBrandRow}><View style={styles.topBrandMark}><Text style={styles.topBrandP}>P</Text></View><View style={styles.topBrandCopy}><Text style={styles.brandSmall}>PAISAPAY · ADMIN</Text><Text style={styles.topTitle}>Control Center</Text></View><View style={styles.livePill}><View style={styles.liveDot}/><Text style={styles.liveText}>SECURE</Text></View></View><View style={styles.roleLine}><Text style={styles.role}>{profile.role?.replace(/_/g, ' ')} · Server authorized</Text></View></View><View style={styles.session}><View><Text style={styles.sessionEyebrow}>WORKSPACE</Text><Text style={styles.sessionText}>{current?.[1] || 'Dashboard'}</Text></View><Pressable style={styles.signoutButton} onPress={signOut}><Text style={styles.signout}>Log out</Text></Pressable></View>{error ? <Text style={styles.errorInline}>{error}</Text> : null}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nav} contentContainerStyle={styles.navContent}>{sections.map(([key, title]) => <Pressable key={key} onPress={() => setSection(key)} style={[styles.navItem, section === key && styles.navActive]}><Text style={[styles.navText, section === key && styles.navTextActive]}>{title}</Text></Pressable>)}</ScrollView>
    {section !== 'overview' ? <View style={styles.searchPanel}><TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search ID, reference, name, or phone" placeholderTextColor={COLORS.muted} returnKeyType="search" onSubmitEditing={() => loadSection(section)} /><TextInput style={styles.statusInput} value={statusFilter} onChangeText={setStatusFilter} placeholder="Status filter" placeholderTextColor={COLORS.muted} autoCapitalize="characters" onSubmitEditing={() => loadSection(section)} /><Pressable style={styles.searchButton} onPress={() => loadSection(section)}><Text style={styles.searchButtonText}>Search</Text></Pressable></View> : null}
    <ScrollView style={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadSection(section); }} />}>
      {info ? <Text style={styles.successInline}>{info}</Text> : null}
      {busy ? <ActivityIndicator color={COLORS.blue} size="large" style={{ marginTop: 30 }} /> : null}
      {section === 'overview' && payloadSection === section && payload ? <><View style={styles.card}><Text style={styles.cardEyebrow}>LIVE · DATABASE</Text><Text style={styles.cardTitle}>Operations overview</Text><Text style={styles.cardNote}>Tap a metric to open its related records. Figures come from the PaisaPay backend. Gross transaction volume and ledger balances are separate measures.</Text></View><View style={styles.grid}>{Object.entries(payload.metrics || {}).filter(([, v]) => typeof v === 'number' || typeof v === 'string' || v === null).map(([k, v]) => <Pressable key={k} onPress={() => setSection(k.toLowerCase().includes('deposit') ? 'deposits' : k.toLowerCase().includes('withdraw') ? 'withdrawals' : k.toLowerCase().includes('user') ? 'users' : 'transactions')} style={({ pressed }) => [styles.metric, pressed && styles.pressed]}><Text style={styles.metricLabel}>{k.replace(/([A-Z])/g, ' $1').replace(/Paise$/i, '')}</Text><Text style={styles.metricValue}>{v === null ? 'Not configured' : /Paise$/i.test(k) ? `₹${(Number(v) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : String(v)}</Text><Text style={styles.metricHint}>View records ›</Text></Pressable>)}</View><View style={styles.card}><Text style={styles.cardTitle}>Transaction and registration trends</Text><View style={styles.decisionRow}>{[['daily','7 days'],['weekly','4 weeks'],['monthly','12 months']].map(([key,title]) => <Button key={key} title={chartRange === key ? `✓ ${title}` : title} secondary onPress={() => setChartRange(key)}/>)}</View><View style={styles.chartLegend}><Text style={styles.rowDetail}>● Deposits</Text><Text style={[styles.rowDetail,{color:COLORS.gold}]}>● Withdrawals</Text><Text style={[styles.rowDetail,{color:COLORS.green}]}>● New users</Text></View>{(payload.charts?.[chartRange] || []).map((point, index, list) => { const max = Math.max(1, ...list.map(x => Number(x.depositsPaise) + Number(x.withdrawalsPaise))); const dep = Math.max(4, 92 * Number(point.depositsPaise) / max); const wd = Math.max(4, 92 * Number(point.withdrawalsPaise) / max); const users = Math.min(24, Number(point.registrations) * 3); return <View key={`${point.date}-${index}`} style={styles.chartRow}><Text style={styles.chartDate}>{new Date(point.date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</Text><View style={styles.chartTrack}><View style={[styles.chartDeposit,{width:`${dep}%`}]}/><View style={[styles.chartWithdraw,{width:`${wd}%`}]}/></View><Text style={styles.chartUsers}>{Number(point.registrations)} users</Text></View>; })}</View></> : null}
      {section === 'alerts' && payloadSection === section && payload ? <><View style={styles.card}><Text style={styles.cardEyebrow}>DURABLE IN-APP INBOX</Text><Text style={styles.cardTitle}>Admin payment alerts</Text><Text style={styles.cardNote}>{pushSetupStatus} Push payloads include only a claim ID; latest details are fetched from the authenticated API when opened.</Text></View>{payload.events?.length ? payload.events.map(event => <Pressable key={event.id} style={styles.card} onPress={() => event.claimId ? openPushClaim(event.claimId) : setDetailsModal({ title: event.title, record: event })}><Text style={styles.cardEyebrow}>{String(event.type).replace(/_/g, ' ')}</Text><Text style={styles.cardTitle}>{event.title}</Text><Text style={styles.cardNote}>{event.body}</Text><Text style={styles.rowDetail}>{new Date(event.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · {event.deliveries?.filter(x => x.status === 'ACCEPTED').length || 0} device(s) accepted</Text><Text style={styles.detailLink}>{event.claimId ? 'Open latest verification record ›' : 'View alert ›'}</Text></Pressable>) : <View style={styles.card}><Text style={styles.cardNote}>No admin alerts have been recorded.</Text></View>}</> : null}
      {section === 'deposits' && payloadSection === section && payload ? <><View style={styles.card}><Text style={styles.cardEyebrow}>ALL PUBLIC USERS · SERVER DATA</Text><Text style={styles.cardTitle}>Deposit requests</Text><Text style={styles.cardNote}>Showing {depositRows.length} of {payload.total || 0} deposits across all users. Search by public user ID, deposit ID, provider reference, or merchant reference. Phone numbers are masked.</Text><Text style={styles.cardNote}>Payment screenshots and entered UTRs are supporting claims only. Approve only after independently confirming the receiver-side transaction.</Text></View>{depositRows.length ? depositRows.map((deposit, i) => <View key={deposit.id} style={styles.card}><Pressable onPress={() => setDetailsModal({ title: 'Deposit request', record: deposit })}><Text style={styles.cardEyebrow}>{deposit.user?.displayName || 'PaisaPay user'} · {deposit.user?.publicId || 'ID unavailable'} · {deposit.user?.phoneMasked || ''}</Text><Text style={styles.cardTitle}>₹{(Number(deposit.amountPaise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Text><Text style={styles.rowDetail}>{deposit.status} · {deposit.method} · {new Date(deposit.createdAt).toLocaleString()}</Text><Text style={styles.rowDetail}>Deposit: {deposit.id} · Reference: {deposit.merchantReference || deposit.providerReference || 'Not available'}</Text><Text style={styles.detailLink}>View deposit details ›</Text></Pressable>{deposit.manualPaymentClaim ? <View style={styles.detailGroup}><Text style={styles.detailSectionTitle}>Customer UTR claim · {deposit.manualPaymentClaim.status}</Text><Text style={styles.rowDetail}>UTR: {deposit.manualPaymentClaim.transactionReference} · Evidence: {deposit.manualPaymentClaim.evidenceMimeType ? 'Image attached' : 'No image'}</Text>{deposit.manualPaymentClaim.status === 'PENDING_REVIEW' && ['FINANCE','ADMIN','SUPER_ADMIN'].includes(profile.role) ? <Pressable style={styles.smallAction} onPress={() => { const claim = { ...deposit.manualPaymentClaim, deposit: { id: deposit.id, amountPaise: deposit.amountPaise, currency: deposit.currency, merchantReference: deposit.merchantReference, status: deposit.status }, user: deposit.user }; setReason(''); setClaimDecision(''); setEvidenceRef(''); setTransactionRef(claim.transactionReference || ''); setVerifiedRupees((Number(deposit.amountPaise || 0) / 100).toFixed(2)); setReceiverConfirmed(false); setModal({ type: 'claim', claim, returnSection: 'deposits' }); }}><Text style={styles.smallActionText}>Inspect evidence & review</Text></Pressable> : null}</View> : <Text style={styles.cardNote}>No customer UTR claim attached.</Text>}</View>) : <View style={styles.card}><Text style={styles.cardNote}>No deposits match these filters.</Text></View>}{depositRows.length < depositTotal ? <Button title={busy ? 'Loading…' : `Load more deposits (${depositTotal - depositRows.length} remaining)`} onPress={loadMoreDeposits} disabled={busy}/> : null}</> : null}
      {section === 'p2p' && payloadSection === section && payload ? <>
        <View style={styles.card}>
          <Text style={styles.cardEyebrow}>LIVE · P2P MARKETPLACE</Text>
          <Text style={styles.cardTitle}>Quick Deposit operations</Text>
          <Text style={styles.cardNote}>Orders, withdrawal offers and payment claims returned by the PaisaPay backend. Buyer contact details are masked. Payment evidence is a claim and must be checked against trusted recipient-side records.</Text>
        </View>
        <View style={styles.grid}>
          {[
            ['Open offers', payload.offers?.open ?? payload.offers?.OPEN ?? '—'],
            ['Total offers', payload.offerRecords.length],
            ['Orders loaded', payload.orderRecords.length],
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
        </> : <View style={styles.card}><Text style={styles.cardTitle}>No payment proofs awaiting review</Text><Text style={styles.cardNote}>New submitted claims appear here after the backend saves them.</Text></View>}
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
      </> : null}
      {section !== 'overview' && section !== 'deposits' && section !== 'p2p' && section !== 'reports' && section !== 'alerts' && payloadSection === section && payload ? rows.length ? rows.map(([key, value]) => <View key={key} style={styles.card}><Text style={styles.cardTitle}>{key}</Text>{value.length ? value.slice(0, 30).map((row, i) => <View key={row?.id || row?.referenceId || i} style={styles.row}><Pressable onPress={() => setDetailsModal({ title: key, record: row })}><Text style={styles.rowTitle}>{row?.referenceId || row?.publicId || row?.displayName || row?.id || `Record ${i + 1}`}</Text><Text style={styles.rowDetail}>{row?.status || row?.role || row?.action || JSON.stringify(row).slice(0, 180)}</Text><Text style={styles.detailLink}>Tap to view full details ›</Text></Pressable>{section === 'users' && ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'].includes(profile.role) && row?.id ? <Pressable style={styles.smallAction} onPress={() => { setReason(''); setModal({ type: 'user-status', user: row }); }}><Text style={styles.smallActionText}>{row.status === 'SUSPENDED' ? 'Reactivate account' : 'Suspend account'}</Text></Pressable> : null}{section === 'support' && row?.id ? <Pressable style={styles.smallAction} onPress={() => openSupportTicket(row)}><Text style={styles.smallActionText}>Open & respond</Text></Pressable> : null}{section === 'reconciliation' && row?.id && row.status === 'PENDING_REVIEW' ? <><Text style={styles.cardNote}>Claimed UTR: {row.transactionReference} · Claimed amount: ₹{(row.deposit.amountPaise / 100).toFixed(2)} · {row.user.phoneMasked}</Text><Pressable style={styles.smallAction} onPress={() => { setReason(''); setModal({ type: 'claim', claim: row }); }}><Text style={styles.smallActionText}>Review claim</Text></Pressable></> : null}</View>) : <Text style={styles.cardNote}>No records returned.</Text>}</View>) : <View style={styles.card}><Text style={styles.cardTitle}>Service response</Text><Text style={styles.cardNote}>{JSON.stringify(payload, null, 2).slice(0, 2500)}</Text></View> : null}
      {section === 'notifications' ? <View style={styles.card}><Text style={styles.cardEyebrow}>IN-APP ONLY · AUDITED</Text><Text style={styles.cardTitle}>Create announcement</Text><Text style={styles.cardNote}>This writes an in-app notification to active accounts. It does not send SMS or push notifications. All-active sends require confirmation and every send is audited.</Text><Text style={styles.label}>Title</Text><TextInput style={styles.input} value={announcementTitle} onChangeText={setAnnouncementTitle} maxLength={100} placeholder="Announcement title" placeholderTextColor={COLORS.muted}/><Text style={styles.label}>Message</Text><TextInput style={[styles.input, styles.multiline]} multiline value={announcementBody} onChangeText={setAnnouncementBody} maxLength={1000} placeholder="Message shown in PaisaPay" placeholderTextColor={COLORS.muted}/><View style={styles.decisionRow}><Button title={announcementAudience === 'ALL_ACTIVE' ? '✓ All active' : 'All active'} secondary onPress={() => setAnnouncementAudience('ALL_ACTIVE')}/><Button title={announcementAudience === 'USER_IDS' ? '✓ Selected IDs' : 'Selected IDs'} secondary onPress={() => setAnnouncementAudience('USER_IDS')}/></View>{announcementAudience === 'USER_IDS' ? <><Text style={styles.label}>User UUIDs (comma or newline separated, up to 1,000)</Text><TextInput style={[styles.input, styles.multiline]} multiline value={announcementUserIds} onChangeText={setAnnouncementUserIds} placeholder="Paste UUIDs returned by the admin API" placeholderTextColor={COLORS.muted}/></> : <Pressable style={styles.confirmRow} onPress={() => setConfirmAll(!confirmAll)}><Text style={[styles.confirmBox, confirmAll && styles.checkedBox]}>{confirmAll ? '✓' : ''}</Text><Text style={styles.cardNote}>I confirm this announcement is intended for all active users</Text></Pressable>}<Text style={styles.label}>Audit reason</Text><TextInput style={styles.input} value={announcementReason} onChangeText={setAnnouncementReason} maxLength={500} placeholder="Reason for sending" placeholderTextColor={COLORS.muted}/><Button title={busy ? 'Sending…' : 'Send in-app announcement'} onPress={sendAnnouncement} disabled={busy}/></View> : null}
      {section === 'rewardRules' && payloadSection === section && payload?.rules ? <><View style={styles.card}><Text style={styles.cardEyebrow}>CONFIGURATION ONLY</Text><Text style={styles.cardTitle}>Reward rules</Text><Text style={styles.cardNote}>Editing rules does not create a reward credit. Payout funding is not configured. Only Super Admin can save changes; all changes are audited.</Text></View>{payload.rules.map(rule => { const draft = rewardDrafts[rule.id] || {}; return <View key={rule.id} style={styles.card}><Text style={styles.cardTitle}>{rule.name}</Text><Text style={styles.cardNote}>Status: {rule.enabled ? 'Enabled' : 'Disabled'} · Funding: {rule.fundingSource || 'not configured'}</Text><Text style={styles.label}>Reward amount (₹)</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={draft.amount ?? String((Number(rule.amountPaise) / 100).toFixed(2))} onChangeText={value => setRewardDrafts(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], amount: value } }))}/><Text style={styles.label}>Audit reason</Text><TextInput style={styles.input} value={draft.reason || ''} onChangeText={value => setRewardDrafts(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], reason: value } }))} placeholder="Why is this rule changing?" placeholderTextColor={COLORS.muted}/><Button title={busy ? 'Saving…' : 'Save rule'} onPress={() => updateReward(rule)} disabled={busy}/><DetailFields value={{ eligibility: rule.eligibility, updatedAt: rule.updatedAt }}/></View>; })}</> : null}
      {section === 'reports' && payloadSection === section && payload ? <><View style={styles.card}><Text style={styles.cardEyebrow}>LIVE SERVER DATA</Text><Text style={styles.cardTitle}>CSV exports</Text><Text style={styles.cardNote}>{payload.note} CSV is prepared locally from authenticated API data and opened in the Android share sheet. PDF export is unavailable.</Text></View>{Object.entries(payload).filter(([, data]) => Array.isArray(data)).map(([name, data]) => <View key={name} style={styles.card}><Text style={styles.cardTitle}>{name}</Text><Text style={styles.cardNote}>{data.length} rows loaded</Text><Button title={`Share ${name} CSV`} onPress={() => exportCsv(name, data)} disabled={!data.length}/></View>)}</> : null}
      {section === 'health' && payloadSection === section && payload ? <><View style={styles.card}><Text style={styles.cardEyebrow}>LIVE BACKEND CHECK</Text><Text style={styles.cardTitle}>System health</Text><Text style={styles.cardNote}>Current status returned by the authenticated backend health endpoint.</Text><DetailFields value={payload}/></View><View style={styles.card}><Text style={styles.cardTitle}>Features not available in this backend</Text><Text style={styles.cardNote}>These need additional domain workflows, models or approved service integrations. They are not simulated by the Admin app.</Text>{UNAVAILABLE.map(name => <Text key={name} style={styles.unavailable}>{name} · unavailable</Text>)}</View></> : null}
      <Text style={styles.securityNote}>Financial state changes remain backend controlled. This app has no direct wallet-balance editing action.</Text>
    </ScrollView>
    <Modal visible={Boolean(modal)} transparent animationType="slide" onRequestClose={closeModal}><View style={styles.modalShade}><ScrollView style={styles.modalCard} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled"><Text style={styles.cardTitle}>{modal?.type === 'user-status' ? `${modal.user.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'} account` : modal?.type === 'p2p-claim' ? 'Review P2P payment claim' : 'Review payment claim'}</Text>{modal?.type === 'user-status' ? <><Text style={styles.cardNote}>This action will be recorded in the backend audit log. Do not suspend an account without a documented reason.</Text><TextInput style={[styles.input, styles.multiline]} multiline value={reason} onChangeText={setReason} placeholder="Required reason (at least 8 characters)" placeholderTextColor={COLORS.muted}/><Button title={busy ? 'Saving…' : 'Confirm status change'} onPress={changeUserStatus} disabled={busy}/></> : <><Text style={styles.cardNote}>A submitted reference or screenshot is only a claim. Approve only after independently confirming receiver-side merchant/bank records, exact INR amount, and payee.</Text>{modal?.type === 'p2p-claim' ? <View style={styles.detailGroup}><Text style={styles.detailSectionTitle}>Order & timeline</Text><Text style={styles.rowDetail}>Order ID · {modal.p2pClaim.order?.id || '—'}</Text><Text style={styles.rowDetail}>Order reference · {modal.p2pClaim.order?.referenceId || '—'}</Text><Text style={styles.rowDetail}>Withdrawal offer ID · {modal.p2pClaim.order?.withdrawalOffer?.id || '—'}</Text><Text style={styles.rowDetail}>Matched · {modal.p2pClaim.order?.timestamps?.matchedAt ? new Date(modal.p2pClaim.order.timestamps.matchedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text><Text style={styles.rowDetail}>Payment handoff · {modal.p2pClaim.order?.timestamps?.paymentHandoffInitiatedAt ? new Date(modal.p2pClaim.order.timestamps.paymentHandoffInitiatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text><Text style={styles.rowDetail}>Proof submitted · {modal.p2pClaim.createdAt ? new Date(modal.p2pClaim.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text><Text style={styles.rowDetail}>Expires · {modal.p2pClaim.order?.expiresAt ? new Date(modal.p2pClaim.order.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text><Text style={styles.rowDetail}>Cancellation requested · {modal.p2pClaim.order?.timestamps?.cancellationRequestedAt ? new Date(modal.p2pClaim.order.timestamps.cancellationRequestedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text></View> : null}{modal?.type === 'p2p-claim' && modal.p2pClaim.evidenceAttached ? <View style={styles.evidencePanel}><Text style={styles.detailLabel}>Buyer screenshot · supporting claim only</Text><SecureEvidenceImage uri={`${API}/api/v1/admin/p2p/claims/${encodeURIComponent(modal.p2pClaim.id)}/evidence`} accessToken={access} onZoom={(uri) => setZoomEvidence({ uri })}/><Text style={styles.cardNote}>Review against receiver-side records; screenshot alone is not payment proof.</Text><Text style={styles.cardNote}>Claimed amount: {modal.p2pClaim.claimedAmountPaise == null ? '—' : `₹${(Number(modal.p2pClaim.claimedAmountPaise) / 100).toFixed(2)}`} · Paid at: {modal.p2pClaim.claimedPaidAt ? new Date(modal.p2pClaim.claimedPaidAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'} · Proof submitted: {modal.p2pClaim.createdAt ? new Date(modal.p2pClaim.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text></View> : null}{modal?.type === 'claim' && modal.claim.evidenceMimeType ? <View style={styles.evidencePanel}><Text style={styles.detailLabel}>Customer screenshot · supporting evidence only</Text><SecureEvidenceImage uri={`${API}/api/v1/admin/reconciliation/claims/${encodeURIComponent(modal.claim.id)}/evidence`} accessToken={access} onZoom={(uri) => setZoomEvidence({ uri })}/><Text style={styles.cardNote}>Do not approve from this image alone. Match the transaction against the actual receiver-side records.</Text></View> : null}<View style={styles.decisionRow}><Button title="Approve verified receipt" onPress={() => setClaimDecision('APPROVE')}/><Button title="Reject claim" secondary onPress={() => setClaimDecision('REJECT')}/></View>{claimDecision ? <><Text style={styles.label}>Reason</Text><TextInput style={[styles.input, styles.multiline]} multiline value={reason} onChangeText={setReason} placeholder="Document review decision (8+ characters)" placeholderTextColor={COLORS.muted}/><Text style={styles.label}>Evidence reference</Text><TextInput style={styles.input} value={evidenceRef} onChangeText={setEvidenceRef} placeholder="Merchant/bank record reference" placeholderTextColor={COLORS.muted}/>{claimDecision === 'APPROVE' ? <><Text style={styles.label}>Verified transaction reference</Text><TextInput style={styles.input} value={transactionRef} onChangeText={setTransactionRef} placeholder="Exact transaction reference" placeholderTextColor={COLORS.muted}/><Text style={styles.label}>Verified amount (₹)</Text><TextInput style={styles.input} value={verifiedRupees} onChangeText={setVerifiedRupees} keyboardType="decimal-pad" placeholder="Exact INR amount" placeholderTextColor={COLORS.muted}/>{modal?.type === 'p2p-claim' ? <><Text style={styles.label}>Actual receiver UPI ID from trusted records</Text><TextInput style={styles.input} value={verifiedPayeeVpa} onChangeText={setVerifiedPayeeVpa} placeholder="Receiver VPA" placeholderTextColor={COLORS.muted} autoCapitalize="none"/></> : null}<Pressable style={styles.confirmRow} onPress={() => setReceiverConfirmed(!receiverConfirmed)}><Text style={[styles.confirmBox, receiverConfirmed && styles.checkedBox]}>{receiverConfirmed ? '✓' : ''}</Text><Text style={styles.cardNote}>I independently confirmed receipt to the correct recipient</Text></Pressable></> : null}{claimDecision === 'REJECT' && modal?.type === 'p2p-claim' ? <Pressable style={styles.confirmRow} onPress={() => setPaymentNotReceivedConfirmed(!paymentNotReceivedConfirmed)}><Text style={[styles.confirmBox, paymentNotReceivedConfirmed && styles.checkedBox]}>{paymentNotReceivedConfirmed ? '✓' : ''}</Text><Text style={styles.cardNote}>I checked recipient-side records and confirm no payment was received and no late payment is pending. This releases the reservation.</Text></Pressable> : null}<Button title={busy ? 'Submitting…' : `Submit ${claimDecision.toLowerCase()} decision`} onPress={modal?.type === 'p2p-claim' ? reviewP2pClaim : reviewClaim} disabled={busy}/></> : null}</>}{error ? <Text style={styles.error}>{error}</Text> : null}<Button title="Close" onPress={closeModal} secondary/></ScrollView></View></Modal>
    <Modal visible={Boolean(supportModal)} transparent animationType="slide" onRequestClose={() => setSupportModal(null)}><View style={styles.modalShade}><ScrollView style={styles.modalCard} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled"><Text style={styles.cardEyebrow}>SUPPORT INBOX</Text><Text style={styles.cardTitle}>{supportModal?.subject}</Text><Text style={styles.cardNote}>{supportModal?.user?.displayName || supportModal?.user?.publicId} · {supportModal?.user?.phoneMasked} · {supportModal?.status}</Text>{supportModal?.messages?.map(message => <View key={message.id} style={styles.detailGroup}><Text style={styles.detailSectionTitle}>{message.authorId === profile?.userId ? 'Admin reply' : 'Customer message'} · {new Date(message.createdAt).toLocaleString()}</Text><Text style={styles.detailValue}>{message.message}</Text></View>)}<Text style={styles.label}>Reply (sent as in-app notice)</Text><TextInput style={[styles.input, styles.multiline]} multiline value={supportReply} onChangeText={setSupportReply} placeholder="Write a support reply" placeholderTextColor={COLORS.muted}/><Text style={styles.label}>Audit reason</Text><TextInput style={styles.input} value={supportReason} onChangeText={setSupportReason} placeholder="Reason for reply/status update" placeholderTextColor={COLORS.muted}/><Button title={busy ? 'Sending…' : 'Send reply'} onPress={sendSupportReply} disabled={busy}/><View style={styles.decisionRow}><Button title="Mark in progress" secondary onPress={() => setSupportStatus('IN_PROGRESS')} disabled={busy}/><Button title="Resolve ticket" secondary onPress={() => setSupportStatus('RESOLVED')} disabled={busy}/></View>{error ? <Text style={styles.error}>{error}</Text> : null}<Button title="Close" secondary onPress={() => setSupportModal(null)}/></ScrollView></View></Modal>
    <Modal visible={Boolean(zoomEvidence)} transparent animationType="fade" onRequestClose={() => setZoomEvidence(null)}><Pressable style={styles.zoomShade} onPress={() => setZoomEvidence(null)}><Image source={zoomEvidence || undefined} resizeMode="contain" style={styles.zoomImage}/><Text style={styles.zoomHint}>Tap anywhere to close</Text></Pressable></Modal>
    <Modal visible={Boolean(detailsModal)} transparent animationType="fade" onRequestClose={() => setDetailsModal(null)}><View style={styles.modalShade}><ScrollView style={styles.modalCard} contentContainerStyle={{ paddingBottom: 24 }}><Text style={styles.cardEyebrow}>RECORD DETAILS</Text><Text style={styles.cardTitle}>{detailsModal?.title || 'Details'}</Text><DetailFields value={detailsModal?.record} /><Button title="Close details" onPress={() => setDetailsModal(null)} secondary/></ScrollView></View></Modal>
    </View>;
}
export default function App() { return <SafeAreaProvider><SafeAreaView style={styles.safe}><StatusBar barStyle="dark-content" backgroundColor={COLORS.navy}/><AppBody/></SafeAreaView></SafeAreaProvider>; }

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
  button: { backgroundColor: COLORS.blue, borderRadius: 15, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 22, paddingHorizontal: 12, elevation: 5, shadowColor: COLORS.blue, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  buttonText: { color: '#fff', fontWeight: '900', fontSize: 15, textAlign: 'center', letterSpacing: 0.2 }, secondaryButton: { backgroundColor: COLORS.panelRaised, borderWidth: 1, borderColor: COLORS.border, elevation: 0 }, secondaryButtonText: { color: COLORS.text }, disabled: { opacity: 0.5 }, pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  footnote: { color: COLORS.muted, fontSize: 11, textAlign: 'center', marginTop: 16, lineHeight: 17 },
  loginSecurity: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 }, loginSecurityIcon: { color: COLORS.green, fontSize: 15 }, loginSecurityText: { color: COLORS.muted, fontSize: 11 },
  error: { color: '#B42318', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12, marginBottom: 4, fontSize: 13 },
  top: { backgroundColor: COLORS.navy, paddingHorizontal: 18, paddingTop: 15, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  topBrandRow: { flexDirection: 'row', alignItems: 'center' }, topBrandMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.blue, borderWidth: 1, borderColor: '#BFDBFE', alignItems: 'center', justifyContent: 'center', marginRight: 12, elevation: 6 }, topBrandP: { color: '#fff', fontWeight: '900', fontSize: 26 }, topBrandCopy: { flex: 1 },
  brandSmall: { color: COLORS.cyan, fontSize: 9, letterSpacing: 1.8, fontWeight: '900' }, topTitle: { color: COLORS.text, fontSize: 20, fontWeight: '900', marginTop: 3, letterSpacing: -0.3 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' }, liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green }, liveText: { color: '#047857', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  roleLine: { marginLeft: 54, marginTop: -1 }, role: { color: '#64748B', fontSize: 11, marginTop: 3, textTransform: 'capitalize' },
  session: { paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sessionEyebrow: { color: COLORS.muted, fontSize: 9, letterSpacing: 1.3, fontWeight: '900', marginBottom: 3 }, sessionText: { color: COLORS.text, fontSize: 17, fontWeight: '900' },
  searchPanel: { flexDirection: 'row', gap: 7, paddingHorizontal: 14, paddingBottom: 10, alignItems: 'center' }, searchInput: { flex: 1, minWidth: 0, backgroundColor: COLORS.panel, color: COLORS.text, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, height: 42, fontSize: 11 }, statusInput: { width: 90, backgroundColor: COLORS.panel, color: COLORS.text, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 9, height: 42, fontSize: 10 }, searchButton: { height: 42, borderRadius: 12, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }, searchButtonText: { color: '#1D4ED8', fontSize: 10, fontWeight: '900' },
  signoutButton: { borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: '#FFFFFF', borderColor: COLORS.border, borderWidth: 1 }, signout: { color: '#DC4242', fontWeight: '800', fontSize: 12 },
  nav: { maxHeight: 54, flexGrow: 0 }, navContent: { paddingHorizontal: 14, gap: 8, alignItems: 'center' }, navItem: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 13, backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border }, navActive: { backgroundColor: '#EFF6FF', borderColor: COLORS.blue }, navText: { color: COLORS.muted, fontWeight: '800', fontSize: 11 }, navTextActive: { color: '#1D4ED8' },
  content: { flex: 1, paddingHorizontal: 15, paddingTop: 14 }, card: { backgroundColor: COLORS.panel, borderRadius: 19, padding: 16, marginBottom: 12, borderColor: COLORS.border, borderWidth: 1, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  cardEyebrow: { color: COLORS.cyan, fontSize: 9, letterSpacing: 1.5, fontWeight: '900', marginBottom: 6 }, cardTitle: { color: COLORS.text, fontWeight: '900', fontSize: 16, textTransform: 'capitalize' }, cardNote: { color: COLORS.muted, fontSize: 12, marginTop: 6, lineHeight: 18 }, metricHint: { color: COLORS.cyan, fontSize: 10, fontWeight: '800', marginTop: 9 }, detailLink: { color: COLORS.cyan, fontSize: 10, fontWeight: '800', marginTop: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metric: { width: '48%', flexGrow: 1, backgroundColor: COLORS.panelRaised, borderRadius: 17, padding: 14, borderColor: COLORS.border, borderWidth: 1, minHeight: 88 }, metricLabel: { color: COLORS.muted, fontSize: 11, textTransform: 'capitalize', fontWeight: '700' }, metricValue: { color: COLORS.text, fontSize: 21, fontWeight: '900', marginTop: 9 },
  chartLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 }, chartRow: { minHeight: 25, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }, chartDate: { color: COLORS.muted, width: 48, fontSize: 9 }, chartTrack: { flex: 1, height: 16, justifyContent: 'center', gap: 2 }, chartDeposit: { height: 6, borderRadius: 5, backgroundColor: COLORS.cyan }, chartWithdraw: { height: 5, borderRadius: 5, backgroundColor: COLORS.gold, opacity: 0.9 }, chartUsers: { color: COLORS.muted, width: 52, fontSize: 9, textAlign: 'right' },
  row: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 10 }, rowTitle: { color: COLORS.text, fontWeight: '800', fontSize: 13 }, rowDetail: { color: COLORS.muted, fontSize: 11, marginTop: 5, lineHeight: 16 },
  detailList: { marginTop: 16, gap: 10 }, detailNested: { marginTop: 7, padding: 10, backgroundColor: '#F7F9FC', borderRadius: 11, borderWidth: 1, borderColor: COLORS.border, gap: 9 }, detailEntry: { paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border }, detailLabel: { color: COLORS.muted, fontSize: 10, textTransform: 'capitalize', fontWeight: '700' }, detailValue: { color: COLORS.text, fontSize: 12, lineHeight: 18, marginTop: 4 }, detailGroup: { marginTop: 12, padding: 12, backgroundColor: '#F7F9FC', borderRadius: 13, borderWidth: 1, borderColor: COLORS.border }, detailSectionTitle: { color: COLORS.cyan, fontSize: 11, fontWeight: '900', marginBottom: 6 },
  smallAction: { alignSelf: 'flex-start', marginTop: 9, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }, smallActionText: { color: '#1D4ED8', fontWeight: '900', fontSize: 11 },
  unavailable: { color: COLORS.muted, fontSize: 11, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFFFF', borderRadius: 11, borderWidth: 1, borderColor: COLORS.border, marginBottom: 7 },
  securityNote: { color: '#047857', fontSize: 11, backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, padding: 12, borderRadius: 13, marginVertical: 14, lineHeight: 17 },
  errorInline: { color: '#B42318', paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#FEF2F2', marginHorizontal: 14, marginBottom: 5, borderRadius: 12, fontSize: 12 }, successInline: { color: '#047857', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, marginBottom: 12, fontSize: 12 },
  zoomShade: { flex: 1, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center', padding: 12 }, zoomImage: { width: '100%', height: '88%' }, zoomHint: { color: '#FFFFFF', marginTop: 10, fontSize: 12 },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0F172A66' }, modalCard: { maxHeight: '88%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 25, borderWidth: 1, borderColor: COLORS.border }, decisionRow: { flexDirection: 'row', gap: 10 }, evidencePanel: { marginTop: 12, padding: 10, backgroundColor: '#F7F9FC', borderRadius: 13, borderWidth: 1, borderColor: COLORS.border }, claimImage: { width: '100%', height: 220, marginTop: 8, backgroundColor: '#FFFFFF', borderRadius: 9 }, evidenceState: { height: 220, marginTop: 8, borderRadius: 9, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }, evidenceFailure: { minHeight: 120, marginTop: 8, borderRadius: 9, backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, padding: 12, justifyContent: 'center' }, evidenceFailureText: { color: '#B42318', fontSize: 12, lineHeight: 18 }, confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }, confirmBox: { width: 24, height: 24, borderRadius: 7, textAlign: 'center', textAlignVertical: 'center', color: COLORS.muted, overflow: 'hidden', backgroundColor: COLORS.panel, borderColor: COLORS.border, borderWidth: 1 }, checkedBox: { color: '#FFFFFF', backgroundColor: COLORS.green },
});
