import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Modal, NativeModules, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import * as SecureStore from 'expo-secure-store';
import { languages } from './jokes.cjs';
import { canShowIdleJoke, chooseNext, localeRecommendation, defaultPreferences, parsePreferences, shouldPromptLanguage, selectLanguagePreferences, recordShownJoke, nextVisitDelay } from './assistantEngine.cjs';

const PREFS_KEY = 'paisapay.bird-assistant.v1';
const LANGUAGE_ORDER = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'or', 'ur'];
const localizedPrompt = {
  en: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  te: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  hi: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  ta: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  kn: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  ml: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  mr: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  bn: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  gu: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  pa: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  or: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
  ur: 'Hi! Welcome to PaisaPay 🐦 Which language do you prefer?',
};
const settingsText = {
  en: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  te: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  hi: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  ta: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  kn: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  ml: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  mr: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  bn: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  gu: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  pa: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  or: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
  ur: ['Bird assistant', 'Change language', 'Mute jokes', 'Minimize bird', 'Close bird', 'Done', 'On', 'Off', 'Suggested'],
};

const recommendedLocale = () => {
  try {
    const locale = Intl?.DateTimeFormat?.().resolvedOptions?.().locale
      || NativeModules?.I18nManager?.localeIdentifier
      || NativeModules?.SettingsManager?.settings?.AppleLocale;
    return localeRecommendation(locale || '');
  } catch { return 'en'; }
};

function BirdMark({ blink }) {
  return <View style={styles.birdFrame}>
    <Svg width={48} height={48} viewBox="0 0 100 100">
      <Ellipse cx="48" cy="57" rx="34" ry="30" fill="#1685E8" />
      <Ellipse cx="48" cy="64" rx="21" ry="18" fill="#EAF8FF" />
      <Circle cx="65" cy="37" r="23" fill="#279BFA" />
      <Path d="M83 39 L99 46 L82 53 Q85 46 83 39Z" fill="#FFB23E" />
      <Path d="M24 55 Q4 36 14 25 Q34 31 41 48 Q34 45 24 55Z" fill="#0865C9" />
      <Path d="M28 76 Q43 85 60 75 Q53 91 37 87Z" fill="#0D72D5" />
      <Path d="M44 82 L40 93 M56 82 L59 93" stroke="#E58C24" strokeWidth="4" strokeLinecap="round" />
      <Circle cx="66" cy="37" r="7.5" fill="#FFFFFF" />
      <Circle cx="68" cy="38" r="3.7" fill="#17314D" />
      <Circle cx="69" cy="36.5" r="1.2" fill="#FFFFFF" />
      <Circle cx="70" cy="53" r="3.2" fill="#FF9E9E" opacity="0.75" />
      <Path d="M58 59 Q65 65 72 58" stroke="#17314D" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <Path d="M42 53 Q48 48 53 51" stroke="#65C1FF" strokeWidth="3" fill="none" strokeLinecap="round" />
    </Svg>
    <Animated.View pointerEvents="none" style={[styles.blinkLid, { opacity: blink }]} />
  </View>;
}

export default function BirdAssistant({ colors, logged, screen, working, activityKey, assistantEvent, onAssistantEventHandled, settingsOpen = false, onCloseSettings }) {
  const [prefs, setPrefs] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [bubble, setBubble] = useState('');
  const [visiting, setVisiting] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const appeared = useRef(new Animated.Value(0)).current;
  const entrance = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  const visitTimeout = useRef(null);
  const mounted = useRef(true);
  const handledEventId = useRef(null);
  const lastInteraction = useRef(Date.now());
  const safeScreen = useMemo(() => ['Home', 'Team', 'Members', 'Mine', 'UPI', 'UPI Wallets', 'FAQs', 'Version Center', 'Bird Settings'].includes(screen), [screen]);
  const language = prefs?.language;
  const words = settingsText[language] || settingsText.en;
  const recommended = useMemo(recommendedLocale, []);

  const persist = async (next) => {
    setPrefs(next);
    try { await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next)); } catch {}
  };

  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync(PREFS_KEY).then((stored) => {
      if (!alive) return;
      try {
        setPrefs(parsePreferences(stored));
      } catch { setPrefs(defaultPreferences()); }
      setHydrated(true);
    }).catch(() => {
      if (alive) { setPrefs(defaultPreferences()); setHydrated(true); }
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { setAppActive(state === 'active'); if (state === 'active') lastInteraction.current = Date.now(); });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 1450, useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 1450, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [float]);

  useEffect(() => {
    let timeout;
    let mounted = true;
    const blinkOnce = () => {
      Animated.sequence([Animated.timing(blink, { toValue: 1, duration: 75, useNativeDriver: true }), Animated.delay(80), Animated.timing(blink, { toValue: 0, duration: 90, useNativeDriver: true })]).start();
      if (mounted) timeout = setTimeout(blinkOnce, 2200 + Math.random() * 2800);
    };
    timeout = setTimeout(blinkOnce, 1200);
    return () => { mounted = false; clearTimeout(timeout); };
  }, [blink]);

  const showJoke = (joke, nextHistory, basePreferences = prefs) => {
    if (visitTimeout.current) clearTimeout(visitTimeout.current);
    setBubble(joke.text);
    setVisiting(true);
    const stamp = Date.now();
    void persist(recordShownJoke(basePreferences, nextHistory, stamp));
    entrance.setValue(0);
    Animated.spring(entrance, { toValue: 1, useNativeDriver: true, speed: 13, bounciness: 7 }).start();
    Animated.spring(appeared, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 5 }).start();
    visitTimeout.current = setTimeout(() => {
      Animated.timing(entrance, { toValue: 0, duration: 520, useNativeDriver: true }).start(({ finished }) => {
        if (!finished || !mounted.current) return;
        setVisiting(false);
        setBubble('');
      });
      Animated.timing(appeared, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    }, 7600);
  };

  const selectLanguage = (code) => {
    if (!languages[code]) return;
    const next = selectLanguagePreferences(prefs, code);
    const welcome = languages[code].jokes.find((item) => item.id === next.history[0]);
    setLanguageOpen(false);
    lastInteraction.current = Date.now();
    showJoke(welcome || { text: localizedPrompt[code] }, next.history, next);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (visitTimeout.current) clearTimeout(visitTimeout.current);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !logged || !safeScreen || working || !appActive || !prefs) return;
    if (shouldPromptLanguage({ preferences: prefs, logged, screen, active: appActive })) { setLanguageOpen(true); return; }
    if (prefs.closed || prefs.muted || prefs.minimized) return;
  }, [hydrated, logged, safeScreen, working, appActive, prefs?.language, prefs?.closed, prefs?.muted, prefs?.minimized, screen]);

  useEffect(() => {
    if (!hydrated || !logged || !safeScreen || !prefs?.language || prefs.closed) return;
    Animated.spring(entrance, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 6 }).start();
  }, [hydrated, logged, safeScreen, prefs?.language, prefs?.closed]);

  useEffect(() => {
    if (activityKey) lastInteraction.current = Date.now();
  }, [activityKey]);

  useEffect(() => {
    const eventId = assistantEvent?.id;
    if (!eventId || handledEventId.current === eventId || !hydrated || !logged || !prefs || !language) return;
    // The first language-selection greeting already fulfills the login greeting.
    if (assistantEvent.type === 'login' && prefs.welcomed && prefs.lastJokeAt >= eventId) {
      handledEventId.current = eventId;
      onAssistantEventHandled?.(eventId);
      return;
    }
    // Financial event jokes wait until the user leaves protected/payment screens.
    if (!safeScreen || working || !appActive || visiting) return;
    if (prefs.closed || prefs.muted || prefs.minimized) {
      handledEventId.current = eventId;
      onAssistantEventHandled?.(eventId);
      return;
    }
    const selected = chooseNext(language, prefs.history);
    handledEventId.current = eventId;
    lastInteraction.current = Date.now();
    showJoke(selected.joke, selected.history);
    onAssistantEventHandled?.(eventId);
  }, [assistantEvent?.id, assistantEvent?.type, hydrated, logged, prefs, language, safeScreen, working, appActive, visiting, onAssistantEventHandled]);

  useEffect(() => {
    if (!logged || !language || !safeScreen || working || !appActive || !prefs || prefs.closed || prefs.muted || prefs.minimized || visiting) return;
    const visitDelay = nextVisitDelay();
    const cooldownRemaining = Math.max(0, 180_000 - (Date.now() - (prefs.lastJokeAt || 0)));
    const delay = Math.max(visitDelay, cooldownRemaining);
    const timer = setTimeout(() => {
      const timestamp = Date.now();
      const idleMs = timestamp - lastInteraction.current;
      const allowed = canShowIdleJoke({ now: timestamp, lastJokeAt: prefs.lastJokeAt, idleMs, screen, active: appActive, working, muted: prefs.muted, closed: prefs.closed, minimized: prefs.minimized });
      if (allowed) {
        const selected = chooseNext(language, prefs.history);
        showJoke(selected.joke, selected.history);
      } else {
        lastInteraction.current = timestamp;
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [activityKey, logged, language, safeScreen, working, appActive, visiting, prefs?.closed, prefs?.muted, prefs?.minimized, prefs?.lastJokeAt, prefs?.history, screen]);

  if (!hydrated || !prefs) return null;
  const enabled = logged && safeScreen && appActive && !working && !prefs.closed && !prefs.muted && !prefs.minimized && !!language && visiting;
  const closeBubble = () => {
    if (visitTimeout.current) clearTimeout(visitTimeout.current);
    Animated.timing(entrance, { toValue: 0, duration: 350, useNativeDriver: true }).start(({ finished }) => {
      if (finished) { setVisiting(false); setBubble(''); }
    });
    Animated.timing(appeared, { toValue: 0, duration: 150, useNativeDriver: true }).start();
  };
  const patchPrefs = (patch) => { void persist({ ...prefs, ...patch }); };
  const openPicker = () => { setLanguageOpen(true); };

  return <>
    {enabled ? <View pointerEvents="box-none" style={styles.anchor}>
      {!prefs.minimized && !prefs.muted && bubble ? <Animated.View style={[styles.speech, { backgroundColor: colors?.card || '#fff', borderColor: colors?.line || '#DCE4F0', opacity: appeared, transform: [{ translateY: appeared.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
        <Text style={[styles.speechText, { color: colors?.ink || '#13223A' }]}>{bubble}</Text>
        <View style={styles.speechActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={words[2]} onPress={() => patchPrefs({ muted: true })}><Text style={styles.actionIcon}>🔇</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={words[3]} onPress={() => { patchPrefs({ minimized: true }); closeBubble(); }}><Text style={styles.actionIcon}>⌄</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close bird" onPress={() => { patchPrefs({ closed: true }); closeBubble(); }}><Text style={styles.actionIcon}>×</Text></TouchableOpacity>
        </View>
      </Animated.View> : null}
      <Animated.View style={{ opacity: entrance, transform: [{ translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [95, 0] }) }, { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.68, 1] }) }] }}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss bird joke" activeOpacity={0.82} onPress={closeBubble} style={styles.birdButton}>
        <Animated.View style={{ transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }, { translateX: float.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) }] }}><BirdMark blink={blink} /></Animated.View>
      </TouchableOpacity></Animated.View>
    </View> : null}

    <Modal transparent animationType="slide" visible={languageOpen && logged && safeScreen} onRequestClose={() => { if (language) setLanguageOpen(false); }}>
      <View style={styles.backdrop}><View style={[styles.sheet, { backgroundColor: colors?.card || '#fff' }]}><View style={styles.grabber} /><View style={styles.sheetHeader}><BirdMark blink={blink} /><View style={{ flex: 1 }}><Text style={[styles.title, { color: colors?.ink || '#13223A' }]}>{language ? words[1] : (localizedPrompt[recommended] || localizedPrompt.en)}</Text>{language ? <Text style={[styles.subtitle, { color: colors?.muted || '#64748B' }]}>Choose the language for the bird’s jokes.</Text> : null}</View></View>
        <ScrollView style={{ maxHeight: 430 }} contentContainerStyle={{ paddingBottom: 8 }}>{LANGUAGE_ORDER.map((code) => <TouchableOpacity key={code} accessibilityRole="button" onPress={() => selectLanguage(code)} style={[styles.languageRow, { borderColor: code === recommended ? colors?.blue || '#176BFF' : colors?.line || '#E2E8F0', backgroundColor: code === recommended ? '#176BFF12' : 'transparent' }]}><Text style={[styles.languageName, { color: colors?.ink || '#13223A' }]}>{languages[code].name}</Text>{code === recommended ? <Text style={styles.recommended}>{words[8]}</Text> : null}<Text style={{ color: colors?.blue || '#176BFF', fontSize: 18 }}>›</Text></TouchableOpacity>)}</ScrollView>
        {language ? <TouchableOpacity onPress={() => setLanguageOpen(false)} style={styles.doneButton}><Text style={styles.doneText}>{words[5]}</Text></TouchableOpacity> : null}
      </View></View>
    </Modal>

    <Modal transparent animationType="slide" visible={settingsOpen} onRequestClose={onCloseSettings}>
      <View style={styles.backdrop}><View style={[styles.sheet, { backgroundColor: colors?.card || '#fff' }]}><View style={styles.grabber} /><View style={styles.settingsHeader}><Text style={[styles.title, { color: colors?.ink || '#13223A' }]}>{words[0]}</Text><TouchableOpacity accessibilityRole="button" onPress={onCloseSettings}><Text style={{ color: colors?.muted || '#64748B', fontSize: 27 }}>×</Text></TouchableOpacity></View>
        <TouchableOpacity onPress={openPicker} style={[styles.settingRow, { borderColor: colors?.line || '#E2E8F0' }]}><Text style={[styles.settingLabel, { color: colors?.ink || '#13223A' }]}>{words[1]}</Text><Text style={styles.settingValue}>{language ? languages[language].name : words[8]}</Text></TouchableOpacity>
        {[[2, 'muted'], [3, 'minimized'], [4, 'closed']].map(([index, key]) => <TouchableOpacity key={key} onPress={() => patchPrefs({ [key]: !prefs[key] })} style={[styles.settingRow, { borderColor: colors?.line || '#E2E8F0' }]}><Text style={[styles.settingLabel, { color: colors?.ink || '#13223A' }]}>{words[index]}</Text><Text style={[styles.settingValue, { color: prefs[key] ? '#E34D59' : '#15885F' }]}>{prefs[key] ? words[7] : words[6]}</Text></TouchableOpacity>)}
        {prefs.closed ? <TouchableOpacity onPress={() => patchPrefs({ closed: false, minimized: false, muted: false })} style={styles.doneButton}><Text style={styles.doneText}>Enable bird</Text></TouchableOpacity> : <TouchableOpacity onPress={onCloseSettings} style={styles.doneButton}><Text style={styles.doneText}>{words[5]}</Text></TouchableOpacity>}
      </View></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', zIndex: 50, right: 9, bottom: 96, alignItems: 'flex-end' },
  birdButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#8AD9FF', alignItems: 'center', justifyContent: 'center', elevation: 7, shadowColor: '#176BFF', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  birdFrame: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  blinkLid: { position: 'absolute', width: 5, height: 2, borderRadius: 2, backgroundColor: '#E9F6FF', top: 18, right: 14 },
  speech: { maxWidth: 225, minWidth: 150, borderWidth: 1, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 10, marginBottom: 6, elevation: 9, shadowColor: '#102747', shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  speechText: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  speechActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 13, marginTop: 7 }, actionIcon: { color: '#52647C', fontSize: 17, fontWeight: '800' },
  minimizedDot: { position: 'absolute', right: -1, top: -2, width: 24, height: 16, borderRadius: 8, backgroundColor: '#176BFF', alignItems: 'center', justifyContent: 'center' }, minimizedText: { color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  backdrop: { flex: 1, backgroundColor: '#08152B80', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 19, paddingTop: 11, paddingBottom: 25 },
  grabber: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: '#AAB5C2', marginBottom: 17 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 15 },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: '900' }, subtitle: { fontSize: 11, marginTop: 4 },
  languageRow: { minHeight: 50, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, marginBottom: 7, flexDirection: 'row', alignItems: 'center', gap: 9 },
  languageName: { flex: 1, fontSize: 14, fontWeight: '800' }, recommended: { color: '#176BFF', fontSize: 9, fontWeight: '900' },
  doneButton: { minHeight: 48, borderRadius: 14, backgroundColor: '#176BFF', alignItems: 'center', justifyContent: 'center', marginTop: 10 }, doneText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  settingRow: { minHeight: 55, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, settingLabel: { flex: 1, fontSize: 13, fontWeight: '800' }, settingValue: { color: '#176BFF', fontSize: 11, fontWeight: '900' },
});
