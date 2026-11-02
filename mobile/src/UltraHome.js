import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { apiGet } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const promoBanners = [
  require('../assets/paisapay-7-percent-banner.png'),
  require('../assets/paisapay-daily-earn-banner.png'),
  require('../assets/paisapay-rules-banner.png'),
];

export default function UltraHome({ balance, pendingBalance, reservedBalance, rewardProfitPaise = 0, vipData, withdrawalPendingBalance, withdrawals = [], deposits = [], transactions = [], notifications = [], name, userId, go, note, colors }) {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [withdrawalOffers, setWithdrawalOffers] = useState(() => withdrawals.filter((item) => item.referenceId));
  const entrance = useRef(new Animated.Value(0)).current;
  const bannerSlide = useRef(new Animated.Value(0)).current;
  const [bannerIndex, setBannerIndex] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const bannerWidth = Math.max(1, windowWidth - 32);
  const lowBalanceNoticeInFlight = useRef(false);
  const lowBalancePermissionDeclined = useRef(false);
  const palette = colors;
  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, useNativeDriver: true, speed: 17, bounciness: 3 }).start();
    return () => entrance.stopAnimation();
  }, [entrance]);
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      Animated.timing(bannerSlide, { toValue: -bannerWidth, duration: 280, useNativeDriver: true }).start(({ finished }) => {
        if (!finished || !active) return;
        setBannerIndex((current) => (current + 1) % promoBanners.length);
        bannerSlide.setValue(bannerWidth);
        Animated.timing(bannerSlide, { toValue: 0, duration: 280, useNativeDriver: true }).start();
      });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
      bannerSlide.stopAnimation();
    };
  }, [bannerSlide, bannerWidth]);
  useEffect(() => {
    let active = true;
    const loadOffers = async () => {
      try {
        const result = await apiGet('/api/v1/withdrawals');
        if (active) setWithdrawalOffers(result.offers || []);
      } catch { /* Keep the last server-confirmed offer list visible while offline. */ }
    };
    void loadOffers();
    const timer = setInterval(loadOffers, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    const cachedOffers = withdrawals.filter((item) => item.referenceId);
    if (cachedOffers.length) setWithdrawalOffers(cachedOffers);
  }, [withdrawals]);
  useEffect(() => {
    const currentBalance = Number(balance);
    if (!Number.isFinite(currentBalance)) return undefined;

    const markerKey = `paisapay.low-balance-alert.v1.${String(userId || 'account').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    if (currentBalance >= 20_000) {
      lowBalancePermissionDeclined.current = false;
      void SecureStore.deleteItemAsync(markerKey).catch(() => {});
      return undefined;
    }
    if (lowBalanceNoticeInFlight.current || lowBalancePermissionDeclined.current) return undefined;

    lowBalanceNoticeInFlight.current = true;
    const notifyOnce = async () => {
      try {
        if (await SecureStore.getItemAsync(markerKey)) return;
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('account-alerts', {
            name: 'Account alerts',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }
        let permission = await Notifications.getPermissionsAsync();
        if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
        if (permission.status !== 'granted') {
          lowBalancePermissionDeclined.current = true;
          return;
        }

        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'PaisaPay · Low balance 🪙',
            body: 'Your wallet balance is below ₹200. Add money to continue using PaisaPay. Rewards depend on eligibility and are not guaranteed.',
            ...(Platform.OS === 'android' ? { channelId: 'account-alerts' } : {}),
          },
          trigger: null,
        });
        await SecureStore.setItemAsync(markerKey, 'sent');
      } catch {
        // Keep the in-app banner available if device notifications are unavailable.
      } finally {
        lowBalanceNoticeInFlight.current = false;
      }
    };
    void notifyOnce();
    return undefined;
  }, [balance, userId]);
  const pendingStatuses = ['OPEN', 'PENDING_MATCH', 'PARTIALLY_MATCHED', 'MATCHED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'DISPUTED'];
  const p2pWithdrawalPendingPaise = withdrawalOffers.filter((offer) => pendingStatuses.includes(offer.status)).reduce((total, offer) => {
    const completedPaise = (offer.orders || []).filter((order) => order.status === 'COMPLETED').reduce((sum, order) => sum + Number(order.amountPaise || 0), 0);
    return total + Math.max(0, Number(offer.amountPaise || 0) - completedPaise);
  }, 0);
  const totalWithdrawalPendingPaise = Number(withdrawalPendingBalance || 0) + p2pWithdrawalPendingPaise;
  return <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
    <View style={styles.welcomeRow}>
      <View style={styles.brandGroup}>
        <Image source={require('../assets/paisapay-neon-logo.png')} resizeMode="cover" style={styles.logo} />
        <View style={{ flexShrink: 1 }}>
          <Text style={[styles.eyebrow, { color: palette.muted }]}>WELCOME BACK</Text>
          <Text style={[styles.welcome, { color: palette.ink }]} numberOfLines={1}>{name?.trim() || 'PaisaPay member'}</Text>
        </View>
      </View>
      <TouchableOpacity accessibilityLabel="Notifications" onPress={() => go('Notifications')} style={[styles.notification, { backgroundColor: palette.card, borderColor: palette.line }]}>
        <Text style={{ fontSize: 19, color: palette.ink }}>♧</Text>
        {notifications.length > 0 && <View style={[styles.dot, { backgroundColor: palette.cyan }]} />}
      </TouchableOpacity>
    </View>

    <View style={[styles.promoBannerFrame, { backgroundColor: palette.surface, borderColor: palette.gold }]}>
      <View style={styles.promoBannerViewport}>
        <Animated.Image
          accessibilityLabel={['PaisaPay 7 percent commission banner', 'PaisaPay daily earnings banner', 'PaisaPay rules banner'][bannerIndex]}
          source={promoBanners[bannerIndex]}
          resizeMode="stretch"
          style={[styles.promoBanner, { transform: [{ translateX: bannerSlide }] }]}
        />
      </View>
    </View>

    <Animated.View style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [11, 0] }) }] }}>
    <View style={[styles.wallet, { backgroundColor: palette.navy, borderColor: palette.electric }]}>
      <View style={styles.walletTop}>
        <View><Text style={styles.walletCaption}>AVAILABLE BALANCE</Text><Text style={styles.currency}>INR · WALLET</Text></View>
        <TouchableOpacity accessibilityLabel={balanceVisible ? 'Hide balance' : 'Show balance'} onPress={() => setBalanceVisible((v) => !v)} style={styles.eye}><Text style={styles.eyeText}>{balanceVisible ? '◉' : '⊘'}</Text></TouchableOpacity>
      </View>
      <Text style={styles.balance}>{balanceVisible ? money(balance) : '₹ ••••••'}</Text>
      <Text style={styles.walletFoot}>Server-reported available funds</Text>
      <View style={styles.balanceTiles}>
        <View style={styles.balanceTile}><Text style={styles.tileLabel}>TOTAL REWARD PROFIT</Text><Text style={styles.tileValue}>{balanceVisible ? money(rewardProfitPaise) : '₹ •••'}</Text></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="View pending withdrawal requests" activeOpacity={0.8} onPress={() => go('Withdrawals')} style={styles.balanceTile}><Text style={styles.tileLabel}>WITHDRAWAL PENDING</Text><Text style={styles.tileValue}>{balanceVisible ? money(totalWithdrawalPendingPaise) : '₹ •••'}</Text><Text style={styles.pendingHint}>View pending requests ›</Text></TouchableOpacity>
      </View>
      <View style={styles.walletButtons}>
        <TouchableOpacity accessibilityRole="button" onPress={() => go('Deposit')} activeOpacity={0.8} style={[styles.primaryButton, { backgroundColor: palette.blue }]}><Text style={styles.primaryText}>＋  Add Money</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={() => go('Withdrawals')} activeOpacity={0.8} style={styles.secondaryButton}><Text style={styles.secondaryText}>↑  Withdraw</Text></TouchableOpacity>
      </View>
    </View>
    </Animated.View>

    {balance !== null && balance !== undefined && Number.isFinite(Number(balance)) && Number(balance) < 20_000 && <View style={[styles.lowBalanceBanner, { backgroundColor: palette.warningSurface, borderColor: palette.gold }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.lowBalanceTitle, { color: palette.warningText }]}>Low wallet balance 🪙</Text>
        <Text style={[styles.lowBalanceCopy, { color: palette.warningText }]}>Balance below ₹200. Add money to continue your daily PaisaPay activity 💸</Text>
        <Text style={[styles.lowBalanceNote, { color: palette.muted }]}>Rewards depend on eligibility and are not guaranteed.</Text>
      </View>
      <TouchableOpacity accessibilityRole="button" onPress={() => go('Deposit')} style={[styles.lowBalanceAction, { backgroundColor: palette.blue }]}><Text style={styles.lowBalanceActionText}>Add Money</Text></TouchableOpacity>
    </View>}

    <Animated.View style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="View VIP levels and progress" activeOpacity={0.88} onPress={() => go('VIP Levels')} style={[styles.vipCard, { backgroundColor: palette.card, borderColor: palette.gold }]}>
        <View style={styles.vipTopRow}>
          <View style={styles.vipHeading}>
            <View style={[styles.vipGem, { backgroundColor: palette.warningSurface }]}><Text style={{ color: palette.gold, fontSize: 20 }}>✦</Text></View>
            <View><Text style={[styles.vipEyebrow, { color: palette.gold }]}>PAISAPAY REWARDS</Text><Text style={[styles.vipTitle, { color: palette.ink }]}>VIP levels</Text></View>
          </View>
          <View style={[styles.vipPreviewPill, { backgroundColor: vipData?.programStatus === 'ACTIVE' ? palette.successSurface : palette.warningSurface }]}><Text style={{ color: vipData?.programStatus === 'ACTIVE' ? palette.green : palette.warningText, fontSize: 9, fontWeight: '900' }}>{vipData?.programStatus === 'ACTIVE' ? `VIP ${vipData.currentLevel || 0} ACTIVE` : 'CONNECTING'}</Text></View>
        </View>
        <View style={[styles.vipRewardStrip, { backgroundColor: palette.navy, borderColor: palette.gold }]}>
          <Text style={styles.vipRewardAmount}>{vipData ? `${vipData.activeLevels || 0}/5` : '—'}</Text>
          <View style={{ flex: 1 }}><Text style={styles.vipRewardLabel}>LIVE VERIFIED PROGRESS</Text><Text style={styles.vipRewardSub}>VIP rewards are credited only when funded</Text></View>
          <Text style={styles.vipSparkle}>✧</Text>
        </View>
        <View style={styles.vipTargets}>
          {(vipData?.levels || []).map((item, index) => <View key={item.levelNumber} style={[styles.vipTarget, index === 4 && { width: '100%' }, { backgroundColor: palette.surface, borderColor: item.achieved ? palette.gold : palette.line }]}>
            <View style={[styles.vipLevelDot, { backgroundColor: item.achieved ? palette.gold : palette.blue }]}><Text style={styles.vipLevelDotText}>{item.levelNumber}</Text></View>
            <View style={{ flex: 1 }}><Text style={[styles.vipLevelName, { color: palette.ink }]}>{item.displayName}</Text><Text numberOfLines={1} style={[styles.vipTargetText, { color: palette.muted }]}>{item.achieved ? 'Achieved' : `${money(item.currentPaise)} / ${money(item.targetPaise)}`}</Text></View>
            <Text style={[styles.vipMiniReward, { color: palette.gold }]}>{item.rewardStatus === 'CREDITED' ? 'PAID' : money(item.rewardPaise)}</Text>
          </View>)}
        </View>
        <View style={styles.vipFooter}>
          <Text style={[styles.vipNote, { color: palette.muted }]}>{vipData?.programStatus === 'ACTIVE' ? 'Calculated from completed, finance-verified activity.' : 'VIP progress is loading from your account.'}</Text>
          <Text style={{ color: palette.cyan, fontSize: 18, fontWeight: '900' }}>›</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>

    <TouchableOpacity onPress={() => go('Support')} activeOpacity={0.8} style={[styles.help, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 14 }}>Need a hand?</Text><Text style={{ color: palette.muted, marginTop: 4, fontSize: 12 }}>Open support or review your tickets.</Text></View><Text style={{ color: palette.cyan, fontSize: 22 }}>›</Text>
    </TouchableOpacity>
    <Text style={[styles.disclosure, { color: palette.muted }]}>UPI deposits remain pending until independently verified. Bank payouts are shown only when an authorized payout service is available.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 26 },
  promoBannerFrame: { width: '100%', padding: 2, borderWidth: 1.5, borderRadius: 17, marginBottom: 12, shadowColor: '#F5A623', shadowOpacity: 0.45, shadowRadius: 9, shadowOffset: { width: 0, height: 2 }, elevation: 7 },
  promoBannerViewport: { width: '100%', height: 76, borderRadius: 13, overflow: 'hidden' },
  promoBanner: { width: '100%', height: 76, alignSelf: 'center', backgroundColor: 'transparent' },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  brandGroup: { flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1 },
  logo: { height: 46, width: 46, borderRadius: 14 },
  eyebrow: { fontSize: 10, letterSpacing: 1.1, fontWeight: '800' },
  welcome: { fontSize: 18, fontWeight: '900', marginTop: 3 },
  notification: { height: 44, width: 44, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dot: { position: 'absolute', right: 9, top: 8, width: 7, height: 7, borderRadius: 4 },
  wallet: { padding: 19, borderRadius: 26, borderWidth: 1, marginBottom: 22, overflow: 'hidden', elevation: 8, shadowColor: '#176BFF', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  walletTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  walletCaption: { color: '#B9D5FF', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  currency: { color: '#7FA8DC', fontSize: 9, fontWeight: '800', marginTop: 4, letterSpacing: 1 },
  eye: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#FFFFFF18', alignItems: 'center', justifyContent: 'center' },
  eyeText: { color: 'white', fontSize: 17 },
  balance: { color: 'white', fontWeight: '900', fontSize: 32, marginTop: 17, letterSpacing: 0.2 },
  walletFoot: { color: '#9DB7D7', fontSize: 11, marginTop: 3 },
  balanceTiles: { flexDirection: 'row', gap: 9, marginTop: 18 },
  balanceTile: { flex: 1, borderRadius: 14, padding: 11, backgroundColor: '#FFFFFF12' },
  tileLabel: { color: '#AFC8E8', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  tileValue: { color: 'white', fontSize: 14, fontWeight: '800', marginTop: 6 },
  pendingHint: { color: '#B9D5FF', fontSize: 8, fontWeight: '800', marginTop: 5 },
  lowBalanceBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 18, padding: 14, marginTop: -8, marginBottom: 18 }, lowBalanceTitle: { fontSize: 13, fontWeight: '900' }, lowBalanceCopy: { fontSize: 11, lineHeight: 16, marginTop: 4 }, lowBalanceNote: { fontSize: 9, lineHeight: 13, marginTop: 4 }, lowBalanceAction: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }, lowBalanceActionText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  walletButtons: { flexDirection: 'row', gap: 9, marginTop: 16 },
  primaryButton: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: 'white', fontSize: 13, fontWeight: '900' },
  secondaryButton: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF18', borderWidth: 1, borderColor: '#FFFFFF2C' },
  secondaryText: { color: 'white', fontSize: 13, fontWeight: '900' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11, marginTop: 2 },
  sectionTitle: { fontSize: 17, fontWeight: '900' },
  vipCard: { borderWidth: 1.5, borderRadius: 23, padding: 15, marginBottom: 16, overflow: 'hidden', elevation: 8, shadowColor: '#F5A623', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  vipTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  vipHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vipGem: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F5A62355' },
  vipEyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  vipTitle: { fontSize: 16, fontWeight: '900', marginTop: 2 },
  vipPreviewPill: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  vipRewardStrip: { flexDirection: 'row', alignItems: 'center', borderRadius: 17, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 13, marginBottom: 11 },
  vipRewardAmount: { color: '#FFD166', fontSize: 25, fontWeight: '900', marginRight: 12, textShadowColor: '#F5A62388', textShadowRadius: 8 },
  vipRewardLabel: { color: 'white', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  vipRewardSub: { color: '#CBD5E1', fontSize: 10, marginTop: 3 },
  vipSparkle: { color: '#FFD166', fontSize: 24, marginLeft: 6 },
  vipTargets: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  vipTarget: { width: '48%', minHeight: 53, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 7 },
  vipLevelDot: { width: 25, height: 25, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  vipLevelDotText: { color: 'white', fontSize: 10, fontWeight: '900' },
  vipLevelName: { fontSize: 10, fontWeight: '900' },
  vipTargetText: { fontSize: 8, marginTop: 2 },
  vipMiniReward: { fontSize: 10, fontWeight: '900', marginLeft: 4 },
  vipFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  vipNote: { fontSize: 9, flex: 1 },
  help: { flexDirection: 'row', alignItems: 'center', padding: 15, borderWidth: 1, borderRadius: 18, marginBottom: 12 },
  disclosure: { fontSize: 10, lineHeight: 16, paddingHorizontal: 3 },
});
