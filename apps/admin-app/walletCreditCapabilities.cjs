function isSuperAdmin(profile) {
  return profile?.role === 'SUPER_ADMIN';
}

function canRequestWalletCredit(profile) {
  return isSuperAdmin(profile) && profile.walletCreditRequestsEnabled === true;
}

function canDirectWalletCredit(profile) {
  return isSuperAdmin(profile) && profile.stagingDirectWalletCreditsEnabled === true;
}

function canDecideWalletRequest(profile, kind) {
  if (!isSuperAdmin(profile)) return false;
  if (kind === 'credit') return profile.walletCreditRequestsEnabled === true;
  if (kind === 'funding') return profile.walletFundingRequestsEnabled === true;
  return false;
}

module.exports = { canDecideWalletRequest, canRequestWalletCredit, canDirectWalletCredit };
