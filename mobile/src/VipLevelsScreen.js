import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const metricLabel = (metric) => metric === 'SETTLED_WITHDRAWAL_PAISE' ? 'Settled withdrawal amount' : 'Finance-verified completed order value';

export default function VipLevelsScreen({ colors, vipData, refresh }) {
  const palette = colors;
  const [data, setData] = useState(vipData || null);
  const [loading, setLoading] = useState(!vipData);
  const [error, setError] = useState('');

  useEffect(() => setData(vipData || null), [vipData]);
  useEffect(() => {
    let active = true;
    if (refresh) {
      setLoading(true);
      refresh().then((result) => { if (active) { setData(result); setError(''); } })
        .catch((failure) => { if (active) setError(failure?.message || 'Could not load VIP progress.'); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, []);

  const reload = async () => {
    if (!refresh) return;
    setLoading(true);
    try { setData(await refresh()); setError(''); }
    catch (failure) { setError(failure?.message || 'Could not load VIP progress.'); }
    finally { setLoading(false); }
  };

  return <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
    <View style={[styles.hero, { backgroundColor: palette.navy, borderColor: palette.gold }]}>
      <View style={styles.heroTop}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>✦</Text></View>
        <View style={[styles.activeBadge, { backgroundColor: data?.programStatus === 'ACTIVE' ? '#123629' : '#3B2D12' }]}>
          <Text style={{ color: data?.programStatus === 'ACTIVE' ? '#12B981' : '#FCD34D', fontSize: 9, fontWeight: '900' }}>{data?.programStatus === 'ACTIVE' ? 'ACTIVE PROGRAM' : 'SETTING UP'}</Text>
        </View>
      </View>
      <Text style={styles.heroEyebrow}>PAISAPAY REWARDS</Text>
      <Text style={styles.heroTitle}>{data ? `VIP ${data.currentLevel || 0}` : 'VIP progress'}</Text>
      <Text style={styles.heroCopy}>Progress uses completed P2P transactions independently verified by PaisaPay Finance.</Text>
      <View style={styles.summaryRow}>
        <View style={styles.summaryCell}><Text style={styles.summaryAmount}>{data?.activeLevels ?? '—'}/5</Text><Text style={styles.summaryLabel}>LEVELS ACHIEVED</Text></View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCell}><Text style={styles.summaryAmount}>{money(data?.volume?.settledWithdrawalPaise)}</Text><Text style={styles.summaryLabel}>SETTLED WITHDRAWALS</Text></View>
      </View>
    </View>

    <View style={styles.titleRow}>
      <View><Text style={[styles.sectionTitle, { color: palette.ink }]}>Your level progress</Text><Text style={[styles.sectionHint, { color: palette.muted }]}>Verified amounts update after Finance approval</Text></View>
      <TouchableOpacity accessibilityRole="button" onPress={reload} disabled={loading} style={[styles.refreshButton, { borderColor: palette.line }]}><Text style={{ color: palette.blue, fontWeight: '900', fontSize: 11 }}>{loading ? '…' : 'REFRESH'}</Text></TouchableOpacity>
    </View>

    {loading && !data && <View style={[styles.loading, { backgroundColor: palette.card, borderColor: palette.line }]}><ActivityIndicator color={palette.blue} /><Text style={{ color: palette.muted, marginTop: 9 }}>Loading verified VIP progress…</Text></View>}
    {!!error && <View style={[styles.errorCard, { backgroundColor: palette.warningSurface, borderColor: palette.gold }]}><Text style={{ color: palette.warningText, fontWeight: '800' }}>{error}</Text><TouchableOpacity onPress={reload} style={styles.retry}><Text style={{ color: palette.blue, fontWeight: '900' }}>Try again</Text></TouchableOpacity></View>}

    {(data?.levels || []).map((item) => {
      const percent = Math.max(0, Math.min(100, Number(item.progressPercent || 0)));
      const rewardText = item.rewardStatus === 'CREDITED' ? `Credited ${money(item.creditedPaise)}` : item.achieved ? `Eligible · ${money(item.rewardPaise)} pending funded reward pool` : `${money(item.rewardPaise)} milestone reward`;
      return <View key={item.levelNumber} style={[styles.levelCard, { backgroundColor: palette.card, borderColor: item.achieved ? palette.gold : palette.line }]}>
        <View style={styles.levelHeader}>
          <View style={[styles.levelBadge, { backgroundColor: item.achieved ? '#FFF2C2' : palette.surface, borderColor: item.achieved ? palette.gold : palette.line }]}>
            <Text style={[styles.levelNumber, { color: item.achieved ? '#9A6700' : palette.blue }]}>{item.levelNumber}</Text><Text style={[styles.levelLabel, { color: item.achieved ? '#9A6700' : palette.muted }]}>VIP</Text>
          </View>
          <View style={{ flex: 1 }}><Text style={[styles.levelName, { color: palette.ink }]}>{item.displayName}</Text><Text style={[styles.levelMetric, { color: palette.muted }]}>{metricLabel(item.metric)}</Text></View>
          <View style={[styles.statusPill, { backgroundColor: item.achieved ? palette.successSurface : palette.surface }]}><Text style={{ color: item.achieved ? palette.green : palette.muted, fontSize: 8, fontWeight: '900' }}>{item.achieved ? 'ACHIEVED' : 'IN PROGRESS'}</Text></View>
        </View>
        <View style={styles.amountRow}><Text style={[styles.currentAmount, { color: palette.ink }]}>{money(item.currentPaise)}</Text><Text style={[styles.targetAmount, { color: palette.muted }]}>of {money(item.targetPaise)}</Text></View>
        <View style={[styles.track, { backgroundColor: palette.line }]}><View style={[styles.fill, { width: `${percent}%`, backgroundColor: item.achieved ? palette.green : palette.blue }]} /></View>
        <View style={styles.bottomRow}><Text style={[styles.rewardStatus, { color: item.rewardStatus === 'CREDITED' ? palette.green : item.achieved ? palette.warningText : palette.muted }]}>{rewardText}</Text><Text style={[styles.percent, { color: palette.blue }]}>{percent}%</Text></View>
      </View>;
    })}

    {data?.programStatus === 'SETUP_REQUIRED' && <View style={[styles.errorCard, { backgroundColor: palette.warningSurface, borderColor: palette.gold }]}><Text style={{ color: palette.warningText, fontWeight: '800' }}>VIP configuration needs setup. Run the VIP configuration seed on the backend.</Text></View>}
    {!!data && <View style={[styles.notice, { backgroundColor: palette.surface, borderColor: palette.line }]}><Text style={[styles.noticeTitle, { color: palette.ink }]}>Reward credit status</Text><Text style={[styles.noticeCopy, { color: palette.muted }]}>{data.rewardPolicy}</Text></View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 30 },
  hero: { borderRadius: 25, borderWidth: 1.5, padding: 20, overflow: 'hidden', marginBottom: 22, elevation: 9, shadowColor: '#F5A623', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 7 } },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 },
  brandMark: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#F5A62322', borderWidth: 1, borderColor: '#F5A62388', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#FFD166', fontSize: 23, fontWeight: '900' },
  activeBadge: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  heroEyebrow: { color: '#FFD166', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  heroTitle: { color: 'white', fontSize: 27, fontWeight: '900', marginTop: 5 },
  heroCopy: { color: '#CBD5E1', fontSize: 11, lineHeight: 17, marginTop: 6 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 17, marginTop: 18, padding: 12, backgroundColor: '#FFFFFF14', borderWidth: 1, borderColor: '#FFFFFF22' },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryAmount: { color: '#FFD166', fontSize: 19, fontWeight: '900' },
  summaryLabel: { color: '#E2E8F0', fontSize: 8, marginTop: 4, textAlign: 'center' },
  summaryDivider: { width: 1, height: 35, backgroundColor: '#FFFFFF40' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  sectionTitle: { fontSize: 17, fontWeight: '900' },
  sectionHint: { fontSize: 9, marginTop: 3 },
  refreshButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  loading: { borderWidth: 1, borderRadius: 17, padding: 20, alignItems: 'center', marginBottom: 11 },
  errorCard: { borderWidth: 1, borderRadius: 15, padding: 13, marginBottom: 11 },
  retry: { marginTop: 9, alignSelf: 'flex-start' },
  levelCard: { borderWidth: 1, borderRadius: 19, padding: 13, marginBottom: 10, elevation: 3, shadowColor: '#0B1B33', shadowOpacity: 0.06, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  levelHeader: { flexDirection: 'row', alignItems: 'center' },
  levelBadge: { width: 43, height: 45, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  levelNumber: { fontSize: 16, fontWeight: '900', lineHeight: 18 },
  levelLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 0.7, marginTop: 2 },
  levelName: { fontSize: 13, fontWeight: '900' },
  levelMetric: { fontSize: 8, marginTop: 3 },
  statusPill: { paddingHorizontal: 7, paddingVertical: 6, borderRadius: 8 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 13 },
  currentAmount: { fontSize: 18, fontWeight: '900' },
  targetAmount: { fontSize: 10, marginLeft: 5 },
  track: { height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 8 },
  fill: { height: 7, borderRadius: 4 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 9 },
  rewardStatus: { fontSize: 9, fontWeight: '800', flex: 1, paddingRight: 6 },
  percent: { fontSize: 10, fontWeight: '900' },
  notice: { borderRadius: 16, borderWidth: 1, padding: 13, marginTop: 4 },
  noticeTitle: { fontSize: 11, fontWeight: '900' },
  noticeCopy: { fontSize: 9, lineHeight: 14, marginTop: 4 },
});
