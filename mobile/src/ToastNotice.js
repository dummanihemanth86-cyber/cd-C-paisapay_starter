import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function ToastNotice({ toast, colors, onDismiss, onCheckServer }) {
  const progress = useRef(new Animated.Value(0)).current;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    progress.setValue(0);
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 3 }).start();
    if (toast?.persistent) return undefined;
    const timer = setTimeout(() => dismissRef.current(), 3600);
    return () => clearTimeout(timer);
  }, [toast?.id, toast?.persistent, progress]);

  if (!toast) return null;
  const title = String(toast.title || 'PaisaPay');
  const isSuccess = /saved|success|copied|complete|verified|cancelled|created|submitted/i.test(title);
  const isWarning = /pending|no match|unavailable|check|expired|required/i.test(title);
  const tone = isSuccess ? (colors.green || '#12B981') : isWarning ? (colors.gold || '#F5A623') : (colors.red || '#EF4444');
  const icon = isSuccess ? '✓' : isWarning ? '!' : '×';

  return <View pointerEvents="box-none" style={styles.layer}>
    <Animated.View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.toast, {
      backgroundColor: colors.card || '#FFFFFF',
      borderColor: colors.line || '#CBD5E1',
      opacity: progress,
      transform: [
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }) },
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
      ],
    }]}>
      <View style={[styles.icon, { backgroundColor: `${tone}18` }]}><Text style={[styles.iconText, { color: tone }]}>{icon}</Text></View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.ink || '#0F172A' }]}>{title}</Text>
        {!!toast.message && <Text style={[styles.message, { color: colors.muted || '#64748B' }]}>{toast.message}</Text>}
        {toast.canCheckServer && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check PaisaPay server connection" onPress={onCheckServer} disabled={toast.checkingServer} style={[styles.action, { borderColor: tone }]}>
          {toast.checkingServer ? <ActivityIndicator size="small" color={tone} /> : null}
          <Text style={[styles.actionText, { color: tone }]}>{toast.checkingServer ? 'Checking server…' : 'Check server'}</Text>
        </TouchableOpacity>}
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={onDismiss} style={styles.close}>
        <Text style={{ color: colors.muted || '#64748B', fontSize: 19, fontWeight: '700' }}>×</Text>
      </TouchableOpacity>
      <View style={[styles.accent, { backgroundColor: tone }]} />
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 10, left: 12, right: 12, zIndex: 1000, elevation: 20 },
  toast: { minHeight: 68, borderRadius: 18, borderWidth: 1, paddingVertical: 12, paddingLeft: 13, paddingRight: 8, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', shadowColor: '#0B1B33', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 7 }, elevation: 8 },
  icon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  iconText: { fontSize: 20, fontWeight: '900' },
  copy: { flex: 1, paddingVertical: 1 },
  title: { fontSize: 14, fontWeight: '800' },
  message: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  action: { alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 11, borderWidth: 1, borderRadius: 11, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 7 },
  actionText: { fontSize: 12, fontWeight: '800' },
  close: { width: 32, height: 38, alignItems: 'center', justifyContent: 'center' },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
});
