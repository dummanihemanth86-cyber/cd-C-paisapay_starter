import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { apiPost } from './api';

const PAYABLE_STATUSES = ['CREATED', 'PENDING_PAYMENT'];
const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const makeUpiIntent = (vpa, paise, reference) => `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent('PaisaPay')}&am=${(Number(paise) / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(reference)}`;

export default function DepositHistory({ rows = [], empty, note, onRefresh, onCancel, upiReceiver, colors }) {
  const [claimRefs, setClaimRefs] = useState({});
  const [claimImages, setClaimImages] = useState({});
  const [checkingId, setCheckingId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const blink = useRef(new Animated.Value(1)).current;
  const pendingCount = rows.filter((row) => row.method === 'UPI' && PAYABLE_STATUSES.includes(row.status)).length;
  const activeCount = rows.filter((row) => row.method === 'UPI' && ['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(row.status)).length;
  const expiredRefreshSent = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pendingCount) { blink.setValue(1); return undefined; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(blink, { toValue: 0.72, duration: 650, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 1, duration: 650, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pendingCount, blink]);

  const countdownFor = (row) => {
    const created = Date.parse(row.createdAt || '') || now;
    const expiry = row.expiresAt ? Date.parse(row.expiresAt) : created + 5 * 60 * 1000;
    return Math.max(0, Math.ceil((expiry - now) / 1000));
  };

  const hasExpiredUnclaimed = rows.some((row) => row.method === 'UPI' && PAYABLE_STATUSES.includes(row.status) && countdownFor(row) === 0);
  useEffect(() => {
    if (hasExpiredUnclaimed && !expiredRefreshSent.current) {
      expiredRefreshSent.current = true;
      void onRefresh?.();
    } else if (!hasExpiredUnclaimed) expiredRefreshSent.current = false;
  }, [hasExpiredUnclaimed, onRefresh]);

  const copy = async (value, label) => {
    try { await Clipboard.setStringAsync(value); note('Copied', `${label} copied.`); }
    catch { note('Copy unavailable', value); }
  };

  const pay = async (row) => {
    if (countdownFor(row) <= 0) { await onRefresh?.(); return note('Deposit expired', 'This payment request expired. If you already paid, submit a transaction image for review; do not pay again.'); }
    try { await Linking.openURL(makeUpiIntent(upiReceiver || 'zitch@ptyes', row.amountPaise, row.merchantReference)); }
    catch { note('UPI app unavailable', 'Scan the QR or copy the receiver UPI ID. The deposit remains pending until payment is independently verified.'); }
  };

  const cancel = (row) => Alert.alert('Cancel deposit?', 'This stops this PaisaPay request. If you already sent the UPI payment, do not pay again; submit a transaction image for manual review.', [
    { text: 'Keep deposit', style: 'cancel' },
    { text: 'Cancel deposit', style: 'destructive', onPress: () => onCancel?.(row) },
  ]);

  const submitClaim = async (row) => {
    const transactionReference = (claimRefs[row.id] || '').trim();
    const image = claimImages[row.id];
    if (transactionReference && !/^\d{12}$/.test(transactionReference)) return note('Check transaction ID', 'If you enter a UTR/RRN, it must contain exactly 12 digits. You can leave this field blank.');
    if (!image?.base64 || !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)) return note('Screenshot required', 'Choose a transaction screenshot (JPEG, PNG, or WebP) before submitting.');
    try {
      setCheckingId(row.id);
      const result = await apiPost(`/api/v1/deposits/${encodeURIComponent(row.id)}/manual-verification`, { ...(transactionReference ? { transactionReference } : {}), evidenceImageBase64: image.base64, evidenceMimeType: image.mimeType });
      setClaimRefs((current) => ({ ...current, [row.id]: '' }));
      setClaimImages((current) => ({ ...current, [row.id]: null }));
      note('Claim submitted', result.message);
      await onRefresh?.();
    } catch (error) { note('Claim not submitted', error.message || 'Try again or contact support.'); }
    finally { setCheckingId(null); }
  };

  const chooseEvidence = (row, source) => {
    const launch = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    void launch({ mediaTypes: ['images'], allowsEditing: false, quality: 0.7 }).then(async (result) => {
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!asset.mimeType?.startsWith('image/')) {
        note('Unsupported screenshot', 'Choose a transaction image from your gallery or camera.');
        return;
      }
      const compressed = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: Math.min(asset.width || 1400, 1400) } }], { compress: 0.65, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!compressed.base64 || compressed.base64.length > 2_000_000) {
        note('Image too large', 'Could not reduce this screenshot to the 1.5 MB upload limit. Choose another image.');
        return;
      }
      setClaimImages((current) => ({ ...current, [row.id]: { uri: compressed.uri, base64: compressed.base64, mimeType: 'image/jpeg' } }));
    }).catch(() => note('Image unavailable', 'Could not open the image picker. Check photo permission and try again.'));
  };

  const bg = colors?.bg || '#07152E';
  const card = colors?.card || '#102747';
  const ink = colors?.ink || '#F8FAFC';
  const muted = colors?.muted || '#94A3B8';
  const line = colors?.line || '#26364F';
  const blue = colors?.blue || '#176BFF';
  const warning = colors?.warningText || '#FCD34D';

  return <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View style={styles.header}>
      <Text style={[styles.title, { color: ink }]}>Deposit history</Text>
      <Text style={[styles.subtitle, { color: muted }]}>Payment is credited only after Finance verifies the merchant receipt.</Text>
    </View>
    {activeCount > 0 && <View style={[styles.notice, { backgroundColor: colors?.warningSurface || '#3B2D12', borderColor: warning }]}>
      <Text style={[styles.noticeTitle, { color: warning }]}>{activeCount >= 2 ? '2 active deposits — limit reached' : pendingCount ? 'Deposit payment is waiting' : 'Deposit is under review'}</Text>
      <Text style={[styles.noticeBody, { color: warning }]}>{activeCount >= 2 ? 'Pay, cancel, or wait for one active deposit to expire/finish before creating another.' : pendingCount ? 'You can create one more deposit. Pay this request before its 5-minute timer ends. If already paid, submit its reference instead of paying again.' : 'This deposit is being reviewed and uses one of your two active deposit slots.'}</Text>
    </View>}
    {rows.length ? rows.map((row) => {
      const unpaid = row.method === 'UPI' && PAYABLE_STATUSES.includes(row.status);
      const seconds = unpaid ? countdownFor(row) : 0;
      const payable = unpaid && seconds > 0;
      const lateClaimAllowed = row.method === 'UPI' && ['EXPIRED', 'CANCELLED'].includes(row.status);
      const claimPending = row.manualPaymentClaim?.status === 'PENDING_REVIEW';
      const claimCanSubmit = row.method === 'UPI' && (payable || lateClaimAllowed) && !claimPending && row.manualPaymentClaim?.status !== 'APPROVED';
      const timeLabel = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      return <Animated.View key={row.id} style={[styles.card, { backgroundColor: card, borderColor: payable ? blue : line, opacity: payable ? blink : 1 }]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[styles.depositId, { color: ink }]}>{row.merchantReference || row.id}</Text>
            <Text style={[styles.status, { color: payable ? blue : muted }]}>{row.method} · {row.status.replace(/_/g, ' ')}</Text>
          </View>
          <Text style={[styles.amount, { color: ink }]}>{money(row.amountPaise)}</Text>
        </View>
        {payable && <View style={[styles.payBanner, { borderColor: blue }]}>
          <Text style={[styles.payBannerTitle, { color: blue }]}>PAY THIS DEPOSIT · EXPIRES IN {timeLabel}</Text>
          <Text style={[styles.body, { color: muted }]}>Receiver: {upiReceiver || 'zitch@ptyes'}</Text>
          <Text style={[styles.body, { color: muted }]}>Reference: {row.merchantReference}</Text>
          <View style={styles.qrWrap}><QRCode value={makeUpiIntent(upiReceiver || 'zitch@ptyes', row.amountPaise, row.merchantReference)} size={158} /></View>
          <TouchableOpacity style={[styles.button, { backgroundColor: blue }]} onPress={() => pay(row)} accessibilityRole="button"><Text style={styles.buttonText}>Pay this deposit</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.button, { borderColor: line, borderWidth: 1 }]} onPress={() => copy(upiReceiver || 'zitch@ptyes', 'Receiver UPI ID')} accessibilityRole="button"><Text style={[styles.secondaryText, { color: ink }]}>Copy receiver UPI ID</Text></TouchableOpacity>
          <Text style={[styles.small, { color: muted }]}>PaisaPay cannot confirm a UPI app success screen. Do not pay twice for this reference.</Text>
        </View>}
        {unpaid && seconds === 0 && <Text style={[styles.warningText, { color: warning }]}>Request expired. If you already paid, submit a transaction image for review; do not pay again.</Text>}
        {row.status === 'CANCELLED' && <Text style={[styles.warningText, { color: muted }]}>Cancelled. If you paid before cancelling, submit a transaction image for independent review.</Text>}
        {claimPending && <Text style={[styles.body, { color: warning }]}>Payment details submitted. Finance is checking merchant records; this deposit has not been verified yet.</Text>}
        {row.manualPaymentClaim?.status && <Text style={[styles.small, { color: muted }]}>Manual review: {row.manualPaymentClaim.status.replace(/_/g, ' ')}</Text>}
        {claimCanSubmit && <View style={styles.claimBox}>
          <Text style={[styles.body, { color: ink }]}>{lateClaimAllowed ? 'Already paid this request? Upload the transaction image for manual review. Do not repay an expired/cancelled deposit.' : 'Already paid? Upload the transaction image for manual review.'}</Text>
          <Text style={[styles.small, { color: muted }]}>Transaction ID / UTR is optional. A transaction image is required. Finance independently checks the merchant records; an image alone does not verify payment.</Text>
          <TextInput value={claimRefs[row.id] || ''} onChangeText={(value) => setClaimRefs((current) => ({ ...current, [row.id]: value.replace(/\D/g, '').slice(0, 12) }))} placeholder="Transaction ID / UTR (optional)" placeholderTextColor={muted} keyboardType="number-pad" maxLength={12} autoCapitalize="none" autoCorrect={false} style={[styles.input, { color: ink, borderColor: line }]} accessibilityLabel="Optional 12-digit transaction ID or UTR" />
          <View style={styles.imageActions}><TouchableOpacity style={[styles.button, styles.imageButton, { borderColor: line, borderWidth: 1 }]} onPress={() => chooseEvidence(row, 'library')} accessibilityRole="button"><Text style={[styles.secondaryText, { color: ink }]}>Choose screenshot</Text></TouchableOpacity><TouchableOpacity style={[styles.button, styles.imageButton, { borderColor: line, borderWidth: 1 }]} onPress={() => chooseEvidence(row, 'camera')} accessibilityRole="button"><Text style={[styles.secondaryText, { color: ink }]}>Take photo</Text></TouchableOpacity></View>
          {claimImages[row.id] && <View style={styles.imagePreview}><Image source={{ uri: claimImages[row.id].uri }} style={styles.preview} resizeMode="cover" /><Text numberOfLines={1} style={[styles.small, { color: muted }]}>Transaction screenshot attached · {claimImages[row.id].mimeType}</Text></View>}
          <TouchableOpacity disabled={checkingId === row.id} style={[styles.button, { backgroundColor: blue, opacity: checkingId === row.id ? 0.6 : 1 }]} onPress={() => submitClaim(row)}><Text style={styles.buttonText}>{checkingId === row.id ? 'Submitting…' : 'Submit payment proof'}</Text></TouchableOpacity>
        </View>}
        {payable && !claimPending && <TouchableOpacity style={[styles.cancelButton, { borderColor: line }]} onPress={() => cancel(row)} accessibilityRole="button"><Text style={{ color: muted, fontWeight: '800' }}>Cancel deposit</Text></TouchableOpacity>}
        {row.createdAt && <Text style={[styles.small, { color: muted }]}>Created {new Date(row.createdAt).toLocaleString()}</Text>}
      </Animated.View>;
    }) : <View style={[styles.empty, { backgroundColor: card }]}><Text style={[styles.body, { color: muted }]}>{empty || 'No deposit requests yet.'}</Text></View>}
    <TouchableOpacity style={[styles.button, { borderColor: line, borderWidth: 1 }]} onPress={onRefresh} accessibilityRole="button"><Text style={[styles.secondaryText, { color: ink }]}>Refresh status</Text></TouchableOpacity>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 36, gap: 12 },
  header: { marginBottom: 2 },
  title: { fontSize: 24, fontWeight: '900' },
  subtitle: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  notice: { padding: 13, borderRadius: 14, borderWidth: 1 },
  noticeTitle: { fontSize: 13, fontWeight: '900' },
  noticeBody: { fontSize: 11, lineHeight: 17, marginTop: 5 },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  depositId: { fontSize: 12, fontWeight: '900' },
  status: { fontSize: 10, fontWeight: '800', marginTop: 4 },
  amount: { fontSize: 15, fontWeight: '900' },
  payBanner: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 7 },
  payBannerTitle: { fontSize: 11, fontWeight: '900' },
  body: { fontSize: 11, lineHeight: 17 },
  qrWrap: { alignSelf: 'center', padding: 10, backgroundColor: '#FFFFFF', borderRadius: 8, marginVertical: 3 },
  button: { borderRadius: 11, paddingVertical: 11, paddingHorizontal: 12, alignItems: 'center', marginTop: 3 },
  buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  secondaryText: { fontSize: 11, fontWeight: '800' },
  small: { fontSize: 9, lineHeight: 14 },
  warningText: { fontSize: 11, lineHeight: 17, fontWeight: '700' },
  claimBox: { gap: 6, paddingTop: 5 },
  imageActions: { flexDirection: 'row', gap: 8 },
  imageButton: { flex: 1 },
  imagePreview: { alignItems: 'center', gap: 4, padding: 8, borderRadius: 10, backgroundColor: '#FFFFFF10' },
  preview: { width: 150, height: 100, borderRadius: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, fontSize: 12 },
  cancelButton: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11 },
  empty: { padding: 22, borderRadius: 14, alignItems: 'center' },
});
