const ROOT_TABS = new Set(['Home', 'Deposit', 'UPI', 'Team', 'Mine']);

function resolveHardwareBack({ logged, screen, tab }) {
  if (!logged || screen === 'Home') return { handled: false };

  const destination = ROOT_TABS.has(screen)
    ? 'Home'
    : ROOT_TABS.has(tab) ? tab : 'Home';

  return { handled: true, screen: destination, tab: destination };
}

module.exports = { resolveHardwareBack };
