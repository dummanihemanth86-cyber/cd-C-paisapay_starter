const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, 'DepositScreen.js'), 'utf8');
const historySource = fs.readFileSync(path.resolve(__dirname, 'DepositHistory.js'), 'utf8');
const appSource = fs.readFileSync(path.resolve(__dirname, '../App.js'), 'utf8');

test('verified-deposit reward estimate is 6.2% and reflected in order UI', () => {
  assert.match(source, /const presets = \[100, 200, 500, 1000, 2000, 5000\]/);
  assert.match(source, /P2P_ORDER_REWARD_PERCENT_BPS = 620/);
  assert.match(source, /rewardPercentLabel\(rewardPercentBps\)\} verified-deposit reward estimate/);
  assert.match(source, /P2P_ORDER_REWARD_PERCENT_BPS \/ 10_000/);
  assert.match(source, /config\?\.verifiedDepositReward \|\| config\?\.p2pOrderReward/);
  assert.match(source, /const verifiedDepositReward = config\?\.verifiedDepositReward \|\| config\?\.p2pOrderReward/);
  assert.match(appSource, /var rewardConfig = versionedAvailability \|\| methodConfig/);
  assert.match(appSource, /verifiedDepositReward: rewardConfig\.verifiedDepositReward \|\| rewardConfig\.p2pOrderReward/);
  assert.match(source, /rewardPercentLabel\(order\.reward\?\.percentBps\)\} matched-order reward/);
  assert.match(source, /rewardPercentLabel\(item\.reward\?\.percentBps\)\} reward estimate/);
});

test('an unfunded or disabled server reward is not shown as an expected wallet credit', () => {
  assert.match(source, /verifiedDepositReward\?\.enabled === true/);
  assert.match(source, /config\?\.rewardEnabled === true/);
  assert.match(source, /rewardPercentLabel\(rewardPercentBps\)\} reward estimate\{rewardProgramEnabled \? '' : ' · inactive'\}/);
  assert.match(source, /This reward is an estimate only and is not included in the expected wallet credit/);
  assert.match(source, /order\.reward\?\.enabled === true \? order\.reward\?\.estimatedPaise/);
  assert.match(source, /reward estimate is inactive; no extra credit is expected while the server reward program is disabled/);
  assert.match(source, /no reward credited · reward program is disabled/);
});

test('deposit history shows only the server-recorded reward and final credited total', () => {
  assert.match(historySource, /Reward actually credited: \{money\(row\.rewardAmountPaise \|\| 0\)\}/);
  assert.match(historySource, /Total wallet credit: \{money\(row\.creditedAmountPaise \?\? row\.amountPaise\)\}/);
  assert.match(historySource, /row\.userFacingStatus \|\| row\.status/);
});

test('standard deposit shows an estimate while disabled but excludes it from expected wallet credit', () => {
  assert.match(source, /key=\{`standard-\$\{value\}`\}/);
  assert.match(source, /Deposit credit breakdown/);
  assert.match(source, /rewardPercentLabel\(rewardPercentBps\)\} verified-deposit reward estimate\{rewardProgramEnabled \? '' : ' · inactive'\}/);
  assert.match(source, /money\(amountPaise \+ \(rewardProgramEnabled \? rewardEstimatePaise : 0\)\)/);
  assert.match(source, /This estimate is not included in expected wallet credit; only independently verified deposit principal is expected/);
  assert.match(source, /funded reward reserve must cover the commission before approval/);
});

test('reward estimate uses server basis points with a safe 6.2 percent fallback', () => {
  assert.match(source, /verifiedDepositReward\?\.percentBps \?\? config\?\.rewardPercentBps \?\? P2P_ORDER_REWARD_PERCENT_BPS/);
  assert.match(source, /Number\.isSafeInteger\(configuredRewardPercentBps\)/);
  assert.match(appSource, /rewardPercentBps: 620/);
  assert.doesNotMatch(appSource, /rewardPercentBps: 1700/);
  assert.match(source, /₹100 example: \+\{money\(hundredRupeeRewardEstimatePaise\)\} estimate/);
  assert.match(source, /Inactive on the server; this is illustrative only and is not included in expected wallet credit/);
});

test('order cancellation stays a direct server action without a cancelled-payment review button', () => {
  assert.match(source, /\/api\/v1\/deposits\/orders\/\$\{encodeURIComponent\(orderId\)\}\/cancel/);
  assert.match(source, />Cancel order</);
  assert.doesNotMatch(source, /Review cancelled payment|openCancelledPaymentRecovery|canReopenCancelledPayment/);
});
