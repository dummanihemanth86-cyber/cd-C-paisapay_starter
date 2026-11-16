const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shouldShowPromotionalBanner, vipProgressStatusLabel } = require('./homeFinancialUx.cjs');

test('marks earnings promotions active only when the server confirms financial operations are enabled', () => {
  assert.equal(shouldShowPromotionalBanner(false), false);
  assert.equal(shouldShowPromotionalBanner(undefined), false);
  assert.equal(shouldShowPromotionalBanner(true), true);
});

test('keeps banner artwork clear and explains unavailable payment actions accurately', () => {
  const home = fs.readFileSync(path.resolve(__dirname, 'UltraHome.js'), 'utf8');
  const deposit = fs.readFileSync(path.resolve(__dirname, 'DepositScreen.js'), 'utf8');
  const withdrawal = fs.readFileSync(path.resolve(__dirname, 'WithdrawalScreen.js'), 'utf8');
  assert.match(home, /require\('\.\.\/assets\/paisapay-7-percent-banner\.png'\)/);
  assert.match(home, /require\('\.\.\/assets\/paisapay-daily-earn-banner\.png'\)/);
  assert.match(home, /require\('\.\.\/assets\/paisapay-rules-banner\.png'\)/);
  assert.match(home, /source=\{promoBanners\[bannerIndex\]\}/);
  assert.match(home, /blurRadius=\{0\}/);
  assert.match(home, /opacity: 1, transform/);
  assert.match(home, /ARTWORK ONLY/);
  assert.doesNotMatch(home, /Some money actions are unavailable/);
  assert.match(home, /\(addMoneyAvailable \|\| withdrawalAvailable\) && balance/);
  assert.doesNotMatch(home, /paused/i);
  assert.doesNotMatch(home, /financial actions are temporarily unavailable/i);
  assert.match(deposit, /source=\{depositPromoBanner\}/);
  assert.match(deposit, /backgroundColor: '#050505'/);
  assert.match(home, /backgroundColor: '#FFFFFF'/);
  assert.match(deposit, /blurRadius=\{0\}/);
  assert.doesNotMatch(deposit, /inactivePromoImage/);
  assert.doesNotMatch(deposit, /QUICK MATCHING UNAVAILABLE/);
  assert.match(deposit, /SETUP REQUIRED/);
  assert.match(deposit, /Matching setup required/);
  assert.match(withdrawal, /Withdrawal creation is disabled by server safety controls\. No new request was created and no funds were reserved\./);
  assert.doesNotMatch(deposit, /Quick Deposit is unavailable/);
  assert.match(deposit, /View deposit history/);
  assert.match(deposit, /api\/v1\/deposits\/orders\/my/);
  assert.doesNotMatch(deposit, /paused/i);
  assert.doesNotMatch(deposit, /financialActionsDisabled \? 'Temporarily unavailable'/);
});

test('keeps server availability details on the affected feature screens rather than Home', () => {
  const home = fs.readFileSync(path.resolve(__dirname, 'UltraHome.js'), 'utf8');
  const deposit = fs.readFileSync(path.resolve(__dirname, 'DepositScreen.js'), 'utf8');
  const withdrawal = fs.readFileSync(path.resolve(__dirname, 'WithdrawalScreen.js'), 'utf8');
  assert.doesNotMatch(home, /Some money actions are unavailable/);
  assert.match(deposit, /financialCapabilityReasons\?\.quickDeposit \|\| financialCapabilityReasons\?\.p2pMatching/);
  assert.match(withdrawal, /financialCapabilityReasons\?\.withdraw/);
  assert.doesNotMatch(withdrawal, /const load = useCallback\(async \(\) => \{\s*if \(financialActionsDisabled\)/);
  assert.match(withdrawal, /Withdrawal setup required/);
  assert.match(withdrawal, /View pending requests/);
  assert.doesNotMatch(home, /LIVE VERIFIED PROGRESS/);
});

test('removes the separate funds request option while disabled payment actions stay server-gated', () => {
  const profile = fs.readFileSync(path.resolve(__dirname, 'ProfileScreen.js'), 'utf8');
  const home = fs.readFileSync(path.resolve(__dirname, 'UltraHome.js'), 'utf8');
  assert.doesNotMatch(profile, /\['Request funds',/);
  assert.match(profile, /\['Support', 'Support'/);
  assert.match(home, /onPress=\{\(\) => go\('Deposit'\)\}/);
  assert.doesNotMatch(home, /disabled=\{financialOperationsEnabled !== true\}/);
});

test('reports VIP setup state without claiming that the server is still connecting', () => {
  assert.equal(vipProgressStatusLabel({ programStatus: 'SETUP_REQUIRED' }), 'SETUP REQUIRED');
  assert.equal(vipProgressStatusLabel({ programStatus: 'ACTIVE', currentLevel: 2 }), 'VIP 2 ACTIVE');
  assert.equal(vipProgressStatusLabel(null), 'STATUS NOT RECEIVED');
  assert.equal(vipProgressStatusLabel({ programStatus: 'UNKNOWN' }), 'STATUS NOT RECEIVED');
});
