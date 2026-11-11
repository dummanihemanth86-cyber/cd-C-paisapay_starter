import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './live-reconciliation.css';
import { ADMIN_LOGIN_PATH, resolveAdminApiBaseUrl } from './apiContract.js';
import { createAdminApiClient } from './sessionApiClient.js';
import { buildAdminListQuery, normalizePagination } from './pagination.js';
import { adminRecordDetailPath } from '../../shared/adminRecordNavigation.cjs';
import { buildReportCsv, formatPaise, reportStatusOptions } from './reportCsv.js';
import adminFinancialUx from '../../shared/adminFinancialUx.cjs';
const { financialActionState } = adminFinancialUx;
import walletAdjustmentUi from '../../shared/walletAdjustmentUi.cjs';
const { parseRupeesToPaise, walletAdjustmentUiState, newIdempotencyKey } = walletAdjustmentUi;

// In local development, use the Vite same-origin proxy. This works when the
// admin page is opened from another device on the LAN as well as on this PC.
const API = resolveAdminApiBaseUrl(import.meta.env.VITE_API_URL, import.meta.env.PROD);

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
  const [resetMode, setResetMode] = useState(false);
  const [resetChallengeId, setResetChallengeId] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [claims, setClaims] = useState([]);
  const [claimsPagination, setClaimsPagination] = useState({ page: 1, pageSize: 25, total: 0 });
  const [p2pOrders, setP2pOrders] = useState([]);
  const [p2pOffers, setP2pOffers] = useState([]);
  const [p2pPagination, setP2pPagination] = useState({ orders: { page: 1, pageSize: 25, total: 0 }, offers: { page: 1, pageSize: 25, total: 0 }, claims: { page: 1, pageSize: 25, total: 0 } });
  const [p2pClaims, setP2pClaims] = useState([]);
  const [adminSection, setAdminSection] = useState('overview');
  const [p2pSearch, setP2pSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const sessionRef = useRef({ accessToken: '', refreshToken: '' });
  const clientRef = useRef(null);
  const clearBrowserSession = useCallback((reason) => {
    sessionRef.current = { accessToken: '', refreshToken: '' };
    setToken(''); setRefreshToken(''); setAdminAccess(null); setClaims([]); setP2pOrders([]); setP2pOffers([]); setP2pClaims([]); setPassword('');
    if (reason?.code !== 'SESSION_CLEARED') setError('Admin session expired. Sign in again.');
  }, []);
  if (!clientRef.current) {
    clientRef.current = createAdminApiClient({
      apiBase: API,
      fetchImpl: window.fetch.bind(window),
      getSession: () => sessionRef.current,
      onSessionChange: (session) => { sessionRef.current = session; setToken(session.accessToken); setRefreshToken(session.refreshToken); },
      onSessionExpired: clearBrowserSession,
      timeoutMs: 20_000,
    });
  }
  const api = useCallback((path, options) => clientRef.current.request(path, options), []);
  const apiRaw = useCallback((url, options) => clientRef.current.requestRaw(url, options), []);

  const loadClaims = async (authToken = token, page = 1) => {
    if (!financialActionState('paymentVerification', adminAccess?.role, adminAccess?.financialOperationsEnabled, adminAccess?.manualUpiOperationsEnabled).enabled) {
      setClaims([]); setClaimsPagination({ page: 1, pageSize: 25, total: 0 }); return;
    }
    const result = await api(`/api/v1/admin/reconciliation/claims?status=PENDING_REVIEW&page=${page}&pageSize=25`, { token: authToken });
    setClaims(result.claims || []);
    setClaimsPagination({ page: result.page || page, pageSize: result.pageSize || 25, total: result.total || 0 });
  };

  const loadP2p = async (authToken = token, query = p2pSearch, options = {}) => {
    const orderParams = new URLSearchParams({ page: String(options.orderPage || 1), pageSize: '25' });
    const offerParams = new URLSearchParams({ page: String(options.offerPage || 1), pageSize: '25' });
    if (query.trim()) { orderParams.set('q', query.trim()); offerParams.set('q', query.trim()); }
    if (options.status && options.status !== 'ALL') orderParams.set('status', options.status);
    setP2pSearch(query);
    const [ordersResult, offersResult] = await Promise.all([
      api(`/api/v1/admin/p2p/orders?${orderParams}`, { token: authToken }),
      api(`/api/v1/admin/p2p/offers?${offerParams}`, { token: authToken }),
    ]);
    setP2pOrders(ordersResult.orders || []); setP2pOffers(offersResult.offers || []);
    setP2pPagination({ orders: { page: ordersResult.page || 1, pageSize: ordersResult.pageSize || 25, total: ordersResult.total || 0 }, offers: { page: offersResult.page || 1, pageSize: offersResult.pageSize || 25, total: offersResult.total || 0 } });
    let claimsResult = { claims: [], page: 1, pageSize: 25, total: 0 };
    if (financialActionState('paymentVerification', adminAccess?.role, adminAccess?.financialOperationsEnabled, adminAccess?.manualUpiOperationsEnabled).enabled) {
      try { claimsResult = await api(`/api/v1/admin/p2p/claims?page=${options.claimPage || 1}&pageSize=25`, { token: authToken }); setP2pClaims(claimsResult.claims || []); }
      catch { setP2pClaims([]); }
    } else setP2pClaims([]);
    setP2pPagination((current) => ({ ...current, claims: { page: claimsResult.page || 1, pageSize: claimsResult.pageSize || 25, total: claimsResult.total || 0 } }));
  };

  const login = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setInfo('');
    try {
      const result = await api(ADMIN_LOGIN_PATH, { method: 'POST', body: { phoneE164: `+91${phone.replace(/\D/g, '').slice(-10)}`, password } });
      const access = await api('/api/v1/admin/me', { token: result.accessToken });
      sessionRef.current = { accessToken: result.accessToken, refreshToken: result.refreshToken || '' };
      setPassword(''); setAdminAccess(access); setToken(result.accessToken); setRefreshToken(result.refreshToken || '');
      setInfo('Signed in. Sections and actions are limited by your server-side administrator role.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const requestAdminResetOtp = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setInfo('');
    try {
      const digits = phone.replace(/\D/g, '').slice(-10);
      if (digits.length !== 10) throw new Error('Enter a valid 10-digit Admin mobile number.');
      const phoneE164 = `+91${digits}`;
      const result = await api('/api/v1/admin/auth/forgot-password/request-otp', {
        method: 'POST', body: { phoneE164 },
      });
      setResetChallengeId(result.challengeId);
      setInfo(result.message || 'If an active Admin account exists, a reset code will be sent by SMS.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const resetAdminPassword = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setInfo('');
    try {
      const digits = phone.replace(/\D/g, '').slice(-10);
      if (digits.length !== 10) throw new Error('Enter a valid 10-digit Admin mobile number.');
      const phoneE164 = `+91${digits}`;
      const result = await api('/api/v1/admin/auth/password/reset', {
        method: 'POST',
        body: { phoneE164, challengeId: resetChallengeId, code: resetCode, newPassword: resetPassword },
      });
      setInfo(result.message || 'Password reset. Sign in using your new password.');
      setResetMode(false); setResetChallengeId(''); setResetCode(''); setResetPassword(''); setPassword('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    try {
      await clientRef.current.logout(async (current) => {
        if (current.refreshToken) await api('/api/v1/auth/logout', { token: current.accessToken, method: 'POST', body: { refreshToken: current.refreshToken } });
      });
    } catch { /* Local logout runs in the API client's finally path even if revocation is unavailable. */ }
    setInfo('Signed out.');
  };

  const reviewed = async () => {
    try { setBusy(true); await loadClaims(); setInfo('Pending reconciliation list refreshed.'); }
    catch (e) { setError(e.message); if (e.message.includes('session') || e.message.includes('Sign in')) logout(); }
    finally { setBusy(false); }
  };

  return <main className="live-admin" data-theme={theme}>
    <header className="live-header">
      <div><div className="live-brand"><img src="/paisapay-admin-emblem.png" alt="PaisaPay Admin security emblem" /><span>PaisaPay Admin</span></div><h1>Admin Control Center</h1><p>Server-reported PaisaPay data · Role controlled · INR</p></div>
      <div className="admin-header-actions"><button type="button" className="secondary" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Switch color theme">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>{token && <button className="secondary" onClick={logout}>Sign out</button>}</div>
    </header>
    <div className="live-notice"><b>UPI payment verification is not automatic.</b> A user-submitted reference is only a claim. Check the merchant bank records, exact amount, INR currency, and receiver before approving.</div>
    {error && <div className="live-alert error">{error}</div>}{info && <div className="live-alert success">{info}</div>}
    {!token ? <form className="login-panel" onSubmit={resetMode ? (resetChallengeId ? resetAdminPassword : requestAdminResetOtp) : login}>
      <h2>{resetMode ? 'Reset Admin password' : 'Admin sign in'}</h2>
      <p>{resetMode ? 'We will send a one-time reset code by SMS to the registered Admin mobile number.' : 'Use an existing PaisaPay account that has an authorized Finance, Admin, or Super Admin role. Ordinary accounts will be denied by the backend.'}</p>
      <label>Mobile number<input autoComplete="username" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" required /></label>
      {!resetMode && <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>}
      {resetMode && resetChallengeId && <>
        <label>6-digit SMS code<input autoComplete="one-time-code" inputMode="numeric" value={resetCode} onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))} minLength={6} maxLength={6} required /></label>
        <label>New password<input autoComplete="new-password" type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} minLength={12} maxLength={128} required /></label>
      </>}
      <button disabled={busy}>{busy ? 'Please wait…' : resetMode ? (resetChallengeId ? 'Reset password' : 'Send reset OTP') : 'Sign in'}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setResetMode(!resetMode); setResetChallengeId(''); setResetCode(''); setResetPassword(''); setError(''); setInfo(''); }}>{resetMode ? 'Back to sign in' : 'Forgot password?'}</button>
      {!resetMode && <small>Session token is kept in memory for this page only. Use HTTPS outside local development.</small>}
    </form> : <AdminWorkspace api={api} apiRaw={apiRaw} token={token} access={adminAccess} claims={claims} claimsPagination={claimsPagination} p2pOrders={p2pOrders} p2pOffers={p2pOffers} p2pClaims={p2pClaims} p2pPagination={p2pPagination} loadClaims={loadClaims} loadP2p={loadP2p} setInfo={setInfo} setError={setError} />}
    <footer>API: {API} · Transaction references are sensitive business data; do not export or share this page.</footer>
  </main>;
}


const adminNavigation = [
  ['overview', 'Dashboard'], ['users', 'Users'], ['deposits', 'Deposits'], ['withdrawals', 'Withdrawals'], ['p2p', 'P2P Marketplace'],
  ['transactions', 'Transactions'], ['ledger', 'Wallet Ledger'], ['walletAdjustments', 'Wallet Adjustment'], ['providers', 'Payment Providers'], ['commissions', 'Commission'],
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

function AdminWorkspace({ api, apiRaw, token, access, claims, claimsPagination, p2pOrders, p2pOffers, p2pClaims, p2pPagination, loadClaims, loadP2p, setInfo, setError }) {
  const [section, setSection] = useState('overview');
  const [refresh, setRefresh] = useState(0);
  const [p2pStatusFilter, setP2pStatusFilter] = useState('ALL');
  const [p2pOrderPage, setP2pOrderPage] = useState(1);
  const [p2pOfferPage, setP2pOfferPage] = useState(1);
  const [p2pClaimPage, setP2pClaimPage] = useState(1);
  const [reconciliationPage, setReconciliationPage] = useState(1);
  const loadP2pRef = useRef(loadP2p);
  loadP2pRef.current = loadP2p;
  const visibleNavigation = adminNavigation.filter(([id]) => access?.allowedSections?.includes(id));
  const paymentReview = financialActionState('paymentVerification', access?.role, access?.financialOperationsEnabled, access?.manualUpiOperationsEnabled);
  const quickDeposit = financialActionState('quickDeposit', access?.role, access?.financialOperationsEnabled);
  const select = (id) => { setSection(id); setRefresh((x) => x + 1); };
  useEffect(() => { if (section === 'reconciliation') loadClaims(token, reconciliationPage).catch((e) => setError(e.message)); if (section === 'p2p') loadP2p(token, undefined, { orderPage: p2pOrderPage, offerPage: p2pOfferPage, claimPage: p2pClaimPage, status: p2pStatusFilter }).catch((e) => setError(e.message)); }, [section, token, refresh, p2pOrderPage, p2pOfferPage, p2pClaimPage, p2pStatusFilter, reconciliationPage]);
  useEffect(() => {
    if (section !== 'p2p') return undefined;
    const timer = window.setInterval(() => loadP2pRef.current(token, undefined, { orderPage: p2pOrderPage, offerPage: p2pOfferPage, claimPage: p2pClaimPage, status: p2pStatusFilter }).catch((e) => setError(e.message)), 4000);
    return () => window.clearInterval(timer);
  }, [section, token, p2pOrderPage, p2pOfferPage, p2pClaimPage, p2pStatusFilter]);
  const refreshAll = async () => { setRefresh((x) => x + 1); if (section === 'reconciliation') await loadClaims(token, reconciliationPage); if (section === 'p2p') await loadP2p(token, undefined, { orderPage: p2pOrderPage, offerPage: p2pOfferPage, claimPage: p2pClaimPage, status: p2pStatusFilter }); };
  return <div className="control-shell">
    <aside className="control-nav"><div className="nav-label">MANAGEMENT · {access?.role || 'ADMIN'}</div>{visibleNavigation.map(([id, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => select(id)}>{label}</button>)}</aside>
    <section className="control-main">
      <div className="control-toolbar"><div><h2>{adminNavigation.find(([id]) => id === section)?.[1] || 'Admin'}</h2><p>Live records from PostgreSQL · INR · Signed in as {access?.role || 'administrator'}; permissions enforced by the server</p></div><button className="secondary" onClick={async () => { try { await refreshAll(); } catch (e) { setError(e.message); } }}>Refresh</button></div>
      {section === 'deposits' && paymentReview.visible && !paymentReview.enabled && <FinancialActionBanner title="Payment verification unavailable" reason={paymentReview.reason} />}
      {section === 'deposits' && !paymentReview.visible && <FinancialActionBanner title="Payment review is Finance-only" reason="Your role can inspect deposit records, but only Finance, Admin, and Super Admin can review payment claims." />}
      {section === 'p2p' && quickDeposit.visible && <FinancialActionBanner title="Quick Deposit matching is unavailable in Admin" reason={quickDeposit.reason} />}
      {section === 'p2p' && paymentReview.visible && !paymentReview.enabled && <FinancialActionBanner title="Payment verification unavailable" reason={paymentReview.reason} />}
      {section === 'p2p' && !paymentReview.visible && <FinancialActionBanner title="Payment claims are restricted to Finance" reason="This role can monitor P2P offers and orders, but only Finance, Admin, and Super Admin roles can view payment claims or review them." />}
      {section === 'overview' && <AdminOverview api={api} token={token} refresh={refresh} />}
      {section === 'reconciliation' && <div className="control-panel">{paymentReview.visible && !paymentReview.enabled && <FinancialActionBanner title="Payment verification unavailable" reason={paymentReview.reason} />}{paymentReview.enabled && <><div className="live-notice"><b>Payment review requires independent evidence.</b> User-submitted UPI references are claims, not proof.</div>{claims.length ? claims.map((claim) => <ClaimCard key={claim.id} api={api} apiRaw={apiRaw} claim={claim} token={token} onDone={async () => { await loadClaims(token, reconciliationPage); setInfo('Pending reconciliation list refreshed.'); }} />) : <div className="empty-live">No manual deposit claims are awaiting review.</div>}<div className="data-pagination"><button className="secondary" disabled={reconciliationPage <= 1} onClick={() => setReconciliationPage((page) => Math.max(1, page - 1))}>Previous claims</button><span>Page {claimsPagination.page} · {claimsPagination.total} claims</span><button className="secondary" disabled={reconciliationPage * claimsPagination.pageSize >= claimsPagination.total} onClick={() => setReconciliationPage((page) => page + 1)}>Next claims</button></div></>}</div>}
      {section === 'p2p' && <div className="control-panel"><div className="live-notice"><b>P2P payment verification is manual.</b> Claims are unverified until Finance confirms recipient-side receipt against independent records. Post-handoff cancellations and expired orders remain held; reject only after confirming non-receipt.</div><div className="p2p-search"><input placeholder="Search by reference" onChange={(e) => { window.clearTimeout(window.__p2pSearchTimer); const value = e.target.value; setP2pOrderPage(1); setP2pOfferPage(1); window.__p2pSearchTimer = window.setTimeout(() => loadP2p(token, value, { orderPage: 1, offerPage: 1, claimPage: p2pClaimPage, status: p2pStatusFilter }), 300); }} /><button className="secondary" onClick={() => loadP2p(token, undefined, { orderPage: p2pOrderPage, offerPage: p2pOfferPage, claimPage: p2pClaimPage, status: p2pStatusFilter })}>Refresh P2P</button><select aria-label="Filter P2P orders by status" value={p2pStatusFilter} onChange={(e) => { setP2pStatusFilter(e.target.value); setP2pOrderPage(1); void loadP2p(token, undefined, { orderPage: 1, offerPage: p2pOfferPage, claimPage: p2pClaimPage, status: e.target.value }); }}><option value="ALL">All order states</option>{['MATCHED','PAYMENT_PENDING','PAYMENT_PROCESSING','PAYMENT_EXPIRED_REVIEW','CANCELLED_PAYMENT_HOLD','DISPUTED','COMPLETED','REJECTED','CANCELLED','EXPIRED','FAILED'].map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select></div><h3>Claims awaiting review ({p2pPagination.claims.total})</h3>{p2pClaims.length ? p2pClaims.map((claim) => <P2pClaimCard key={claim.id} api={api} apiRaw={apiRaw} claim={claim} token={token} onDone={async (message) => { await loadP2p(token, undefined, { orderPage: p2pOrderPage, offerPage: p2pOfferPage, claimPage: p2pClaimPage, status: p2pStatusFilter }); setInfo(message || 'P2P review saved.'); }} />) : <div className="empty-live">{paymentReview.enabled ? 'No Finance claims awaiting review.' : paymentReview.visible ? 'Claim queue unavailable while financial operations are disabled.' : 'Payment claims are Finance-only; this role sees P2P records only.'}</div>}<div className="data-pagination"><button className="secondary" disabled={p2pClaimPage <= 1} onClick={() => setP2pClaimPage((page) => Math.max(1, page - 1))}>Previous claims</button><span>Page {p2pPagination.claims.page} · {p2pPagination.claims.total} claims</span><button className="secondary" disabled={p2pClaimPage * p2pPagination.claims.pageSize >= p2pPagination.claims.total} onClick={() => setP2pClaimPage((page) => page + 1)}>Next claims</button></div><h3>Buyer orders · {p2pPagination.orders.total}</h3><SimpleTable rows={p2pOrders.map((o) => ({ id: o.id, referenceId: o.referenceId, amountPaise: o.amountPaise, status: o.status, buyer: o.buyer?.publicId, buyerPhone: o.buyer?.phoneMasked, seller: o.seller?.publicId, sellerPhone: o.seller?.phoneMasked, withdrawalReference: o.withdrawalOffer?.referenceId, expiresAt: o.expiresAt, paymentDetailsShownAt: o.paymentDetailsShownAt, paymentHandoffStartedAt: o.paymentHandoffStartedAt, claims: o.claims, timeline: o.timeline, createdAt: o.createdAt, updatedAt: o.updatedAt }))} /><div className="data-pagination"><button className="secondary" disabled={p2pOrderPage <= 1} onClick={() => setP2pOrderPage((page) => Math.max(1, page - 1))}>Previous orders</button><span>Page {p2pPagination.orders.page} · {p2pPagination.orders.total} orders</span><button className="secondary" disabled={p2pOrderPage * p2pPagination.orders.pageSize >= p2pPagination.orders.total} onClick={() => setP2pOrderPage((page) => page + 1)}>Next orders</button></div><h3>Withdrawal offers · {p2pPagination.offers.total}</h3><SimpleTable rows={p2pOffers.map((o) => ({ id: o.id, referenceId: o.referenceId, amountPaise: o.amountPaise, status: o.status, user: o.user?.publicId, userPhone: o.user?.phoneMasked, completedAmountPaise: o.completedAmountPaise, activeReservedPaise: o.activeReservedPaise, disputedHeldPaise: o.disputedHeldPaise, availableAmountPaise: o.availableAmountPaise, orderCount: o.orderCount, expiresAt: o.expiresAt, orders: o.orders }))} /><div className="data-pagination"><button className="secondary" disabled={p2pOfferPage <= 1} onClick={() => setP2pOfferPage((page) => Math.max(1, page - 1))}>Previous offers</button><span>Page {p2pPagination.offers.page} · {p2pPagination.offers.total} offers</span><button className="secondary" disabled={p2pOfferPage * p2pPagination.offers.pageSize >= p2pPagination.offers.total} onClick={() => setP2pOfferPage((page) => page + 1)}>Next offers</button></div></div>}
      {section === 'referrals' && <ReferralAdminSection api={api} token={token} refresh={refresh} setInfo={setInfo} setError={setError} />}
      {section === 'reports' && <ReportAdminSection api={api} token={token} refresh={refresh} />}
      {section === 'settings' && <AdminSettingsSection api={api} token={token} refresh={refresh} />}
      {section === 'walletAdjustments' && <WalletAdjustmentAdminSection api={api} token={token} access={access} setInfo={setInfo} setError={setError} />}
      {section !== 'referrals' && adminViews[section] && <AdminDataSection key={section} api={api} view={adminViews[section]} token={token} role={access?.role} financialOperationsEnabled={access?.financialOperationsEnabled} refresh={refresh} setInfo={setInfo} setError={setError} />}
      {section === 'notifications' && <div className="control-panel"><h3>Notifications unavailable</h3><p className="claim-muted">This section has no supported notification workflow in the current project. No send action is exposed here.</p></div>}
    </section>
  </div>;
}

const reportKinds = [
  ['registrations', 'User registrations'], ['deposits', 'Deposit requests'], ['withdrawals', 'Withdrawals'],
  ['p2p-orders', 'P2P orders'], ['support-tickets', 'Support tickets'],
];
const utcDate = (date) => date.toISOString().slice(0, 10);
function WalletAdjustmentAdminSection({ api, token, access, setInfo, setError }) {
  const [targetPublicId, setTargetPublicId] = useState('');
  const [rupees, setRupees] = useState('');
  const [direction, setDirection] = useState('CREDIT');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmationOpen = useRef(false);
  const submissionKey = useRef('');
  const submissionFingerprint = useRef('');
  const gate = walletAdjustmentUiState(access?.role, access?.walletAdjustmentAllowed, access?.walletAdjustmentsEnabled);
  const amountPaise = parseRupeesToPaise(rupees);

  const submit = async (event) => {
    event.preventDefault();
    if (!gate.enabled || busy || confirmationOpen.current) return;
    if (!/^[A-Za-z0-9_-]{1,10}$/.test(targetPublicId.trim()) || amountPaise === null || reason.trim().length < 8) {
      setError('Enter a valid public user ID, amount up to ₹10,000, and a reason of at least 8 characters.');
      return;
    }
    confirmationOpen.current = true;
    if (!window.confirm(`Confirm ${direction.toLowerCase()} of ${money(amountPaise)} for user ${targetPublicId.trim()}? This creates an audited, immutable ledger transaction.`)) { confirmationOpen.current = false; return; }
    const fingerprint = JSON.stringify([targetPublicId.trim(), direction, amountPaise, reason.trim()]);
    if (submissionFingerprint.current !== fingerprint) { submissionFingerprint.current = fingerprint; submissionKey.current = newIdempotencyKey(); }
    setBusy(true);
    try {
      const result = await api('/api/v1/admin/wallet-adjustments', {
        token, method: 'POST', headers: { 'Idempotency-Key': submissionKey.current },
        body: { targetPublicId: targetPublicId.trim(), direction, amountPaise, reason: reason.trim() },
      });
      setInfo(`${result.message} Ledger transaction ${result.adjustment?.id || 'recorded'}.`);
      submissionKey.current = ''; submissionFingerprint.current = '';
      setTargetPublicId(''); setRupees(''); setReason('');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); confirmationOpen.current = false; }
  };

  return <div className="control-panel">
    <h3>Private wallet adjustment</h3>
    <FinancialActionBanner title={gate.enabled ? 'Wallet adjustment is enabled' : 'Wallet adjustment unavailable'} reason={gate.reason || 'Every adjustment is balanced against the pre-funded adjustment account, recorded in the immutable ledger, and audited.'} />
    <form className="admin-form" onSubmit={submit}>
      <label>Target public user ID<input value={targetPublicId} onChange={(event) => setTargetPublicId(event.target.value)} maxLength={10} disabled={!gate.enabled || busy} autoCapitalize="none" /></label>
      <label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value)} disabled={!gate.enabled || busy}><option value="CREDIT">Credit</option><option value="DEBIT">Debit</option></select></label>
      <label>Amount in INR<input inputMode="decimal" value={rupees} onChange={(event) => setRupees(event.target.value)} placeholder="0.00 · max ₹10,000" disabled={!gate.enabled || busy} /></label>
      <label>Mandatory transaction reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} disabled={!gate.enabled || busy} /></label>
      <button type="submit" disabled={!gate.enabled || busy || amountPaise === null}>{busy ? 'Recording…' : `Record ${direction.toLowerCase()}`}</button>
    </form>
    <p className="claim-muted">No user OTP is requested. Only the single backend-configured ADMIN account can submit. Credits require sufficient funds in the dedicated adjustment ledger account; debits cannot use reserved funds.</p>
  </div>;
}

function ReportAdminSection({ api, token, refresh }) {
  const today = utcDate(new Date());
  const monthAgo = utcDate(new Date(Date.now() - 29 * 86_400_000));
  const [kind, setKind] = useState('registrations'); const [from, setFrom] = useState(monthAgo); const [to, setTo] = useState(today);
  const [status, setStatus] = useState(''); const [data, setData] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = async (selection = { kind, from, to, status }) => {
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ report: selection.kind, from: selection.from, to: selection.to });
      if (selection.status) params.set('status', selection.status);
      setData(await api(`/api/v1/admin/reports?${params}`, { token }));
    } catch (e) { setError(e.message || 'Could not load this report.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [token, refresh]);
  const exportCsv = () => {
    if (!data) return;
    const blob = new Blob([buildReportCsv(data)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `paisapay-${kind}-${from}-to-${to}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };
  const statuses = reportStatusOptions(kind);
  const moneySummary = data?.totalAmountPaise == null ? null : formatPaise(data.totalAmountPaise);
  return <div className="control-panel">
    <div className="data-toolbar"><div><h3>Operational reports</h3><p>Aggregate counts from existing records. No names, phone numbers, transaction references, or evidence are included.</p></div><button className="secondary" disabled={!data || busy} onClick={exportCsv}>Download CSV</button></div>
    <div className="data-filters">
      <label>Report<select value={kind} onChange={(e) => { setKind(e.target.value); setStatus(''); }} aria-label="Report type">{reportKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>To<input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label>
      <label>Status<select aria-label="Filter report by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
      <button className="secondary" disabled={busy || !from || !to} onClick={() => load({ kind, from, to, status })}>{busy ? 'Loading…' : 'Generate report'}</button>
    </div>
    {error && <div className="live-alert error" role="alert">{error}<button className="secondary" onClick={() => load()}>Retry</button></div>}
    {busy && <p role="status">Loading report…</p>}
    {!busy && !error && !data && <div className="empty-live">Choose a report and date range to begin.</div>}
    {!busy && data && <>
      <div className="admin-metrics"><article className="admin-metric"><span>Records</span><strong>{data.total.toLocaleString()}</strong></article>{moneySummary != null && <article className="admin-metric"><span>Aggregate amount</span><strong>{moneySummary}</strong></article>}<article className="admin-metric"><span>Date range (UTC)</span><strong>{data.from} – {data.to}</strong></article></div>
      <h4>Daily totals</h4>{data.daily.length ? <SimpleTable rows={data.daily.map((row) => ({ date: row.date, count: row.count, ...(row.amountPaise == null ? {} : { recordAmount: formatPaise(row.amountPaise) }) }))} /> : <div className="empty-live">No daily records in this date range.</div>}
      <h4>Status totals</h4>{data.statusBreakdown.length ? <SimpleTable rows={data.statusBreakdown.map((row) => ({ status: row.status, count: row.count, ...(row.amountPaise == null ? {} : { recordAmount: formatPaise(row.amountPaise) }) }))} /> : <div className="empty-live">No statuses to display.</div>}
      <p className="claim-muted">For financial reports, record amount is the sum of the selected requests/orders across the included statuses. It is not verified payment volume, payout, wallet balance, or revenue. Financial report queries remain unavailable while the server’s financial-operations gate is disabled.</p>
    </>}
  </div>;
}

function AdminSettingsSection({ api, token, refresh }) {
  const [settings, setSettings] = useState(null); const [health, setHealth] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = async () => {
    setBusy(true); setError('');
    try { const [safeSettings, systemHealth] = await Promise.all([api('/api/v1/admin/settings', { token }), api('/api/v1/admin/system-health', { token })]); setSettings(safeSettings); setHealth(systemHealth); }
    catch (e) { setError(e.message || 'Could not load safe system settings.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [token, refresh]);
  if (error) return <div className="control-panel live-alert error" role="alert">{error} <button className="secondary" onClick={() => load()}>Retry</button></div>;
  if (busy || !settings || !health) return <div className="control-panel" role="status">{busy ? 'Loading read-only settings…' : 'Settings have not been loaded.'}</div>;
  const rows = [
    { setting: 'Environment', value: settings.environment }, { setting: 'Financial operations', value: settings.financialOperationsEnabled ? 'Enabled' : 'Disabled' },
    { setting: 'Payment provider', value: settings.paymentProvider }, { setting: 'OTP provider', value: settings.otpProvider },
    { setting: 'Database configured', value: settings.databaseConfigured ? 'Yes' : 'No' }, { setting: 'API', value: health.api },
    { setting: 'Database connectivity', value: health.database }, { setting: 'Database response time', value: health.databaseResponseTimeMs == null ? 'Unavailable' : `${health.databaseResponseTimeMs} ms` },
    { setting: 'Payout provider', value: health.payoutProvider }, { setting: 'Background workers', value: health.backgroundWorkers },
    ...health.payments.map((payment) => ({ setting: `Payment method · ${payment.name}`, value: `${payment.status} · ${payment.available ? 'available' : 'unavailable'}` })),
  ];
  return <div className="control-panel"><div className="data-toolbar"><div><h3>System settings</h3><p>Safe configuration and health indicators. Secrets and financial-operation controls are not exposed.</p></div><button className="secondary" onClick={() => load()}>Refresh</button></div><SimpleTable rows={rows} /><p className="live-notice">{settings.message} There are no supported editable general settings in this API. Payments and financial operations remain governed by server environment and safety gates.</p></div>;
}

function ReferralAdminSection({ api, token, refresh, setInfo, setError }) {
  const [data, setData] = useState(null); const [rows, setRows] = useState([]); const [direct, setDirect] = useState('0.4'); const [indirect, setIndirect] = useState('0.1'); const [reason, setReason] = useState('Referral program rules reviewed and approved.'); const [busy, setBusy] = useState(false); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25); const [total, setTotal] = useState(0); const [query, setQuery] = useState(''); const [localError, setLocalError] = useState('');
  const load = async (requestedPage = page, requestedQuery = query) => {
    setBusy(true); setLocalError('');
    try {
    const params = new URLSearchParams({ page: String(requestedPage), pageSize: String(pageSize) }); if (requestedQuery.trim()) params.set('q', requestedQuery.trim());
    const [config, referrals] = await Promise.all([api('/api/v1/admin/referrals/config', { token }), api(`/api/v1/admin/referrals?${params}`, { token })]);
    setData(config); setRows(Array.isArray(referrals.referrals) ? referrals.referrals : []); setTotal(Number(referrals.total) || 0); setDirect(String(config.config.directRateBps / 100)); setIndirect(String(config.config.indirectRateBps / 100));
    } catch (e) { setLocalError(e.message); setError(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(page); }, [token, refresh, page, pageSize]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
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
  if (!data && busy) return <div className="control-panel" role="status">Loading referral configuration…</div>;
  if (!data) return <div className="control-panel">{localError || 'Referral configuration is unavailable.'} <button className="secondary" onClick={() => load()}>Retry</button></div>;
  return <>
    <div className="live-notice"><b>Reward payout is not configured.</b> Verified activity can create pending accruals and milestone eligibility records. No referral commission or milestone is credited to wallets until an approved funded payout process exists.</div>
    <form className="control-panel" onSubmit={saveRates}><h3>Commission rates</h3><div className="data-toolbar"><label>Direct rate (%)<input inputMode="decimal" value={direct} onChange={(e) => setDirect(e.target.value)} /></label><label>Indirect rate (%)<input inputMode="decimal" value={indirect} onChange={(e) => setIndirect(e.target.value)} /></label><label>Audit reason<input value={reason} onChange={(e) => setReason(e.target.value)} minLength={8} /></label><button disabled={busy}>Save rates</button></div></form>
    <div className="control-panel"><h3>Milestone rules</h3>{data.milestones.map((item) => <ReferralMilestoneEditor key={item.key} item={item} onSave={saveMilestone} disabled={busy} />)}</div>
    <div className="control-panel"><div className="data-toolbar"><div><h3>Referral relationships</h3><p>{total} relationships · page {page} of {pageCount}</p></div><div className="data-filters"><input aria-label="Search referrals" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search user ID or name" onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load(1, query) : setPage(1))}/><select aria-label="Referral rows per page" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={25}>25 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option></select><button className="secondary" disabled={busy} onClick={() => page === 1 ? load(1, query) : setPage(1)}>Search</button></div></div>{localError && <div className="live-alert error" role="alert">{localError} <button className="secondary" onClick={() => load()}>Retry</button></div>}{busy ? <p role="status">Loading referrals…</p> : rows.length ? <SimpleTable rows={rows.map((r) => ({ id: r.id, referrer: r.referrer?.publicId, referrerName: r.referrer?.displayName, invitee: r.invitee?.publicId, inviteeName: r.invitee?.displayName, status: r.status, joined: r.createdAt }))} /> : <div className="empty-live">No referral relationships match the current search.</div>}<div className="data-pagination"><button className="secondary" disabled={page <= 1 || busy} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button><span>Page {page} of {pageCount} · {total} records · {pageSize} per page</span><button className="secondary" disabled={page >= pageCount || busy} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button></div></div>
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

function AdminOverview({ api, token, refresh }) {
  const [data, setData] = useState(null); const [error, setError] = useState('');
  const [period, setPeriod] = useState('daily');
  useEffect(() => { let active = true; api('/api/v1/admin/overview', { token }).then((v) => { if (active) { setData(v); setError(''); } }).catch((e) => active && setError(e.message)); return () => { active = false; }; }, [token, refresh]);
  if (error) return <div className="control-panel live-alert error">{error}</div>;
  if (!data) return <div className="control-panel">Loading dashboard…</div>;
  const m = data.metrics || {}; const cards = [['Registered users', m.users], ['Active users', m.activeUsers], ['Suspended users', m.blockedUsers], ['New today', m.newUsersToday], ['Available ledger', money(m.totalWalletBalancePaise)], ['Reserved ledger', money(m.totalReservedBalancePaise)], ['Pending deposits', m.pendingDeposits], ['Pending withdrawals', m.pendingWithdrawals], ['Verified deposit value', money(m.totalDepositValuePaise)], ['Completed withdrawal value', money(m.totalWithdrawalValuePaise)], ['Completed transactions', m.completedTransactions], ['Failed deposits', m.failedTransactions], ['Disputed orders', m.disputedTransactions], ['Today volume', money(m.todayTransactionVolumePaise)], ['Commission entries', m.commissionEarnedPaise == null ? 'Unavailable' : money(m.commissionEarnedPaise)], ['Platform revenue', m.totalPlatformRevenuePaise == null ? 'Unavailable' : 'Not tracked']];
  const chart = data.charts?.[period] || []; const max = Math.max(1, ...chart.map((x) => x.depositsPaise + x.withdrawalsPaise)); const maxUsers = Math.max(1, ...chart.map((x) => x.registrations));
  return <><div className="admin-metrics">{cards.map(([label, value]) => <article className="admin-metric" key={label}><span>{label}</span><strong>{value ?? '—'}</strong></article>)}</div><div className="control-panel"><div className="data-toolbar"><h3>Transaction and registration trends</h3><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="daily">Daily · 7 days</option><option value="weekly">Weekly · 4 weeks</option><option value="monthly">Monthly · 12 months</option></select></div><div className="admin-chart">{chart.map((d) => <div className="chart-day" key={String(d.date)}><div className="chart-bars"><i title={`Deposits ${money(d.depositsPaise)}`} style={{ height: `${Math.max(3, d.depositsPaise / max * 100)}%` }} /><b title={`Withdrawals ${money(d.withdrawalsPaise)}`} style={{ height: `${Math.max(3, d.withdrawalsPaise / max * 100)}%` }} /><em title={`New users ${d.registrations}`} style={{ height: `${Math.max(3, d.registrations / maxUsers * 100)}%` }} /></div><small>{period === 'daily' ? new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }) : new Date(d.date).toLocaleDateString(undefined, period === 'monthly' ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' })}</small></div>)}</div><div className="chart-legend"><span>Deposits</span><span>Withdrawals</span><span>New users</span></div></div><div className="admin-columns"><div className="control-panel"><h3>Recent deposits</h3><SimpleTable rows={data.recentTransactions || []} /></div><div className="control-panel"><h3>Recent registrations</h3><SimpleTable rows={data.recentUsers || []} /></div></div><div className="control-panel"><h3>Pending admin actions</h3><p>Manual deposits: {data.pendingAdminActions?.manualDeposits ?? 0} · P2P claims: {data.pendingAdminActions?.p2pClaims ?? 0} · Open P2P offers: {data.pendingAdminActions?.openP2pOffers ?? 0}</p><p>API: {data.system?.api} · Database: {data.system?.database}</p></div></>;
}

function AdminDataSection({ api, view, token, role, financialOperationsEnabled, refresh, setInfo, setError }) {
  const [rows, setRows] = useState([]); const [raw, setRaw] = useState(null); const [query, setQuery] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25); const [busy, setBusy] = useState(false); const [localError, setLocalError] = useState(''); const [total, setTotal] = useState(0);
  const [selectedUser, setSelectedUser] = useState(null); const [selectedRecord, setSelectedRecord] = useState(null);
  const statusOptions = view[1] === 'users' ? ['PENDING_PROFILE','ACTIVE','SUSPENDED','CLOSED'] : view[1] === 'deposits' ? ['CREATED','PENDING_PAYMENT','PAYMENT_PROCESSING','PAYMENT_VERIFIED','COMPLETED','FAILED','CANCELLED','EXPIRED','REFUNDED','REVERSED'] : view[1] === 'withdrawals' ? ['REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','COMPLETED','REJECTED','FAILED','CANCELLED'] : view[1] === 'support' ? ['OPEN','IN_PROGRESS','RESOLVED','CLOSED'] : view[1] === 'disputes' ? ['DISPUTED'] : view[1] === 'transactions' ? ['CREATED','PENDING_PAYMENT','PAYMENT_PROCESSING','PAYMENT_VERIFIED','COMPLETED','FAILED','CANCELLED','EXPIRED','REFUNDED','REVERSED','REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','REJECTED','AVAILABLE','RESERVED','OPEN','MATCHED','PAYMENT_PENDING','SETTLED','DISPUTED'] : null;
  const load = async (requestedPage = page, requestedQuery = query) => { if (!view[1]) { const result = await api(view[0], { token }); setRaw(result); setRows([]); return; } setBusy(true); setLocalError(''); try { const suffix = buildAdminListQuery({ page: requestedPage, pageSize, q: requestedQuery, status }); const result = await api(`${view[0]}${suffix}`, { token }); setRows(Array.isArray(result[view[1]]) ? result[view[1]] : []); setRaw(result); setTotal(Number(result.total) || 0); } catch (e) { setLocalError(e.message); setError(e.message); } finally { setBusy(false); } };
  useEffect(() => { load(page); }, [token, refresh, page, pageSize, status]);
  const search = async () => { if (page === 1) await load(1, query); else setPage(1); };
  const pagination = normalizePagination(total, page, pageSize); const pageCount = pagination.pageCount;
  const viewUser = async (row) => { try { const result = await api(adminRecordDetailPath('users', row.id), { token }); setSelectedUser(result.user); } catch (e) { setError(e.message); } };
  const viewRecord = async (row) => { const path = adminRecordDetailPath(view[1], row?.id); if (!path) { setSelectedRecord(row); return; } try { const result = await api(path, { token }); setSelectedRecord(view[1] === 'support' ? result.ticket : result.user || result); } catch (e) { setError(e.message); } };
  const act = async (row) => { const next = row.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED'; const reason = window.prompt(`${next === 'SUSPENDED' ? 'Suspend' : 'Reactivate'} account. Enter reason (minimum 8 characters):`); if (!reason || reason.trim().length < 8) return; try { await api(`/api/v1/admin/users/${encodeURIComponent(row.id)}/status`, { token, method: 'POST', body: { status: next, reason: reason.trim() } }); await load(); setInfo(`Account status changed to ${next}.`); } catch (e) { setError(e.message); } };
  const withdrawalState = financialActionState('withdrawalVerification', role, financialOperationsEnabled);
  const payoutState = financialActionState('payoutProcessing', role, financialOperationsEnabled);
  const walletState = financialActionState('walletAdjustment', role, financialOperationsEnabled);
  return <div className="control-panel">{view[1] === 'withdrawals' && withdrawalState.visible && <FinancialActionBanner title="Withdrawal verification is read-only" reason={withdrawalState.reason} />}{view[1] === 'ledger' && walletState.visible && <FinancialActionBanner title="Wallet adjustments unavailable" reason={walletState.reason} />}{view[0].endsWith('/system-health') && payoutState.visible && <FinancialActionBanner title="Payout processing unavailable" reason={payoutState.reason} />}<div className="data-toolbar"><div><h3>{view[2]}</h3><p>{total.toLocaleString()} records · page {page} of {pageCount}</p></div>{view[1] && <div className="data-filters"><input aria-label={`Search ${view[2]}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search records" onKeyDown={(e) => e.key === 'Enter' && search()} />{statusOptions && <select aria-label={`Filter ${view[2]} by status`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{statusOptions.map((x) => <option key={x}>{x}</option>)}</select>}<select aria-label="Rows per page" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={25}>25 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option></select><button className="secondary" onClick={search}>Search</button></div>}</div>
    {localError && <div className="live-alert error" role="alert">{localError} <button className="secondary" onClick={() => load()}>Retry</button></div>}
    {busy && <p role="status">Loading records…</p>}
    {selectedUser && <section className="control-panel" aria-label="User details"><div className="data-toolbar"><div><h3>User details · {selectedUser.publicId}</h3><p>Protected account summary; credentials and full phone number are never returned.</p></div><button className="secondary" onClick={() => setSelectedUser(null)}>Close</button></div><SimpleTable rows={[{ name: selectedUser.displayName, userId: selectedUser.publicId, phone: selectedUser.phoneMasked, status: selectedUser.status, adminRole: selectedUser.adminRole?.role || 'USER', joined: selectedUser.createdAt, updated: selectedUser.updatedAt, totalTransactions: selectedUser.totalTransactions }]} /></section>}
    {selectedRecord && <section className="control-panel" aria-label="Record detail view"><div className="data-toolbar"><div><h3>Record details · {selectedRecord.referenceId || selectedRecord.publicId || selectedRecord.subject || selectedRecord.id}</h3><p>Details are fetched from the authorized API where a dedicated detail endpoint exists.</p></div><button className="secondary" onClick={() => setSelectedRecord(null)}>Close</button></div><SimpleTable rows={[selectedRecord]} /></section>}
    {view[1] ? <>{!busy && !localError && rows.length === 0 ? <div className="empty-live">No {view[2].toLowerCase()} match the current search and filters.</div> : <SimpleTable rows={rows} onUserAction={view[1] === 'users' && ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'].includes(role) ? act : null} onUserView={view[1] === 'users' ? viewUser : null} onRowView={view[1] !== 'users' ? viewRecord : null} />}<div className="data-pagination"><button className="secondary" disabled={page <= 1 || busy} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button><span>Page {page} of {pageCount} · {total} records · {pageSize} per page</span><button className="secondary" disabled={page >= pageCount || busy} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button></div></> : <><SimpleTable rows={view[0].endsWith('/providers') ? (raw?.methods || []) : view[0].endsWith('/system-health') ? [{ api: raw?.api, database: raw?.database, databaseResponseTimeMs: raw?.databaseResponseTimeMs, payoutProvider: raw?.payoutProvider, backgroundWorkers: raw?.backgroundWorkers }, ...(raw?.payments || [])] : []} /><pre className="safe-json">{JSON.stringify(raw, null, 2)}</pre></>}
    {raw?.message && <p className="claim-muted">{raw.message}</p>}{raw?.configuration && <p className="claim-muted">{raw.configuration}</p>}{raw?.actions && <p className="claim-muted">{raw.actions}</p>}{raw?.management && <p className="claim-muted">{raw.management}</p>}{raw?.rewards && <p className="claim-muted">{raw.rewards}</p>}
  </div>;
}

function FinancialActionBanner({ title, reason }) {
  return <div className="financial-action-banner" role="status" title={reason}><strong>{title}</strong><span>{reason}</span></div>;
}

function SimpleTable({ rows = [], onUserAction, onUserView, onRowView }) {
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
  return <><div className="admin-table-wrap"><table className="admin-table"><thead><tr>{keys.map((key) => <th key={key}>{key.replace(/([A-Z])/g, ' $1')}</th>)}{(onUserAction || onUserView || onRowView) && <th>Actions</th>}</tr></thead><tbody>{rows.map((row, i) => <tr key={row.id || row.referenceId || i} className="detail-row" tabIndex={0} onClick={() => setSelectedRow(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedRow(row); }}>{keys.map((key) => <td key={key}>{value(key, row)}</td>)}{(onUserAction || onUserView || onRowView) && <td onClick={(event) => event.stopPropagation()}>{(onUserView || onRowView) && <button className="secondary" onClick={() => (onUserView || onRowView)(row)}>Details</button>} {onUserAction && <button className="secondary" disabled={row.status === 'CLOSED'} onClick={() => onUserAction(row)}>{row.status === 'SUSPENDED' ? 'Reactivate' : row.status === 'CLOSED' ? 'Closed' : 'Suspend'}</button>}</td>}</tr>)}</tbody></table></div>{selectedRow && <div className="record-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRow(null); }}><section className="record-detail-card" role="dialog" aria-modal="true" aria-label="Record details"><header><div><span className="eyebrow">RECORD DETAILS</span><h2>{selectedRow.referenceId || selectedRow.publicId || selectedRow.displayName || selectedRow.id || 'Record details'}</h2><p>Click any record to inspect fields returned by the authorized backend.</p></div><button className="secondary" onClick={() => setSelectedRow(null)}>Close</button></header><dl>{Object.entries(safeDetails(selectedRow)).map(([key, raw]) => <div className="record-detail-field" key={key}><dt>{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</dt><dd>{detailValue(key, raw)}</dd></div>)}</dl></section></div>}</>;
}

function ClaimCard({ api, apiRaw, claim, token, onDone }) {
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
    apiRaw(`${API}/api/v1/admin/reconciliation/claims/${encodeURIComponent(claim.id)}/evidence`, { token, accept: 'image/jpeg, image/png' })
      .then(async (response) => { if (!response.ok) throw new Error('Screenshot is unavailable.'); return response.blob(); })
      .then((blob) => { if (!active) return; objectUrl = URL.createObjectURL(blob); setScreenshotUrl(objectUrl); })
      .catch((e) => active && setScreenshotError(e.message));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [apiRaw, claim.id, claim.evidenceMimeType, token]);
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

function P2pClaimCard({ api, apiRaw, claim, token, onDone }) {
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
    if (claim.evidenceAttached) apiRaw(`${API}/api/v1/admin/p2p/claims/${encodeURIComponent(claim.id)}/evidence`, { token, accept: 'image/jpeg, image/png' })
      .then((response) => { if (!response.ok) throw new Error(`Evidence unavailable (${response.status})`); return response.blob(); })
      .then((blob) => { objectUrl = URL.createObjectURL(blob); if (!cancelled) setEvidenceUrl(objectUrl); else URL.revokeObjectURL(objectUrl); })
      .catch(() => { if (!cancelled) setEvidenceUrl(''); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [apiRaw, claim.id, claim.evidenceAttached, token]);
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
    <div className="live-notice"><b>Seller receipt acknowledgement:</b> {claim.order.sellerPaymentConfirmation ? `Recorded ${new Date(claim.order.sellerPaymentConfirmation.confirmedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.` : 'Not recorded.'} This acknowledgement is not independent verification and cannot settle the wallet ledger.</div>
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

