import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './live-reconciliation.css';

// In local development, use the Vite same-origin proxy. This works when the
// admin page is opened from another device on the LAN as well as on this PC.
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function api(path, { token, method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    const apiAddress = API || `${window.location.origin} (Vite API proxy)`;
    throw new Error(`Could not reach the PaisaPay API at ${apiAddress}. Check the backend at ${window.location.origin}/ready and restart the admin dev server.`);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code ? ` [${data.error.code}]` : '';
    const requestId = data?.requestId ? ` Request ID: ${data.requestId}` : '';
    throw new Error(`${data?.error?.message || `Request failed (${response.status}).`}${code}${requestId}`);
  }
  return data;
}

function amountPaiseFromRupees(value) {
  const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

function money(paise) {
  return `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function App() {
  const [theme, setTheme] = useState(() => window.localStorage.getItem('paisapay.admin.theme') === 'light' ? 'light' : 'dark');
  useEffect(() => { window.localStorage.setItem('paisapay.admin.theme', theme); }, [theme]);
  const [token, setToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [adminAccess, setAdminAccess] = useState(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [claims, setClaims] = useState([]);
  const [p2pOrders, setP2pOrders] = useState([]);
  const [p2pOffers, setP2pOffers] = useState([]);
  const [p2pClaims, setP2pClaims] = useState([]);
  const [adminSection, setAdminSection] = useState('overview');
  const [p2pSearch, setP2pSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const loadClaims = async (authToken = token) => {
    const result = await api('/api/v1/admin/reconciliation/claims?status=PENDING_REVIEW', { token: authToken });
    setClaims(result.claims || []);
  };

  const loadP2p = async (authToken = token, query = p2pSearch) => {
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    const [ordersResult, offersResult] = await Promise.all([
      api(`/api/v1/admin/p2p/orders${suffix}`, { token: authToken }),
      api(`/api/v1/admin/p2p/offers${suffix}`, { token: authToken }),
    ]);
    setP2pOrders(ordersResult.orders || []); setP2pOffers(offersResult.offers || []);
    try { const claimsResult = await api('/api/v1/admin/p2p/claims', { token: authToken }); setP2pClaims(claimsResult.claims || []); }
    catch { setP2pClaims([]); }
  };

  const login = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setInfo('');
    try {
      const result = await api('/api/v1/auth/password/login', { method: 'POST', body: { phoneE164: `+91${phone.replace(/\D/g, '').slice(-10)}`, password } });
      const access = await api('/api/v1/admin/me', { token: result.accessToken });
      setPassword(''); setAdminAccess(access); setToken(result.accessToken); setRefreshToken(result.refreshToken || '');
      setInfo('Signed in. Sections and actions are limited by your server-side administrator role.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const logout = async () => { try { await api('/api/v1/auth/logout', { token, method: 'POST', body: { refreshToken } }); } catch { /* Clear this browser session even if the API is offline. */ } finally { setToken(''); setRefreshToken(''); setAdminAccess(null); setClaims([]); setP2pOrders([]); setP2pOffers([]); setP2pClaims([]); setPassword(''); setInfo('Signed out.'); } };

  const reviewed = async () => {
    try { setBusy(true); await loadClaims(); setInfo('Pending reconciliation list refreshed.'); }
    catch (e) { setError(e.message); if (e.message.includes('session') || e.message.includes('Sign in')) logout(); }
    finally { setBusy(false); }
  };

  return <main className="live-admin" data-theme={theme}>
    <header className="live-header">
      <div><div className="live-brand"><img src="/paisapay-neon-logo.png" alt="PaisaPay logo" /><span>PaisaPay</span></div><h1>Admin Control Center</h1><p>Live PaisaPay data · Role controlled · INR</p></div>
      <div className="admin-header-actions"><button type="button" className="secondary" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Switch color theme">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>{token && <button className="secondary" onClick={logout}>Sign out</button>}</div>
    </header>
    <div className="live-notice"><b>UPI payment verification is not automatic.</b> A user-submitted reference is only a claim. Check the merchant bank records, exact amount, INR currency, and receiver before approving.</div>
    {error && <div className="live-alert error">{error}</div>}{info && <div className="live-alert success">{info}</div>}
    {!token ? <form className="login-panel" onSubmit={login}>
      <h2>Admin sign in</h2><p>Use an existing PaisaPay account that has an authorized Finance, Admin, or Super Admin role. Ordinary accounts will be denied by the backend.</p>
      <label>Mobile number<input autoComplete="username" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" required /></label>
      <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <small>Session token is kept in memory for this page only. Use HTTPS outside local development.</small>
    </form> : <AdminWorkspace token={token} access={adminAccess} claims={claims} p2pOrders={p2pOrders} p2pOffers={p2pOffers} p2pClaims={p2pClaims} loadClaims={loadClaims} loadP2p={loadP2p} setInfo={setInfo} setError={setError} />}
    <footer>API: {API} · Transaction references are sensitive business data; do not export or share this page.</footer>
  </main>;
}


const adminNavigation = [
  ['overview', 'Dashboard'], ['users', 'Users'], ['deposits', 'Deposits'], ['withdrawals', 'Withdrawals'], ['p2p', 'P2P Marketplace'],
  ['transactions', 'Transactions'], ['ledger', 'Wallet Ledger'], ['providers', 'Payment Providers'], ['commissions', 'Commission'],
  ['referrals', 'Referral & Team'], ['disputes', 'Disputes'], ['support', 'Support'], ['reconciliation', 'Reconciliation'],
  ['admins', 'Admin Management'], ['audit', 'Audit Logs'], ['health', 'System Health'], ['reports', 'Reports'],
  ['notifications', 'Notifications'], ['settings', 'Settings'],
];
const adminViews = {
  users: ['/api/v1/admin/users', 'users', 'Users'], deposits: ['/api/v1/admin/deposits', 'deposits', 'Deposits'],
  withdrawals: ['/api/v1/admin/withdrawals', 'withdrawals', 'Withdrawals'], transactions: ['/api/v1/admin/transactions', 'transactions', 'Transactions'],
  ledger: ['/api/v1/admin/wallets/ledger', 'entries', 'Wallet ledger'], referrals: ['/api/v1/admin/referrals', 'referrals', 'Referrals'],
  commissions: ['/api/v1/admin/commissions', 'commissions', 'Commission history'], providers: ['/api/v1/admin/providers', 'methods', 'Payment providers'],
  disputes: ['/api/v1/admin/disputes', 'disputes', 'Disputes'], support: ['/api/v1/admin/support/tickets', 'tickets', 'Support tickets'],
  admins: ['/api/v1/admin/admins', 'admins', 'Administrator accounts'], audit: ['/api/v1/admin/audit-logs', 'auditLogs', 'Audit logs'],
  health: ['/api/v1/admin/system-health', null, 'System health'], p2pSummary: ['/api/v1/admin/p2p/overview', null, 'P2P Marketplace'],
};

function AdminWorkspace({ token, access, claims, p2pOrders, p2pOffers, p2pClaims, loadClaims, loadP2p, setInfo, setError }) {
  const [section, setSection] = useState('overview');
  const [refresh, setRefresh] = useState(0);
  const [p2pStatusFilter, setP2pStatusFilter] = useState('ALL');
  const loadP2pRef = useRef(loadP2p);
  loadP2pRef.current = loadP2p;
  const visibleNavigation = adminNavigation.filter(([id]) => access?.allowedSections?.includes(id));
  const select = (id) => { setSection(id); setRefresh((x) => x + 1); };
  useEffect(() => { if (section === 'reconciliation') loadClaims().catch((e) => setError(e.message)); if (section === 'p2p') loadP2p().catch((e) => setError(e.message)); }, [section, token, refresh]);
  useEffect(() => {
    if (section !== 'p2p') return undefined;
    const timer = window.setInterval(() => loadP2pRef.current(token).catch((e) => setError(e.message)), 4000);
    return () => window.clearInterval(timer);
  }, [section, token]);
  const refreshAll = async () => { setRefresh((x) => x + 1); if (section === 'reconciliation') await loadClaims(); if (section === 'p2p') await loadP2p(); };
  return <div className="control-shell">
    <aside className="control-nav"><div className="nav-label">MANAGEMENT · {access?.role || 'ADMIN'}</div>{visibleNavigation.map(([id, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => select(id)}>{label}</button>)}</aside>
    <section className="control-main">
      <div className="control-toolbar"><div><h2>{adminNavigation.find(([id]) => id === section)?.[1] || 'Admin'}</h2><p>Live records from PostgreSQL · INR · Signed in as {access?.role || 'administrator'}; permissions enforced by the server</p></div><button className="secondary" onClick={async () => { try { await refreshAll(); } catch (e) { setError(e.message); } }}>Refresh</button></div>
      {section === 'overview' && <AdminOverview token={token} refresh={refresh} />}
      {section === 'reconciliation' && <div className="control-panel"><div className="live-notice"><b>Payment review requires independent evidence.</b> User-submitted UPI references are claims, not proof.</div>{claims.length ? claims.map((claim) => <ClaimCard key={claim.id} claim={claim} token={token} onDone={async () => { await loadClaims(); setInfo('Reconciliation review saved.'); }} />) : <div className="empty-live">No manual deposit claims are awaiting review.</div>}</div>}
      {section === 'p2p' && <div className="control-panel"><div className="live-notice"><b>P2P payment verification is manual.</b> Claims are unverified until Finance confirms recipient-side receipt against independent records. Post-handoff cancellations and expired orders remain held; reject only after confirming non-receipt.</div><div className="p2p-search"><input placeholder="Search by reference" onChange={(e) => { window.clearTimeout(window.__p2pSearchTimer); window.__p2pSearchTimer = window.setTimeout(() => loadP2p(token, e.target.value), 300); }} /><button className="secondary" onClick={() => loadP2p()}>Refresh P2P</button><select aria-label="Filter P2P orders by status" value={p2pStatusFilter} onChange={(e) => setP2pStatusFilter(e.target.value)}><option value="ALL">All order states</option>{['MATCHED','PAYMENT_PENDING','PAYMENT_PROCESSING','PAYMENT_EXPIRED_REVIEW','CANCELLED_PAYMENT_HOLD','DISPUTED','COMPLETED','REJECTED','CANCELLED','EXPIRED','FAILED'].map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select></div><h3>Claims awaiting review ({p2pClaims.length})</h3>{p2pClaims.length ? p2pClaims.map((claim) => <P2pClaimCard key={claim.id} claim={claim} token={token} onDone={async (message) => { await loadP2p(); setInfo(message || 'P2P review saved.'); }} />) : <div className="empty-live">No Finance claims awaiting review.</div>}<h3>Buyer orders · {p2pOrders.filter((o) => p2pStatusFilter === 'ALL' || o.status === p2pStatusFilter).length}</h3><SimpleTable rows={p2pOrders.filter((o) => p2pStatusFilter === 'ALL' || o.status === p2pStatusFilter).map((o) => ({ referenceId: o.referenceId, amountPaise: o.amountPaise, status: o.status, buyer: o.buyer?.publicId, buyerPhone: o.buyer?.phoneMasked, seller: o.seller?.publicId, sellerPhone: o.seller?.phoneMasked, withdrawalReference: o.withdrawalOffer?.referenceId, expiresAt: o.expiresAt, paymentDetailsShownAt: o.paymentDetailsShownAt, paymentHandoffStartedAt: o.paymentHandoffStartedAt, claims: o.claims, createdAt: o.createdAt, updatedAt: o.updatedAt }))} /><h3>Withdrawal offers · {p2pOffers.length}</h3><SimpleTable rows={p2pOffers.map((o) => ({ referenceId: o.referenceId, amountPaise: o.amountPaise, status: o.status, user: o.user?.publicId, userPhone: o.user?.phoneMasked, completedAmountPaise: o.completedAmountPaise, activeReservedPaise: o.activeReservedPaise, disputedHeldPaise: o.disputedHeldPaise, availableAmountPaise: o.availableAmountPaise, expiresAt: o.expiresAt, orders: o.orders }))} /></div>}
      {section === 'referrals' && <ReferralAdminSection token={token} refresh={refresh} setInfo={setInfo} setError={setError} />}
      {section !== 'referrals' && adminViews[section] && <AdminDataSection key={section} view={adminViews[section]} token={token} role={access?.role} refresh={refresh} setInfo={setInfo} setError={setError} />}
      {['notifications', 'settings', 'reports'].includes(section) && <div className="control-panel"><h3>{adminNavigation.find(([id]) => id === section)?.[1]} unavailable</h3><p className="claim-muted">This feature does not have a supported backend workflow in the current project. No send, configuration, export, or financial controls are exposed here.</p>{section === 'reports' && <button className="secondary" onClick={() => select('transactions')}>View live transaction list</button>}</div>}
    </section>
  </div>;
}

function ReferralAdminSection({ token, refresh, setInfo, setError }) {
  const [data, setData] = useState(null); const [rows, setRows] = useState([]); const [direct, setDirect] = useState('0.4'); const [indirect, setIndirect] = useState('0.1'); const [reason, setReason] = useState('Referral program rules reviewed and approved.'); const [busy, setBusy] = useState(false);
  const load = async () => {
    const [config, referrals] = await Promise.all([api('/api/v1/admin/referrals/config', { token }), api('/api/v1/admin/referrals?pageSize=100', { token })]);
    setData(config); setRows(referrals.referrals || []); setDirect(String(config.config.directRateBps / 100)); setIndirect(String(config.config.indirectRateBps / 100));
  };
  useEffect(() => { load().catch((e) => setError(e.message)); }, [token, refresh]);
  const saveRates = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const d = Number(direct); const i = Number(indirect);
      if (!Number.isFinite(d) || !Number.isFinite(i) || d < 0 || i < 0 || d > 10 || i > 10) throw new Error('Rates must be between 0% and 10%.');
      await api('/api/v1/admin/referrals/config', { token, method: 'PATCH', body: { directRateBps: Math.round(d * 100), indirectRateBps: Math.round(i * 100), reason } });
      setInfo('Referral commission rates saved and audited.'); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const saveMilestone = async (rule) => {
    setBusy(true);
    try {
      const requiredReferrals = Number(rule.requiredReferrals);
      const rewardAmountPaise = amountPaiseFromRupees(rule.rewardRupees);
      const qualifyingTopUpPaise = rule.qualifyingRupees === '' ? null : amountPaiseFromRupees(rule.qualifyingRupees);
      if (!Number.isInteger(requiredReferrals) || requiredReferrals < 1 || rewardAmountPaise === null || (rule.qualifyingRupees !== '' && qualifyingTopUpPaise === null)) throw new Error('Enter valid referral counts and rupee amounts.');
      await api(`/api/v1/admin/referrals/milestones/${encodeURIComponent(rule.key)}`, { token, method: 'PATCH', body: { requiredReferrals, qualifyingTopUpPaise, rewardAmountPaise, enabled: rule.enabled, reason } });
      setInfo(`${rule.key} milestone saved and audited.`); await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  if (!data) return <div className="control-panel">Loading referral configuration…</div>;
  return <>
    <div className="live-notice"><b>Reward payout is not configured.</b> Verified activity can create pending accruals and milestone eligibility records. No referral commission or milestone is credited to wallets until an approved funded payout process exists.</div>
    <form className="control-panel" onSubmit={saveRates}><h3>Commission rates</h3><div className="data-toolbar"><label>Direct rate (%)<input inputMode="decimal" value={direct} onChange={(e) => setDirect(e.target.value)} /></label><label>Indirect rate (%)<input inputMode="decimal" value={indirect} onChange={(e) => setIndirect(e.target.value)} /></label><label>Audit reason<input value={reason} onChange={(e) => setReason(e.target.value)} minLength={8} /></label><button disabled={busy}>Save rates</button></div></form>
    <div className="control-panel"><h3>Milestone rules</h3>{data.milestones.map((item) => <ReferralMilestoneEditor key={item.key} item={item} onSave={saveMilestone} disabled={busy} />)}</div>
    <div className="control-panel"><h3>Referral relationships ({rows.length})</h3><SimpleTable rows={rows.map((r) => ({ referrer: r.referrer?.publicId, referrerName: r.referrer?.displayName, invitee: r.invitee?.publicId, inviteeName: r.invitee?.displayName, status: r.status, joined: r.createdAt }))} /></div>
  </>;
}

function ReferralMilestoneEditor({ item, onSave, disabled }) {
  const [requiredReferrals, setRequired] = useState(String(item.requiredReferrals));
  const [qualifyingRupees, setQualifying] = useState(item.qualifyingTopUpPaise == null ? '' : String(item.qualifyingTopUpPaise / 100));
  const [rewardRupees, setReward] = useState(String(item.rewardAmountPaise / 100));
  const [enabled, setEnabled] = useState(item.enabled);
  return <form className="data-toolbar referral-rule" onSubmit={(event) => { event.preventDefault(); onSave({ key: item.key, requiredReferrals, qualifyingRupees, rewardRupees, enabled }); }}>
    <strong>{item.key.replace('_', ' ')}</strong><label>Qualifying users<input type="number" min="1" value={requiredReferrals} onChange={(e) => setRequired(e.target.value)} /></label><label>Min verified top-up (₹; blank disables)<input inputMode="decimal" value={qualifyingRupees} onChange={(e) => setQualifying(e.target.value)} /></label><label>Reward (₹)<input inputMode="decimal" value={rewardRupees} onChange={(e) => setReward(e.target.value)} /></label><label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label><button disabled={disabled}>Save</button>
  </form>;
}

function AdminOverview({ token, refresh }) {
  const [data, setData] = useState(null); const [error, setError] = useState('');
  const [period, setPeriod] = useState('daily');
  useEffect(() => { let active = true; api('/api/v1/admin/overview', { token }).then((v) => { if (active) { setData(v); setError(''); } }).catch((e) => active && setError(e.message)); return () => { active = false; }; }, [token, refresh]);
  if (error) return <div className="control-panel live-alert error">{error}</div>;
  if (!data) return <div className="control-panel">Loading live dashboard…</div>;
  const m = data.metrics || {}; const cards = [['Registered users', m.users], ['Active users', m.activeUsers], ['Suspended users', m.blockedUsers], ['New today', m.newUsersToday], ['Available ledger', money(m.totalWalletBalancePaise)], ['Reserved ledger', money(m.totalReservedBalancePaise)], ['Pending deposits', m.pendingDeposits], ['Pending withdrawals', m.pendingWithdrawals], ['Verified deposit value', money(m.totalDepositValuePaise)], ['Completed withdrawal value', money(m.totalWithdrawalValuePaise)], ['Completed transactions', m.completedTransactions], ['Failed deposits', m.failedTransactions], ['Disputed orders', m.disputedTransactions], ['Today volume', money(m.todayTransactionVolumePaise)], ['Commission entries', m.commissionEarnedPaise == null ? 'Unavailable' : money(m.commissionEarnedPaise)], ['Platform revenue', m.totalPlatformRevenuePaise == null ? 'Unavailable' : 'Not tracked']];
  const chart = data.charts?.[period] || []; const max = Math.max(1, ...chart.map((x) => x.depositsPaise + x.withdrawalsPaise)); const maxUsers = Math.max(1, ...chart.map((x) => x.registrations));
  return <><div className="admin-metrics">{cards.map(([label, value]) => <article className="admin-metric" key={label}><span>{label}</span><strong>{value ?? '—'}</strong></article>)}</div><div className="control-panel"><div className="data-toolbar"><h3>Transaction and registration trends</h3><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="daily">Daily · 7 days</option><option value="weekly">Weekly · 4 weeks</option><option value="monthly">Monthly · 12 months</option></select></div><div className="admin-chart">{chart.map((d) => <div className="chart-day" key={String(d.date)}><div className="chart-bars"><i title={`Deposits ${money(d.depositsPaise)}`} style={{ height: `${Math.max(3, d.depositsPaise / max * 100)}%` }} /><b title={`Withdrawals ${money(d.withdrawalsPaise)}`} style={{ height: `${Math.max(3, d.withdrawalsPaise / max * 100)}%` }} /><em title={`New users ${d.registrations}`} style={{ height: `${Math.max(3, d.registrations / maxUsers * 100)}%` }} /></div><small>{period === 'daily' ? new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }) : new Date(d.date).toLocaleDateString(undefined, period === 'monthly' ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' })}</small></div>)}</div><div className="chart-legend"><span>Deposits</span><span>Withdrawals</span><span>New users</span></div></div><div className="admin-columns"><div className="control-panel"><h3>Recent deposits</h3><SimpleTable rows={data.recentTransactions || []} /></div><div className="control-panel"><h3>Recent registrations</h3><SimpleTable rows={data.recentUsers || []} /></div></div><div className="control-panel"><h3>Pending admin actions</h3><p>Manual deposits: {data.pendingAdminActions?.manualDeposits ?? 0} · P2P claims: {data.pendingAdminActions?.p2pClaims ?? 0} · Open P2P offers: {data.pendingAdminActions?.openP2pOffers ?? 0}</p><p>API: {data.system?.api} · Database: {data.system?.database}</p></div></>;
}

function AdminDataSection({ view, token, role, refresh, setInfo, setError }) {
  const [rows, setRows] = useState([]); const [raw, setRaw] = useState(null); const [query, setQuery] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1); const [busy, setBusy] = useState(false); const [total, setTotal] = useState(0);
  const [selectedUser, setSelectedUser] = useState(null);
  const statusOptions = view[1] === 'users' ? ['PENDING_PROFILE','ACTIVE','SUSPENDED','CLOSED'] : view[1] === 'deposits' ? ['CREATED','PENDING_PAYMENT','PAYMENT_PROCESSING','PAYMENT_VERIFIED','COMPLETED','FAILED','CANCELLED','EXPIRED','REFUNDED','REVERSED'] : view[1] === 'withdrawals' ? ['REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','COMPLETED','REJECTED','FAILED','CANCELLED'] : ['AVAILABLE','RESERVED','PENDING','OPEN','MATCHED','PAYMENT_PENDING','PAYMENT_PROCESSING','PAYMENT_VERIFIED','SETTLED','FAILED','CANCELLED','DISPUTED','COMPLETED'];
  const load = async (requestedPage = page, requestedQuery = query) => { if (!view[1]) { const result = await api(view[0], { token }); setRaw(result); setRows([]); return; } setBusy(true); try { const params = new URLSearchParams({ page: String(requestedPage), pageSize: '25' }); if (requestedQuery) params.set('q', requestedQuery); if (status) params.set('status', status); const result = await api(`${view[0]}?${params}`, { token }); setRows(result[view[1]] || []); setRaw(result); setTotal(result.total || 0); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  useEffect(() => { load(page); }, [token, refresh, page, status]);
  const search = async () => { setPage(1); await load(1, query); };
  const viewUser = async (row) => { try { const result = await api(`/api/v1/admin/users/${encodeURIComponent(row.id)}`, { token }); setSelectedUser(result.user); } catch (e) { setError(e.message); } };
  const act = async (row) => { const next = row.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED'; const reason = window.prompt(`${next === 'SUSPENDED' ? 'Suspend' : 'Reactivate'} account. Enter reason (minimum 8 characters):`); if (!reason || reason.trim().length < 8) return; try { await api(`/api/v1/admin/users/${encodeURIComponent(row.id)}/status`, { token, method: 'POST', body: { status: next, reason: reason.trim() } }); await load(); setInfo(`Account status changed to ${next}.`); } catch (e) { setError(e.message); } };
  return <div className="control-panel"><div className="data-toolbar"><div><h3>{view[2]}</h3><p>{total ? `${total.toLocaleString()} records` : 'Live database records. Empty means no matching records.'}</p></div>{view[1] && <div className="data-filters"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search records" onKeyDown={(e) => e.key === 'Enter' && search()} /><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{statusOptions.map((x) => <option key={x}>{x}</option>)}</select><button className="secondary" onClick={search}>Search</button></div>}</div>
    {busy && <p>Loading…</p>}
    {selectedUser && <section className="control-panel" aria-label="User details"><div className="data-toolbar"><div><h3>User details · {selectedUser.publicId}</h3><p>Protected account summary; credentials and full phone number are never returned.</p></div><button className="secondary" onClick={() => setSelectedUser(null)}>Close</button></div><SimpleTable rows={[{ name: selectedUser.displayName, userId: selectedUser.publicId, phone: selectedUser.phoneMasked, status: selectedUser.status, adminRole: selectedUser.adminRole?.role || 'USER', joined: selectedUser.createdAt, updated: selectedUser.updatedAt, totalTransactions: selectedUser.totalTransactions }]} /></section>}
    {view[1] ? <><SimpleTable rows={rows} onUserAction={view[1] === 'users' && ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'].includes(role) ? act : null} onUserView={view[1] === 'users' ? viewUser : null} /><div className="data-pagination"><button className="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button><span>Page {page} · {total} records</span><button className="secondary" disabled={page * 25 >= total} onClick={() => setPage((p) => p + 1)}>Next</button></div></> : <><SimpleTable rows={view[0].endsWith('/providers') ? (raw?.methods || []) : view[0].endsWith('/system-health') ? [{ api: raw?.api, database: raw?.database, databaseResponseTimeMs: raw?.databaseResponseTimeMs, payoutProvider: raw?.payoutProvider, backgroundWorkers: raw?.backgroundWorkers }, ...(raw?.payments || [])] : []} /><pre className="safe-json">{JSON.stringify(raw, null, 2)}</pre></>}
    {raw?.message && <p className="claim-muted">{raw.message}</p>}{raw?.configuration && <p className="claim-muted">{raw.configuration}</p>}{raw?.actions && <p className="claim-muted">{raw.actions}</p>}{raw?.management && <p className="claim-muted">{raw.management}</p>}{raw?.rewards && <p className="claim-muted">{raw.rewards}</p>}
  </div>;
}

function SimpleTable({ rows = [], onUserAction, onUserView }) {
  const [selectedRow, setSelectedRow] = useState(null);
  if (!rows.length) return <div className="empty-live">No records to display.</div>;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r || {})))].filter((key) => !['_count', 'metadata', 'history', 'claims'].includes(key)).slice(0, 8);
  const value = (key, item) => { let v = item?.[key]; if (v && typeof v === 'object') v = v.publicId || v.referenceId || JSON.stringify(v); if (key.toLowerCase().includes('paise') && v != null) return money(v); if (v instanceof Date || (typeof v === 'string' && /At$/.test(key) && !Number.isNaN(Date.parse(v)))) return new Date(v).toLocaleString(); if (typeof v === 'boolean') return v ? 'Yes' : 'No'; return v == null || v === '' ? '—' : String(v); };
  const safeDetails = (record) => {
    if (Array.isArray(record)) return record.map(safeDetails);
    if (!record || typeof record !== 'object') return record;
    return Object.fromEntries(Object.entries(record).filter(([key]) => !/password|otp|token|secret|api.?key|phoneE164|evidenceImage|base64|authorization/i.test(key)).map(([key, value]) => [key, safeDetails(value)]));
  };
  const detailValue = (key, raw) => { if (raw == null || raw === '') return '—'; if (/Paise$/i.test(key) && (typeof raw === 'number' || /^\d+$/.test(String(raw)))) return money(raw); if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'; if (raw && typeof raw === 'object') return JSON.stringify(safeDetails(raw), null, 2); if (typeof raw === 'string' && /At$/.test(key) && !Number.isNaN(Date.parse(raw))) return new Date(raw).toLocaleString(); return String(raw); };
  return <><div className="admin-table-wrap"><table className="admin-table"><thead><tr>{keys.map((key) => <th key={key}>{key.replace(/([A-Z])/g, ' $1')}</th>)}{(onUserAction || onUserView) && <th>Actions</th>}</tr></thead><tbody>{rows.map((row, i) => <tr key={row.id || row.referenceId || i} className="detail-row" tabIndex={0} onClick={() => setSelectedRow(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedRow(row); }}>{keys.map((key) => <td key={key}>{value(key, row)}</td>)}{(onUserAction || onUserView) && <td onClick={(event) => event.stopPropagation()}>{onUserView && <button className="secondary" onClick={() => onUserView(row)}>Details</button>} {onUserAction && <button className="secondary" disabled={row.status === 'CLOSED'} onClick={() => onUserAction(row)}>{row.status === 'SUSPENDED' ? 'Reactivate' : row.status === 'CLOSED' ? 'Closed' : 'Suspend'}</button>}</td>}</tr>)}</tbody></table></div>{selectedRow && <div className="record-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRow(null); }}><section className="record-detail-card" role="dialog" aria-modal="true" aria-label="Record details"><header><div><span className="eyebrow">LIVE RECORD</span><h2>{selectedRow.referenceId || selectedRow.publicId || selectedRow.displayName || selectedRow.id || 'Record details'}</h2><p>Click any record to inspect fields returned by the authorized backend.</p></div><button className="secondary" onClick={() => setSelectedRow(null)}>Close</button></header><dl>{Object.entries(safeDetails(selectedRow)).map(([key, raw]) => <div className="record-detail-field" key={key}><dt>{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</dt><dd>{detailValue(key, raw)}</dd></div>)}</dl></section></div>}</>;
}

function ClaimCard({ claim, token, onDone }) {
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [screenshotError, setScreenshotError] = useState('');
  const [decision, setDecision] = useState('APPROVE');
  const [reason, setReason] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [verifiedReference, setVerifiedReference] = useState(claim.transactionReference || '');
  const [amount, setAmount] = useState((Number(claim.deposit.amountPaise) / 100).toFixed(2));
  const [receiverConfirmed, setReceiverConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!claim.evidenceMimeType) return undefined;
    let active = true; let objectUrl = '';
    fetch(`${API}/api/v1/admin/reconciliation/claims/${encodeURIComponent(claim.id)}/evidence`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => { if (!response.ok) throw new Error('Screenshot is unavailable.'); return response.blob(); })
      .then((blob) => { if (!active) return; objectUrl = URL.createObjectURL(blob); setScreenshotUrl(objectUrl); })
      .catch((e) => active && setScreenshotError(e.message));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [claim.id, claim.evidenceMimeType, token]);
  const submit = async () => {
    setError('');
    if (reason.trim().length < 8 || evidenceReference.trim().length < 3) return setError('Add a clear review reason and internal evidence reference.');
    const verifiedAmountPaise = amountPaiseFromRupees(amount);
    if (decision === 'APPROVE' && (verifiedAmountPaise === null || !receiverConfirmed)) return setError('For approval, confirm receiver receipt and enter the exact amount shown in merchant records.');
    setBusy(true);
    try {
      await api(`/api/v1/admin/reconciliation/claims/${encodeURIComponent(claim.id)}/review`, {
        token, method: 'POST', body: {
          decision, reason: reason.trim(), evidenceReference: evidenceReference.trim(),
          ...(decision === 'APPROVE' ? { verifiedTransactionReference: verifiedReference.trim(), verifiedAmountPaise, verifiedCurrency: 'INR', receiverConfirmed: true } : {}),
        },
      });
      await onDone();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <article className="claim-card">
    <div className="claim-top"><div><span className="eyebrow">DEPOSIT · {claim.deposit.status}</span><h3>{claim.deposit.id}</h3><div className="claim-muted">Merchant reference: {claim.deposit.merchantReference}</div></div><strong>{money(claim.deposit.amountPaise)}</strong></div>
    <div className="claim-facts"><div><small>Customer</small><b>{claim.user.displayName || claim.user.publicId || 'PaisaPay user'} · {claim.user.phoneMasked}</b></div><div><small>Submitted transaction reference (unverified)</small><b>{claim.transactionReference}</b></div><div><small>Submitted</small><b>{new Date(claim.createdAt).toLocaleString()}</b></div></div>
    <div className="claim-screenshot"><b>Customer transaction screenshot · unverified evidence</b>{screenshotUrl ? <a href={screenshotUrl} target="_blank" rel="noreferrer"><img src={screenshotUrl} alt="Customer-submitted transaction screenshot" /></a> : <small>{screenshotError || 'Loading protected attachment…'}</small>}<small>Use this only as supporting context. Confirm the UTR, amount, INR currency and receiver independently in merchant records.</small></div>
    <div className="review-form">
      <label>Decision<select value={decision} onChange={(e) => setDecision(e.target.value)}><option value="APPROVE">Approve after independent confirmation</option><option value="REJECT">Reject claim</option></select></label>
      {decision === 'APPROVE' && <><label>Verified transaction reference<input value={verifiedReference} onChange={(e) => setVerifiedReference(e.target.value)} /></label><label>Verified received amount (₹)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label className="check-row"><input type="checkbox" checked={receiverConfirmed} onChange={(e) => setReceiverConfirmed(e.target.checked)} />I independently confirmed this exact transaction reached the PaisaPay merchant receiver.</label></>}
      <label>Internal evidence reference<input value={evidenceReference} onChange={(e) => setEvidenceReference(e.target.value)} placeholder="Statement/report reference; do not paste credentials" /></label>
      <label>Review reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={8} maxLength={500} placeholder="Describe the records checked and decision." /></label>
    </div>
    {error && <div className="live-alert error">{error}</div>}
    <button disabled={busy} onClick={submit}>{busy ? 'Saving…' : decision === 'APPROVE' ? 'Verify receipt and credit ledger' : 'Reject claim'}</button>
    <small className="claim-footnote">Approval credits the available ledger once. Do not approve from a screenshot, user message, or sender-side success screen alone.</small>
  </article>;
}

function P2pClaimCard({ claim, token, onDone }) {
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [decision, setDecision] = useState('APPROVE');
  const [reason, setReason] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [verifiedReference, setVerifiedReference] = useState(claim.transactionReference);
  const [amount, setAmount] = useState((Number(claim.order.amountPaise) / 100).toFixed(2));
  const [verifiedPayeeVpa, setVerifiedPayeeVpa] = useState(claim.order.withdrawalOffer.payeeVpa || '');
  const [receiverConfirmed, setReceiverConfirmed] = useState(false);
  const [paymentNotReceivedConfirmed, setPaymentNotReceivedConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    if (claim.evidenceAttached) fetch(`${API}/api/v1/admin/p2p/claims/${encodeURIComponent(claim.id)}/evidence`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (!response.ok) throw new Error(`Evidence unavailable (${response.status})`); return response.blob(); })
      .then((blob) => { objectUrl = URL.createObjectURL(blob); if (!cancelled) setEvidenceUrl(objectUrl); else URL.revokeObjectURL(objectUrl); })
      .catch(() => { if (!cancelled) setEvidenceUrl(''); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [claim.id, claim.evidenceAttached, token]);
  const submit = async () => {
    setError('');
    if (reason.trim().length < 8 || evidenceReference.trim().length < 3) return setError('Add a review reason and internal evidence reference.');
    const verifiedAmountPaise = amountPaiseFromRupees(amount);
    if (decision === 'APPROVE' && (verifiedAmountPaise === null || !verifiedReference.trim() || !verifiedPayeeVpa.trim() || !receiverConfirmed)) return setError('Confirm the exact amount, transaction reference, recipient UPI ID, and receiver-side receipt from trusted records.');
    if (decision === 'REJECT' && !paymentNotReceivedConfirmed) return setError('Confirm from recipient-side records that no payment was received and no late payment is pending.');
    setBusy(true);
    try {
      const result = await api(`/api/v1/admin/p2p/claims/${encodeURIComponent(claim.id)}/review`, { token, method: 'POST', body: {
        decision, reason: reason.trim(), evidenceReference: evidenceReference.trim(),
        ...(decision === 'APPROVE' ? { verifiedTransactionReference: verifiedReference.trim(), verifiedAmountPaise, verifiedCurrency: 'INR', verifiedPayeeVpa: verifiedPayeeVpa.trim(), receiverConfirmed: true } : { paymentNotReceivedConfirmed: true }),
      } });
      await onDone(result?.message);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <article className="claim-card">
    <div className="claim-top"><div><span className="eyebrow">P2P · PENDING REVIEW</span><h3>{claim.order.referenceId}</h3><div className="claim-muted">Withdrawal {claim.order.withdrawalOffer.referenceId}</div></div><strong>{money(claim.order.amountPaise)}</strong></div>
    <div className="live-notice"><b>Seller UPI details are user-provided and unverified.</b> Check the recipient against actual receiver-side bank or merchant records before approval. Reject only after records show the payment was not received; rejection cancels this buyer order and makes the remaining offer available for another match.</div>
    <div className="claim-facts"><div><small>Order ID / reference</small><b>{claim.order.id} · {claim.order.referenceId}</b></div><div><small>Seller offer ID / reference</small><b>{claim.order.withdrawalOffer.id} · {claim.order.withdrawalOffer.referenceId}</b></div><div><small>Buyer</small><b>{claim.user.displayName || claim.user.publicId} · {claim.user.phoneMasked || '••••••'}</b></div><div><small>Seller ID</small><b>{claim.order.seller?.publicId || '—'}</b></div><div><small>Submitted reference (unverified)</small><b>{claim.transactionReference || 'Not supplied'}</b></div><div><small>Claimed payment</small><b>{claim.claimedAmountPaise == null ? 'Not supplied' : money(claim.claimedAmountPaise)} · {claim.claimedPaidAt ? new Date(claim.claimedPaidAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'time not supplied'}</b></div><div><small>Matched</small><b>{claim.order.timestamps?.matchedAt ? new Date(claim.order.timestamps.matchedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</b></div><div><small>Proof submitted</small><b>{new Date(claim.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</b></div><div><small>Expires</small><b>{claim.order.expiresAt ? new Date(claim.order.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</b></div><div><small>Cancellation requested</small><b>{claim.order.timestamps?.cancellationRequestedAt ? new Date(claim.order.timestamps.cancellationRequestedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</b></div><div><small>Seller-provided account name</small><b>{claim.order.withdrawalOffer.payeeName || '—'}</b></div><div><small>Seller-provided UPI ID</small><b>{claim.order.withdrawalOffer.payeeVpa || '—'}</b></div></div>
    <div className="claim-facts"><div><small>Matched</small><b>{claim.order.timestamps?.matchedAt ? new Date(claim.order.timestamps.matchedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</b></div><div><small>Details viewed</small><b>{claim.order.timestamps?.paymentDetailsViewedAt ? new Date(claim.order.timestamps.paymentDetailsViewedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</b></div><div><small>Pay Now / handoff</small><b>{claim.order.timestamps?.paymentHandoffInitiatedAt ? new Date(claim.order.timestamps.paymentHandoffInitiatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not recorded'}</b></div><div><small>Expires</small><b>{claim.order.timestamps?.expiresAt ? new Date(claim.order.timestamps.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</b></div><div><small>Proof submitted</small><b>{new Date(claim.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</b></div><div><small>Cancellation requested</small><b>{claim.order.timestamps?.cancellationRequestedAt ? new Date(claim.order.timestamps.cancellationRequestedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'No'}</b></div></div>
    {claim.evidenceAttached && <div className="evidence-panel"><b>Screenshot · supporting claim only</b>{evidenceUrl ? <img src={evidenceUrl} alt="Buyer-submitted payment screenshot for Finance review" /> : <p>Loading private evidence…</p>}</div>}
    <div className="review-form">
      <label>Decision<select value={decision} onChange={(e) => setDecision(e.target.value)}><option value="APPROVE">Approve after independent confirmation</option><option value="REJECT">Reject claim</option></select></label>
      {decision === 'APPROVE' && <><label>Verified transaction reference<input value={verifiedReference} onChange={(e) => setVerifiedReference(e.target.value)} /></label><label>Verified received amount (₹)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label>Actual receiver UPI ID from trusted records<input value={verifiedPayeeVpa} onChange={(e) => setVerifiedPayeeVpa(e.target.value)} /></label><label className="check-row"><input type="checkbox" checked={receiverConfirmed} onChange={(e) => setReceiverConfirmed(e.target.checked)} />I independently confirmed the exact amount reached this recipient.</label></>}
      {decision === 'REJECT' && <label className="check-row"><input type="checkbox" checked={paymentNotReceivedConfirmed} onChange={(e) => setPaymentNotReceivedConfirmed(e.target.checked)} />I checked recipient-side records and confirm no payment was received and no late payment is pending. This releases the reservation.</label>}
      <label>Internal evidence reference<input value={evidenceReference} onChange={(e) => setEvidenceReference(e.target.value)} placeholder="Internal statement/report reference" /></label>
      <label>Review reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={8} maxLength={500} placeholder="Describe the records checked and decision." /></label>
    </div>
    {error && <div className="live-alert error">{error}</div>}
    <button disabled={busy} onClick={submit}>{busy ? 'Saving…' : decision === 'APPROVE' ? 'Verify receipt and settle offer' : 'Reject claim'}</button>
    <small className="claim-footnote">Approval credits buyer and settles reserved seller funds once. Never approve from a screenshot, user message, or sender-side success screen.</small>
  </article>;
}

createRoot(document.getElementById('root')).render(<App />);

