function shouldShowPromotionalBanner(financialOperationsEnabled) {
  return financialOperationsEnabled === true;
}

function vipProgressStatusLabel(vipData) {
  if (vipData?.programStatus === 'ACTIVE') {
    const level = Number.isInteger(vipData.currentLevel) && vipData.currentLevel >= 0
      ? vipData.currentLevel
      : 0;
    return `VIP ${level} ACTIVE`;
  }
  if (vipData?.programStatus === 'SETUP_REQUIRED') return 'SETUP REQUIRED';
  return 'STATUS UNAVAILABLE';
}

module.exports = { shouldShowPromotionalBanner, vipProgressStatusLabel };
