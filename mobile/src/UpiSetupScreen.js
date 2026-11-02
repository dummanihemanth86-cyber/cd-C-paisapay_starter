import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';

export default function UpiSetupScreen({ upiProfile, upiInput, setUpiInput, upiNameInput, setUpiNameInput, saveUpiId, removeUpiId, working, go, colors }) {
  const entrance = useRef(new Animated.Value(0)).current;
  const [helpVisible, setHelpVisible] = useState(false);
  const { width, height } = useWindowDimensions();
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 380, useNativeDriver: true }).start();
    return () => entrance.stopAnimation();
  }, [entrance]);
  const saved = upiProfile?.detailsStatus === 'USER_CONFIRMED' && !!upiProfile?.upiId;
  return <>
  <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <Animated.View style={{ opacity: entrance }}>
      <View style={[styles.hero, { backgroundColor: colors.navy, borderColor: colors.cyan }]}>
        <View style={styles.heroTop}><View style={styles.heroIcon}><Text style={styles.heroIconText}>₹</Text></View><View style={styles.securePill}><Text style={styles.secureText}>UPI DETAILS</Text></View></View>
        <Text style={styles.heroTitle}>Your UPI profile</Text>
        <Text style={styles.heroCopy}>Save the name and UPI ID you use for PaisaPay P2P offers.</Text>
        <View style={styles.heroFoot}><View style={styles.heroDot} /><Text style={styles.heroFootText}>{saved ? 'Details saved to your account' : 'Add your details to get started'}</Text></View>
      </View>

      {saved && <View style={[styles.savedCard, { backgroundColor: colors.successSurface, borderColor: colors.green }]}>
        <View style={styles.savedIcon}><Text style={{ color: colors.green, fontSize: 19, fontWeight: '900' }}>✓</Text></View>
        <View style={{ flex: 1 }}><Text style={[styles.savedTitle, { color: colors.ink }]}>UPI details saved</Text><Text style={[styles.savedCopy, { color: colors.muted }]}>{upiProfile.displayName} · {upiProfile.upiId}</Text></View>
      </View>}

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.line }]}>
        <View style={styles.sectionHeading}><View style={[styles.sectionIcon, { backgroundColor: colors.accentSurface }]}><Text style={{ color: colors.blue, fontSize: 18 }}>◉</Text></View><View><Text style={[styles.cardTitle, { color: colors.ink }]}>{saved ? 'Update UPI details' : 'Add UPI details'}</Text><Text style={[styles.cardSubtitle, { color: colors.muted }]}>Enter the details shown in your UPI app</Text></View></View>
        <Text style={[styles.label, { color: colors.muted }]}>ACCOUNT NAME</Text>
        <View style={[styles.inputWrap, { backgroundColor: colors.bg, borderColor: colors.line }]}><Text style={styles.inputIcon}>👤</Text><TextInput accessibilityLabel="UPI account name" value={upiNameInput} onChangeText={setUpiNameInput} placeholder="Name shown in your UPI app" placeholderTextColor={colors.muted} autoCapitalize="words" autoCorrect={false} editable={!working} style={[styles.input, { color: colors.ink }]} /></View>
        <Text style={[styles.label, { color: colors.muted, marginTop: 16 }]}>UPI ID</Text>
        <View style={[styles.inputWrap, { backgroundColor: colors.bg, borderColor: colors.line }]}><Text style={[styles.atIcon, { color: colors.cyan }]}>@</Text><TextInput accessibilityLabel="UPI ID" value={upiInput} onChangeText={setUpiInput} placeholder="yourname@bank" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!working} style={[styles.input, { color: colors.ink }]} /></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="How to get your UPI ID? Open the guide" onPress={() => setHelpVisible(true)} activeOpacity={0.7} style={styles.helpLink}>
          <Text style={[styles.helpLinkText, { color: colors.blue }]}>How to get your UPI ID? <Text style={{ color: colors.cyan }}>›</Text></Text>
        </TouchableOpacity>
        <View style={[styles.reminder, { backgroundColor: colors.warningSurface }]}><Text style={{ fontSize: 16, marginRight: 8 }}>ⓘ</Text><Text style={[styles.reminderText, { color: colors.warningText }]}>Check spelling carefully. PaisaPay saves these details for P2P matching; this does not confirm UPI ownership.</Text></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={saved ? 'Update UPI details' : 'Save UPI details'} disabled={working || !upiInput.trim() || !upiNameInput.trim()} onPress={saveUpiId} activeOpacity={0.86} style={[styles.primary, { backgroundColor: working || !upiInput.trim() || !upiNameInput.trim() ? colors.line : colors.blue }]}>
          <Text style={styles.primaryText}>{working ? 'Saving details…' : saved ? '✓  Save UPI details' : 'Save UPI details  →'}</Text>
        </TouchableOpacity>
        {saved && <TouchableOpacity accessibilityRole="button" disabled={working} onPress={removeUpiId} style={[styles.removeButton, { borderColor: colors.line }]}><Text style={{ color: colors.red, fontSize: 12, fontWeight: '800' }}>Remove saved UPI details</Text></TouchableOpacity>}
      </View>

      <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.infoTitle, { color: colors.ink }]}>How this is used</Text>
        <View style={styles.infoRow}><Text style={[styles.infoNumber, { backgroundColor: colors.accentSurface, color: colors.blue }]}>1</Text><Text style={[styles.infoCopy, { color: colors.muted }]}>Saved UPI ID is offered for your P2P withdrawal requests.</Text></View>
        <View style={styles.infoRow}><Text style={[styles.infoNumber, { backgroundColor: colors.accentSurface, color: colors.blue }]}>2</Text><Text style={[styles.infoCopy, { color: colors.muted }]}>Payment status still requires independent review; saving details does not verify a payment.</Text></View>
        <TouchableOpacity accessibilityRole="button" onPress={() => go('Deposit')} style={[styles.depositLink, { borderColor: colors.line }]}><Text style={{ color: colors.blue, fontWeight: '900', fontSize: 12 }}>Go to Deposit  →</Text></TouchableOpacity>
      </View>
    </Animated.View>
  </ScrollView>
  <Modal visible={helpVisible} transparent animationType="fade" onRequestClose={() => setHelpVisible(false)} statusBarTranslucent>
    <View style={styles.helpBackdrop}>
      <View style={[styles.helpModal, { width: Math.min(width - 28, 560), maxHeight: height * 0.9, backgroundColor: colors.card, borderColor: colors.line }]}>
        <View style={styles.helpModalHeader}>
          <View style={{ flex: 1, paddingRight: 12 }}><Text style={[styles.helpTitle, { color: colors.ink }]}>Find your UPI ID</Text><Text style={[styles.helpSubtitle, { color: colors.muted }]}>Look for “UPI ID” or “Manage UPI IDs” in your payment app.</Text></View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close UPI ID guide" onPress={() => setHelpVisible(false)} style={[styles.closeHelp, { backgroundColor: colors.surface }]}><Text style={{ color: colors.ink, fontSize: 21, fontWeight: '700' }}>×</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.guideImageWrap} showsVerticalScrollIndicator={false}>
          <Image source={require('../assets/upi-id-how-to.png')} resizeMode="contain" accessibilityLabel="Guide showing where to find a UPI ID in PhonePe, Google Pay and Paytm" style={{ width: width - 64, height: Math.min(height * 0.68, width - 64) }} />
        </ScrollView>
      </View>
    </View>
  </Modal>
  </>;
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 32 },
  hero: { borderWidth: 1, borderRadius: 24, padding: 20, marginBottom: 14, overflow: 'hidden', elevation: 8, shadowColor: '#176BFF', shadowOpacity: 0.18, shadowRadius: 15, shadowOffset: { width: 0, height: 7 } },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#FFFFFF18', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF33' },
  heroIconText: { fontSize: 23, color: '#FFFFFF', fontWeight: '900' },
  securePill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#16D9F526', borderWidth: 1, borderColor: '#16D9F555' },
  secureText: { color: '#67E8F9', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  heroTitle: { color: '#FFFFFF', fontSize: 23, fontWeight: '900', marginTop: 17 },
  heroCopy: { color: '#CBD5E1', fontSize: 12, lineHeight: 18, marginTop: 5 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 15 },
  heroDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16D9F5', marginRight: 8 },
  heroFootText: { color: '#E2E8F0', fontSize: 10, fontWeight: '700' },
  savedCard: { borderWidth: 1, borderRadius: 18, padding: 13, marginBottom: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  savedIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#12B98122', alignItems: 'center', justifyContent: 'center' },
  savedTitle: { fontSize: 12, fontWeight: '900' },
  savedCopy: { fontSize: 10, marginTop: 3 },
  card: { borderWidth: 1, borderRadius: 23, padding: 17, marginBottom: 13, elevation: 4, shadowColor: '#102747', shadowOpacity: 0.07, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 18 },
  sectionIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '900' },
  cardSubtitle: { fontSize: 9, marginTop: 3 },
  label: { fontSize: 9, fontWeight: '900', letterSpacing: 1, marginBottom: 7 },
  inputWrap: { minHeight: 54, borderWidth: 1, borderRadius: 15, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  inputIcon: { fontSize: 16, marginRight: 10 },
  atIcon: { fontSize: 21, fontWeight: '900', marginRight: 10 },
  input: { flex: 1, minHeight: 52, fontSize: 13, fontWeight: '700' },
  helpLink: { alignSelf: 'flex-start', minHeight: 34, justifyContent: 'center', paddingHorizontal: 2, marginTop: 3 },
  helpLinkText: { fontSize: 11, fontWeight: '800' },
  reminder: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 13, padding: 11, marginTop: 15 },
  reminderText: { flex: 1, fontSize: 9, lineHeight: 14, fontWeight: '600' },
  primary: { minHeight: 51, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 16, elevation: 4, shadowColor: '#176BFF', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  primaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  removeButton: { minHeight: 43, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 9 },
  infoCard: { borderWidth: 1, borderRadius: 20, padding: 16 },
  infoTitle: { fontSize: 13, fontWeight: '900', marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 7 },
  infoNumber: { height: 21, width: 21, borderRadius: 8, textAlign: 'center', textAlignVertical: 'center', fontSize: 10, fontWeight: '900', overflow: 'hidden', marginRight: 9 },
  infoCopy: { flex: 1, fontSize: 10, lineHeight: 15 },
  depositLink: { minHeight: 42, borderWidth: 1, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 14 },
  helpBackdrop: { flex: 1, backgroundColor: '#020817D9', alignItems: 'center', justifyContent: 'center', padding: 14 },
  helpModal: { borderWidth: 1, borderRadius: 22, padding: 14, overflow: 'hidden' },
  helpModalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  helpTitle: { fontSize: 17, fontWeight: '900' },
  helpSubtitle: { fontSize: 10, lineHeight: 15, marginTop: 4 },
  closeHelp: { height: 36, width: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  guideImageWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
});
