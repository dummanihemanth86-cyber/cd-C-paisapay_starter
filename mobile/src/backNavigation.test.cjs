const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { resolveHardwareBack } = require('./backNavigation.cjs');

test('hardware Back leaves login and Home to Android', () => {
  assert.deepEqual(resolveHardwareBack({ logged: false, screen: 'Login', tab: 'Home' }), { handled: false });
  assert.deepEqual(resolveHardwareBack({ logged: true, screen: 'Home', tab: 'Home' }), { handled: false });
});

test('hardware Back from a primary tab returns to Home', () => {
  assert.deepEqual(resolveHardwareBack({ logged: true, screen: 'Deposit', tab: 'Deposit' }), { handled: true, screen: 'Home', tab: 'Home' });
  assert.deepEqual(resolveHardwareBack({ logged: true, screen: 'Mine', tab: 'Mine' }), { handled: true, screen: 'Home', tab: 'Home' });
});

test('hardware Back from a secondary screen returns to its parent tab', () => {
  assert.deepEqual(resolveHardwareBack({ logged: true, screen: 'Deposit History', tab: 'Deposit' }), { handled: true, screen: 'Deposit', tab: 'Deposit' });
  assert.deepEqual(resolveHardwareBack({ logged: true, screen: 'Withdrawals', tab: 'Mine' }), { handled: true, screen: 'Mine', tab: 'Mine' });
  assert.deepEqual(resolveHardwareBack({ logged: true, screen: 'Order Details', tab: 'UPI' }), { handled: true, screen: 'UPI', tab: 'UPI' });
});

test('App wires hardware Back to the tested navigation resolver', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
  assert.match(source, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(source, /resolveHardwareBack\(\{ logged, screen, tab \}\)/);
});
