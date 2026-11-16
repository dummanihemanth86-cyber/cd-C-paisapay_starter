'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registrationRewardMessage, loginRewardMessage } = require('./welcomeBonusUi.cjs');

test('shows the welcome amount as credited only when the server confirms a ledger credit', () => {
  assert.equal(registrationRewardMessage({ status: 'CREDITED', amountPaise: 4900 }), '₹49 welcome reward has been added to your available balance.');
  assert.equal(registrationRewardMessage({ status: 'DISABLED', amountPaise: 0 }), null);
  assert.equal(registrationRewardMessage({ status: 'NOT_ELIGIBLE', amountPaise: 0 }), null);
});

test('explains a depleted reward pool without claiming a credit', () => {
  assert.equal(registrationRewardMessage({ status: 'FUNDING_REQUIRED', amountPaise: 0 }), 'The welcome reward was not credited because the reward fund is not funded.');
});

test('registration result is connected to the truthful welcome reward notice', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '..', 'App.js'), 'utf8');
  assert.match(app, /registrationRewardMessage\(result\.welcomeBonus\)/);
  assert.match(app, /completionMessage, rewardMessage\]\.filter\(Boolean\)\.join\(' '\)/);
});

test('login only reports a server-confirmed welcome credit and gives the exact funding blocker', () => {
  assert.equal(loginRewardMessage({ status: 'CREDITED', amountPaise: 4900 }), '₹49 welcome reward was credited. Your balance is refreshing from the server.');
  assert.match(loginRewardMessage({ status: 'FUNDING_REQUIRED', amountPaise: 0 }), /reward fund is not funded/);
  assert.match(loginRewardMessage({ status: 'DISABLED', amountPaise: 0 }), /not enabled on this server/);
  assert.equal(loginRewardMessage({ status: 'NOT_ELIGIBLE', amountPaise: 0 }), null);
  const app = fs.readFileSync(path.resolve(__dirname, '..', 'App.js'), 'utf8');
  assert.match(app, /loginRewardMessage\(result\.welcomeBonus\)/);
  assert.match(app, /balanceStatus: balanceStatus/);
  const home = fs.readFileSync(path.resolve(__dirname, 'UltraHome.js'), 'utf8');
  assert.match(home, /balance === null \|\| balance === undefined \? \(balanceStatus === 'error' \? 'Unavailable' : 'Loading…'\)/);
});
