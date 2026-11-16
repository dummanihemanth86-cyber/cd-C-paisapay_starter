'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = readFileSync(resolve(__dirname, 'ReferralScreens.js'), 'utf8');

test('referral member cards open that member’s detail view', () => {
  assert.match(source, /accessibilityLabel=\{`View \$\{member\.displayName \|\| 'member'\} referral activity`\}/);
  assert.match(source, /onPress=\{\(\) => setSelectedMemberId\(member\.id\)\}/);
  assert.match(source, /visible=\{Boolean\(selectedMember\)\}/);
});

test('member details show server verified lifetime and today totals plus commission accrued to the referrer', () => {
  assert.match(source, /Total verified deposits/);
  assert.match(source, /Standard deposits · legacy API/);
  assert.match(source, /Today’s verified deposits/);
  assert.match(source, /Commission accrued to you/);
  assert.match(source, /Today accrued to you/);
  assert.match(source, /todayVerifiedTopUpPaise/);
  assert.match(source, /todayEarningsGeneratedPaise/);
  assert.match(source, /referrals\?\.memberActivityVersion === 2/);
  assert.match(source, /API update required/);
  assert.match(source, /Accrued commission is not wallet balance/);
  assert.match(source, /P2P-inclusive totals and today’s figures appear after the referral API update/);
  assert.match(source, /P2P deposits are omitted by the legacy API/);
  assert.match(source, /selectedMemberHasLegacyTotals \? money\(selectedMember\.earningsGeneratedPaise\)/);
});

test('Share & Earn scopes deposit commission availability to its own screen', () => {
  assert.match(source, /export function ShareEarnScreen[\s\S]*?const depositRatesConfigured = Number\.isInteger\(referrals\?\.commissionRates\?\.depositDirectBps\)/);
});
