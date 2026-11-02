import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Modal, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function useEntrance() {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(value, { toValue: 1, duration: 320, useNativeDriver: true }).start();
    return () => value.stopAnimation();
  }, [value]);
  return value;
}

function Header({ title, subtitle, colors }) {
  return <View style={[styles.hero, { backgroundColor: colors.navy, borderColor: colors.cyan }]}>
    <View style={styles.heroTop}><View style={styles.heroIcon}><Text style={styles.heroIconText}>↗</Text></View><Text style={styles.heroBadge}>PAISAPAY TEAM</Text></View>
    <Text style={styles.heroTitle}>{title}</Text><Text style={styles.heroCopy}>{subtitle}</Text>
  </View>;
}

function Metric({ label, value, colors, accent = false }) {
  return <View style={[styles.metric, { backgroundColor: colors.card, borderColor: colors.line }]}>
    <Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text>
    <Text style={[styles.metricValue, { color: accent ? colors.cyan : colors.ink }]}>{value}</Text>
  </View>;
}

function Action({ title, subtitle, onPress, colors, secondary = false }) {
  return <TouchableOpacity accessibilityRole="button" activeOpacity={0.84} onPress={onPress} style={[styles.action, { backgroundColor: secondary ? colors.surface : colors.blue, borderColor: secondary ? colors.line : colors.blue }]}>
    <View style={{ flex: 1 }}><Text style={[styles.actionTitle, { color: secondary ? colors.ink : '#FFFFFF' }]}>{title}</Text>{subtitle ? <Text style={[styles.actionSubtitle, { color: secondary ? colors.muted : '#DBEAFE' }]}>{subtitle}</Text> : null}</View>
    <Text style={[styles.actionArrow, { color: secondary ? colors.blue : '#FFFFFF' }]}>›</Text>
  </TouchableOpacity>;
}

export function TeamScreen({ referrals, go, colors, refresh, note }) {
  const entrance = useEntrance();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('all');
  const [shareOpen, setShareOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const reload = async () => {
    if (!refresh) return;
    setLoading(true);
    try { await refresh(period); setError(''); } catch (e) { setError(e?.message || 'Could not refresh team data.'); }
    finally { setLoading(false); }
  };
  const changePeriod = async (next) => { setPeriod(next); setLoading(true); try { await refresh?.(next); setError(''); } catch (e) { setError(e?.message || 'Could not load this period.'); } finally { setLoading(false); } };
  const referralCode = referrals?.referralCode || '';
  const referralLink = referrals?.referralLink || (referralCode ? `paisapay://register?ref=${encodeURIComponent(referralCode)}` : '');
  const copyLink = async () => { try { await Clipboard.setStringAsync(referralLink); setShareOpen(false); note?.('Referral link copied', 'The referral code is included as a fallback.'); } catch { setError('Could not copy referral link.'); } };
  const shareLink = async (channel) => {
    const message = encodeURIComponent(`Join PaisaPay with my referral code ${referralCode}: ${referralLink}`);
    try {
      if (channel === 'more') await Share.share({ message: `Join PaisaPay with my referral code ${referralCode}: ${referralLink}` });
      else await Linking.openURL(channel === 'whatsapp' ? `whatsapp://send?text=${message}` : channel === 'telegram' ? `tg://msg?text=${message}` : `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`);
    } catch {
      try { await Share.share({ message: `Join PaisaPay with my referral code ${referralCode}: ${referralLink}` }); }
      catch { setError('Sharing is unavailable. Copy the referral link instead.'); }
    }
  };
  const moneyGradient = { backgroundColor: '#514D91' };
  const statusLabel = (status) => status === 'CREDITED' || status === 'SETTLED' ? 'Paid' : status === 'ELIGIBLE_PENDING_REVIEW' ? 'Review pending' : status === 'SETUP_REQUIRED' ? 'Setup needed' : status === 'PENDING' ? 'Pending funding' : 'In progress';
  const paidMilestoneCount=(referrals?.milestones||[]).filter(m=>m.status==='CREDITED'||m.status==='SETTLED').length;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
    <Animated.View style={{ opacity: entrance }}>
      <View style={styles.periodRow}>{[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All time']].map(([key, label]) => <TouchableOpacity key={key} onPress={() => changePeriod(key)} style={[styles.periodButton, { backgroundColor: period === key ? colors.blue : colors.card, borderColor: period === key ? colors.blue : colors.line }]}><Text style={{ color: period === key ? '#fff' : colors.muted, fontSize: 9, fontWeight: '900' }}>{label}</Text></TouchableOpacity>)}</View>
      <View style={[styles.earningCard, moneyGradient]}>
        <Text style={styles.earningLabel}>Total accrued</Text><Text style={styles.earningValue}>{money(referrals?.accruedCommissionPaise ?? referrals?.totalEarningsPaise ?? 0)}</Text>
        <Text style={styles.earningToday}>Today · {money(referrals?.todayEarningsPaise ?? 0)} accrued</Text>
        <View style={styles.earningDivider} />
        <View style={styles.earningSplit}><View style={styles.earningHalf}><Text style={styles.earningLabel}>Direct</Text><Text style={styles.earningSplitValue}>{money(referrals?.directEarningsPaise ?? 0)}</Text><Text style={styles.earningRate}>{Number(referrals?.commissionRates?.directBps ?? 40) / 100}% commission</Text></View><View style={styles.earningVLine} /><View style={styles.earningHalf}><Text style={styles.earningLabel}>Indirect</Text><Text style={styles.earningSplitValue}>{money(referrals?.indirectEarningsPaise ?? 0)}</Text><Text style={styles.earningRate}>{Number(referrals?.commissionRates?.indirectBps ?? 10) / 100}% commission</Text></View></View>
      </View>
      <View style={[styles.info, { backgroundColor: colors.warningSurface, borderColor: colors.gold }]}><Text style={[styles.infoCopy, { color: colors.warningText }]}>{referrals?.rewardFundingMessage || 'Accrued amounts are not wallet funds. Only verified eligible transactions count.'}</Text></View>
      <View style={[styles.milestonePanel, { backgroundColor: colors.card, borderColor: colors.line }]}>
        <View style={styles.sectionHeading}><View style={[styles.sectionIcon,{backgroundColor:colors.accentSurface}]}><Text style={{fontSize:16}}>🏅</Text></View><View style={{flex:1}}><Text style={[styles.commissionTitle, { color: colors.ink, marginBottom:2 }]}>Team recharge progress</Text><Text style={[styles.infoCopy,{color:colors.muted,marginTop:0}]}>Rewards require eligible referrals and verified top-ups</Text></View><Text style={[styles.donePill,{color:colors.muted,backgroundColor:colors.surface}]}>{paidMilestoneCount}/{(referrals?.milestones||[]).length} paid</Text></View>
        {(referrals?.milestones || []).map((milestone) => {
          const progress = Math.min(1, (milestone.qualifiedReferrals || 0) / Math.max(1, milestone.requiredReferrals));
          return <View key={milestone.key} style={[styles.milestoneCard, { borderColor: colors.line, backgroundColor: colors.surface }]}>
            <View style={styles.milestoneLayout}><View style={styles.milestoneAmount}><Text style={[styles.milestoneReward, { color: colors.gold }]}>{money(milestone.rewardAmountPaise)}</Text><Text style={[styles.infoCopy, { color: colors.muted,marginTop:2 }]}>Min {milestone.qualifyingTopUpPaise == null ? 'Admin setup' : `${money(milestone.qualifyingTopUpPaise)}/user`}</Text></View><View style={styles.milestoneProgress}><View style={styles.milestoneProgressTop}><Text style={[styles.infoCopy,{color:colors.muted,marginTop:0}]}>Target: {milestone.requiredReferrals} users</Text><Text style={[styles.memberName,{color:colors.ink}]}>{milestone.qualifiedReferrals}/{milestone.requiredReferrals}</Text></View><View style={[styles.progressTrack, { backgroundColor: colors.line }]}><View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.taupe || '#A79881' }]} /></View></View><Text style={[styles.doingPill,{backgroundColor:milestone.status==='PENDING'?colors.warningSurface:colors.accentSurface,color:milestone.status==='PENDING'?colors.warningText:colors.blue}]}>{statusLabel(milestone.status)}</Text></View>
          </View>;
        })}
        {!referrals?.milestones?.length ? <Text style={[styles.infoCopy, { color: colors.muted }]}>Reward rules are not configured yet.</Text> : null}
      </View>
      <View style={[styles.invitePanel,{backgroundColor:colors.card,borderColor:colors.line}]}><View style={styles.sectionHeading}><View style={[styles.sectionIcon,{backgroundColor:colors.accentSurface}]}><Text style={{fontSize:17}}>●</Text></View><View style={{flex:1}}><Text style={[styles.commissionTitle,{color:colors.ink,marginBottom:3}]}>Invite & Earn</Text><Text style={[styles.infoCopy,{color:colors.muted,marginTop:0}]}>Earn eligible referral commission</Text></View></View><View style={[styles.inviteHint,{backgroundColor:colors.surface}]}><Text style={{color:colors.green,fontSize:18,marginRight:8}}>↗</Text><Text style={[styles.infoCopy,{color:colors.muted,marginTop:0,flex:1}]}>Direct {Number(referrals?.commissionRates?.directBps??40)/100}% · Indirect {Number(referrals?.commissionRates?.indirectBps??10)/100}% on verified activity</Text></View><TouchableOpacity accessibilityRole="button" onPress={()=>setShareOpen(true)} style={styles.inviteButton}><Text style={styles.inviteButtonIcon}>✦</Text><Text style={styles.inviteButtonText}>Start inviting</Text></TouchableOpacity></View>
      <TouchableOpacity accessibilityRole="button" activeOpacity={0.85} onPress={()=>go('Members')} style={[styles.overviewPanel,{backgroundColor:colors.card,borderColor:colors.line}]}><View style={styles.sectionHeading}><Text style={{fontSize:18,marginRight:8}}>♧</Text><Text style={[styles.commissionTitle,{color:colors.ink,flex:1,marginBottom:0}]}>Team overview</Text><Text style={{color:colors.muted,fontSize:22}}>›</Text></View><View style={styles.overviewGrid}><OverviewTile label="Total members" value={String(referrals?.totalMembers??0)} colors={colors} tint={colors.accentSurface}/><OverviewTile label="Today new" value={`+${referrals?.todayNewMembers??0}`} colors={colors} tint="#F4FAF4"/><OverviewTile label="Direct" value={String(referrals?.directCount??0)} colors={colors} tint="#F3F4FB"/><OverviewTile label="Indirect" value={String(referrals?.indirectCount??0)} colors={colors} tint="#F1F8FC"/></View><View style={styles.overviewTotals}><View style={{flex:1}}><Text style={[styles.infoCopy,{color:colors.muted,marginTop:0}]}>Period verified deposits</Text><Text style={[styles.overviewMoney,{color:colors.gold}]}>{money(referrals?.periodVerifiedDepositsPaise??0)}</Text></View><View style={{flex:1}}><Text style={[styles.infoCopy,{color:colors.muted,marginTop:0}]}>Total verified deposits</Text><Text style={[styles.overviewMoney,{color:colors.blue}]}>{money(referrals?.totalVerifiedDepositsPaise??0)}</Text></View></View><View style={styles.overviewFoot}><Text style={[styles.infoCopy,{color:colors.muted,marginTop:0}]}>{referrals?.periodVerifiedDepositCount??0} verified deposits in selected period · {referrals?.totalVerifiedDepositCount??0} lifetime</Text></View></TouchableOpacity>
      {!!referrals?.commissionHistory?.length && <View style={[styles.commissionList, { backgroundColor: colors.card, borderColor: colors.line }]}><Text style={[styles.commissionTitle, { color: colors.ink }]}>Earnings activity</Text>{referrals.commissionHistory.slice(0, 5).map((entry) => <View key={entry.id} style={[styles.commissionRow, { borderBottomColor: colors.line }]}><View style={{ flex: 1 }}><Text style={[styles.commissionName, { color: colors.ink }]}>{entry.kind?.replaceAll('_', ' ') || 'Referral commission'}</Text><Text style={[styles.commissionDate, { color: colors.muted }]}>{new Date(entry.createdAt).toLocaleDateString()}</Text></View><View style={{ alignItems: 'flex-end' }}><Text style={[styles.commissionAmount, { color: colors.warningText }]}>{money(entry.amountPaise)}</Text><Text style={[styles.commissionStatus, { color: colors.warningText }]}>{entry.status === 'CREDITED' || entry.status === 'SETTLED' ? 'PAID' : 'PENDING FUNDING'}</Text></View></View>)}</View>}
      {error ? <Text style={[styles.error, { color: colors.red }]}>{error}</Text> : null}
      <Action title={loading ? 'Refreshing…' : 'Refresh team'} subtitle={`Fetch the latest ${period === 'all' ? 'lifetime' : period} data`} onPress={reload} colors={colors} secondary />
    </Animated.View>
    <Modal transparent animationType="slide" visible={shareOpen} onRequestClose={()=>setShareOpen(false)}><View style={styles.sheetBackdrop}><TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={()=>setShareOpen(false)}/><View style={[styles.shareSheet,{backgroundColor:colors.card}]}><View style={styles.sheetGrabber}/><TouchableOpacity onPress={()=>setShareOpen(false)} style={styles.sheetClose}><Text style={{color:colors.muted,fontSize:23}}>×</Text></TouchableOpacity><Text style={[styles.sheetTitle,{color:colors.ink}]}>Share & Earn</Text><Text style={[styles.sheetSubtitle,{color:colors.muted}]}>Invite friends and grow your eligible earnings</Text><View style={[styles.linkField,{backgroundColor:colors.surface}]}><Text numberOfLines={1} style={[styles.linkText,{color:colors.ink}]}>{referralLink||'Referral link loading…'}</Text><TouchableOpacity accessibilityRole="button" onPress={copyLink} style={[styles.copySquare,{backgroundColor:colors.line}]}><Text style={{fontSize:20,color:colors.ink}}>▢</Text></TouchableOpacity></View><TouchableOpacity accessibilityRole="button" disabled={!referralLink} onPress={()=>shareLink('more')} style={styles.sheetShareButton}><Text style={styles.sheetShareSpark}>✦</Text><Text style={styles.sheetShareText}>Share & Earn</Text></TouchableOpacity><Text style={[styles.recommended,{color:colors.muted}]}>Recommended</Text><View style={styles.sheetChannels}>{[['telegram','➤','Telegram','#E5F5FB','#229ED9'],['whatsapp','◉','WhatsApp','#E8F8EF','#25A765'],['facebook','f','Facebook','#E7F0FE','#1877F2'],['more','•••','More',colors.surface,colors.muted]].map(([id,icon,label,bg,fg])=><TouchableOpacity key={id} onPress={()=>shareLink(id)} style={styles.channel}><View style={[styles.channelIcon,{backgroundColor:bg}]}><Text style={{color:fg,fontSize:22,fontWeight:'900'}}>{icon}</Text></View><Text style={[styles.channelLabel,{color:colors.ink}]}>{label}</Text></TouchableOpacity>)}</View><TouchableOpacity accessibilityRole="button" onPress={()=>{setShareOpen(false);setQrOpen(true)}} style={[styles.qrRow,{borderColor:colors.line,backgroundColor:colors.surface}]}><Text style={{fontSize:19,color:colors.taupe||'#A79881',marginRight:12}}>▦</Text><Text style={[styles.qrRowTitle,{color:colors.ink,flex:1}]}>Show QR Code</Text><Text style={{color:colors.muted,fontSize:22}}>›</Text></TouchableOpacity></View></View></Modal>
    <Modal transparent animationType="fade" visible={qrOpen} onRequestClose={()=>setQrOpen(false)}><View style={styles.qrBackdrop}><View style={[styles.qrModal,{backgroundColor:colors.card}]}><TouchableOpacity onPress={()=>setQrOpen(false)} style={styles.sheetClose}><Text style={{color:colors.muted,fontSize:23}}>×</Text></TouchableOpacity><Text style={[styles.sheetTitle,{color:colors.ink}]}>Your referral QR</Text><Text style={[styles.sheetSubtitle,{color:colors.muted}]}>{referralCode}</Text>{referralLink?<View style={styles.qrWrap}><QRCode value={referralLink} size={210} color={colors.navy} backgroundColor="#FFFFFF"/></View>:<ActivityIndicator color={colors.blue}/>}<Text style={[styles.qrHint,{color:colors.muted}]}>If the app link does not open, enter this code during registration.</Text><TouchableOpacity onPress={()=>{setQrOpen(false);setShareOpen(true)}} style={styles.inviteButton}><Text style={styles.inviteButtonText}>Share referral</Text></TouchableOpacity></View></View></Modal>
  </ScrollView>;
}

function OverviewTile({label,value,colors,tint}) { return <View style={[styles.overviewTile,{backgroundColor:tint||colors.surface}]}><Text style={[styles.overviewLabel,{color:colors.muted}]}>{label}</Text><Text style={[styles.overviewValue,{color:colors.ink}]}>{value}</Text></View>; }

export function MembersScreen({ referrals, colors, refresh }) {
  const entrance = useEntrance();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('direct');
  const reload = async () => {
    if (!refresh) return;
    setLoading(true);
    try { await refresh(); setError(''); } catch (e) { setError(e?.message || 'Could not refresh members.'); }
    finally { setLoading(false); }
  };
  const allRows = referrals?.members || [];
  const rows = useMemo(() => allRows.filter((member) => (tab === 'direct' ? member.depth === 1 : member.depth === 2) && `${member.displayName || ''} ${member.permittedIdentifier || ''}`.toLowerCase().includes(query.trim().toLowerCase())), [allRows, query, tab]);
  const memberCount = tab === 'direct' ? referrals?.directCount ?? 0 : referrals?.indirectCount ?? 0;
  const totalEarned = rows.reduce((sum,member)=>sum+Number(member.earningsGeneratedPaise||0),0);
  return <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <Animated.View style={{ opacity: entrance }}>
      <Header title="Team members" subtitle="Names and masked phone identifiers protect member privacy." colors={colors} />
      <View style={[styles.memberTabs,{backgroundColor:colors.card,borderColor:colors.line}]}>{[['direct','Direct team',referrals?.directCount??0],['indirect','Indirect team',referrals?.indirectCount??0]].map(([id,label,count])=><TouchableOpacity key={id} accessibilityRole="tab" accessibilityState={{selected:tab===id}} onPress={()=>{setTab(id);setQuery('')}} style={[styles.memberTab,tab===id&&{borderBottomColor:colors.blue,borderBottomWidth:3}]}><Text style={[styles.memberTabText,{color:tab===id?colors.blue:colors.muted}]}>{label}</Text><Text style={[styles.memberTabCount,{color:tab===id?colors.blue:colors.muted}]}>{count}</Text></TouchableOpacity>)}</View>
      <View style={[styles.memberSummary,{backgroundColor:'#57518D'}]}><View style={{flex:1}}><Text style={styles.summaryLabel}>{tab==='direct'?'Direct members':'Indirect members'}</Text><Text style={styles.summaryCount}>{memberCount}</Text></View><View style={styles.summaryDivider}/><View style={{flex:1,alignItems:'flex-end'}}><Text style={styles.summaryLabel}>Accrued commission</Text><Text style={styles.summaryTotal}>{money(totalEarned)}</Text></View></View>
      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.line }]}><Text style={{ color: colors.cyan, fontSize: 18, marginRight: 9 }}>⌕</Text><TextInput accessibilityLabel="Search team members" value={query} onChangeText={setQuery} placeholder="Search name or masked phone" placeholderTextColor={colors.muted} style={[styles.searchInput, { color: colors.ink }]} /></View>
      <TouchableOpacity onPress={reload} disabled={loading} style={styles.reload}><Text style={{ color: colors.blue, fontSize: 11, fontWeight: '900' }}>{loading ? 'Refreshing…' : 'Refresh members ↻'}</Text></TouchableOpacity>
      {error ? <Text style={[styles.error, { color: colors.red }]}>{error}</Text> : null}
      {rows.length ? rows.map((member) => <View key={member.id} style={[styles.memberCardPremium, { backgroundColor: colors.card, borderColor: colors.line }]}>
        <View style={styles.memberIdentity}><View style={[styles.memberAvatarPremium, { backgroundColor: colors.accentSurface }]}><Text style={{ color: colors.taupe||'#A79881', fontWeight: '900', fontSize: 19 }}>●</Text></View><View style={{flex:1}}><Text style={[styles.memberName, { color: colors.ink }]}>{member.displayName || 'PaisaPay member'}</Text><Text style={[styles.memberDetails, { color: colors.muted }]}>{member.permittedIdentifier} · Joined {new Date(member.joinedAt).toLocaleDateString()}</Text></View><View style={[styles.activePill,{backgroundColor:'#EEF8EF'}]}><Text style={{color:'#48A765',fontSize:9,fontWeight:'900'}}>Joined</Text></View></View>
        <View style={styles.memberStats}><View style={[styles.memberStat,{backgroundColor:'#F4F9F4'}]}><Text style={{color:colors.green,fontSize:16}}>▣</Text><Text style={[styles.memberStatValue,{color:colors.ink}]}>{money(member.earningsGeneratedPaise)}</Text><Text style={[styles.memberStatLabel,{color:colors.muted}]}>Accrued to you</Text></View><View style={[styles.memberStat,{backgroundColor:'#F4F5FB'}]}><Text style={{color:colors.blue,fontSize:16}}>↗</Text><Text style={[styles.memberStatValue,{color:colors.ink}]}>{money(member.verifiedTopUpPaise)}</Text><Text style={[styles.memberStatLabel,{color:colors.muted}]}>Verified top-ups</Text></View></View>
        <Text style={[styles.memberPrivacyNote,{color:colors.muted}]}>Commission remains pending until an approved funded payout program is available.</Text>
      </View>) : <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.line }]}><Text style={styles.emptyIcon}>♧</Text><Text style={[styles.emptyTitle, { color: colors.ink }]}>{query ? 'No matching members' : `No ${tab} members yet`}</Text><Text style={[styles.emptyCopy, { color: colors.muted }]}>{query ? 'Try a different name or masked phone.' : 'Share your code so new users can enter it during registration.'}</Text></View>}
    </Animated.View>
  </ScrollView>;
}

export function ShareEarnScreen({ referrals, code, colors, refresh, note }) {
  const entrance = useEntrance();
  const [error, setError] = useState('');
  const referralCode = referrals?.referralCode || code;
  const referralLink = referrals?.referralLink || (referralCode ? `paisapay://register?ref=${encodeURIComponent(referralCode)}` : '');
  const copy = async () => {
    if (!referralLink) return;
    try { await Clipboard.setStringAsync(referralLink); note?.('Referral link copied', 'Share the link. If it does not open the app, enter the code during registration.'); }
    catch { setError('Could not copy the referral link.'); }
  };
  const share = async () => {
    if (!referralCode) return;
    try { await Share.share({ message: `Join PaisaPay with my referral link: ${referralLink}\nReferral code: ${referralCode}` }); }
    catch { setError('The device share sheet is unavailable. You can copy the code instead.'); }
  };
  const shareExternal = async (url) => { try { await Linking.openURL(url); } catch { await share(); } };
  const message = encodeURIComponent(`Join PaisaPay with my referral link: ${referralLink} (Code: ${referralCode})`);
  const reload = async () => { try { await refresh?.(); setError(''); } catch (e) { setError(e?.message || 'Could not refresh referral information.'); } };
  return <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
    <Animated.View style={{ opacity: entrance }}>
      <Header title="Share & invite" subtitle="Invite a new user with your code. Referrals are attributed during account registration." colors={colors} />
      <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.gold }]}>
        <Text style={[styles.codeLabel, { color: colors.muted }]}>YOUR PERSONAL REFERRAL CODE</Text>
        <Text selectable style={[styles.code, { color: colors.ink }]}>{referralCode || 'Loading…'}</Text>
        {referralLink ? <View style={styles.qrWrap}><QRCode value={referralLink} size={154} color={colors.navy} backgroundColor="#FFFFFF" /></View> : <ActivityIndicator color={colors.blue} />}
        <Text style={[styles.qrHint, { color: colors.muted }]}>Scan or share this referral link. If it does not open the app, the new user can enter your code during registration.</Text>
        <TouchableOpacity accessibilityRole="button" disabled={!referralLink} onPress={copy} style={[styles.sharePrimary, { backgroundColor: colors.blue }]}><Text style={styles.sharePrimaryText}>Copy referral link</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={!referralCode} onPress={share} style={[styles.shareSecondary, { borderColor: colors.line }]}><Text style={{ color: colors.ink, fontWeight: '900', fontSize: 12 }}>Share using phone apps</Text></TouchableOpacity>
        <View style={styles.shareRow}>
          <TouchableOpacity onPress={() => shareExternal(`whatsapp://send?text=${message}`)} style={[styles.shareChip, { backgroundColor: '#128C7E' }]}><Text style={styles.shareChipText}>WhatsApp</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => shareExternal(`tg://msg?text=${message}`)} style={[styles.shareChip, { backgroundColor: '#229ED9' }]}><Text style={styles.shareChipText}>Telegram</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => shareExternal(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`)} style={[styles.shareChip, { backgroundColor: '#1877F2' }]}><Text style={styles.shareChipText}>Facebook</Text></TouchableOpacity>
        </View>
      </View>
      <View style={[styles.info, { backgroundColor: colors.warningSurface, borderColor: colors.gold }]}><Text style={[styles.infoTitle, { color: colors.warningText }]}>Referral rewards are conditional</Text><Text style={[styles.infoCopy, { color: colors.warningText }]}>Commission: direct {Number(referrals?.commissionRates?.directBps ?? 40) / 100}% · indirect {Number(referrals?.commissionRates?.indirectBps ?? 10) / 100}%. Only verified eligible activity counts. Pending amounts are not wallet funds until a funded payout program is configured.</Text></View>
      {error ? <Text style={[styles.error, { color: colors.red }]}>{error}</Text> : null}
      <TouchableOpacity onPress={reload} style={styles.reload}><Text style={{ color: colors.blue, fontWeight: '900', fontSize: 11 }}>Refresh referral stats ↻</Text></TouchableOpacity>
    </Animated.View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 32 },
  hero: { borderWidth: 1, borderRadius: 24, padding: 19, marginBottom: 14, elevation: 8, shadowColor: '#176BFF', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#FFFFFF18', borderColor: '#FFFFFF33', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  heroIconText: { color: '#FFFFFF', fontSize: 23, fontWeight: '900' },
  heroBadge: { color: '#67E8F9', fontSize: 8, fontWeight: '900', letterSpacing: 1, backgroundColor: '#16D9F526', overflow: 'hidden', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7 },
  heroTitle: { color: '#FFFFFF', fontSize: 23, fontWeight: '900', marginTop: 14 },
  heroCopy: { color: '#CBD5E1', fontSize: 10, lineHeight: 16, marginTop: 5 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 9, marginBottom: 12 },
  commissionList: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 13, paddingTop: 13, marginBottom: 12 }, commissionTitle: { fontSize: 11, fontWeight: '900', marginBottom: 6 }, commissionRow: { minHeight: 50, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center' }, commissionName: { fontSize: 9, fontWeight: '800' }, commissionDate: { fontSize: 8, marginTop: 3 }, commissionAmount: { fontSize: 11, fontWeight: '900' }, commissionStatus: { fontSize: 7, fontWeight: '900', marginTop: 3 },
  metric: { width: '48%', borderWidth: 1, borderRadius: 17, padding: 13, minHeight: 78 },
  periodRow: { flexDirection: 'row', gap: 7, marginBottom: 12 },
  periodButton: { flex: 1, minHeight: 34, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  milestonePanel: { borderWidth: 1, borderRadius: 18, padding: 12, marginBottom: 12 },
  milestoneCard: { borderWidth: 1, borderRadius: 13, padding: 11, marginTop: 8 },
  milestoneTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  earningCard: { borderRadius: 26, padding: 20, marginBottom: 13, overflow: 'hidden', elevation: 9, shadowColor: '#333A80', shadowOpacity: 0.2, shadowRadius: 15, shadowOffset: { width: 0, height: 7 } },
  earningLabel: { color: '#E4E2F1', fontSize: 12 }, earningValue: { color: '#FFFFFF', fontSize: 35, fontWeight: '900', marginTop: 7 }, earningToday: { color: '#E0DEEF', fontSize: 11, marginTop: 8 },
  earningDivider: { height: 1, backgroundColor: '#FFFFFF55', marginVertical: 16 }, earningSplit: { flexDirection: 'row', alignItems: 'center' }, earningHalf: { flex: 1 }, earningSplitValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', marginTop: 5 }, earningRate: { color: '#D7D5E7', fontSize: 9, marginTop: 4 }, earningVLine: { width: 1, height: 48, backgroundColor: '#FFFFFF55', marginHorizontal: 14 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 }, sectionIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, donePill: { borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7, fontSize: 9, fontWeight: '900', overflow: 'hidden' },
  milestoneLayout: { flexDirection: 'row', alignItems: 'center', gap: 9 }, milestoneAmount: { width: '31%' }, milestoneProgress: { flex: 1, minWidth: 0 }, milestoneProgressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, doingPill: { fontSize: 8, fontWeight: '900', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 6, overflow: 'hidden' },
  invitePanel: { borderWidth: 1, borderRadius: 22, padding: 16, marginBottom: 13, elevation: 4, shadowColor: '#1E3155', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }, inviteHint: { borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', marginTop: 14 }, inviteButton: { minHeight: 55, borderRadius: 17, marginTop: 13, backgroundColor: '#5051A0', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, elevation: 5, shadowColor: '#5051A0', shadowOpacity: 0.24, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } }, inviteButtonIcon: { color: '#FFFFFF', fontSize: 20 }, inviteButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', textTransform: 'capitalize' },
  overviewPanel: { borderWidth: 1, borderRadius: 22, padding: 15, marginBottom: 13 }, overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 }, overviewTile: { width: '48%', borderRadius: 16, padding: 12, minHeight: 68 }, overviewLabel: { fontSize: 9 }, overviewValue: { fontSize: 19, fontWeight: '900', marginTop: 4 }, overviewTotals: { borderTopWidth: 1, borderTopColor: '#E5E7EB', marginTop: 13, paddingTop: 12, flexDirection: 'row' }, overviewMoney: { fontSize: 17, fontWeight: '900', marginTop: 5 }, overviewFoot: { borderTopWidth: 1, borderTopColor: '#E5E7EB', marginTop: 10, paddingTop: 9 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(12,15,25,0.54)', justifyContent: 'flex-end' }, shareSheet: { minHeight: '62%', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 }, sheetGrabber: { alignSelf: 'center', width: 48, height: 5, borderRadius: 4, backgroundColor: '#D9D9D9', marginBottom: 18 }, sheetClose: { position: 'absolute', right: 17, top: 19, zIndex: 1, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }, sheetTitle: { fontSize: 21, fontWeight: '900', marginTop: 8 }, sheetSubtitle: { fontSize: 12, marginTop: 7 }, linkField: { minHeight: 68, borderRadius: 17, paddingLeft: 15, paddingRight: 8, marginTop: 22, flexDirection: 'row', alignItems: 'center' }, linkText: { flex: 1, fontSize: 12 }, copySquare: { width: 48, height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, sheetShareButton: { minHeight: 59, borderRadius: 18, marginTop: 17, backgroundColor: '#5051A0', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, elevation: 5, shadowColor: '#343B83', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, sheetShareText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 }, sheetShareSpark: { color: '#FFFFFF', fontSize: 19 }, recommended: { fontSize: 11, fontWeight: '800', marginTop: 20, marginBottom: 11 }, sheetChannels: { flexDirection: 'row', justifyContent: 'space-between' }, channel: { alignItems: 'center', width: '23%' }, channelIcon: { width: 56, height: 56, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, channelLabel: { fontSize: 10, marginTop: 6 }, qrRow: { minHeight: 62, borderWidth: 1, borderRadius: 16, marginTop: 20, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }, qrRowTitle: { fontSize: 12, fontWeight: '900' }, qrBackdrop: { flex: 1, backgroundColor: 'rgba(12,15,25,0.58)', justifyContent: 'center', padding: 22 }, qrModal: { borderRadius: 24, padding: 22, alignItems: 'center' },
  memberTabs: { borderWidth: 1, borderRadius: 14, flexDirection: 'row', marginBottom: 12, overflow: 'hidden' }, memberTab: { flex: 1, minHeight: 53, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderBottomColor: 'transparent', borderBottomWidth: 3 }, memberTabText: { fontSize: 12, fontWeight: '900' }, memberTabCount: { fontSize: 11, fontWeight: '900' }, memberSummary: { minHeight: 106, borderRadius: 23, padding: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 13 }, summaryLabel: { color: '#E5E4F0', fontSize: 11 }, summaryCount: { color: '#FFFFFF', fontSize: 27, fontWeight: '900', marginTop: 5 }, summaryTotal: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', marginTop: 5 }, summaryDivider: { width: 1, height: 54, backgroundColor: '#FFFFFF55', marginHorizontal: 14 },
  memberCardPremium: { borderWidth: 1, borderRadius: 20, padding: 14, marginTop: 9, elevation: 2, shadowColor: '#22324E', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }, memberIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10 }, memberAvatarPremium: { width: 49, height: 49, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, activePill: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18 }, memberStats: { flexDirection: 'row', gap: 9, marginTop: 13 }, memberStat: { flex: 1, minHeight: 83, borderRadius: 16, padding: 11 }, memberStatValue: { fontSize: 16, fontWeight: '900', marginTop: 4 }, memberStatLabel: { fontSize: 9, marginTop: 3 }, memberPrivacyNote: { fontSize: 8, lineHeight: 12, marginTop: 10 },
  milestoneReward: { fontSize: 15, fontWeight: '900' },
  progressTrack: { height: 7, borderRadius: 8, overflow: 'hidden', marginTop: 9 },
  progressFill: { height: '100%', borderRadius: 8 },
  metricLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  metricValue: { fontSize: 18, fontWeight: '900', marginTop: 8 },
  info: { borderWidth: 1, borderRadius: 16, padding: 13, marginBottom: 12 },
  infoTitle: { fontSize: 11, fontWeight: '900' },
  infoCopy: { fontSize: 9, lineHeight: 14, marginTop: 4 },
  action: { minHeight: 62, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11, marginTop: 9, flexDirection: 'row', alignItems: 'center', elevation: 2, shadowColor: '#176BFF', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  actionTitle: { fontSize: 12, fontWeight: '900' },
  actionSubtitle: { fontSize: 9, marginTop: 3 },
  actionArrow: { fontSize: 24, fontWeight: '700', marginLeft: 8 },
  searchBox: { minHeight: 49, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  searchInput: { flex: 1, minHeight: 45, fontSize: 11, fontWeight: '600' },
  reload: { alignSelf: 'flex-end', paddingVertical: 11, paddingHorizontal: 4 },
  error: { fontSize: 10, fontWeight: '700', marginVertical: 8 },
  memberCard: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 10 },
  memberAvatar: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  memberName: { fontSize: 11, fontWeight: '900' },
  memberDetails: { fontSize: 8, marginTop: 4 },
  empty: { borderWidth: 1, borderRadius: 19, padding: 22, alignItems: 'center', marginTop: 4 },
  emptyIcon: { fontSize: 31, color: '#176BFF', marginBottom: 8 },
  emptyTitle: { fontSize: 13, fontWeight: '900' },
  emptyCopy: { fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 5 },
  codeCard: { borderWidth: 1.5, borderRadius: 22, padding: 17, alignItems: 'center', elevation: 6, shadowColor: '#F5A623', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  codeLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  code: { fontSize: 23, fontWeight: '900', letterSpacing: 2, marginTop: 8 },
  qrWrap: { backgroundColor: '#FFFFFF', padding: 11, borderRadius: 15, marginTop: 15 },
  qrHint: { fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 10 },
  sharePrimary: { minHeight: 48, width: '100%', borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 15, elevation: 3 },
  sharePrimaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  shareSecondary: { minHeight: 45, width: '100%', borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 9 },
  shareRow: { flexDirection: 'row', gap: 7, width: '100%', marginTop: 9 },
  shareChip: { flex: 1, minHeight: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  shareChipText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
});
