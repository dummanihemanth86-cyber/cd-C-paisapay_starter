const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshWalletBalance } = require('./walletBalanceRefresh.cjs');

test('applies a valid wallet balance as soon as its request succeeds', async () => {
  const expected = { availablePaise: 12500, pendingPaise: 1000, reservedPaise: 500 };
  let actual;
  const result = await refreshWalletBalance(async () => expected, (balance) => { actual = balance; });
  assert.equal(result, expected);
  assert.equal(actual, expected);
});

test('keeps a successful balance update even if a parallel dashboard request fails', async () => {
  let actual;
  let finishBalance;
  const balanceRequest = refreshWalletBalance(
    () => new Promise((resolve) => { finishBalance = resolve; }),
    (balance) => { actual = balance; },
  );
  const snapshot = Promise.all([balanceRequest, Promise.reject(new Error('transactions unavailable'))]);
  await assert.rejects(snapshot, /transactions unavailable/);
  finishBalance({ availablePaise: 9000 });
  await balanceRequest;
  assert.deepEqual(actual, { availablePaise: 9000 });
});

test('does not replace the displayed balance with malformed server data', async () => {
  let updated = false;
  await assert.rejects(
    refreshWalletBalance(async () => ({ availablePaise: -1 }), () => { updated = true; }),
    /invalid wallet balance/,
  );
  assert.equal(updated, false);
});
