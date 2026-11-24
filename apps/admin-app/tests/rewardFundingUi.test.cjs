'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseRupeesToPaise } = require('../rewardFundingUi.cjs');

test('parses common rupee amounts exactly into paise', () => {
  assert.equal(parseRupeesToPaise('100'), 10_000);
  assert.equal(parseRupeesToPaise('100.29'), 10_029);
  assert.equal(parseRupeesToPaise('6.2'), 620);
  assert.equal(parseRupeesToPaise('0.01'), 1);
});

test('rejects malformed, over-precision, and unsafe rupee amounts', () => {
  for (const value of ['', '1.', '.25', '1.234', '1.2.3', '-1', 'Infinity', '90071992547409.92']) {
    assert.equal(parseRupeesToPaise(value), null, `expected ${value} to be rejected`);
  }
});

test('SUPER_ADMIN reward-funding menu key matches the API profile capability', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../App.js'), 'utf8');
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../../../server/src/modules/admin/routes.ts'), 'utf8');
  assert.match(appSource, /\['rewardFunding',\s*'Reward Funding',\s*null\]/);
  assert.match(appSource, /section === 'rewardFunding'.*RewardFundingSection/s);
  assert.match(routesSource, /SUPER_ADMIN:[^\n]*'rewardFunding'/);
});
