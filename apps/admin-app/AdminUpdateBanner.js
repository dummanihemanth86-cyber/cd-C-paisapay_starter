import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ADMIN_API_VERSION_PATH, STAGING_ADMIN_VERSION_URL, STAGING_ADMIN_WEB_URL, adminUpdateState } from './adminUpdate.cjs';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

async function readJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`Version request failed (${response.status}).`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export default function AdminUpdateBanner({ apiBase, currentBuildCode, stagingBuild }) {
  const [update, setUpdate] = useState({ available: false, label: '', blink: false, updateUrl: null });
  const [checking, setChecking] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;

  const check = useCallback(async () => {
    if (!stagingBuild || !apiBase) return;
    setChecking(true);
    try {
      const [apiVersion, release] = await Promise.all([
        readJson(`${apiBase}${ADMIN_API_VERSION_PATH}`),
        readJson(`${STAGING_ADMIN_VERSION_URL}?check=${Date.now()}`),
      ]);
      const next = adminUpdateState(currentBuildCode, apiVersion, release);
      if (next.available) next.updateUrl = STAGING_ADMIN_WEB_URL;
      setUpdate(next);
    } catch {
      // Version checks are best-effort. Existing sessions and app functions stay untouched.
    } finally {
      setChecking(false);
    }
  }, [apiBase, currentBuildCode, stagingBuild]);

  useEffect(() => {
    void check();
    const timer = setInterval(() => { void check(); }, CHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [check]);

  useEffect(() => {
    if (!update.available) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return undefined;
    }
    const blink = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.25, duration: 650, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    blink.start();
    return () => blink.stop();
  }, [opacity, update.available]);

  const openLatest = async () => {
    try { await Linking.openURL(STAGING_ADMIN_WEB_URL); } catch { /* Do not log browser errors or user data. */ }
  };

  if (!stagingBuild || (!update.available && !checking)) return null;
  if (!update.available) return <View accessibilityRole="summary" style={styles.checking}><ActivityIndicator size="small" color="#2563EB"/><Text style={styles.checkingText}>Checking Admin updates…</Text></View>;
  return <View style={styles.banner} accessibilityLiveRegion="polite">
    <Pressable accessibilityRole="button" accessibilityLabel="Update available. Open latest staging Admin app." onPress={openLatest} style={styles.action}>
      <Animated.View style={[styles.badge, { opacity }]}><Text style={styles.badgeText}>UPDATE AVAILABLE</Text></Animated.View>
      <Text style={styles.actionText}>Open latest Admin</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#FFF7E6', borderBottomColor: '#F6C453', borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 9 },
  action: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'center', minHeight: 32 },
  badge: { backgroundColor: '#D92D20', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  actionText: { color: '#17243B', fontSize: 13, fontWeight: '700' },
  checking: { alignItems: 'center', backgroundColor: '#F1F5F9', borderBottomColor: '#E2E8F0', borderBottomWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', paddingVertical: 5 },
  checkingText: { color: '#64748B', fontSize: 11 },
});
