function refreshWalletBalance(request, onBalance) {
  if (typeof request !== 'function' || typeof onBalance !== 'function') {
    throw new TypeError('A balance request and update callback are required.');
  }
  return Promise.resolve()
    .then(request)
    .then((balance) => {
      if (!balance || !Number.isSafeInteger(balance.availablePaise) || balance.availablePaise < 0) {
        throw new Error('The server returned an invalid wallet balance.');
      }
      onBalance(balance);
      return balance;
    });
}

module.exports = { refreshWalletBalance };
