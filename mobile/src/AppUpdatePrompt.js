import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, NativeModules, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { API_URL } from './api';
import appUpdate from './appUpdate.cjs';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const updater = NativeModules.PaisaPayUpdater;

export default function AppUpdatePrompt() {
  const [release, setRelease] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const checkForUpdate = useCallback(async () => {
    if (Platform.OS !== 'android' || !updater) return;
    try {
      const [installed, response] = await Promise.all([
        updater.getInstalledVersion(),
        fetch(`${API_URL}${appUpdate.APP_VERSION_PATH}`, { headers: { Accept: 'application/json' } }),
      ]);
      if (!response.ok) {
        setRelease(null);
        return;
      }
      const manifest = await response.json();
      const state = appUpdate.getUpdateState(installed, manifest);
      setRelease(state.available ? state.release : null);
    } catch {
      // An unavailable version check must never be presented as an available update.
    }
  }, []);

  useEffect(() => {
    void checkForUpdate();
    const interval = setInterval(() => { void checkForUpdate(); }, CHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkForUpdate();
    });
    return () => { clearInterval(interval); subscription.remove(); };
  }, [checkForUpdate]);

  const startUpdate = async () => {
    if (!release || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await updater.downloadAndInstall(release.apkUrl, release.version, release.buildCode, release.sha256);
      if (result === 'permission_required') {
        Alert.alert('Allow PaisaPay updates', 'Android settings opened. Allow installs from PaisaPay, return here, then tap Update Now again.');
      } else if (result === 'installer_opened') {
        Alert.alert('Confirm update', 'Android package installer opened. Review the package details and confirm to install the update.');
      }
    } catch (updateError) {
      setError(typeof updateError?.message === 'string' ? updateError.message : 'The update could not be verified or opened. The installed app was not changed.');
    } finally {
      setBusy(false);
    }
  };

  if (Platform.OS !== 'android' || !release) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.scrim}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.mark}><Text style={styles.markText}>P</Text></View>
          <Text style={styles.eyebrow}>PAISAPAY VERSION {release.version}</Text>
          <Text accessibilityRole="header" style={styles.title}>UPDATE THE APP</Text>
          <Text style={styles.description}>
            A verified update is ready. Install it to continue using the latest PaisaPay app.
          </Text>
          {!!release.releaseNotes && <Text style={styles.notes}>{release.releaseNotes}</Text>}
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Pressable accessibilityRole="button" disabled={busy} onPress={startUpdate} style={[styles.primary, busy && styles.primaryDisabled]}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>UPDATE NOW</Text>}
          </Pressable>
          {!busy && <Pressable accessibilityRole="button" onPress={() => setRelease(null)} style={styles.secondary}>
            <Text style={styles.secondaryText}>Maybe later</Text>
          </Pressable>}
          <Text style={styles.secureNote}>The APK is checked for integrity and must match this app’s signing key. Android will ask you to confirm installation.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { alignItems: 'center', backgroundColor: 'rgba(3, 12, 29, 0.78)', flex: 1, justifyContent: 'center', padding: 24 },
  card: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 26, maxWidth: 440, paddingHorizontal: 25, paddingVertical: 28, width: '100%' },
  mark: { alignItems: 'center', backgroundColor: '#176BFF', borderRadius: 22, height: 56, justifyContent: 'center', marginBottom: 15, width: 56 },
  markText: { color: '#FFFFFF', fontSize: 29, fontWeight: '900' },
  eyebrow: { color: '#52627D', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: '#0B1730', fontSize: 26, fontWeight: '900', marginTop: 7, textAlign: 'center' },
  description: { color: '#44536C', fontSize: 15, lineHeight: 22, marginTop: 12, textAlign: 'center' },
  notes: { color: '#34445E', fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: 'center' },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18, marginTop: 13, textAlign: 'center' },
  primary: { alignItems: 'center', backgroundColor: '#176BFF', borderRadius: 14, justifyContent: 'center', marginTop: 22, minHeight: 52, paddingHorizontal: 18, width: '100%' },
  primaryDisabled: { opacity: 0.72 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  secondary: { alignItems: 'center', justifyContent: 'center', marginTop: 11, minHeight: 42, paddingHorizontal: 16 },
  secondaryText: { color: '#44536C', fontSize: 14, fontWeight: '700' },
  secureNote: { color: '#6B7890', fontSize: 11, lineHeight: 16, marginTop: 14, textAlign: 'center' },
});
