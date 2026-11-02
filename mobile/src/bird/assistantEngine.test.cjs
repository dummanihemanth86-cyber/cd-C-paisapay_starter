const test = require('node:test');
const assert = require('node:assert/strict');
const { languages, jokes } = require('./jokes.cjs');
const { canSpeak, canShowIdleJoke, chooseNext, localeRecommendation, defaultPreferences, parsePreferences, shouldPromptLanguage, selectLanguagePreferences, recordShownJoke, nextVisitDelay } = require('./assistantEngine.cjs');

test('all 12 locales contain 20 unique, categorized Roman-text joke dialogues and IDs', () => {
  assert.equal(Object.keys(languages).length, 12);
  for (const [language, collection] of Object.entries(jokes)) {
    assert.equal(collection.length, 20, `${language} joke count`);
    assert.equal(new Set(collection.map((joke) => joke.id)).size, 20, `${language} IDs`);
    assert.equal(new Set(collection.map((joke) => joke.text)).size, 20, `${language} dialogue uniqueness`);
    assert.ok(collection.every((joke) => /^[\p{Script=Latin}\p{Number}\p{Punctuation}\p{Symbol}\p{Separator}]+$/u.test(joke.text)), `${language} must use Roman/English letters`);
    assert.ok(collection.every((joke) => joke.category && joke.text.trim().length > 12));
  }
});

test('rotation shuffles without repeats and resets after every joke is used', () => {
  const first = chooseNext('en', [], () => 0.4);
  assert.equal(first.history.length, 1);
  const second = chooseNext('en', first.history, () => 0.4);
  assert.equal(second.history.length, 2);
  assert.notEqual(first.joke.id, second.joke.id);
  const finished = jokes.en.map((joke) => joke.id);
  const reset = chooseNext('en', finished, () => 0);
  assert.equal(reset.reset, true);
  assert.equal(reset.history.length, 1);
});

test('idle jokes obey the cooldown and suppress protected screens and app states', () => {
  const base = { now: 400_000, lastJokeAt: 0, idleMs: 180_000, screen: 'Home', active: true };
  assert.equal(canShowIdleJoke(base), true);
  assert.equal(canShowIdleJoke({ ...base, lastJokeAt: 250_000 }), false);
  assert.equal(canShowIdleJoke({ ...base, idleMs: 179_999 }), false);
  assert.equal(canShowIdleJoke({ ...base, screen: 'Withdrawals' }), false);
  assert.equal(canShowIdleJoke({ ...base, working: true }), false);
  assert.equal(canShowIdleJoke({ ...base, active: false }), false);
  assert.equal(canSpeak({ screen: 'Deposit History' }), false);
});

test('bird visit intervals are randomized from 3 to 10 minutes', () => {
  assert.equal(nextVisitDelay(() => 0), 180_000);
  assert.equal(nextVisitDelay(() => 0.5), 390_000);
  assert.equal(nextVisitDelay(() => 1), 600_000);
});

test('device locale recommendation recognizes supported language tags', () => {
  assert.equal(localeRecommendation('te-IN'), 'te');
  assert.equal(localeRecommendation('pa_IN'), 'pa');
  assert.equal(localeRecommendation('fr-FR'), 'en');
});

test('first-launch language prompt, stored returning preference, and language change are deterministic', () => {
  const firstLaunch = parsePreferences(null);
  assert.equal(shouldPromptLanguage({ preferences: firstLaunch, logged: true, screen: 'Home' }), true);
  assert.equal(shouldPromptLanguage({ preferences: firstLaunch, logged: true, screen: 'Login' }), false);
  const chosen = selectLanguagePreferences(firstLaunch, 'te', 12345);
  assert.equal(chosen.language, 'te');
  assert.equal(chosen.history[0], 'te-001');
  assert.equal(chosen.lastJokeAt, 12345);
  const persisted = parsePreferences(JSON.stringify(chosen));
  assert.equal(shouldPromptLanguage({ preferences: persisted, logged: true, screen: 'Home' }), false);
  assert.equal(selectLanguagePreferences(persisted, 'hi', 23456).language, 'hi');
  assert.deepEqual(parsePreferences('{bad'), defaultPreferences());
});

test('showing the first joke preserves the newly selected language and settings', () => {
  const selected = selectLanguagePreferences(defaultPreferences(), 'te', 1000);
  const shown = recordShownJoke(selected, ['te-001'], 2000);
  const restored = parsePreferences(JSON.stringify(shown));
  assert.equal(restored.language, 'te');
  assert.deepEqual(restored.history, ['te-001']);
  assert.equal(restored.lastJokeAt, 2000);
  assert.equal(shouldPromptLanguage({ preferences: restored, logged: true, screen: 'Home' }), false);
});
