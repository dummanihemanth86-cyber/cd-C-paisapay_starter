'use strict';

function registrationRewardMessage(reward) {
  if (reward?.status === 'CREDITED' && Number.isSafeInteger(reward.amountPaise) && reward.amountPaise > 0) {
    const amount = (reward.amountPaise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return `₹${amount} welcome reward has been added to your available balance.`;
  }
  if (reward?.status === 'FUNDING_REQUIRED') {
    return 'The welcome reward was not credited because the reward fund is not funded.';
  }
  return null;
}

function loginRewardMessage(reward) {
  if (reward?.status === 'CREDITED' && Number.isSafeInteger(reward.amountPaise) && reward.amountPaise > 0) {
    const amount = (reward.amountPaise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return `₹${amount} welcome reward was credited. Your balance is refreshing from the server.`;
  }
  if (reward?.status === 'FUNDING_REQUIRED') {
    return 'The welcome reward was not credited because the reward fund is not funded.';
  }
  if (reward?.status === 'DISABLED') {
    return 'The welcome reward is not enabled on this server. No reward was added.';
  }
  return null;
}

module.exports = { registrationRewardMessage, loginRewardMessage };
