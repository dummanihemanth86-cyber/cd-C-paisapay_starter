import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { apiGet, apiPost } from './api';

const depositPromo = require('../assets/paisapay-deposit-promo.png');

const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const key = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const localDateTimeInput = (date) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default function DepositScreen({ amount, setAmount, create, go, balance, config, working, colors, note, upiProfile, refresh, onAssistantEvent, financialOperationsEnabled, financialOperationsReason }) {
  const entrance = useRef(new Animated.Value(0)).current;
  const [myOrders, setMyOrders] = useState([]);
  const [order, setOrder] = useState(null);
  const [receiptVisible, setReceiptVisible] = useState(false);
  const [supportFollowUp, setSupportFollowUp] = useState(null);
  const [payeeVpa, setPayeeVpa] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [ref, setRef] = useState('');
  const [claimedRupees, setClaimedRupees] = useState('');
  const [claimedPaidAt, setClaimedPaidAt] = useState(() => localDateTimeInput(new Date()));
  const [proofImage, setProofImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchSeconds, setMatchSeconds] = useState(7);
  const [matchAmountPaise, setMatchAmountPaise] = useState(0);
  const [standardOpen, setStandardOpen] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [matchedNoticeOrderId, setMatchedNoticeOrderId] = useState(null);
  const scrollRef = useRef(null);
  const orderDetailsY = useRef(0);
  const matchSuccessOpacity = useRef(new Animated.Value(1)).current;
  const notificationOrderStatuses = useRef(new Map());
  const proofOrderId = useRef(null);
  const financialActionsDisabled = financialOperationsEnabled !== true;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 360, useNativeDriver: true }).start();
    return () => entrance.stopAnimation();
  }, [entrance]);
  useEffect(() => { const timer = setInterval(() => setClockNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!matchedNoticeOrderId) return undefined;
    matchSuccessOpacity.setValue(1);
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(matchSuccessOpacity, { toValue: 0.25, duration: 320, useNativeDriver: true }),
      Animated.timing(matchSuccessOpacity, { toValue: 1, duration: 320, useNativeDriver: true }),
    ]), { iterations: 5 });
    pulse.start();
    const scrollTimer = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, orderDetailsY.current - 18), animated: true }), 120);
    const noticeTimer = setTimeout(() => setMatchedNoticeOrderId(null), 3200);
    return () => { pulse.stop(); clearTimeout(scrollTimer); clearTimeout(noticeTimer); };
  }, [matchedNoticeOrderId, matchSuccessOpacity]);
  useEffect(() => {
    if (proofOrderId.current !== order?.id) {
      proofOrderId.current = order?.id ?? null;
      setRef(''); setClaimedRupees(''); setClaimedPaidAt(localDateTimeInput(new Date())); setProofImage(null);
    }
    if (['CANCELLED', 'COMPLETED', 'EXPIRED'].includes(order?.status)) { setPayeeVpa(''); setPayeeName(''); }
  }, [order?.id, order?.status]);
  const loadMyOrders = useCallback(async ({ quiet = false } = {}) => {
    if (financialActionsDisabled) return;
    try {
      const response = await apiGet('/api/v1/deposits/orders/my');
      if (response.serverTime) setServerClockOffsetMs(Date.parse(response.serverTime) - Date.now());
      const orders = response.orders || [];
      const buyerOrders = orders.filter((item) => item.viewerRole === 'BUYER');
      setMyOrders(buyerOrders);
      const latestSupportOrder = buyerOrders.find((item) => item.status === 'REJECTED' && item.claims?.some((claim) => claim.status === 'REJECTED'))
        || buyerOrders.find((item) => ['CANCELLED_PAYMENT_HOLD', 'PAYMENT_EXPIRED_REVIEW', 'DISPUTED'].includes(item.status));
      if (latestSupportOrder) {
        const rejectedClaim = latestSupportOrder.claims?.find((claim) => claim.status === 'REJECTED');
        setSupportFollowUp((current) => current || {
          orderId: latestSupportOrder.id,
          referenceId: latestSupportOrder.referenceId,
          reason: rejectedClaim?.reviewReason || 'The payment outcome is uncertain. Do not pay again while this order is being resolved.',
          kind: rejectedClaim ? 'rejection' : 'payment-uncertain',
        });
      }
      setOrder((current) => {
        if (!current) return current;
        const latest = buyerOrders.find((item) => item.id === current.id);
        // Once an order is cancelled, expired, or awaiting Finance resolution, close it
        // out of the active Deposit view. The backend still retains the order and hold.
        if (latest && ['CANCELLED', 'CANCELLED_PAYMENT_HOLD', 'DISPUTED', 'EXPIRED', 'PAYMENT_EXPIRED_REVIEW', 'REJECTED'].includes(latest.status)) return null;
        return latest ? { ...current, ...latest, reward: latest.reward || current.reward } : current;
      });
    }
    catch (e) { if (!quiet) note?.('Could not load deposit orders', e.message); }
  }, [financialActionsDisabled]);
  const needsQuickStatusRefresh = myOrders.some((item) => ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'PAYMENT_EXPIRED_REVIEW', 'CANCELLED_PAYMENT_HOLD', 'DISPUTED'].includes(item.status) || item.claims?.some((claim) => claim.status === 'PENDING_REVIEW'));
  // Keep closed/cancel-requested/payment-review orders out of the active Deposit list.
  // They remain on the backend for Finance review and continue to hold seller funds if payment is uncertain.
  const visibleQuickDepositOrders = myOrders.filter((item) => ['MATCHED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'COMPLETED'].includes(item.status));
  useEffect(() => {
    if (financialActionsDisabled) return undefined;
    void loadMyOrders();
    const timer = setInterval(() => { void loadMyOrders({ quiet: true }); }, needsQuickStatusRefresh ? 2000 : 12000);
    return () => clearInterval(timer);
  }, [financialActionsDisabled, loadMyOrders, needsQuickStatusRefresh]);
  useEffect(() => {
    const previous = notificationOrderStatuses.current;
    let terminalUpdate = false;
    for (const item of myOrders) {
      const old = previous.get(item.id);
      if (old && old.status !== item.status && item.status === 'COMPLETED') {
        const rewardPaise = Number(item.reward?.creditedPaise || 0);
        note?.('Congratulations! Your deposit was successful.', `${money(item.amountPaise)} deposit${rewardPaise ? ` + ${money(rewardPaise)} reward = ${money(Number(item.amountPaise) + rewardPaise)} credited.` : ' credited.'} Open the completed order for its receipt.`);
        onAssistantEvent?.('order_success');
        terminalUpdate = true;
      } else if (old && old.status !== item.status && ['REJECTED', 'CANCELLED'].includes(item.status) && item.claims?.some((claim) => claim.status === 'REJECTED')) {
        const reason = item.claims.find((claim) => claim.status === 'REJECTED')?.reviewReason;
        note?.('Your deposit was rejected', `${reason || 'Finance could not verify the payment claim.'} No wallet credit was made. Contact PaisaPay support if you believe this decision is incorrect.`);
        onAssistantEvent?.('order_rejected');
        setSupportFollowUp({ orderId: item.id, referenceId: item.referenceId, reason: reason || 'Finance could not verify the payment claim.', kind: 'rejection' });
        terminalUpdate = true;
      } else if (old && old.status !== item.status && ['CANCELLED_PAYMENT_HOLD', 'PAYMENT_EXPIRED_REVIEW', 'DISPUTED'].includes(item.status)) {
        setSupportFollowUp({ orderId: item.id, referenceId: item.referenceId, reason: 'The payment outcome is uncertain. Do not pay again while the seller allocation is held for Finance review.', kind: 'payment-uncertain' });
      }
    }
    notificationOrderStatuses.current = new Map(myOrders.map((item) => [item.id, { status: item.status }]));
    if (terminalUpdate) void refresh?.();
  }, [myOrders, note, refresh, onAssistantEvent]);

  const match = async (offerId, selectedAmount = amount, excludeOfferId) => {
    if (financialActionsDisabled) return note?.('Financial actions unavailable', 'The server has disabled deposits and P2P matching. No order was created.');
    const n = Number(selectedAmount);
    if (!Number.isSafeInteger(n) || n < 100 || n % 100 !== 0) return note?.('Check amount', 'Enter a whole amount divisible by ₹100.');
    setLoading(true);
    setMatching(true);
    setMatchSeconds(7);
    setMatchAmountPaise(n * 100);
    const deadline = Date.now() + 7_000;
    const idempotencyKey = key('p2p-match');
    let lastConnectionError = null;
    let retryDelayMs = 300;
    const ticker = setInterval(() => setMatchSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 200);
    try {
      while (Date.now() < deadline) {
        const remainingMs = deadline - Date.now();
        try {
          const result = await apiPost('/api/v1/deposits/quick-match', { amountPaise: n * 100, ...(offerId ? { withdrawalOfferId: offerId } : {}), ...(excludeOfferId ? { excludeWithdrawalOfferId: excludeOfferId } : {}) }, idempotencyKey, { timeoutMs: Math.max(500, Math.min(1500, remainingMs)), transientRetries: 0 });
          if (result.serverTime) setServerClockOffsetMs(Date.parse(result.serverTime) - Date.now());
          setOrder({ ...result.order, withdrawalOffer: result.withdrawalOffer, reward: result.reward }); setMatchedNoticeOrderId(result.order?.id || null); setPayeeVpa(''); setPayeeName('');
          void loadMyOrders();
          return;
        } catch (e) {
          if (e.code === 'NO_MATCHING_WITHDRAWAL_OFFERS') lastConnectionError = null;
          else if (e.code === 'FINANCIAL_OPERATIONS_DISABLED' || e.code === 'DEPOSIT_RECEIVER_NOT_CONFIGURED') { note?.('Financial actions unavailable', e.message); return; }
          else if (e.status && e.status < 500) { note?.('Could not match', e.message); return; }
          else lastConnectionError = e;
        }
        const pause = Math.min(retryDelayMs, Math.max(0, deadline - Date.now()));
        if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
        retryDelayMs = Math.min(1200, retryDelayMs * 2);
      }
      if (lastConnectionError) {
        note?.('Could not check for a match', 'Check your connection and your order list before retrying. No payment was started.');
      } else {
        note?.('No match found yet', 'No matching withdrawal offer was found within 7 seconds. No payment was started and no order was created. Please try again later.');
      }
    } finally { clearInterval(ticker); setMatching(false); setLoading(false); }
  };
  const confirm = async () => {
    if (financialActionsDisabled) { note?.('Financial actions unavailable', 'The server has disabled payment actions. No payment handoff was started.'); return null; }
    setLoading(true);
    try { const result = await apiPost(`/api/v1/deposits/orders/${encodeURIComponent(order.id)}/confirm`, {}); if (result.serverTime) setServerClockOffsetMs(Date.parse(result.serverTime) - Date.now()); setOrder({ ...order, ...result.order }); setPayeeVpa(result.paymentDetails.payeeVpa); setPayeeName(result.paymentDetails.payeeName); void loadMyOrders(); return result; }
    catch (e) { note?.('Could not confirm order', e.message); return null; }
    finally { setLoading(false); }
  };
  const cancelOrder = async (orderId = order?.id) => {
    if (!orderId) return;
    if (financialActionsDisabled) return note?.('Financial actions unavailable', 'The server has disabled order changes. No cancellation was submitted.');
    setLoading(true);
    try {
      const result = await apiPost(`/api/v1/deposits/orders/${encodeURIComponent(orderId)}/cancel`, {});
      setOrder((current) => current?.id === orderId ? (['CANCELLED', 'CANCELLED_PAYMENT_HOLD', 'DISPUTED'].includes(result.order?.status) ? null : { ...current, ...result.order }) : current);
      setPayeeVpa(''); setPayeeName(''); await loadMyOrders();
      const heldForSettlement = result.order?.holdForSettlement || result.order?.status === 'CANCELLED_PAYMENT_HOLD';
      const paymentClaimPending = result.order?.status === 'DISPUTED';
      if (heldForSettlement || paymentClaimPending) setSupportFollowUp({ orderId, referenceId: result.order?.referenceId || order?.referenceId, reason: 'This order was closed from the active Deposit view, but its payment outcome is unresolved. Do not pay again.', kind: 'payment-uncertain' });
      if (!heldForSettlement && !paymentClaimPending && result.order?.status === 'CANCELLED') onAssistantEvent?.('order_cancelled');
      note?.(heldForSettlement || paymentClaimPending ? 'Cancellation requested' : 'Order cancelled', paymentClaimPending ? 'The payment proof is still under Finance review. This order is removed from active deposits; the seller amount stays held until Finance resolves whether payment was received.' : heldForSettlement ? 'The UPI app may have sent payment. This order is removed from active deposits, but the seller amount stays held until its payment outcome is resolved.' : 'No payment handoff was recorded. The amount is available for another match.');
    } catch (e) { note?.('Could not cancel order', e.message); }
    finally { setLoading(false); }
  };
  const openUpiPayment = async (targetVpa, targetName, targetOrder) => {
    const uri = `upi://pay?${[
      ['pa', targetVpa], ['pn', targetName || 'UPI account'], ['am', (Number(targetOrder.amountPaise) / 100).toFixed(2)], ['cu', 'INR'], ['tn', targetOrder.referenceId],
    ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
    try {
      await Linking.openURL(uri);
      setOrder((current) => current?.id === targetOrder.id ? { ...current, paymentAppOpened: true } : current);
      try { await apiPost(`/api/v1/deposits/orders/${encodeURIComponent(targetOrder.id)}/handoff-attempt`, { outcome: 'OPENED' }); }
      catch { note?.('Payment app opened', 'The handoff could not be logged because the network is unavailable. Payment is still unverified; check the order status after returning.'); }
      note?.('Complete payment in your UPI app', 'PaisaPay is waiting for a status update. Returning from the UPI app is not payment confirmation.');
    }
    catch {
      try { await apiPost(`/api/v1/deposits/orders/${encodeURIComponent(targetOrder.id)}/handoff-attempt`, { outcome: 'UNAVAILABLE' }); } catch { /* best-effort audit event */ }
      note?.('UPI app unavailable', 'No UPI app could open this payment. The order remains pending because seller details were already shown; cancel only if you did not pay.');
    }
  };
  const payNow = async () => {
    if (payeeVpa) return openUpiPayment(payeeVpa, payeeName, order);
    if (order?.status === 'MATCHED') {
      const result = await confirm();
      if (result?.paymentDetails?.payeeVpa) return openUpiPayment(result.paymentDetails.payeeVpa, result.paymentDetails.payeeName, { ...order, ...result.order });
    }
  };
  const submitReference = async () => {
    if (financialActionsDisabled) return note?.('Financial actions unavailable', 'The server has disabled payment proof submission. No payment information was submitted.');
    if (ref.trim().length < 4) return note?.('Enter transaction reference', 'Enter the UTR / transaction reference from your payment app before submitting proof.');
    const match = claimedRupees.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    const claimedAmountPaise = match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : 0;
    const paidAt = new Date(claimedPaidAt.trim().replace(' ', 'T'));
    if (!proofImage?.base64) return note?.('Add payment screenshot', 'Choose the payment screenshot so Finance can review the claim.');
    if (!Number.isSafeInteger(claimedAmountPaise) || claimedAmountPaise <= 0) return note?.('Enter payment amount', 'Enter the amount shown in your payment app. Finance will compare it with the order.');
    if (!claimedPaidAt.trim() || Number.isNaN(paidAt.getTime())) return note?.('Enter payment time', 'Use YYYY-MM-DD HH:mm format for the payment time.');
    setLoading(true);
    try {
      const result = await apiPost(`/api/v1/deposits/orders/${encodeURIComponent(order.id)}/payment-reference`, {
        ...(ref.trim() ? { transactionReference: ref.trim() } : {}), evidenceImageBase64: proofImage.base64, evidenceMimeType: proofImage.mimeType,
        claimedAmountPaise, claimedPaidAt: paidAt.toISOString(),
      });
      setOrder({ ...order, ...result.order, claims: [result.claim] }); setRef(''); setProofImage(null); note?.('Payment submitted', result.message); await loadMyOrders(); await refresh?.();
    } catch (e) { note?.('Payment proof not submitted', e.message); }
    finally { setLoading(false); }
  };
  const selectPaymentScreenshot = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return note?.('Photo access needed', 'Allow photo access to attach your payment screenshot.');
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8 });
      if (picked.canceled || !picked.assets?.[0]?.uri) return;
      const compressed = await ImageManipulator.manipulateAsync(picked.assets[0].uri, [{ resize: { width: 1280 } }], { compress: 0.68, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!compressed.base64 || compressed.base64.length > 1_900_000) return note?.('Screenshot too large', 'Choose a smaller image and try again.');
      setProofImage({ uri: compressed.uri, base64: compressed.base64, mimeType: 'image/jpeg' });
    } catch (e) { note?.('Could not select screenshot', e.message || 'Choose a JPG or PNG image and retry.'); }
  };

  const presets = [100, 200, 500, 1000];
  const amountRupees = Number(amount);
  const amountIsValid = Number.isSafeInteger(amountRupees) && amountRupees >= 100 && amountRupees % 100 === 0;
  const amountPaise = amountIsValid ? amountRupees * 100 : 0;
  const amountEntered = String(amount || '').trim().length > 0;
  const amountIncrementInvalid = amountEntered && (!Number.isSafeInteger(amountRupees) || amountRupees % 100 !== 0 || amountRupees < 100);
  const minDepositPaise = Number(config?.minAmountPaise || 0);
  const maxDepositPaise = Math.min(Number(config?.maxAmountPaise || 1_000_000), 1_000_000);
  const quickAmountValid = amountIsValid && amountPaise <= maxDepositPaise;
  const standardAmountValid = quickAmountValid && amountPaise >= minDepositPaise;
  const amountAboveMax = amountEntered && Number.isSafeInteger(amountRupees) && amountRupees * 100 > maxDepositPaise;
  const amountBelowMin = amountEntered && amountIsValid && amountPaise < minDepositPaise;
  const amountInvalid = amountIncrementInvalid || amountAboveMax || amountBelowMin;
  const amountError = amountAboveMax ? 'Maximum deposit is ₹10,000.' : amountBelowMin ? `Minimum deposit is ${money(minDepositPaise)}.` : 'Enter an amount in ₹100 multiples, such as ₹100, ₹200, or ₹500.';
  const showDepositError = () => note?.('Invalid deposit amount', amountError);
  const createStandardDeposit = () => {
    if (financialActionsDisabled) return note?.('Financial actions unavailable', 'The server has disabled deposits. No deposit was created.');
    if (!standardAmountValid) return showDepositError();
    if (!config?.receiverVpa) return note?.('UPI recipient unavailable', 'PaisaPay has not configured a payment recipient. No deposit was created.');
    return create();
  };
  const errorColor = colors.red || '#EF4444';
  const rewardEstimatePaise = Math.floor(amountPaise * 0.06);
  const authoritativeNow = clockNow + serverClockOffsetMs;
  const orderSecondsLeft = order?.expiresAt ? Math.max(0, Math.ceil((new Date(order.expiresAt).getTime() - authoritativeNow) / 1000)) : null;
  const orderTimeLabel = orderSecondsLeft == null ? null : `${String(Math.floor(orderSecondsLeft / 60)).padStart(2, '0')}:${String(orderSecondsLeft % 60).padStart(2, '0')}`;
  const formatTimestamp = (value) => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not recorded';
  const timeline = order ? [
    ['Order created', order.timestamps?.orderCreatedAt || order.createdAt],
    ['Matched', order.timestamps?.matchedAt || order.createdAt],
    ['Payment details viewed', order.timestamps?.paymentDetailsViewedAt || order.paymentDetailsShownAt],
    ['Pay Now clicked', order.timestamps?.payNowClickedAt],
    ['Payment handoff reported', order.timestamps?.paymentHandoffInitiatedAt || order.paymentHandoffStartedAt],
    ['Expiry deadline', order.timestamps?.expiresAt || order.expiresAt],
    ['Cancellation requested', order.timestamps?.cancellationRequestedAt],
    ['Reservation released', order.timestamps?.reservationReleasedAt],
    ['Payment verified', order.timestamps?.paymentVerifiedAt],
    ['Finance resolved', order.timestamps?.financeResolvedAt],
  ] : [];
  const renderPaymentProofForm = () => <View style={[styles.proofCard, { borderColor: colors.line, backgroundColor: colors.bg }]}>
    <Text style={[styles.cardTitle, { color: colors.ink }]}>Submit payment proof</Text>
    <Text style={[styles.caption, { color: colors.muted }]}>Enter the UTR and upload your screenshot. Both are claims for Finance review and do not credit your wallet.</Text>
    <TextInput accessibilityLabel="UPI transaction reference" value={ref} onChangeText={setRef} placeholder="UTR / transaction reference (required)" placeholderTextColor={colors.muted} style={[styles.reference, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface }]} />
    <TextInput accessibilityLabel="Claimed payment amount in rupees" value={claimedRupees} onChangeText={setClaimedRupees} keyboardType="decimal-pad" placeholder="Amount paid (₹)" placeholderTextColor={colors.muted} style={[styles.reference, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface }]} />
    <TextInput accessibilityLabel="Payment time" value={claimedPaidAt} onChangeText={setClaimedPaidAt} placeholder="YYYY-MM-DD HH:mm (local time)" placeholderTextColor={colors.muted} style={[styles.reference, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface }]} />
    <TouchableOpacity disabled={loading || financialActionsDisabled} onPress={selectPaymentScreenshot} style={[styles.secondaryButton, { borderColor: colors.line, opacity: financialActionsDisabled ? 0.55 : 1 }]}><Text style={{ color: colors.cyan, fontWeight: '900' }}>{proofImage ? 'Change payment screenshot' : 'Upload payment screenshot'}</Text></TouchableOpacity>
    {proofImage && <Image source={{ uri: proofImage.uri }} resizeMode="contain" accessibilityLabel="Selected payment screenshot for review" style={styles.proofPreview} />}
    <TouchableOpacity disabled={loading || financialActionsDisabled} onPress={submitReference} style={[styles.primary, { backgroundColor: loading || financialActionsDisabled ? colors.line : colors.blue }]}><Text style={styles.primaryText}>{loading ? 'Submitting…' : 'Submit proof for review'}</Text></TouchableOpacity>
  </View>;
  return <Animated.ScrollView ref={scrollRef} style={{ flex: 1, backgroundColor: colors.bg, opacity: entrance }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    {financialActionsDisabled && <View accessibilityRole="alert" style={[styles.card, { backgroundColor: colors.warningSurface, borderColor: colors.gold }]}><Text style={[styles.cardTitle, { color: colors.warningText }]}>Financial actions are unavailable</Text><Text style={[styles.caption, { color: colors.warningText }]}>{financialOperationsReason || 'The server has disabled deposit creation, P2P matching, payment submission and order changes.'} Existing non-financial account features remain available. No payment or balance change was made.</Text></View>}
    <View style={[styles.heroImageWrap, { borderColor: colors.cyan }]}>
      <Image source={depositPromo} style={styles.heroImage} resizeMode="cover" accessibilityLabel="PaisaPay Add Money and commission promotional banner" />
    </View>

    <View style={[styles.card, styles.quick, { backgroundColor: colors.card, borderColor: colors.blue }]}>
      <View style={styles.heading}><View style={[styles.quickIcon, { backgroundColor: colors.accentSurface }]}><Text style={{ color: colors.blue, fontSize: 19, fontWeight: '900' }}>↗</Text></View><View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: colors.ink }]}>Quick Deposit</Text><Text style={[styles.caption, { color: colors.muted }]}>Exact amount match · Up to 7 seconds</Text></View><View accessibilityLabel={`Quick Deposit ${financialActionsDisabled ? 'unavailable' : 'available'}`} style={[styles.liveBadge, { backgroundColor: financialActionsDisabled ? colors.warningSurface : colors.successSurface }]}><View style={[styles.liveDot, { backgroundColor: financialActionsDisabled ? colors.warningText : colors.green }]} /><Text style={{ color: financialActionsDisabled ? colors.warningText : colors.green, fontSize: 8, fontWeight: '900' }}>{financialActionsDisabled ? 'UNAVAILABLE' : 'AVAILABLE'}</Text></View></View>
      {financialActionsDisabled && <Text style={[styles.caption, { color: colors.warningText }]}>{financialOperationsReason || 'Quick Deposit matching is disabled by the server.'}</Text>}
      <View style={styles.amountHeading}><Text style={[styles.amountLabel, { color: colors.ink }]}>Amount to deposit</Text><Text style={[styles.amountRange, { color: colors.muted }]}>₹100–₹10,000</Text></View>
      <View style={[styles.amountBox, { backgroundColor: colors.bg, borderColor: amountInvalid ? errorColor : colors.line }]}><Text style={[styles.rupee, { color: colors.cyan }]}>₹</Text><TextInput accessibilityLabel="Quick deposit amount in rupees" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="100" placeholderTextColor={colors.muted} style={[styles.amountInput, { color: colors.ink }]} /></View>
      {amountInvalid && <Text accessibilityRole="alert" style={[styles.amountError, { color: errorColor }]}>{amountError}</Text>}
      <View style={styles.presets}>{presets.map((value) => <TouchableOpacity key={value} onPress={() => setAmount(String(value))} style={[styles.preset, { borderColor: colors.line, backgroundColor: amount === String(value) ? colors.blue : colors.surface }]}><Text style={{ color: amount === String(value) ? '#fff' : colors.ink, fontWeight: '800' }}>₹{value.toLocaleString('en-IN')}</Text></TouchableOpacity>)}</View>
      <View style={[styles.totalCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>Before you match</Text>
        {quickAmountValid ? <>
          <View style={styles.totalRow}><Text style={[styles.totalLabel, { color: colors.muted }]}>You pay</Text><Text style={[styles.totalValue, { color: colors.ink }]}>{money(amountPaise)}</Text></View>
          <View style={styles.totalRow}><Text style={[styles.totalLabel, { color: colors.muted }]}>6% reward estimate</Text><Text style={[styles.totalValue, { color: colors.cyan }]}>+{money(rewardEstimatePaise)}</Text></View>
          <View style={[styles.totalRow, styles.totalFinal, { borderTopColor: colors.line }]}><Text style={[styles.totalLabel, { color: colors.ink, fontWeight: '900' }]}>Estimated wallet credit</Text><Text style={[styles.totalValue, { color: colors.ink }]}>{money(amountPaise + rewardEstimatePaise)}</Text></View>
          <Text style={[styles.caption, { color: colors.muted }]}>Reward is an estimate, not immediate or guaranteed. It is credited only after payment receipt is independently verified and the reward pool has sufficient funds.</Text>
        </> : <Text style={[styles.caption, { color: colors.muted }]}>Choose or enter an amount in ₹100 steps to see the payment and 6% reward estimate.</Text>}
      </View>
      <TouchableOpacity accessibilityRole="button" disabled={loading || working || financialActionsDisabled} onPress={() => quickAmountValid ? match() : showDepositError()} style={[styles.primary, { backgroundColor: loading || working || financialActionsDisabled ? colors.line : colors.blue }]}><Text style={styles.primaryText}>{financialActionsDisabled ? 'Temporarily unavailable' : loading ? 'Finding a match…' : 'Continue'}</Text></TouchableOpacity>
      {order && <View onLayout={(event) => { orderDetailsY.current = event.nativeEvent.layout.y; }} style={[styles.orderCard, { backgroundColor: colors.surface, borderColor: matchedNoticeOrderId === order.id ? colors.green : colors.line }]}>
        {matchedNoticeOrderId === order.id && <Animated.Text accessibilityRole="alert" style={[styles.matchSuccessText, { color: colors.green, opacity: matchSuccessOpacity }]}>✓ Your order is matched</Animated.Text>}
        <Text style={[styles.cardTitle, { color: colors.ink }]}>Matched order</Text>
        <Text style={[styles.detail, { color: colors.muted }]}>Order reference · <Text style={{ color: colors.ink, fontWeight: '800' }}>{order.referenceId}</Text></Text>
        <Text style={[styles.detail, { color: colors.muted }]}>Withdrawal reference · <Text style={{ color: colors.ink, fontWeight: '800' }}>{order.withdrawalOffer?.referenceId || 'Available after match'}</Text></Text>
        <Text style={[styles.detail, { color: colors.muted }]}>Amount · <Text style={{ color: colors.ink, fontWeight: '800' }}>{money(order.amountPaise)}</Text></Text>
        <View style={[styles.totalCard, { backgroundColor: colors.bg, borderColor: colors.line }]}><Text style={[styles.cardTitle, { color: colors.ink }]}>Order timeline · IST</Text>{timeline.map(([label, value]) => <View key={label} style={[styles.totalRow, { alignItems: 'flex-start' }]}><Text style={[styles.caption, { color: colors.muted, flex: 1 }]}>{label}</Text><Text style={[styles.caption, { color: colors.ink, flex: 1, textAlign: 'right' }]}>{formatTimestamp(value)}</Text></View>)}</View>
        <View style={[styles.rewardCard, { backgroundColor: colors.accentSurface, borderColor: colors.cyan }]}>
          <Text style={[styles.rewardTitle, { color: colors.cyan }]}>6% matched-order reward</Text>
          <Text style={[styles.rewardAmount, { color: colors.ink }]}>{money(order.reward?.estimatedPaise ?? Math.floor(Number(order.amountPaise) * 0.06))}</Text>
          <Text style={[styles.caption, { color: colors.muted }]}>{order.reward?.message || 'Estimate only. Credited after Finance independently verifies payment and only if the reward pool is funded.'}</Text>
        </View>
        {order.expiresAt && ['MATCHED', 'PAYMENT_PENDING'].includes(order.status) && <View style={[styles.paymentTimer, { backgroundColor: colors.warningSurface, borderColor: colors.warningText }]}><Text style={[styles.timerLabel, { color: colors.warningText }]}>{order.status === 'MATCHED' ? 'PAYMENT DEADLINE' : 'TIME LEFT TO PAY'}</Text><Text style={[styles.timerValue, { color: colors.warningText }]}>{orderTimeLabel}</Text><Text style={[styles.caption, { color: colors.warningText, textAlign: 'right', flex: 1 }]}>{orderSecondsLeft === 0 ? 'Refreshing order status…' : 'Pay within 5 minutes of match'}</Text></View>}
        {order.status === 'EXPIRED' && <Text style={[styles.warningCopy, { color: colors.warningText }]}>This match expired before payment details were shown. Its amount is back in matching; press Continue to request a fresh match.</Text>}
        {order.status === 'PAYMENT_EXPIRED_REVIEW' && <><Text style={[styles.warningCopy, { color: colors.warningText }]}>Payment status needs to be resolved. The seller allocation remains held because a payment may have been initiated. Do not pay again.</Text><TouchableOpacity accessibilityRole="button" onPress={() => go('Support', { subject: `Payment status help · ${order.referenceId}`, message: `Order ID: ${order.id}\nOrder reference: ${order.referenceId}\nAmount: ${money(order.amountPaise)}\nStatus: ${order.status}\nPlease help resolve the payment status. I will not pay again until it is clarified.` })} style={[styles.secondaryButton, { borderColor: colors.line }]}><Text style={{ color: colors.cyan, fontWeight: '900' }}>Contact Support</Text></TouchableOpacity></>}
        {order.status === 'CANCELLED_PAYMENT_HOLD' && <><Text style={[styles.warningCopy, { color: colors.warningText }]}>This order is cancelled and removed from active deposits. Its payment outcome is unresolved, so the seller allocation remains held. Do not pay again.</Text><TouchableOpacity accessibilityRole="button" onPress={() => go('Support', { subject: `Cancelled payment status · ${order.referenceId}`, message: `Order ID: ${order.id}\nOrder reference: ${order.referenceId}\nAmount: ${money(order.amountPaise)}\nStatus: ${order.status}\nPlease help resolve this cancelled order. I will not pay again until the status is clarified.` })} style={[styles.secondaryButton, { borderColor: colors.line }]}><Text style={{ color: colors.cyan, fontWeight: '900' }}>Contact Support</Text></TouchableOpacity></>}
        {order.status === 'CANCELLED' && <Text style={[styles.warningCopy, { color: colors.warningText }]}>This order was cancelled. Do not pay using its old details. Request a fresh match if you still want to deposit.</Text>}
        {order.status === 'COMPLETED' ? <>
          <Text style={[styles.successCopy, { color: colors.green }]}>Payment verified · deposit credited</Text>
          <Text style={[styles.caption, { color: colors.muted }]}>The backend confirmed this order and recorded the wallet ledger credit.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => setReceiptVisible(true)} style={[styles.primary, { backgroundColor: colors.blue }]}><Text style={styles.primaryText}>View receipt</Text></TouchableOpacity>
        </> : order.claims?.some((claim) => claim.status === 'PENDING_REVIEW') ? <>
          <Text style={[styles.successCopy, { color: colors.warningText }]}>PENDING ADMIN REVIEW</Text>
          <Text style={[styles.caption, { color: colors.muted }]}>Your payment proof has been submitted successfully. Please wait for admin verification. Do not pay again.</Text>
          <Text style={[styles.caption, { color: colors.muted }]}>Your screenshot and payment details are attached for Finance review. They are unverified claims; no wallet credit has been made.</Text>
          <Text style={[styles.caption, { color: colors.ink }]}>UTR · {order.claims?.[0]?.transactionReference || 'Not provided'} · Proof · {order.claims?.[0]?.evidenceAttached ? 'Uploaded' : 'Submitted'}</Text>
          {order.claims?.[0]?.claimedAmountPaise != null && <Text style={[styles.caption, { color: colors.ink }]}>Claimed amount · {money(order.claims[0].claimedAmountPaise)} · {formatTimestamp(order.claims[0].claimedPaidAt || order.claims[0].createdAt)}</Text>}
          <TouchableOpacity accessibilityRole="button" onPress={() => go('Support', { subject: `Payment proof help · ${order.referenceId}`, message: `Order ID: ${order.id}\nOrder reference: ${order.referenceId}\nAmount: ${money(order.amountPaise)}\nStatus: PENDING ADMIN REVIEW\nPlease help me with this submitted payment proof.` })} style={[styles.secondaryButton, { borderColor: colors.line }]}><Text style={{ color: colors.cyan, fontWeight: '900' }}>Contact Support</Text></TouchableOpacity>
        </> : payeeVpa ? <>
          <View style={[styles.payee, { borderColor: colors.line }]}><Text style={[styles.caption, { color: colors.muted }]}>Seller-provided account name · unverified</Text><Text style={[styles.payeeText, { color: colors.ink }]}>{payeeName}</Text><Text style={[styles.caption, { color: colors.muted, marginTop: 8 }]}>UPI ID</Text><Text selectable style={[styles.payeeText, { color: colors.ink }]}>{payeeVpa}</Text></View>
          <Text style={[styles.warningCopy, { color: colors.warningText }]}>Payment verification is manual. A UPI app success screen or UTR does not prove receipt or credit your wallet. Do not share your UPI PIN or OTP.</Text>
          {!order.paymentHandoffStartedAt && !order.timestamps?.paymentHandoffInitiatedAt ? <View style={styles.orderActions}><TouchableOpacity disabled={loading || financialActionsDisabled || order.status !== 'PAYMENT_PENDING'} onPress={payNow} style={[styles.primary, styles.orderActionButton, { backgroundColor: colors.blue, opacity: loading || financialActionsDisabled || order.status !== 'PAYMENT_PENDING' ? 0.55 : 1 }]}><Text style={styles.primaryText}>{financialActionsDisabled ? 'Temporarily unavailable' : loading ? 'Opening…' : `Pay Now · ${money(order.amountPaise)}`}</Text></TouchableOpacity>{order.status === 'PAYMENT_PENDING' && <TouchableOpacity disabled={loading || financialActionsDisabled} onPress={() => cancelOrder()} style={[styles.cancelOrderButton, styles.orderActionButton, { borderColor: colors.line, opacity: loading || financialActionsDisabled ? 0.55 : 1 }]}><Text style={{ color: colors.warningText, fontWeight: '900' }}>Cancel order</Text></TouchableOpacity>}</View> : <Text style={[styles.caption, { color: colors.cyan, marginTop: 8 }]}>Payment handoff was recorded. Do not pay again. If your payment is complete, submit its UTR and screenshot for Finance review.</Text>}
          {(order.paymentHandoffStartedAt || order.timestamps?.paymentHandoffInitiatedAt) && <Text style={[styles.caption, { color: colors.cyan, marginTop: 8 }]}>PAYMENT PENDING · Returning from the UPI app is not payment confirmation.</Text>}
          {renderPaymentProofForm()}
        </> : order.status === 'PAYMENT_PROCESSING' ? <><Text style={[styles.successCopy, { color: colors.warningText }]}>PAYMENT SUBMITTED · PENDING ADMIN REVIEW</Text><Text style={[styles.caption, { color: colors.muted }]}>Do not pay again. Contact support if you need help with this order.</Text><TouchableOpacity accessibilityRole="button" onPress={() => go('Support', { subject: `Payment status help · ${order.referenceId}`, message: `Order ID: ${order.id}\nOrder reference: ${order.referenceId}\nAmount: ${money(order.amountPaise)}\nStatus: ${order.status}\nPlease help me with this payment status.` })} style={[styles.secondaryButton, { borderColor: colors.line }]}><Text style={{ color: colors.cyan, fontWeight: '900' }}>Contact Support</Text></TouchableOpacity></> : <><Text style={[styles.warningCopy, { color: colors.warningText }]}>Pay Now opens the UPI handoff. You can cancel this match before the UPI app opens.</Text><View style={styles.orderActions}><TouchableOpacity disabled={loading || financialActionsDisabled || order.status !== 'MATCHED'} onPress={payNow} style={[styles.primary, styles.orderActionButton, { backgroundColor: colors.blue, opacity: loading || financialActionsDisabled || order.status !== 'MATCHED' ? 0.55 : 1 }]}><Text style={styles.primaryText}>{financialActionsDisabled ? 'Temporarily unavailable' : loading ? 'Opening…' : `Pay Now · ${money(order.amountPaise)}`}</Text></TouchableOpacity>{order.status === 'MATCHED' && <TouchableOpacity disabled={loading || financialActionsDisabled} onPress={() => cancelOrder()} style={[styles.cancelOrderButton, styles.orderActionButton, { borderColor: colors.line, opacity: loading || financialActionsDisabled ? 0.55 : 1 }]}><Text style={{ color: colors.warningText, fontWeight: '900' }}>Cancel order</Text></TouchableOpacity>}</View></>}
        <Modal visible={receiptVisible && order.status === 'COMPLETED'} transparent animationType="slide" onRequestClose={() => setReceiptVisible(false)}><View style={styles.matchBackdrop}><View style={[styles.matchModal, { backgroundColor: colors.card, borderColor: colors.line }]}><Text style={[styles.cardTitle, { color: colors.ink }]}>PaisaPay payment receipt</Text><Text style={[styles.detail, { color: colors.muted }]}>Order ID · <Text style={{ color: colors.ink, fontWeight: '800' }}>{order.referenceId}</Text></Text><Text style={[styles.detail, { color: colors.muted }]}>Verified deposit · <Text style={{ color: colors.ink, fontWeight: '800' }}>{money(order.amountPaise)}</Text></Text>{Number(order.reward?.creditedPaise || 0) > 0 && <Text style={[styles.detail, { color: colors.muted }]}>Reward credited · <Text style={{ color: colors.green, fontWeight: '800' }}>{money(order.reward.creditedPaise)}</Text></Text>}<Text style={[styles.detail, { color: colors.muted }]}>Total wallet credit · <Text style={{ color: colors.ink, fontWeight: '900' }}>{money(Number(order.amountPaise) + Number(order.reward?.creditedPaise || 0))}</Text></Text><Text style={[styles.detail, { color: colors.muted }]}>Status · <Text style={{ color: colors.green, fontWeight: '900' }}>COMPLETED</Text></Text><TouchableOpacity onPress={() => setReceiptVisible(false)} style={[styles.primary, { backgroundColor: colors.blue }]}><Text style={styles.primaryText}>Done</Text></TouchableOpacity></View></View></Modal>
      </View>}
      <Text style={[styles.small, { color: colors.muted }]}>Wallet credit happens only after Finance independently confirms the seller received the exact INR payment in bank records.</Text>
    </View>

    {!!visibleQuickDepositOrders.length && <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}><Text style={[styles.cardTitle, { color: colors.ink }]}>Your Quick Deposit orders</Text>{visibleQuickDepositOrders.slice(0, 6).map((item) => <View key={item.id} style={[styles.offer, { borderColor: colors.line, backgroundColor: colors.surface }]}><View style={{ flex: 1 }}><Text style={[styles.offerAmount, { color: colors.ink }]}>{money(item.amountPaise)}</Text><Text style={[styles.caption, { color: colors.muted }]}>{item.referenceId} · {item.status.replace(/_/g, ' ')}</Text><Text style={[styles.caption, { color: colors.cyan }]}>6% reward · {money(item.reward?.estimatedPaise ?? Math.floor(Number(item.amountPaise) * 0.06))}{item.reward?.creditedPaise ? ` · credited ${money(item.reward.creditedPaise)}` : ' · after verified payment, if funded'}</Text></View>{item.status === 'COMPLETED' ? <TouchableOpacity onPress={() => { setOrder({ ...item, reward: item.reward || { estimatedPaise: Math.floor(Number(item.amountPaise) * 0.06), message: 'Verified payment receipt.' } }); setReceiptVisible(true); }} style={[styles.buyButton, { backgroundColor: colors.blue }]}><Text style={styles.primaryText}>View receipt</Text></TouchableOpacity> : item.status === 'PAYMENT_PROCESSING' && item.claims?.some((claim) => claim.status === 'PENDING_REVIEW') ? <TouchableOpacity onPress={() => { setOrder({ ...item, reward: item.reward || { estimatedPaise: Math.floor(Number(item.amountPaise) * 0.06), message: 'Estimate only. Reward is credited after independent verification if funded.' } }); setPayeeVpa(''); setPayeeName(''); }} style={[styles.buyButton, { backgroundColor: colors.blue }]}><Text style={styles.primaryText}>View status</Text></TouchableOpacity> : item.status === 'PAYMENT_PROCESSING' ? <TouchableOpacity onPress={() => go('Support', { subject: `Payment status help · ${item.referenceId}`, message: `Order ID: ${item.id}\nOrder reference: ${item.referenceId}\nAmount: ${money(item.amountPaise)}\nStatus: ${item.status}\nPlease help me with this payment status. I will not pay again until it is clarified.` })} style={[styles.buyButton, { backgroundColor: colors.blue }]}><Text style={styles.primaryText}>Contact Support</Text></TouchableOpacity> : <TouchableOpacity onPress={async () => { setOrder({ ...item, reward: item.reward || { estimatedPaise: Math.floor(Number(item.amountPaise) * 0.06), message: 'Estimate only. Reward is credited after independent verification if funded.' } }); setPayeeVpa(''); setPayeeName(''); setLoading(true); try { const result = await apiPost(`/api/v1/deposits/orders/${encodeURIComponent(item.id)}/confirm`, {}); setOrder({ ...item, ...result.order, reward: item.reward }); setPayeeVpa(result.paymentDetails.payeeVpa); setPayeeName(result.paymentDetails.payeeName); } catch (e) { note?.('Order unavailable', e.message); } finally { setLoading(false); } }} style={[styles.buyButton, { backgroundColor: colors.blue }]}><Text style={styles.primaryText}>Resume</Text></TouchableOpacity>}</View>)}</View>}
    {supportFollowUp && <View style={[styles.card, { backgroundColor: colors.warningSurface, borderColor: colors.warningText }]}><Text style={[styles.cardTitle, { color: colors.warningText }]}>{supportFollowUp.kind === 'rejection' ? 'Deposit decision · Support available' : 'Payment outcome needs help'}</Text><Text style={[styles.caption, { color: colors.warningText }]}>Order {supportFollowUp.referenceId || supportFollowUp.orderId} · {supportFollowUp.reason}</Text><TouchableOpacity accessibilityRole="button" onPress={() => go('Support', { subject: `${supportFollowUp.kind === 'rejection' ? 'Dispute deposit decision' : 'Payment status help'} · ${supportFollowUp.referenceId || supportFollowUp.orderId}`, message: `Order ID: ${supportFollowUp.orderId}\nOrder reference: ${supportFollowUp.referenceId || '—'}\nIssue: ${supportFollowUp.reason}\nPlease review this order. I will not make another payment until the status is clarified.` })} style={[styles.primary, { backgroundColor: colors.blue }]}><Text style={styles.primaryText}>Contact Support</Text></TouchableOpacity></View>}

    <TouchableOpacity onPress={() => setStandardOpen((value) => !value)} style={[styles.secondaryButton, { borderColor: colors.line }]}><Text style={{ color: colors.ink, fontWeight: '800' }}>{standardOpen ? 'Hide standard deposit' : 'Use standard PaisaPay deposit'}</Text></TouchableOpacity>
    {standardOpen && <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
      <Text style={[styles.cardTitle, { color: colors.ink }]}>Standard UPI deposit</Text><Text style={[styles.caption, { color: colors.muted, marginTop: 4 }]}>This remains pending until Finance verifies receipt. UPI app callbacks do not count as proof.</Text>
      <Text style={[styles.detail, { color: colors.muted, marginTop: 12 }]}>Available wallet balance · <Text style={{ color: colors.ink, fontWeight: '800' }}>{money(balance)}</Text></Text>
      <Text style={[styles.detail, { color: colors.muted }]}>Receiver · <Text selectable style={{ color: colors.ink, fontWeight: '800' }}>{config?.receiverVpa || 'Not configured'}</Text></Text>
      <TouchableOpacity disabled={!config?.receiverVpa} onPress={async () => { if (!config?.receiverVpa) return note?.('UPI recipient unavailable', 'PaisaPay has not configured a payment recipient. Do not make a payment.'); try { await Clipboard.setStringAsync(config.receiverVpa); note?.('Copied', 'PaisaPay receiver UPI ID copied.'); } catch { note?.('Copy unavailable', config.receiverVpa); } }} style={[styles.secondaryButton, { borderColor: colors.line, opacity: config?.receiverVpa ? 1 : 0.55 }]}><Text style={{ color: colors.cyan, fontWeight: '900' }}>Copy receiver UPI ID</Text></TouchableOpacity>
      <View style={[styles.amountBox, { backgroundColor: colors.bg, borderColor: amountInvalid ? errorColor : colors.line }]}><Text style={[styles.rupee, { color: colors.cyan }]}>₹</Text><TextInput accessibilityLabel="Deposit amount in rupees" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="100" placeholderTextColor={colors.muted} style={[styles.amountInput, { color: colors.ink }]} /></View>
      {amountInvalid && <Text accessibilityRole="alert" style={[styles.amountError, { color: errorColor }]}>{amountError}</Text>}
      {!config?.receiverVpa && <Text style={[styles.caption, { color: colors.red || '#EF4444', marginTop: 8 }]}>UPI deposits are unavailable until a recipient is configured. Do not send money.</Text>}
      <TouchableOpacity onPress={createStandardDeposit} disabled={working || !config?.receiverVpa || financialActionsDisabled} style={[styles.primary, { backgroundColor: colors.blue, opacity: !config?.receiverVpa || financialActionsDisabled ? 0.55 : 1 }]}><Text style={styles.primaryText}>{financialActionsDisabled ? 'Temporarily unavailable' : working ? 'Creating…' : 'Create pending deposit'}</Text></TouchableOpacity>
      {financialActionsDisabled && <Text style={[styles.caption, { color: colors.warningText, marginTop: 8 }]}>{financialOperationsReason || 'Standard deposits are disabled by the server.'}</Text>}
      <TouchableOpacity onPress={() => go('Deposit History')} style={[styles.secondaryButton, { borderColor: colors.line }]}><Text style={{ color: colors.ink, fontWeight: '800' }}>View deposit history</Text></TouchableOpacity>
    </View>}
    <Modal visible={matching} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.matchBackdrop}>
        <View style={[styles.matchModal, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <View style={[styles.matchOrb, { backgroundColor: colors.accentSurface, borderColor: colors.blue }]}>
            <ActivityIndicator size="small" color={colors.cyan} />
            <Text style={[styles.matchCountdown, { color: colors.ink }]}>{matchSeconds}</Text>
            <Text style={[styles.matchSecondsLabel, { color: colors.muted }]}>SECONDS</Text>
          </View>
          <Text style={[styles.matchTitle, { color: colors.ink }]}>Finding your deposit match</Text>
          <Text style={[styles.matchAmount, { color: colors.cyan }]}>{money(matchAmountPaise)}</Text>
          <Text style={[styles.matchCopy, { color: colors.muted }]}>{matchSeconds > 5 ? 'Searching eligible withdrawal offers…' : matchSeconds > 2 ? 'Checking exact amount and availability…' : 'Securing the match with the server…'}</Text>
          <View style={[styles.matchTrack, { backgroundColor: colors.softSurface }]}><View style={[styles.matchProgress, { backgroundColor: colors.blue, width: `${Math.max(4, ((7 - matchSeconds) / 7) * 100)}%` }]} /></View>
          <View style={styles.matchSteps}>
            <Text style={[styles.matchStep, { color: colors.green }]}>✓ Search offers</Text>
            <Text style={[styles.matchStep, { color: matchSeconds <= 5 ? colors.cyan : colors.muted }]}>◉ Check amount</Text>
            <Text style={[styles.matchStep, { color: matchSeconds <= 2 ? colors.cyan : colors.muted }]}>◉ Secure match</Text>
          </View>
          <Text style={[styles.matchFootnote, { color: colors.muted }]}>We check for up to 7 seconds. No payment starts unless a match is found.</Text>
        </View>
      </View>
    </Modal>
  </Animated.ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 30 },
  heroImageWrap: { height: 178, width: '100%', borderWidth: 1, borderRadius: 18, overflow: 'hidden', marginBottom: 14, backgroundColor: '#101010', elevation: 8, shadowColor: '#F5B900', shadowOpacity: 0.22, shadowRadius: 13, shadowOffset: { width: 0, height: 6 } }, heroImage: { width: '100%', height: '100%' },
  matchBackdrop: { flex: 1, backgroundColor: 'rgba(3, 10, 25, 0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 }, matchModal: { width: '100%', maxWidth: 390, borderWidth: 1, borderRadius: 26, padding: 22, alignItems: 'center', elevation: 18, shadowColor: '#176BFF', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 9 } }, matchOrb: { width: 112, height: 112, borderRadius: 56, borderWidth: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }, matchCountdown: { fontSize: 27, fontWeight: '900', marginTop: 4 }, matchSecondsLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1.2 }, matchTitle: { fontSize: 18, textAlign: 'center', fontWeight: '900' }, matchAmount: { fontSize: 22, fontWeight: '900', marginTop: 6 }, matchCopy: { fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: 8 }, matchTrack: { width: '100%', height: 7, borderRadius: 8, overflow: 'hidden', marginTop: 18 }, matchProgress: { height: '100%', borderRadius: 8 }, matchSteps: { width: '100%', gap: 7, marginTop: 16 }, matchStep: { fontSize: 11, fontWeight: '800' }, matchFootnote: { fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 16 },
  card: { borderWidth: 1, borderRadius: 22, padding: 16, marginBottom: 13, elevation: 4, shadowColor: '#102747', shadowOpacity: 0.07, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } }, quick: { borderWidth: 1.5 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 }, quickIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 6 }, liveDot: { width: 6, height: 6, borderRadius: 3 }, cardTitle: { fontSize: 16, fontWeight: '900' }, caption: { fontSize: 10, lineHeight: 15, marginTop: 4 }, amountHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }, amountLabel: { fontSize: 12, fontWeight: '900' }, amountRange: { fontSize: 9, fontWeight: '700' },
  amountBox: { minHeight: 66, borderWidth: 1.5, borderRadius: 17, marginTop: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 }, amountError: { fontSize: 11, fontWeight: '800', marginTop: 6 }, rupee: { fontSize: 26, fontWeight: '900', marginRight: 8 }, amountInput: { flex: 1, fontSize: 25, fontWeight: '900', paddingVertical: 8 }, presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, preset: { flex: 1, minWidth: '20%', alignItems: 'center', paddingVertical: 11, borderRadius: 13, borderWidth: 1 },
  primary: { minHeight: 49, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 12, paddingHorizontal: 10 }, primaryText: { color: '#fff', fontWeight: '900', fontSize: 12 }, orderActions: { flexDirection: 'row', gap: 9, alignItems: 'stretch', marginTop: 2 }, orderActionButton: { flex: 1, paddingHorizontal: 8 }, cancelOrderButton: { minHeight: 49, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 12, paddingHorizontal: 8 }, paymentTimer: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 11, paddingVertical: 8, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }, timerLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 }, timerValue: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] }, totalCard: { borderWidth: 1, borderRadius: 15, padding: 12, marginTop: 12 }, totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 9 }, totalLabel: { fontSize: 11 }, totalValue: { fontSize: 13, fontWeight: '900' }, totalFinal: { borderTopWidth: 1, paddingTop: 9, marginTop: 10 }, matchSuccessText: { fontSize: 14, fontWeight: '900', textAlign: 'center', paddingVertical: 8, marginBottom: 5 }, orderCard: { borderWidth: 1, borderRadius: 16, padding: 13, marginTop: 13 }, rewardCard: { borderWidth: 1, borderRadius: 13, padding: 11, marginTop: 11 }, rewardTitle: { fontSize: 12, fontWeight: '900' }, rewardAmount: { fontSize: 22, fontWeight: '900', marginTop: 3 }, detail: { fontSize: 11, marginTop: 7 }, warningCopy: { fontSize: 10, lineHeight: 15, marginTop: 9 }, payee: { borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 11 }, payeeText: { fontSize: 15, fontWeight: '900', marginTop: 4 }, proofCard: { borderWidth: 1, borderRadius: 14, padding: 11, marginTop: 12 }, proofPreview: { width: '100%', height: 180, marginTop: 10, borderRadius: 10, backgroundColor: '#0A1527' }, successCopy: { fontSize: 13, fontWeight: '900', marginTop: 10 }, reference: { borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 10 }, secondaryButton: { minHeight: 43, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 9, paddingHorizontal: 12 }, small: { fontSize: 9, lineHeight: 14, marginTop: 10 }, offer: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 15, padding: 11, marginTop: 10 }, offerAmount: { fontSize: 17, fontWeight: '900' }, buyButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 11 },
});
