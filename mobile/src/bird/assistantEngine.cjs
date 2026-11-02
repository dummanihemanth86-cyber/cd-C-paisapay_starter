const { jokes } = require('./jokes.cjs');

const EXCLUDED_SCREENS = new Set([
  'Splash', 'Login', 'Register', 'OTP', 'Forgot Password', 'Profile setup',
  'Deposit', 'Deposit History', 'Withdrawals', 'Bank Accounts', 'P2P', 'Orders',
  'Payment', 'Payment Processing', 'UPI', 'Security', 'Admin'
]);

function defaultPreferences() {
  return { language: null, muted: false, minimized: false, closed: false, welcomed: false, history: [], lastJokeAt: 0 };
}

function parsePreferences(serialized) {
  const defaults = defaultPreferences();
  if (!serialized) return defaults;
  try {
    const value = JSON.parse(serialized);
    return {
      ...defaults,
      ...value,
      language: value.language && jokes[value.language] ? value.language : null,
      history: Array.isArray(value.history) ? value.history.filter((id) => typeof id === 'string') : [],
      lastJokeAt: Number(value.lastJokeAt) || 0,
      muted: !!value.muted,
      minimized: !!value.minimized,
      closed: !!value.closed,
      welcomed: !!value.welcomed,
    };
  } catch { return defaults; }
}

function shouldPromptLanguage({ preferences, logged, screen, active = true }) {
  return !!logged && active && screen === 'Home' && !preferences?.language;
}

function selectLanguagePreferences(preferences, language, now = Date.now()) {
  const code = jokes[language] ? language : 'en';
  const greeting = jokes[code].find((joke) => joke.category === 'greeting');
  return { ...defaultPreferences(), ...preferences, language: code, history: greeting ? [greeting.id] : [], welcomed: true, lastJokeAt: now, closed: false, minimized: false };
}

function recordShownJoke(preferences, history, now = Date.now()) {
  return { ...defaultPreferences(), ...preferences, history, lastJokeAt: now };
}

function canSpeak({ screen, active = true, working = false, muted = false, closed = false, minimized = false } = {}) {
  return active && !working && !muted && !closed && !minimized && !EXCLUDED_SCREENS.has(screen);
}

function canShowIdleJoke({ now, lastJokeAt, idleMs, screen, active, working, muted, closed, minimized }) {
  return canSpeak({ screen, active, working, muted, closed, minimized })
    && idleMs >= 180_000
    && (!lastJokeAt || now - lastJokeAt >= 180_000);
}

function nextVisitDelay(random = Math.random) {
  return 180_000 + Math.floor(Math.min(1, Math.max(0, random())) * 420_000);
}

function chooseNext(language, history = [], random = Math.random) {
  const rotation = jokes[language] || jokes.en;
  const used = new Set(history);
  let eligible = rotation.filter((joke) => !used.has(joke.id));
  const reset = eligible.length === 0;
  if (reset) eligible = rotation;
  const joke = eligible[Math.floor(random() * eligible.length)];
  return { joke, history: [...(reset ? [] : history), joke.id], reset };
}

function localeRecommendation(locale = '') {
  const normalized = String(locale).toLowerCase().replace('_', '-');
  const code = normalized.split('-')[0];
  return Object.prototype.hasOwnProperty.call(jokes, code) ? code : 'en';
}

module.exports = { EXCLUDED_SCREENS, canSpeak, canShowIdleJoke, chooseNext, localeRecommendation, defaultPreferences, parsePreferences, shouldPromptLanguage, selectLanguagePreferences, recordShownJoke, nextVisitDelay };
