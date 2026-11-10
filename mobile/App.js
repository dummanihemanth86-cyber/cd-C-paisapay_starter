  var _jsxFileName = 'C:\\paisapay_starter\\mobile\\App.js';
  Object.defineProperty(exports, '__esModule', {
    value: true
  });
  function _interopDefault(e) {
    return e && e.__esModule ? e : {
      default: e
    };
  }
  function _interopNamespace(e) {
    if (e && e.__esModule) return e;
    var n = {};
    if (e) Object.keys(e).forEach(function (k) {
      var d = Object.getOwnPropertyDescriptor(e, k);
      Object.defineProperty(n, k, d.get ? d : {
        enumerable: true,
        get: function () {
          return e[k];
        }
      });
    });
    n.default = e;
    return n;
  }
  Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function () {
      return App;
    }
  });
  var _babelRuntimeHelpersSlicedToArray = require("@babel/runtime/helpers/slicedToArray");
  var _slicedToArray = _interopDefault(_babelRuntimeHelpersSlicedToArray);
  var _babelRuntimeHelpersAsyncToGenerator = require("@babel/runtime/helpers/asyncToGenerator");
  var _asyncToGenerator = _interopDefault(_babelRuntimeHelpersAsyncToGenerator);
  var _react = require("react");
  var _reactNative = require("react-native");
  var _safeAreaContext = require("react-native-safe-area-context");
  var _reactNativeQrcodeSvg = require("react-native-qrcode-svg");
  var QRCode = _interopDefault(_reactNativeQrcodeSvg);
  var _expoClipboard = require("expo-clipboard");
  var Clipboard = _interopNamespace(_expoClipboard);
  var _expoSecureStore = require("expo-secure-store");
  var SecureStore = _interopNamespace(_expoSecureStore);
  var _srcApi = require("./src/api");
  var _financialApiFallback = require("./src/financialApiFallback.cjs");
  var _walletBalanceRefresh = require("./src/walletBalanceRefresh.cjs");
  var _ultraHome = _interopDefault(require("./src/UltraHome"));
  var _vipLevelsScreen = _interopDefault(require("./src/VipLevelsScreen"));
  var _toastNotice = _interopDefault(require("./src/ToastNotice"));
  var _ultraActivity = _interopDefault(require("./src/UltraActivity"));
  var _depositScreen = _interopDefault(require("./src/DepositScreen"));
  var _depositHistory = _interopDefault(require("./src/DepositHistory"));
  var _withdrawalScreen = _interopDefault(require("./src/WithdrawalScreen"));
  var _upiSetupScreen = _interopDefault(require("./src/UpiSetupScreen"));
  var _referralScreens = require("./src/ReferralScreens");
  var _profileScreen = _interopDefault(require("./src/ProfileScreen"));
  var _birdAssistant = _interopDefault(require("./src/bird/BirdAssistant"));
  var _reactJsxRuntime = require("react/jsx-runtime");
  var PALETTES = {
    dark: {
      navy: '#07152E',
      blue: '#176BFF',
      electric: '#3B82F6',
      cyan: '#16D9F5',
      gold: '#F5A623',
      bg: '#07152E',
      surface: '#102747',
      softSurface: '#16385E',
      card: '#102747',
      ink: '#F8FAFC',
      textSecondary: '#CBD5E1',
      muted: '#94A3B8',
      line: '#26364F',
      green: '#12B981',
      red: '#EF4444',
      white: '#F8FAFC',
      pale: '#080F1F',
      warningSurface: '#3B2D12',
      warningText: '#FCD34D',
      successSurface: '#123629',
      accentSurface: '#12344A'
    },
    light: {
      navy: '#07152E',
      blue: '#176BFF',
      electric: '#3B82F6',
      cyan: '#16D9F5',
      gold: '#F5A623',
      bg: '#F5F8FF',
      surface: '#E9F0FB',
      softSurface: '#EAF1FC',
      card: '#FFFFFF',
      ink: '#0F172A',
      textSecondary: '#334155',
      muted: '#64748B',
      line: '#CBD5E1',
      green: '#12B981',
      red: '#DC2626',
      white: '#FFFFFF',
      pale: '#F5F8FF',
      warningSurface: '#FEF3C7',
      warningText: '#92400E',
      successSurface: '#DCFCE7',
      accentSurface: '#CFFAFE'
    }
  };
  var THEME_KEY = 'paisapay.appearance.v1';
  var C = PALETTES.light;
  var METHODS = [{
    name: 'Paytm',
    buy: true,
    sell: true,
    available: false,
    status: 'LOADING',
    availabilityMessage: 'Checking provider configuration.'
  }, {
    name: 'PhonePe',
    buy: false,
    sell: true,
    available: false,
    status: 'LOADING',
    availabilityMessage: 'Checking provider configuration.'
  }, {
    name: 'Navi',
    buy: false,
    sell: true,
    available: false,
    status: 'LOADING',
    availabilityMessage: 'Checking provider configuration.'
  }, {
    name: 'Cashfree',
    buy: false,
    sell: false,
    available: false,
    status: 'LOADING',
    availabilityMessage: 'Checking Cashfree sandbox configuration.'
  }];
  var DEFAULT_UPI_DEPOSIT = {
    receiverVpa: null,
    minAmountPaise: 1000,
    maxAmountPaise: 5000000,
    automaticVerificationAvailable: false,
    rewardPercentBps: 1700,
    rewardEnabled: false
  };
  var makeUpiIntent = (receiverVpa, amountPaise, reference) => `upi://pay?pa=${encodeURIComponent(receiverVpa)}&pn=${encodeURIComponent('PaisaPay')}&am=${(Number(amountPaise) / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(reference)}`;
  var money = p => {
    try {
      var value = typeof p === 'string' && /^\d+$/.test(p) ? BigInt(p) : Number.isSafeInteger(p) ? BigInt(p) : null;
      if (value === null) return '—';
      var rupees = (value / 100n).toString();
      var grouped = rupees.length > 3 ? rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + rupees.slice(-3) : rupees;
      return `₹${grouped}.${(value % 100n).toString().padStart(2, '0')}`;
    } catch {
      return '—';
    }
  };
  function openCashfreeCheckout(_x, _x2) {
    return _openCashfreeCheckout.apply(this, arguments);
  }
  function _openCashfreeCheckout() {
    _openCashfreeCheckout = (0, _asyncToGenerator.default)(function* (checkout, depositId) {
      return new Promise((resolve, reject) => {
        var service;
        var checkOnServer = /*#__PURE__*/function () {
          var _ref69 = (0, _asyncToGenerator.default)(function* () {
            try {
              var result = yield (0, _srcApi.apiGet)(`/api/v1/deposits/${depositId}`);
              resolve(result.deposit);
            } catch (error) {
              reject(error);
            }
          });
          return function checkOnServer() {
            return _ref69.apply(this, arguments);
          };
        }();
        try {
          var _require = require("react-native-cashfree-pg-sdk");
          service = _require.CFPaymentGatewayService;
          var _require2 = require("cashfree-pg-api-contract"),
            CFEnvironment = _require2.CFEnvironment,
            CFSession = _require2.CFSession;
          service.setCallback({
            onVerify: function () {
              var _ref70 = (0, _asyncToGenerator.default)(function* (orderId) {
                service.removeCallback();
                if (orderId !== checkout.orderId) return reject(new Error('Checkout returned a different order reference.'));
                yield checkOnServer();
              });
              return function onVerify(_x12) {
                return _ref70.apply(this, arguments);
              };
            }(),
            onError: function () {
              var _ref71 = (0, _asyncToGenerator.default)(function* () {
                service.removeCallback();
                yield checkOnServer();
              });
              return function onError() {
                return _ref71.apply(this, arguments);
              };
            }()
          });
          service.doWebPayment(new CFSession(checkout.paymentSessionId, checkout.orderId, CFEnvironment.SANDBOX));
        } catch (error) {
          try {
            service?.removeCallback?.();
          } catch {}
          reject(error);
        }
      });
    });
    return _openCashfreeCheckout.apply(this, arguments);
  }
  function AppContent() {
    var _useState = (0, _react.useState)('light'),
      _useState2 = (0, _slicedToArray.default)(_useState, 2),
      themeMode = _useState2[0],
      setThemeMode = _useState2[1];
    var applyTheme = /*#__PURE__*/function () {
      var _ref = (0, _asyncToGenerator.default)(function* (mode) {
        var next = 'light';
        C = PALETTES[next];
        styles = createStyles();
        setThemeMode(next);
        try {
          yield SecureStore.setItemAsync(THEME_KEY, next);
        } catch {}
      });
      return function applyTheme(_x3) {
        return _ref.apply(this, arguments);
      };
    }();
    (0, _react.useEffect)(() => {
      var mounted = true;
      SecureStore.getItemAsync(THEME_KEY).then(() => {
        if (mounted) {
          C = PALETTES.light;
          styles = createStyles();
          setThemeMode('light');
          SecureStore.setItemAsync(THEME_KEY, 'light').catch(() => {});
        }
      }).catch(() => {});
      return () => {
        mounted = false;
      };
    }, []);
    var _useState3 = (0, _react.useState)('Splash'),
      _useState4 = (0, _slicedToArray.default)(_useState3, 2),
      screen = _useState4[0],
      setScreen = _useState4[1];
    var _useSupportContext = (0, _react.useState)(null),
      _supportContextPair = (0, _slicedToArray.default)(_useSupportContext, 2),
      supportContext = _supportContextPair[0],
      setSupportContext = _supportContextPair[1];
    var _assistantActivityState = (0, _react.useState)(0),
      _assistantActivityPair = (0, _slicedToArray.default)(_assistantActivityState, 2),
      assistantActivity = _assistantActivityPair[0],
      setAssistantActivity = _assistantActivityPair[1];
    var _assistantEventState = (0, _react.useState)(null),
      _assistantEventPair = (0, _slicedToArray.default)(_assistantEventState, 2),
      assistantEvent = _assistantEventPair[0],
      setAssistantEvent = _assistantEventPair[1];
    var _useState5 = (0, _react.useState)('Home'),
      _useState6 = (0, _slicedToArray.default)(_useState5, 2),
      tab = _useState6[0],
      setTab = _useState6[1];
    var _useState7 = (0, _react.useState)(false),
      _useState8 = (0, _slicedToArray.default)(_useState7, 2),
      logged = _useState8[0],
      setLogged = _useState8[1];
    var _useState9 = (0, _react.useState)(''),
      _useState0 = (0, _slicedToArray.default)(_useState9, 2),
      phone = _useState0[0],
      setPhone = _useState0[1];
    var _useState1 = (0, _react.useState)(''),
      _useState10 = (0, _slicedToArray.default)(_useState1, 2),
      password = _useState10[0],
      setPassword = _useState10[1];
    var _useState11 = (0, _react.useState)(false),
      _useState12 = (0, _slicedToArray.default)(_useState11, 2),
      remember = _useState12[0],
      setRemember = _useState12[1];
    var _useState13 = (0, _react.useState)(''),
      _useState14 = (0, _slicedToArray.default)(_useState13, 2),
      registerName = _useState14[0],
      setRegisterName = _useState14[1];
    var _useState15 = (0, _react.useState)(''),
      _useState16 = (0, _slicedToArray.default)(_useState15, 2),
      registerPassword = _useState16[0],
      setRegisterPassword = _useState16[1];
    var _useState17 = (0, _react.useState)(''),
      _useState18 = (0, _slicedToArray.default)(_useState17, 2),
      registerConfirm = _useState18[0],
      setRegisterConfirm = _useState18[1];
    var _useState19 = (0, _react.useState)(''),
      _useState20 = (0, _slicedToArray.default)(_useState19, 2),
      registerCode = _useState20[0],
      setRegisterCode = _useState20[1];
    var _useStateRegisterReferral = (0, _react.useState)(''),
      _useStateRegisterReferralPair = (0, _slicedToArray.default)(_useStateRegisterReferral, 2),
      registerReferral = _useStateRegisterReferralPair[0],
      setRegisterReferral = _useStateRegisterReferralPair[1];
    var _useState21 = (0, _react.useState)(''),
      _useState22 = (0, _slicedToArray.default)(_useState21, 2),
      registerChallenge = _useState22[0],
      setRegisterChallenge = _useState22[1];
    var _useState23 = (0, _react.useState)(''),
      _useState24 = (0, _slicedToArray.default)(_useState23, 2),
      name = _useState24[0],
      setName = _useState24[1];
    var _useState25 = (0, _react.useState)(null),
      _useState26 = (0, _slicedToArray.default)(_useState25, 2),
      balance = _useState26[0],
      setBalance = _useState26[1];
    var _useState27 = (0, _react.useState)(null),
      _useState28 = (0, _slicedToArray.default)(_useState27, 2),
      pendingBalance = _useState28[0],
      setPendingBalance = _useState28[1];
    var _useState75 = (0, _react.useState)(null),
      _useState76 = (0, _slicedToArray.default)(_useState75, 2),
      reservedBalance = _useState76[0],
      setReservedBalance = _useState76[1];
    var _useState77 = (0, _react.useState)(null),
      _useState78 = (0, _slicedToArray.default)(_useState77, 2),
      withdrawalPendingBalance = _useState78[0],
      setWithdrawalPendingBalance = _useState78[1];
    var _useState29 = (0, _react.useState)(null),
      _useState30 = (0, _slicedToArray.default)(_useState29, 2),
      selectedOrder = _useState30[0],
      setSelectedOrder = _useState30[1];
    var _useState31 = (0, _react.useState)([]),
      _useState32 = (0, _slicedToArray.default)(_useState31, 2),
      orders = _useState32[0],
      setOrders = _useState32[1];
    var _useState33 = (0, _react.useState)([]),
      _useState34 = (0, _slicedToArray.default)(_useState33, 2),
      deposits = _useState34[0],
      setDeposits = _useState34[1];
    var _useState35 = (0, _react.useState)([]),
      _useState36 = (0, _slicedToArray.default)(_useState35, 2),
      withdrawals = _useState36[0],
      setWithdrawals = _useState36[1];
    var _financialOpsState = (0, _react.useState)(null),
      _financialOpsPair = (0, _slicedToArray.default)(_financialOpsState, 2),
      financialOperationsEnabled = _financialOpsPair[0],
      setFinancialOperationsEnabled = _financialOpsPair[1];
    var _financialReasonState = (0, _react.useState)('Availability could not be confirmed from the server. Financial actions remain disabled.'),
      _financialReasonPair = (0, _slicedToArray.default)(_financialReasonState, 2),
      financialOperationsReason = _financialReasonPair[0],
      setFinancialOperationsReason = _financialReasonPair[1];
    var _useState37 = (0, _react.useState)([]),
      _useState38 = (0, _slicedToArray.default)(_useState37, 2),
      bankAccounts = _useState38[0],
      setBankAccounts = _useState38[1];
    var _useState39 = (0, _react.useState)({
        upiId: null,
        verificationStatus: 'NOT_SET'
      }),
      _useState40 = (0, _slicedToArray.default)(_useState39, 2),
      upiProfile = _useState40[0],
      setUpiProfile = _useState40[1];
    var _useState41 = (0, _react.useState)(''),
      _useState42 = (0, _slicedToArray.default)(_useState41, 2),
      upiInput = _useState42[0],
      setUpiInput = _useState42[1];
    var _useState119 = (0, _react.useState)(''),
      _useState120 = (0, _slicedToArray.default)(_useState119, 2),
      upiNameInput = _useState120[0],
      setUpiNameInput = _useState120[1];
    var _useState43 = (0, _react.useState)(DEFAULT_UPI_DEPOSIT),
      _useState44 = (0, _slicedToArray.default)(_useState43, 2),
      upiDepositConfig = _useState44[0],
      setUpiDepositConfig = _useState44[1];
    var _useState45 = (0, _react.useState)({
        activeCount: 0,
        targetCount: null,
        progressPercent: null,
        booster: {
          configured: false,
          eligible: false,
          message: 'Withdrawal speed benefits are not configured for this account.'
        }
      }),
      _useState46 = (0, _slicedToArray.default)(_useState45, 2),
      walletActivation = _useState46[0],
      setWalletActivation = _useState46[1];
    var _useState47 = (0, _react.useState)([]),
      _useState48 = (0, _slicedToArray.default)(_useState47, 2),
      tickets = _useState48[0],
      setTickets = _useState48[1];
    var _useState49 = (0, _react.useState)([]),
      _useState50 = (0, _slicedToArray.default)(_useState49, 2),
      transactions = _useState50[0],
      setTransactions = _useState50[1];
    var _useState51 = (0, _react.useState)([]),
      _useState52 = (0, _slicedToArray.default)(_useState51, 2),
      notifications = _useState52[0],
      setNotifications = _useState52[1];
    var _useState53 = (0, _react.useState)(null),
      _useState54 = (0, _slicedToArray.default)(_useState53, 2),
      referrals = _useState54[0],
      setReferrals = _useState54[1];
    var _useState121 = (0, _react.useState)(0),
      _useState122 = (0, _slicedToArray.default)(_useState121, 2),
      rewardProfitPaise = _useState122[0],
      setRewardProfitPaise = _useState122[1];
    var _useStateVip = (0, _react.useState)(null),
      _useStateVipPair = (0, _slicedToArray.default)(_useStateVip, 2),
      vipStatus = _useStateVipPair[0],
      setVipStatus = _useStateVipPair[1];
    var _useState55 = (0, _react.useState)(''),
      _useState56 = (0, _slicedToArray.default)(_useState55, 2),
      challengeId = _useState56[0],
      setChallengeId = _useState56[1];
    var _useState57 = (0, _react.useState)('UNKNOWN'),
      _useState58 = (0, _slicedToArray.default)(_useState57, 2),
      otpDeliveryState = _useState58[0],
      setOtpDeliveryState = _useState58[1];
    var _useState59 = (0, _react.useState)(false),
      _useState60 = (0, _slicedToArray.default)(_useState59, 2),
      working = _useState60[0],
      setWorking = _useState60[1];
    var _useState61 = (0, _react.useState)(null),
      _useState62 = (0, _slicedToArray.default)(_useState61, 2),
      user = _useState62[0],
      setUser = _useState62[1];
    var _useState63 = (0, _react.useState)(METHODS),
      _useState64 = (0, _slicedToArray.default)(_useState63, 2),
      methods = _useState64[0],
      setMethods = _useState64[1];
    var _useState65 = (0, _react.useState)(''),
      _useState66 = (0, _slicedToArray.default)(_useState65, 2),
      amount = _useState66[0],
      setAmount = _useState66[1];
    var _useState67 = (0, _react.useState)(''),
      _useState68 = (0, _slicedToArray.default)(_useState67, 2),
      ref = _useState68[0],
      setRef = _useState68[1];
    var _useState69 = (0, _react.useState)('UPI'),
      _useState70 = (0, _slicedToArray.default)(_useState69, 2),
      method = _useState70[0],
      setMethod = _useState70[1];
    var _useState71 = (0, _react.useState)(false),
      _useState72 = (0, _slicedToArray.default)(_useState71, 2),
      taskDone = _useState72[0],
      setTaskDone = _useState72[1];
    var _useState73 = (0, _react.useState)(''),
      _useState74 = (0, _slicedToArray.default)(_useState73, 2),
      referralInput = _useState74[0],
      setReferralInput = _useState74[1];
    var _useStateToast = (0, _react.useState)(null),
      _useStateToastPair = (0, _slicedToArray.default)(_useStateToast, 2),
      toast = _useStateToastPair[0],
      setToast = _useStateToastPair[1];
    var note = (title, msg) => {
      var safeTitle = String(title || 'PaisaPay');
      var safeMessage = String(msg || '');
      var canCheckServer = /PaisaPay (?:is temporarily unavailable|could not be reached|is responding slowly)|server.*respond|cannot reach/i.test(safeMessage);
      setToast({ id: Date.now(), title: safeTitle, message: safeMessage, persistent: canCheckServer, canCheckServer });
    };
    _react.useEffect(() => _srcApi.setApiNetworkObserver(event => {
      if (event.state === 'retrying') {
        setToast({ id: Date.now(), title: 'Reconnecting to PaisaPay', message: `Retry ${event.attempt} of ${event.maxRetries} · waiting briefly before trying again.`, persistent: true });
      } else if (event.state === 'connected') {
        setToast({ id: Date.now(), title: 'Connection restored', message: 'PaisaPay responded. Check the latest transaction status before repeating an action.' });
      } else if (event.state === 'unavailable') {
        setToast({ id: Date.now(), title: 'PaisaPay server unavailable', message: 'Check your phone’s internet connection, then check the server before retrying an action.', persistent: true, canCheckServer: true });
      }
    }), []);
    var checkApiConnection = /*#__PURE__*/function () {
      var _refHealth = (0, _asyncToGenerator.default)(function* () {
        setToast({ id: Date.now(), title: 'Checking PaisaPay server', message: 'Checking the API and database connection…', persistent: true, checkingServer: true, canCheckServer: true });
        try {
          var health = yield (0, _srcApi.apiGet)('/ready', { auth: false, timeoutMs: 15000, totalTimeoutMs: 30000, transientRetries: 1 });
          if (health?.ok !== true) throw new Error('The API is responding, but database readiness was not confirmed.');
          setToast({ id: Date.now(), title: 'PaisaPay server ready', message: 'API and database are responding. Check your action’s status before submitting it again.' });
        } catch (error) {
          setToast({ id: Date.now(), title: 'PaisaPay server unavailable', message: error?.message || 'Could not reach the API. Check internet and try checking again.', persistent: true, canCheckServer: true });
        }
      });
      return function checkApiConnection() { return _refHealth.apply(this, arguments); };
    }();
    var refreshVip = () => (0, _srcApi.apiGet)('/api/v1/users/me/vip').then(data => {
      setVipStatus(data);
      return data;
    });
    var refreshReferrals = period => (0, _srcApi.apiGet)(`/api/v1/users/me/referrals${period ? `?period=${encodeURIComponent(period)}` : ''}`).then(data => {
      setReferrals(data);
      return data;
    });
    var loadPrivateData = /*#__PURE__*/function () {
      var _ref2 = (0, _asyncToGenerator.default)(function* () {
        setFinancialOperationsEnabled(false);
        setFinancialOperationsReason('Availability could not be confirmed from the server. Financial actions remain disabled.');
        var walletBalanceRequest = (0, _walletBalanceRefresh.refreshWalletBalance)(() => (0, _srcApi.apiGet)('/api/v1/users/me/balance'), balance => {
          setBalance(balance.availablePaise);
          setPendingBalance(balance.pendingPaise);
          setReservedBalance(balance.reservedPaise);
          setWithdrawalPendingBalance(balance.withdrawalPendingPaise);
          setRewardProfitPaise(balance.rewardProfitPaise || 0);
        });
        var _yield$Promise$all = yield Promise.all([(0, _srcApi.apiGet)('/api/v1/users/me'), walletBalanceRequest, (0, _srcApi.apiGet)('/api/v1/deposits'), (0, _financialApiFallback.loadFinancialResource)(() => (0, _srcApi.apiGet)('/api/v1/orders'), { orders: [] }), (0, _financialApiFallback.loadFinancialResource)(() => (0, _srcApi.apiGet)('/api/v1/withdrawals'), { withdrawals: [], offers: [] }), (0, _srcApi.apiGet)('/api/v1/users/me/transactions'), (0, _srcApi.apiGet)('/api/v1/support/tickets'), (0, _srcApi.apiGet)('/api/v1/notifications'), (0, _srcApi.apiGet)('/api/v1/users/me/referrals'), (0, _srcApi.apiGet)('/api/v1/wallet-methods'), (0, _srcApi.apiGet)('/api/v1/users/me/upi'), (0, _srcApi.apiGet)('/api/v1/users/me/bank-accounts')]),
          _yield$Promise$all2 = (0, _slicedToArray.default)(_yield$Promise$all, 12),
          me = _yield$Promise$all2[0],
          b = _yield$Promise$all2[1],
          ds = _yield$Promise$all2[2],
          orderResult = _yield$Promise$all2[3],
          withdrawalResult = _yield$Promise$all2[4],
          ts = _yield$Promise$all2[5],
          tk = _yield$Promise$all2[6],
          ns = _yield$Promise$all2[7],
          rs = _yield$Promise$all2[8],
          methodConfig = _yield$Promise$all2[9],
          upi = _yield$Promise$all2[10],
          ba = _yield$Promise$all2[11];
        setUser(me.user);
        setName(me.user.displayName || '');
        setBalance(b.availablePaise);
        setPendingBalance(b.pendingPaise);
        setReservedBalance(b.reservedPaise);
        setWithdrawalPendingBalance(b.withdrawalPendingPaise);
        setRewardProfitPaise(b.rewardProfitPaise || 0);
        void refreshVip().catch(() => setVipStatus(null));
        setDeposits(ds.deposits || []);
        setBankAccounts(ba.bankAccounts || []);
        setUpiProfile(upi);
        setUpiInput(upi.upiId || '');
        setUpiNameInput(upi.displayName || '');
        setUpiDepositConfig(methodConfig.upiDeposit || DEFAULT_UPI_DEPOSIT);
        var os = orderResult.value;
        var wd = withdrawalResult.value;
        var financialAvailability = _financialApiFallback.financialAvailability(methodConfig, orderResult, withdrawalResult);
        setFinancialOperationsEnabled(financialAvailability.enabled);
        setFinancialOperationsReason(financialAvailability.reason);
        setOrders((os.orders || []).map(o => ({
          ...o,
          kind: o.kind === 'BUY' ? 'Buy' : 'Sell',
          status: o.status === 'AVAILABLE' ? 'Available' : 'Reserved',
          expires: `${o.expiresInMinutes} min`
        })));
        setWithdrawals([...(wd.withdrawals || []), ...(wd.offers || [])]);
        setTransactions(ts.transactions || []);
        setTickets(tk.tickets || []);
        setNotifications(ns.notifications || []);
        setReferrals(rs);
        setWalletActivation(methodConfig.walletActivation || {
          activeCount: 0,
          targetCount: null,
          progressPercent: null,
          booster: {
            configured: false,
            eligible: false,
            message: 'Withdrawal speed benefits are not configured for this account.'
          }
        });
        if (Array.isArray(methodConfig.methods)) setMethods(methodConfig.methods.map(m => ({
          name: m.name,
          buy: m.buyEnabled,
          sell: m.sellEnabled,
          providerApproved: m.providerApproved,
          available: m.available === true,
          status: m.status,
          availabilityMessage: m.availabilityMessage,
          walletIntegration: m.walletIntegration
        })));
      });
      return function loadPrivateData() {
        return _ref2.apply(this, arguments);
      };
    }();
    (0, _react.useEffect)(() => {
      var active = true;
      var timer = setTimeout(() => {
        if (active) setScreen(current => current === 'Splash' ? 'Login' : current);
      }, 800);
      (0, _asyncToGenerator.default)(function* () {
        try {
          var rememberedPhone = yield (0, _srcApi.getRememberedLoginPhone)();
          if (active && rememberedPhone) {
            setPhone(rememberedPhone);
            setRemember(true);
          }
          var session = yield (0, _srcApi.restoreSession)();
          if (session) {
            yield loadPrivateData();
            if (active) {
              setLogged(true);
              setTab('Home');
              setScreen('Home');
            }
          }
        } catch (e) {
          if (['AUTH_REQUIRED', 'SESSION_INVALID', 'REFRESH_INVALID', 'REFRESH_REPLAYED'].includes(e.code)) yield (0, _srcApi.clearSession)();
          if (active) note('Could not restore session', e.message || 'Reconnect and sign in again if needed.');
        }
      })();
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, []);
    (0, _react.useEffect)(() => {
      var applyReferralUrl = url => {
        if (!url) return;
        try {
          var match = String(url).match(/[?&]ref=([^&]+)/i);
          var code = match ? decodeURIComponent(match[1]) : '';
          if (/^[a-z0-9_-]{4,60}$/i.test(code)) {
            setRegisterReferral(code);
            setLogged(false);
            setScreen('Register');
          }
        } catch {}
      };
      _reactNative.Linking.getInitialURL().then(applyReferralUrl).catch(() => {});
      var subscription = _reactNative.Linking.addEventListener('url', event => applyReferralUrl(event?.url));
      return () => subscription?.remove?.();
    }, []);
    var go = (s, context) => {
      setScreen(s);
      setAmount('');
      setRef('');
      setSupportContext(context || null);
    };
    var nav = t => {
      setTab(t);
      setScreen(t);
    };
    var logout = /*#__PURE__*/function () {
      var _ref4 = (0, _asyncToGenerator.default)(function* () {
        try {
          yield (0, _srcApi.apiLogout)();
        } finally {
          setLogged(false);
          setScreen('Login');
          setUser(null);
          setName('');
          setBalance(null);
          setOrders([]);
          setDeposits([]);
          setWithdrawals([]);
          setFinancialOperationsEnabled(null);
          setFinancialOperationsReason('Availability could not be confirmed from the server. Financial actions remain disabled.');
          setBankAccounts([]);
          setTransactions([]);
          setTickets([]);
        }
      });
      return function logout() {
        return _ref4.apply(this, arguments);
      };
    }();
    var refreshPrivateData = /*#__PURE__*/function () {
      var _ref5 = (0, _asyncToGenerator.default)(function* () {
        try {
          yield loadPrivateData();
        } catch (e) {
          setFinancialOperationsEnabled(false);
          setFinancialOperationsReason('Availability could not be confirmed from the server. Financial actions remain disabled.');
          note('Could not refresh', e.message || 'Check the API connection.');
        }
      });
      return function refreshPrivateData() {
        return _ref5.apply(this, arguments);
      };
    }();
    var saveUpiId = /*#__PURE__*/function () {
      var _ref6 = (0, _asyncToGenerator.default)(function* () {
        var displayName = upiNameInput.trim();
        var upiId = upiInput.trim();
        if (displayName.length < 2) {
          note('Check account name', 'Enter the account name shown in your UPI app (at least 2 characters).');
          return;
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,48}@[A-Za-z0-9][A-Za-z0-9.-]{1,48}$/.test(upiId)) {
          note('Check UPI ID', 'Enter a UPI ID in name@provider format, such as name@bank.');
          return;
        }
        try {
          setWorking(true);
          var result = yield (0, _srcApi.apiPatch)('/api/v1/users/me/upi', {
            upiId: upiId,
            displayName: displayName
          });
          setUpiProfile(result);
          setUpiInput(result.upiId || '');
          setUpiNameInput(result.displayName || '');
          setAssistantEvent({ type: 'upi_saved', id: Date.now() });
          note('UPI details saved successfully', 'Your name and UPI ID are saved and ready to use for P2P offers.');
        } catch (e) {
          note('Could not save UPI ID', e.message || 'Check the UPI ID format and API connection.');
        } finally {
          setWorking(false);
        }
      });
      return function saveUpiId() {
        return _ref6.apply(this, arguments);
      };
    }();
    var removeUpiId = /*#__PURE__*/function () {
      var _ref7 = (0, _asyncToGenerator.default)(function* () {
        try {
          setWorking(true);
          var result = yield (0, _srcApi.apiDelete)('/api/v1/users/me/upi');
          setUpiProfile(result);
          setUpiInput('');
          setUpiNameInput('');
          note('UPI ID removed', 'The saved reference was deleted.');
        } catch (e) {
          note('Could not remove UPI ID', e.message || 'Check the API connection.');
        } finally {
          setWorking(false);
        }
      });
      return function removeUpiId() {
        return _ref7.apply(this, arguments);
      };
    }();
    var saveBankAccount = /*#__PURE__*/function () {
      var _ref8 = (0, _asyncToGenerator.default)(function* (account) {
        try {
          setWorking(true);
          yield (0, _srcApi.apiPost)('/api/v1/users/me/bank-accounts', account);
          yield loadPrivateData();
          go('Bank Accounts');
          note('Bank account saved', 'Account number is encrypted and masked. Ownership is not verified, so withdrawals are unavailable.');
        } catch (e) {
          note('Could not save bank account', e.message || 'Check the fields and server configuration.');
        } finally {
          setWorking(false);
        }
      });
      return function saveBankAccount(_x4) {
        return _ref8.apply(this, arguments);
      };
    }();
    var updateBankAccount = /*#__PURE__*/function () {
      var _ref9 = (0, _asyncToGenerator.default)(function* (id, changes) {
        try {
          setWorking(true);
          yield (0, _srcApi.apiPatch)(`/api/v1/users/me/bank-accounts/${id}`, changes);
          yield loadPrivateData();
          note('Bank details updated', 'Ownership remains unverified.');
        } catch (e) {
          note('Could not update bank details', e.message || 'Check the API connection.');
        } finally {
          setWorking(false);
        }
      });
      return function updateBankAccount(_x5, _x6) {
        return _ref9.apply(this, arguments);
      };
    }();
    var removeBankAccount = /*#__PURE__*/function () {
      var _ref0 = (0, _asyncToGenerator.default)(function* (id) {
        try {
          setWorking(true);
          yield (0, _srcApi.apiDelete)(`/api/v1/users/me/bank-accounts/${id}`);
          yield loadPrivateData();
        } catch (e) {
          note('Could not remove bank account', e.message || 'Check the API connection.');
        } finally {
          setWorking(false);
        }
      });
      return function removeBankAccount(_x7) {
        return _ref0.apply(this, arguments);
      };
    }();
    var createDeposit = /*#__PURE__*/function () {
      var _ref1 = (0, _asyncToGenerator.default)(function* () {
        var n = Number(amount);
        var paise = Math.round(n * 100);
        var min = Number(upiDepositConfig.minAmountPaise ?? DEFAULT_UPI_DEPOSIT.minAmountPaise);
        var max = Number(upiDepositConfig.maxAmountPaise ?? DEFAULT_UPI_DEPOSIT.maxAmountPaise);
        if (!Number.isFinite(n) || !Number.isSafeInteger(paise) || paise < min || paise > max) return note('Check amount', `Enter an amount from ${money(min)} to ${money(max)}.`);
        if (!upiDepositConfig.receiverVpa) return note('UPI recipient unavailable', 'PaisaPay has not configured a payment recipient. No deposit was created.');
        try {
          setWorking(true);
          var x = yield (0, _srcApi.apiPost)('/api/v1/deposits', {
            amountPaise: paise,
            method: 'UPI'
          }, `upi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
          var deposit = x.deposit;
          var receiver = x.deposit.receiverVpa || upiDepositConfig.receiverVpa;
          if (!receiver) return note('UPI recipient unavailable', 'PaisaPay has not configured a payment recipient. No payment was started.');
          var paymentUri = makeUpiIntent(receiver, paise, deposit.merchantReference);
          setSelectedOrder({
            ...deposit,
            paymentUri,
            receiverVpa: receiver
          });
          go('Deposit History');
          void loadPrivateData().catch(() => {});
          try {
            yield _reactNative.Linking.openURL(paymentUri);
          } catch {
            note('UPI app unavailable', 'Order remains pending. Use the QR or copy the receiver UPI ID from Deposit History. No payment was verified.');
          }
        } catch (e) {
          if (e.code === 'PENDING_DEPOSIT_EXISTS') {
            yield loadPrivateData().catch(() => {});
            go('Deposit History');
            note('Pending deposits', 'You can have up to 2 active deposits. Pay, cancel, or wait for one to expire before creating another.');
            return;
          }
          note('Deposit unavailable', e.message || 'Check the API connection.');
        } finally {
          setWorking(false);
        }
      });
      return function createDeposit() {
        return _ref1.apply(this, arguments);
      };
    }();
    var cancelDeposit = /*#__PURE__*/function () {
      var _refCancel = (0, _asyncToGenerator.default)(function* (deposit) {
        try {
          setWorking(true);
          var result = yield (0, _srcApi.apiPost)(`/api/v1/deposits/${encodeURIComponent(deposit.id)}/cancel`, {});
          yield loadPrivateData();
          note(result.deposit.status === 'CANCELLED' ? 'Deposit cancelled' : 'Deposit expired', result.message);
        } catch (e) {
          note('Could not cancel deposit', e.message || 'Refresh deposit history and retry.');
        } finally {
          setWorking(false);
        }
      });
      return function cancelDeposit(deposit) {
        return _refCancel.apply(this, arguments);
      };
    }();
    var createWithdrawal = /*#__PURE__*/function () {
      var _ref10 = (0, _asyncToGenerator.default)(function* () {
        var n = Number(amount);
        if (!Number.isInteger(n) || n < 100 || n % 100 !== 0 || n * 100 > (balance || 0)) return note('Check amount', 'Enter a multiple of ₹100 from ₹100 up to your available balance.');
        try {
          setWorking(true);
          var result = yield (0, _srcApi.apiPost)('/api/v1/withdrawals', {
            amountPaise: n * 100
          }, `withdrawal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
          yield refreshPrivateData();
          go('Withdrawals');
          note('Withdrawal request pending', result.message || 'Your offer is visible to eligible buyers. Its amount is reserved from your available balance while the offer is active.');
        } catch (e) {
          note('Withdrawal unavailable', e.message || 'No withdrawal was created.');
        } finally {
          setWorking(false);
        }
      });
      return function createWithdrawal() {
        return _ref10.apply(this, arguments);
      };
    }();
    var cancelWithdrawalOffer = /*#__PURE__*/function () {
      var _refCancelWithdrawal = (0, _asyncToGenerator.default)(function* (offer) {
        try {
          setWorking(true);
          var result = yield (0, _srcApi.apiPost)(`/api/v1/withdrawals/offers/${encodeURIComponent(offer.id)}/cancel`, {});
          yield refreshPrivateData();
          note('Withdrawal request cancelled', result.message || 'You can create another withdrawal request now.');
          return true;
        } catch (e) {
          note('Could not cancel withdrawal', e.message || 'A matched payment may still be pending. Refresh and check the offer status.');
          return false;
        } finally {
          setWorking(false);
        }
      });
      return function cancelWithdrawalOffer(offer) {
        return _refCancelWithdrawal.apply(this, arguments);
      };
    }();
    var reserve = /*#__PURE__*/function () {
      var _ref11 = (0, _asyncToGenerator.default)(function* (o) {
        if (o.status !== 'Available' || working) return;
        try {
          setWorking(true);
          var result = yield (0, _srcApi.apiPost)(`/api/v1/orders/${o.id}/reservations`, {}, `reserve-${o.id}-${Date.now()}`);
          yield refreshPrivateData();
          setSelectedOrder({
            ...o,
            status: 'Reserved'
          });
          note('Order reserved', result.message || 'Payment is not initiated or verified by PaisaPay.');
        } catch (e) {
          note('Reservation unavailable', e.message || 'Check the connection and try again.');
        } finally {
          setWorking(false);
        }
      });
      return function reserve(_x8) {
        return _ref11.apply(this, arguments);
      };
    }();
    var content = () => {
      if (!logged && !['Login', 'OTP', 'Profile setup', 'Register', 'Forgot Password', 'Splash'].includes(screen)) return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Login, {
        onContinue: () => go('Login')
      }, void 0);
      switch (screen) {
        case 'Splash':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Splash, {}, void 0);
        case 'Login':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Login, {
            phone: phone,
            setPhone: setPhone,
            password: password,
            setPassword: setPassword,
            remember: remember,
            setRemember: setRemember,
            working: working,
            onLogin: /*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
              if (phone.replace(/\D/g, '').length !== 10) return note('Check mobile number', 'Enter a 10-digit Indian mobile number.');
              if (!password) return note('Password required', 'Enter your PaisaPay password.');
              try {
                setWorking(true);
                var result = yield (0, _srcApi.apiPost)('/api/v1/auth/password/login', {
                  phoneE164: `+91${phone.replace(/\D/g, '')}`,
                  password
                }, undefined, {
                  auth: false
                });
                yield (0, _srcApi.saveSession)(result, {
                  remember
                });
                yield (0, _srcApi.setRememberedLoginPhone)(remember ? phone.replace(/\D/g, '') : '');
                setPassword('');
                yield loadPrivateData();
                setLogged(true);
                setAssistantEvent({ type: 'login', id: Date.now() });
                setTab('Home');
                go('Home');
              } catch (e) {
                note('Login failed', e.message || 'Check your mobile number and password.');
              } finally {
                setWorking(false);
              }
            }),
            onRegister: () => go('Register'),
            onForgot: () => go('Forgot Password')
          }, void 0);
        case 'Forgot Password':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(PasswordReset, {
            phone: phone,
            setPhone: setPhone,
            working: working,
            onBack: () => go('Login'),
            onRequestCode: /*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
              if (phone.replace(/\D/g, '').length !== 10) return note('Check mobile number', 'Enter your registered 10-digit mobile number.');
              try {
                setWorking(true);
                return yield (0, _srcApi.apiPost)('/api/v1/auth/forgot-password/request-otp', {
                  phoneE164: `+91${phone.replace(/\D/g, '')}`
                }, undefined, {
                  auth: false
                });
              } catch (e) {
                note('Could not send reset OTP', e.message || 'Check your network and SMS service, then try again.');
                return null;
              } finally {
                setWorking(false);
              }
            }),
            onReset: (/*#__PURE__*/function () {
              var _ref14 = (0, _asyncToGenerator.default)(function* (challengeId, code, newPassword) {
                try {
                  setWorking(true);
                  yield (0, _srcApi.apiPost)('/api/v1/auth/password/reset', {
                    phoneE164: `+91${phone.replace(/\D/g, '')}`,
                    challengeId,
                    code,
                    newPassword
                  }, undefined, {
                    auth: false
                  });
                  setPassword('');
                  go('Login');
                  note('Password reset', 'Sign in with your new password. Existing sessions were signed out.');
                } catch (e) {
                  note('Password reset failed', e.message || 'The code may be incorrect or expired.');
                } finally {
                  setWorking(false);
                }
              });
              return function (_x9, _x0, _x1) {
                return _ref14.apply(this, arguments);
              };
            }())
          }, void 0);
        case 'Register':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Register, {
            phone: phone,
            setPhone: setPhone,
            fullName: registerName,
            setFullName: setRegisterName,
            password: registerPassword,
            setPassword: setRegisterPassword,
            confirmPassword: registerConfirm,
            setConfirmPassword: setRegisterConfirm,
            referralCode: registerReferral,
            setReferralCode: setRegisterReferral,
            code: registerCode,
            setCode: setRegisterCode,
            challengeId: registerChallenge,
            working: working,
            onRequestOtp: /*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
              if (registerName.trim().length < 2) return note('Check name', 'Enter your full name.');
              if (phone.replace(/\D/g, '').length !== 10) return note('Check mobile number', 'Enter a 10-digit Indian mobile number.');
              if (registerPassword.length < 8) return note('Password too short', 'Choose at least 8 characters.');
              if (registerPassword !== registerConfirm) return note('Passwords do not match', 'Enter the same password in both fields.');
              try {
                setWorking(true);
                var result = yield (0, _srcApi.apiPost)('/api/v1/auth/register/request-otp', {
                  phoneE164: `+91${phone.replace(/\D/g, '')}`,
                  fullName: registerName.trim(),
                  ...(registerReferral.trim() ? { referralCode: registerReferral.trim() } : {})
                }, undefined, {
                  auth: false
                });
                setRegisterChallenge(result.challengeId);
                return result;
              } catch (e) {
                note('Could not request OTP', e.message || 'Check the backend connection.');
                return null;
              } finally {
                setWorking(false);
              }
            }),
            onVerify: /*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
              if (!registerChallenge || registerCode.length !== 6) return note('Check code', 'Enter the six-digit OTP.');
              try {
                setWorking(true);
                var result = yield (0, _srcApi.apiPost)('/api/v1/auth/register/verify-otp', {
                  phoneE164: `+91${phone.replace(/\D/g, '')}`,
                  fullName: registerName.trim(),
                  password: registerPassword,
                  ...(registerReferral.trim() ? { referralCode: registerReferral.trim() } : {}),
                  challengeId: registerChallenge,
                  code: registerCode
                }, undefined, {
                  auth: false
                });
                setRegisterName('');
                setRegisterPassword('');
                setRegisterConfirm('');
                setRegisterReferral('');
                setRegisterCode('');
                setRegisterChallenge('');
                setPassword('');
                go('Login');
                note('Registration complete', `Your PaisaPay ID is ${result.user?.publicId || 'created'}. Sign in with your phone number and password.`);
              } catch (e) {
                note('Registration failed', e.message || 'The code may be invalid or expired.');
              } finally {
                setWorking(false);
              }
            }),
            onBack: () => go('Login')
          }, void 0);
        case 'OTP':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Otp, {
            phone: phone,
            deliveryState: otpDeliveryState,
            onCheckDelivery: /*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
              try {
                setWorking(true);
                var result = yield (0, _srcApi.apiGet)(`/api/v1/auth/otp-status/${challengeId}`, {
                  auth: false
                });
                setOtpDeliveryState(result.deliveryState || 'UNKNOWN');
                note('SMS status', `Gateway status: ${result.gatewayStatus || 'UNKNOWN'}.`);
              } catch (e) {
                note('Could not check SMS status', e.message || 'The gateway status is unavailable.');
              } finally {
                setWorking(false);
              }
            }),
            onVerify: (/*#__PURE__*/function () {
              var _ref18 = (0, _asyncToGenerator.default)(function* (code) {
                try {
                  setWorking(true);
                  var result = yield (0, _srcApi.apiPost)('/api/v1/auth/verify-otp', {
                    phoneE164: `+91${phone.replace(/\D/g, '')}`,
                    challengeId,
                    code
                  }, undefined, {
                    auth: false
                  });
                  yield (0, _srcApi.saveSession)(result, { remember });
                  yield (0, _srcApi.setRememberedLoginPhone)(remember ? phone.replace(/\D/g, '') : '');
                  yield loadPrivateData();
                  setLogged(true);
                  setAssistantEvent({ type: 'login', id: Date.now() });
                  if (result.user.displayName) {
                    setTab('Home');
                    go('Home');
                  } else go('Profile setup');
                } catch (e) {
                  note('Sign in failed', e.message || 'The code is invalid or expired.');
                } finally {
                  setWorking(false);
                }
              });
              return function (_x10) {
                return _ref18.apply(this, arguments);
              };
            }())
          }, void 0);
        case 'Profile setup':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Profile, {
            name: name,
            setName: setName,
            referralCode: referralInput,
            setReferralCode: setReferralInput,
            onSave: /*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
              if (name.trim().length < 2) return note('Check name', 'Enter at least 2 characters.');
              try {
                setWorking(true);
                yield (0, _srcApi.apiPatch)('/api/v1/users/me', {
                  displayName: name.trim(),
                  ...(referralInput.trim() ? {
                    referralCode: referralInput.trim()
                  } : {})
                });
                yield loadPrivateData();
                setLogged(true);
                setAssistantEvent({ type: 'login', id: Date.now() });
                setTab('Home');
                go('Home');
              } catch (e) {
                note('Could not save profile', e.message || 'Check the API connection.');
              } finally {
                setWorking(false);
              }
            })
          }, void 0);
        case 'Home':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Home, {
            balance: balance,
            pendingBalance: pendingBalance,
            reservedBalance: reservedBalance,
            rewardProfitPaise: rewardProfitPaise,
            vipData: vipStatus,
            withdrawalPendingBalance: withdrawalPendingBalance,
            withdrawals: withdrawals,
            deposits: deposits,
            orders: orders,
            transactions: transactions,
            notifications: notifications,
            financialOperationsEnabled: financialOperationsEnabled,
            financialOperationsReason: financialOperationsReason,
            name: name,
            userId: user && user.id,
            go: go,
            reserve: reserve,
            note: note
          }, void 0);
        case 'Deposit':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Deposit, {
            amount: amount,
            setAmount: setAmount,
            create: createDeposit,
            go: go,
            balance: balance,
            config: upiDepositConfig,
            working: working,
            note: note,
            financialOperationsEnabled: financialOperationsEnabled,
            financialOperationsReason: financialOperationsReason,
            upiProfile: upiProfile,
            refresh: refreshPrivateData,
            onAssistantEvent: type => setAssistantEvent({ type, id: Date.now() })
          }, void 0);
        case 'UPI':
        case 'UPI Wallets':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(UpiSetup, {
            upiProfile: upiProfile,
            upiInput: upiInput,
            setUpiInput: setUpiInput,
            upiNameInput: upiNameInput,
            setUpiNameInput: setUpiNameInput,
            saveUpiId: saveUpiId,
            removeUpiId: removeUpiId,
            working: working,
            go: go
          }, void 0);
        case 'Buy Orders':
        case 'Sell Orders':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Orders, {
            methods: methods,
            screen: screen,
            orders: orders,
            go: go,
            onSelect: o => {
              setSelectedOrder(o);
              go('Order Details');
            }
          }, void 0);
        case 'Create Sell Order':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(CreateSellOrder, {
            methods: methods,
            amount: amount,
            setAmount: setAmount,
            method: method,
            setMethod: setMethod,
            create: /*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
              var n = Number(amount);
              if (!Number.isInteger(n) || n < 10 || n > 50000) return note('Check amount', 'Enter a whole rupee amount from ₹10 to ₹50,000.');
              try {
                setWorking(true);
                var x = yield (0, _srcApi.apiPost)('/api/v1/orders', {
                  kind: 'SELL',
                  amountPaise: n * 100,
                  method
                }, `sell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
                yield loadPrivateData();
                go('Sell Orders');
                note('Order created', x.message || 'This order does not create or verify payment.');
              } catch (e) {
                note('Could not create order', e.message || 'Check the API connection.');
              } finally {
                setWorking(false);
              }
            })
          }, void 0);
        case 'Order Details':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(OrderDetails, {
            order: selectedOrder,
            go: go,
            note: note,
            reserve: reserve
          }, void 0);
        case 'Team':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_referralScreens.TeamScreen, {
            referrals: referrals,
            go: go,
            colors: C,
            refresh: refreshReferrals,
            note: note
          }, void 0);
        case 'Members':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_referralScreens.MembersScreen, {
            referrals: referrals,
            colors: C,
            refresh: refreshReferrals
          }, void 0);
        case 'Share & Earn':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_referralScreens.ShareEarnScreen, {
            referrals: referrals,
            code: referrals?.referralCode || user?.referralCode,
            colors: C,
            refresh: refreshReferrals,
            note: note
          }, void 0);
        case 'VIP Levels':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_vipLevelsScreen.default, {
            colors: C,
            vipData: vipStatus,
            refresh: refreshVip
          }, void 0);
        case 'Daily Tasks':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Tasks, {
            done: taskDone,
            onClaim: () => note('Rewards unavailable', 'No funded task reward rules are configured.')
          }, void 0);
        case 'Mine':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Mine, {
            name: name,
            accountId: user?.publicId,
            balance: balance,
            status: user?.status,
            avatarId: user?.avatarId,
            onSaveName: /*#__PURE__*/(0, _asyncToGenerator.default)(function* (displayName) {
              try {
                setWorking(true);
                var result = yield (0, _srcApi.apiPatch)('/api/v1/users/me', { displayName: displayName });
                setName(result.user.displayName || displayName);
                setUser({ ...user, ...result.user });
                note('Name updated', 'Your profile name was saved.');
                return true;
              } catch (e) {
                note('Could not update name', e.message || 'Check the API connection.');
                return false;
              } finally { setWorking(false); }
            }),
            onSelectAvatar: /*#__PURE__*/(0, _asyncToGenerator.default)(function* (selectedAvatarId) {
              try {
                setWorking(true);
                var result = yield (0, _srcApi.apiPatch)('/api/v1/users/me', { avatarId: selectedAvatarId });
                setUser({ ...user, ...result.user });
                note('Avatar saved', 'Your profile mascot was updated.');
                return true;
              } catch (e) {
                note('Could not save avatar', e.message || 'Check the API connection.');
                return false;
              } finally { setWorking(false); }
            }),
            go: go,
            logout: logout,
            note: note,
            themeMode: themeMode,
            onThemeChange: applyTheme
          }, void 0);
        case 'Bills':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Bills, {
            deposits: deposits,
            withdrawals: withdrawals,
            activity: transactions.map(t => ({
              label: t.displayDescription || t.description,
              detail: `${t.reference} · ${t.type}`,
              status: t.status,
              createdAt: t.createdAt,
              amount: `${t.type === 'CREDIT' ? '+' : '−'}${money(t.amountPaise)}`
            })),
            balance: balance,
            pendingBalance: pendingBalance,
            reservedBalance: reservedBalance,
            withdrawalPendingBalance: withdrawalPendingBalance,
            go: go,
            colors: C
          }, void 0);
        case 'Deposit History':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_depositHistory.default, {
            rows: deposits,
            empty: "No deposit requests yet",
            note: note,
            onRefresh: refreshPrivateData,
            onCancel: cancelDeposit,
            upiReceiver: upiDepositConfig.receiverVpa,
            colors: C
          }, void 0);
        case 'Withdrawals':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Withdraw, {
            amount: amount,
            setAmount: setAmount,
            create: createWithdrawal,
            balance: balance,
            bankAccounts: bankAccounts,
            upiProfile: upiProfile,
            go: go,
            cancelOffer: cancelWithdrawalOffer,
            working: working,
            note: note,
            financialOperationsEnabled: financialOperationsEnabled,
            financialOperationsReason: financialOperationsReason
          }, void 0);
        case 'Bank Accounts':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(BankAccounts, {
            accounts: bankAccounts,
            onAdd: saveBankAccount,
            onUpdate: updateBankAccount,
            onRemove: removeBankAccount,
            working: working
          }, void 0);
        case 'Support':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Support, {
            tickets: tickets,
            setTickets: setTickets,
            note: note,
            supportContext: supportContext
          }, void 0);
        case 'FAQs':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(FAQs, {}, void 0);
        case 'Security':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Security, {
            note: note,
            onResetPassword: () => { logout().catch(() => {}).finally(() => go('Forgot Password')); },
            onLogout: logout
          }, void 0);
        case 'Notifications':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(NotificationList, {
            rows: notifications
          }, void 0);
        case 'Version Center':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Version, {}, void 0);
        case 'Bird Settings':
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Empty, { title: 'Bird assistant', body: 'Change the assistant language, joke sound, size or visibility in these settings.' }, void 0);
        default:
          return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Empty, {
            title: screen,
            body: "This section is not configured in the current release."
          }, void 0);
      }
    };
    var tabs = ['Home', 'Deposit', 'UPI', 'Team', 'Mine'];
    var sub = logged && !tabs.includes(screen);
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_safeAreaContext.SafeAreaView, {
      style: styles.safe,
      edges: ['top', 'bottom'],
      onTouchStart: () => setAssistantActivity(value => value + 1),
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.StatusBar, {
        barStyle: themeMode === 'dark' ? 'light-content' : 'dark-content',
        backgroundColor: C.navy
      }, void 0), logged && screen !== 'Login' && screen !== 'OTP' && screen !== 'Profile setup' && screen !== 'Home' ? screen === 'UPI' ? /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.View, {
        style: [styles.header, {
          backgroundColor: C.navy,
          justifyContent: 'center'
        }],
        children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: [styles.brand, {
            flex: 0,
            textAlign: 'center'
          }],
          children: "UPI"
        }, void 0)
      }, void 0) : /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
        style: styles.header,
        children: [sub && /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.TouchableOpacity, {
          onPress: () => go(tab),
          children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: styles.back,
            children: "\u2039"
          }, void 0)
        }, void 0), /*#__PURE__*/_react.createElement(_reactNative.View, { style: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 } }, _react.createElement(_reactNative.Image, { source: require('./assets/paisapay-customer-emblem.png'), style: { width: 34, height: 34, borderRadius: 8 } }), _react.createElement(_reactNative.Text, { style: styles.brand }, 'PaisaPay')), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.demoTag,
          children: "INR"
        }, void 0)]
      }, void 0) : null, /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
        style: styles.body,
        children: [content(), working && /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
          style: {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: '#080F1FCC',
            alignItems: 'center',
            justifyContent: 'center'
          },
          children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.ActivityIndicator, {
            size: "large",
            color: C.gold
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: {
              color: 'white',
              fontWeight: '700',
              marginTop: 12
            },
            children: "Connecting to PaisaPay\u2026"
          }, void 0)]
        }, void 0)]
      }, void 0), logged && tabs.includes(screen) ? /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.View, {
        style: styles.nav,
        children: tabs.map((t, i) => /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.TouchableOpacity, {
          style: [styles.navItem, tab === t && styles.navItemActive],
          onPress: () => nav(t),
          children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: [styles.navIcon, tab === t && styles.navActive],
            children: ['⌂', '↓', '▣', '♧', '◉'][i]
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: [styles.navLabel, tab === t && styles.navActive],
            children: t === 'Mine' ? 'Profile' : t
          }, void 0)]
        }, t))
      }, void 0) : null, toast && _react.createElement(_toastNotice.default, {
        toast: toast,
        colors: C,
        onDismiss: () => setToast(null),
        onCheckServer: checkApiConnection
      }), _react.createElement(_birdAssistant.default, { colors: C, logged, screen, working, activityKey: assistantActivity, assistantEvent, onAssistantEventHandled: id => setAssistantEvent(current => current?.id === id ? null : current), settingsOpen: screen === 'Bird Settings', onCloseSettings: () => go('Mine') })]
    }, void 0);
  }
  function App() {
    return _react.createElement(_safeAreaContext.SafeAreaProvider, null, _react.createElement(AppContent));
  }
  function Page(_ref21) {
    var children = _ref21.children,
      style = _ref21.style,
      contentStyle = _ref21.contentStyle;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.ScrollView, {
      style: [{
        flex: 1
      }, style],
      contentContainerStyle: [styles.page, contentStyle],
      children: children
    }, void 0);
  }
  function Splash() {
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
      style: {
        flex: 1,
        backgroundColor: C.navy,
        alignItems: 'center',
        justifyContent: 'center'
      },
      children: [/*#__PURE__*/_react.createElement(_reactNative.Image, { source: require('./assets/paisapay-customer-brand.png'), resizeMode: 'contain', style: { width: 210, height: 210 } }), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: {
          fontSize: 32,
          fontWeight: '900',
          color: 'white',
          marginTop: 9
        },
        children: "PaisaPay"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: {
          fontSize: 12,
          color: C.textSecondary,
          marginTop: 8
        },
        children: "INR-only account"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: {
          fontSize: 11,
          color: C.muted,
          marginTop: 35
        },
        children: "Checking your secure session\u2026"
      }, void 0)]
    }, void 0);
  }
  function Title(_ref22) {
    var title = _ref22.title,
      sub = _ref22.sub;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
      style: {
        marginBottom: 16
      },
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: styles.title,
        children: title
      }, void 0), sub && /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: styles.subtitle,
        children: sub
      }, void 0)]
    }, void 0);
  }
  function Card(_ref23) {
    var children = _ref23.children,
      style = _ref23.style;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.View, {
      style: [styles.card, style],
      children: children
    }, void 0);
  }
  function Button(_ref24) {
    var title = _ref24.title,
      onPress = _ref24.onPress,
      _ref24$secondary = _ref24.secondary,
      secondary = _ref24$secondary === void 0 ? false : _ref24$secondary,
      _ref24$disabled = _ref24.disabled,
      disabled = _ref24$disabled === void 0 ? false : _ref24$disabled,
      customStyle = _ref24.style;
    var scale = (0, _react.useRef)(new _reactNative.Animated.Value(1)).current;
    var animate = toValue => _reactNative.Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 32,
      bounciness: 4
    }).start();
    return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Animated.View, {
      style: {
        transform: [{
          scale
        }]
      },
      children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.TouchableOpacity, {
        activeOpacity: 0.88,
        onPressIn: () => animate(.98),
        onPressOut: () => animate(1),
        disabled: disabled,
        onPress: onPress,
        style: [styles.button, secondary && styles.buttonSecondary, customStyle, disabled && {
          opacity: .45
        }],
        children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: [styles.buttonText, secondary && styles.buttonTextSecondary],
          children: title
        }, void 0)
      }, void 0)
    }, void 0);
  }
  function Chip(_ref25) {
    var label = _ref25.label,
      active = _ref25.active,
      onPress = _ref25.onPress,
      _ref25$disabled = _ref25.disabled,
      disabled = _ref25$disabled === void 0 ? false : _ref25$disabled;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.TouchableOpacity, {
      disabled: disabled,
      onPress: onPress,
      style: [styles.chip, active && styles.chipActive, disabled && {
        opacity: .45
      }],
      children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: [styles.chipText, active && styles.chipTextActive],
        children: label
      }, void 0)
    }, void 0);
  }
  function Field(_ref26) {
    var label = _ref26.label,
      value = _ref26.value,
      onChangeText = _ref26.onChangeText,
      placeholder = _ref26.placeholder,
      _ref26$keyboardType = _ref26.keyboardType,
      keyboardType = _ref26$keyboardType === void 0 ? 'default' : _ref26$keyboardType,
      _ref26$secureTextEntr = _ref26.secureTextEntry,
      secureTextEntry = _ref26$secureTextEntr === void 0 ? false : _ref26$secureTextEntr,
      autoCapitalize = _ref26.autoCapitalize,
      autoCorrect = _ref26.autoCorrect;
    var _useState75 = (0, _react.useState)(false),
      _useState76 = (0, _slicedToArray.default)(_useState75, 2),
      visible = _useState76[0],
      setVisible = _useState76[1];
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
      style: {
        marginBottom: 13
      },
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: styles.fieldLabel,
        children: label
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
        style: {
          position: 'relative',
          justifyContent: 'center'
        },
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.TextInput, {
          accessibilityLabel: label,
          value: value,
          onChangeText: onChangeText,
          placeholder: placeholder,
          keyboardType: keyboardType,
          secureTextEntry: secureTextEntry && !visible,
          style: [styles.input, secureTextEntry && {
            paddingRight: 76
          }],
          placeholderTextColor: "#9AA5BA",
          autoCapitalize: autoCapitalize || (secureTextEntry ? 'none' : 'sentences'),
          autoCorrect: autoCorrect === undefined ? !secureTextEntry : autoCorrect
        }, void 0), secureTextEntry ? /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.TouchableOpacity, {
          accessibilityRole: "button",
          accessibilityLabel: visible ? 'Hide password' : 'Show password',
          onPress: () => setVisible(value => !value),
          style: {
            position: 'absolute',
            right: 18,
            padding: 8
          },
          children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: {
              color: C.ink,
              fontWeight: '800'
            },
            children: visible ? 'Hide' : 'Show'
          }, void 0)
        }, void 0) : null]
      }, void 0)]
    }, void 0);
  }
  function Banner(_ref27) {
    var children = _ref27.children;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.View, {
      style: styles.banner,
      children: /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
        style: styles.bannerText,
        children: ["\u24D8  ", children]
      }, void 0)
    }, void 0);
  }
  function AmbientGlow(_ref28) {
    var style = _ref28.style;
    var pulse = (0, _react.useRef)(new _reactNative.Animated.Value(.72)).current;
    (0, _react.useEffect)(() => {
      var loop = _reactNative.Animated.loop(_reactNative.Animated.sequence([_reactNative.Animated.timing(pulse, {
        toValue: 1,
        duration: 2600,
        useNativeDriver: true
      }), _reactNative.Animated.timing(pulse, {
        toValue: .72,
        duration: 2600,
        useNativeDriver: true
      })]));
      loop.start();
      return () => loop.stop();
    }, [pulse]);
    return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Animated.View, {
      pointerEvents: "none",
      style: [{
        position: 'absolute',
        width: 230,
        height: 230,
        borderRadius: 120,
        backgroundColor: '#2563EB20',
        opacity: pulse,
        transform: [{
          scale: pulse
        }]
      }, style]
    }, void 0);
  }
  function Login(_ref29) {
    var phone = _ref29.phone,
      setPhone = _ref29.setPhone,
      password = _ref29.password,
      setPassword = _ref29.setPassword,
      remember = _ref29.remember,
      setRemember = _ref29.setRemember,
      onLogin = _ref29.onLogin,
      onRegister = _ref29.onRegister,
      onForgot = _ref29.onForgot,
      working = _ref29.working;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      style: {
        backgroundColor: C.pale
      },
      contentStyle: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 28,
        paddingVertical: 30
      },
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(AmbientGlow, {
        style: {
          top: 20,
          right: -105
        }
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(AmbientGlow, {
        style: {
          bottom: 70,
          left: -145,
          width: 270,
          height: 270,
          backgroundColor: '#22D3EE14'
        }
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
        style: {
          alignItems: 'center',
          marginBottom: 38
        },
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.View, {
          style: {
            width: 116,
            height: 116,
            borderRadius: 60,
            backgroundColor: C.card,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 25
          },
          children: /*#__PURE__*/_react.createElement(_reactNative.Image, { source: require('./assets/paisapay-customer-emblem.png'), resizeMode: 'contain', style: { width: 106, height: 106 } })
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: [styles.loginBrand, {
            color: C.ink,
            fontSize: 27
          }],
          children: "PaisaPay"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: {
            color: C.ink,
            fontSize: 20,
            fontWeight: '900',
            marginTop: 28
          },
          children: "Welcome Back!"
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Mobile number",
        value: phone,
        onChangeText: setPhone,
        placeholder: "10-digit mobile number",
        keyboardType: "phone-pad"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Password",
        value: password,
        onChangeText: setPassword,
        placeholder: "Enter your password",
        secureTextEntry: true
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.TouchableOpacity, {
        accessibilityRole: "checkbox",
        accessibilityState: {
          checked: remember
        },
        onPress: () => setRemember(!remember),
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 10,
          paddingVertical: 12,
          marginBottom: 4
        },
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.View, {
          style: {
            width: 22,
            height: 22,
            borderRadius: 4,
            borderWidth: 1.5,
            borderColor: C.navy,
            backgroundColor: remember ? C.navy : 'transparent',
            alignItems: 'center',
            justifyContent: 'center'
          },
          children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: {
              color: 'white',
              fontSize: 15,
              fontWeight: '900'
            },
            children: remember ? '✓' : ''
          }, void 0)
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: {
            color: C.ink,
            fontWeight: '700'
          },
          children: "Remember me"
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "LOGIN",
        disabled: working,
        style: {
          borderRadius: 32,
          paddingVertical: 18,
          marginTop: 8,
          elevation: 4,
          shadowColor: '#000',
          shadowOpacity: .16,
          shadowRadius: 8,
          shadowOffset: {
            width: 0,
            height: 4
          }
        },
        onPress: onLogin
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
        style: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 25
        },
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.TouchableOpacity, {
          accessibilityRole: "button",
          onPress: onRegister,
          children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: [styles.link, {
              color: C.ink
            }],
            children: "Register"
          }, void 0)
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.TouchableOpacity, {
          accessibilityRole: "button",
          onPress: onForgot,
          children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: [styles.link, {
              color: C.ink
            }],
            children: "Forgot Password?"
          }, void 0)
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: {
          color: C.muted,
          fontSize: 11,
          textAlign: 'center',
          marginTop: 18
        },
        children: "Remember me keeps your session and mobile number on this device. Your password is never saved."
      }, void 0)]
    }, void 0);
  }
  function PasswordReset(_ref30) {
    var phone = _ref30.phone,
      setPhone = _ref30.setPhone,
      working = _ref30.working,
      onBack = _ref30.onBack,
      onRequestCode = _ref30.onRequestCode,
      onReset = _ref30.onReset;
    var _useState77 = (0, _react.useState)(''),
      _useState78 = (0, _slicedToArray.default)(_useState77, 2),
      challengeId = _useState78[0],
      setChallengeId = _useState78[1];
    var _useState79 = (0, _react.useState)(''),
      _useState80 = (0, _slicedToArray.default)(_useState79, 2),
      code = _useState80[0],
      setCode = _useState80[1];
    var _useState81 = (0, _react.useState)(''),
      _useState82 = (0, _slicedToArray.default)(_useState81, 2),
      password = _useState82[0],
      setNewPassword = _useState82[1];
    var _useState83 = (0, _react.useState)(''),
      _useState84 = (0, _slicedToArray.default)(_useState83, 2),
      confirm = _useState84[0],
      setConfirm = _useState84[1];
    var _useState85 = (0, _react.useState)(0),
      _useState86 = (0, _slicedToArray.default)(_useState85, 2),
      secondsLeft = _useState86[0],
      setSecondsLeft = _useState86[1];
    var _useState87 = (0, _react.useState)(0),
      _useState88 = (0, _slicedToArray.default)(_useState87, 2),
      resendIn = _useState88[0],
      setResendIn = _useState88[1];
    var _useState89 = (0, _react.useState)(''),
      _useState90 = (0, _slicedToArray.default)(_useState89, 2),
      statusMessage = _useState90[0],
      setStatusMessage = _useState90[1];
    (0, _react.useEffect)(() => {
      if (!challengeId || secondsLeft <= 0) return;
      var timer = setTimeout(() => setSecondsLeft(value => Math.max(0, value - 1)), 1000);
      return () => clearTimeout(timer);
    }, [challengeId, secondsLeft]);
    (0, _react.useEffect)(() => {
      if (resendIn <= 0) return;
      var timer = setTimeout(() => setResendIn(value => Math.max(0, value - 1)), 1000);
      return () => clearTimeout(timer);
    }, [resendIn]);
    var request = /*#__PURE__*/function () {
      var _ref31 = (0, _asyncToGenerator.default)(function* () {
        var result = yield onRequestCode();
        if (result?.challengeId) {
          setChallengeId(result.challengeId);
          setCode('');
          setSecondsLeft(result.expiresInSeconds || 300);
          setResendIn(result.resendAfterSeconds || 60);
          setStatusMessage(result.message || 'Check your SMS for a password reset code.');
        }
      });
      return function request() {
        return _ref31.apply(this, arguments);
      };
    }();
    var submit = () => {
      if (!challengeId) return _reactNative.Alert.alert('Request reset code', 'Request a code first.');
      if (secondsLeft <= 0) return _reactNative.Alert.alert('Code expired', 'Request a new reset code.');
      if (code.length !== 6) return _reactNative.Alert.alert('Check code', 'Enter the six-digit OTP sent by SMS.');
      if (password.length < 8) return _reactNative.Alert.alert('Password too short', 'Choose at least 8 characters.');
      if (password !== confirm) return _reactNative.Alert.alert('Passwords do not match', 'Enter the same password in both fields.');
      onReset(challengeId, code, password);
    };
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      style: {
        backgroundColor: C.pale
      },
      contentStyle: {
        flexGrow: 1,
        paddingHorizontal: 25,
        paddingTop: 24,
        paddingBottom: 32
      },
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.TouchableOpacity, {
        accessibilityRole: "button",
        onPress: onBack,
        style: {
          paddingVertical: 8,
          alignSelf: 'flex-start'
        },
        children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: {
            fontSize: 30,
            color: C.ink
          },
          children: "\u2039"
        }, void 0)
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: {
          textAlign: 'center',
          fontSize: 25,
          fontWeight: '900',
          color: C.ink,
          marginBottom: 20
        },
        children: "Forgot Password"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "We send a one-time password reset code by SMS. Enter it here to change your PaisaPay password."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: { color: C.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 },
        children: "Reset uses the PaisaPay SMS OTP. Never share the code with anyone."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Mobile Number",
        value: phone,
        onChangeText: setPhone,
        placeholder: "Registered 10-digit mobile number",
        keyboardType: "phone-pad"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: challengeId ? resendIn > 0 ? `Resend OTP in ${resendIn}s` : secondsLeft > 0 ? 'Resend OTP' : 'Code expired · Send new OTP' : 'Send reset OTP',
        secondary: true,
        disabled: working || Boolean(challengeId) && resendIn > 0,
        onPress: request
      }, void 0), statusMessage ? /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: { color: C.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
        children: statusMessage
      }, void 0) : null, challengeId ? /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_react.Fragment, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "6-digit SMS OTP",
          value: code,
          onChangeText: value => setCode(value.replace(/\D/g, '').slice(0, 6)),
          placeholder: "Enter the SMS code",
          keyboardType: "number-pad"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: {
            color: secondsLeft > 0 ? C.muted : '#B42318',
            fontSize: 13,
            marginTop: -6,
            marginBottom: 12
          },
          children: secondsLeft > 0 ? `The code expires in ${secondsLeft} seconds.` : 'This code expired. Request a new code.'
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "New Password",
          value: password,
          onChangeText: setNewPassword,
          placeholder: "At least 8 characters",
          secureTextEntry: true
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "Confirm New Password",
          value: confirm,
          onChangeText: setConfirm,
          placeholder: "Enter password again",
          secureTextEntry: true
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: "Reset Password",
          disabled: working || secondsLeft <= 0,
          onPress: submit
        }, void 0)]
      }, void 0) : null, /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Back to Login",
        secondary: true,
        onPress: onBack
      }, void 0)]
    }, void 0);
  }
  function Register(_ref32) {
    var phone = _ref32.phone,
      setPhone = _ref32.setPhone,
      fullName = _ref32.fullName,
      setFullName = _ref32.setFullName,
      password = _ref32.password,
      setPassword = _ref32.setPassword,
      confirmPassword = _ref32.confirmPassword,
      setConfirmPassword = _ref32.setConfirmPassword,
      referralCode = _ref32.referralCode,
      setReferralCode = _ref32.setReferralCode,
      code = _ref32.code,
      setCode = _ref32.setCode,
      challengeId = _ref32.challengeId,
      working = _ref32.working,
      onRequestOtp = _ref32.onRequestOtp,
      onVerify = _ref32.onVerify,
      onBack = _ref32.onBack;
    var _useState87 = (0, _react.useState)(0),
      _useState88 = (0, _slicedToArray.default)(_useState87, 2),
      cooldown = _useState88[0],
      setCooldown = _useState88[1];
    (0, _react.useEffect)(() => {
      if (cooldown <= 0) return;
      var timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
      return () => clearTimeout(timer);
    }, [cooldown]);
    var request = /*#__PURE__*/function () {
      var _ref33 = (0, _asyncToGenerator.default)(function* () {
        var result = yield onRequestOtp();
        if (result) setCooldown(result.resendAfterSeconds || 60);
      });
      return function request() {
        return _ref33.apply(this, arguments);
      };
    }();
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      style: {
        backgroundColor: C.pale
      },
      contentStyle: {
        flexGrow: 1,
        paddingHorizontal: 25,
        paddingTop: 20,
        paddingBottom: 32
      },
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.TouchableOpacity, {
        accessibilityRole: "button",
        onPress: onBack,
        style: {
          paddingVertical: 8,
          alignSelf: 'flex-start'
        },
        children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: {
            fontSize: 30,
            color: C.ink
          },
          children: "\u2039"
        }, void 0)
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: {
          textAlign: 'center',
          fontSize: 25,
          fontWeight: '900',
          color: C.ink,
          marginBottom: 20
        },
        children: "Create Account"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Full Name",
        value: fullName,
        onChangeText: setFullName,
        placeholder: "Enter your full name"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Mobile Number",
        value: phone,
        onChangeText: setPhone,
        placeholder: "10-digit mobile number",
        keyboardType: "phone-pad"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Password",
        value: password,
        onChangeText: setPassword,
        placeholder: "At least 8 characters",
        secureTextEntry: true
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Confirm Password",
        value: confirmPassword,
        onChangeText: setConfirmPassword,
        placeholder: "Enter password again",
        secureTextEntry: true
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Referral Code (optional)",
        value: referralCode,
        onChangeText: setReferralCode,
        placeholder: "Enter a friend's code",
        autoCapitalize: "none",
        autoCorrect: false
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: challengeId ? cooldown ? `Resend OTP in ${cooldown}s` : 'Resend OTP' : 'Send OTP',
        disabled: working || cooldown > 0,
        secondary: true,
        onPress: request
      }, void 0), challengeId ? /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_react.Fragment, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "6-digit OTP",
          value: code,
          onChangeText: value => setCode(value.replace(/\D/g, '').slice(0, 6)),
          placeholder: "Enter the code",
          keyboardType: "number-pad"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: "Verify OTP and Register",
          disabled: working,
          onPress: onVerify
        }, void 0)]
      }, void 0) : null]
    }, void 0);
  }
  function Otp(_ref34) {
    var phone = _ref34.phone,
      onVerify = _ref34.onVerify,
      deliveryState = _ref34.deliveryState,
      onCheckDelivery = _ref34.onCheckDelivery;
    var _useState89 = (0, _react.useState)(''),
      _useState90 = (0, _slicedToArray.default)(_useState89, 2),
      otp = _useState90[0],
      setOtp = _useState90[1];
    var detail = {
      ACCEPTED: 'Gateway accepted the request. This does not confirm carrier delivery.',
      SENT: 'The gateway reports the SMS was sent to the carrier.',
      DELIVERED: 'The gateway reports the SMS was delivered.',
      FAILED: 'The gateway reports SMS sending failed.',
      UNKNOWN: 'The gateway has not confirmed a delivery state.'
    }[deliveryState] || 'Check delivery state with the gateway.';
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Verify mobile",
        sub: `Verification code for +91 ${phone}`
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: detail
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Check SMS status",
        secondary: true,
        onPress: onCheckDelivery
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Verification code",
        value: otp,
        onChangeText: setOtp,
        placeholder: "6-digit code",
        keyboardType: "number-pad"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Verify and continue",
        onPress: () => otp.length === 6 ? onVerify(otp) : _reactNative.Alert.alert('Check code', 'Enter six digits.')
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: styles.small,
        children: "Never enter a payment app password or OTP."
      }, void 0)]
    }, void 0);
  }
  function Profile(_ref35) {
    var name = _ref35.name,
      setName = _ref35.setName,
      referralCode = _ref35.referralCode,
      setReferralCode = _ref35.setReferralCode,
      onSave = _ref35.onSave;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Your profile",
        sub: "Finish setting up your PaisaPay account."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Name",
        value: name,
        onChangeText: setName,
        placeholder: "Your name"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Referral code (optional)",
        value: referralCode,
        onChangeText: setReferralCode,
        placeholder: "Enter a referral code"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Save profile",
        onPress: onSave
      }, void 0)]
    }, void 0);
  }
  function Home(props) {
    return _react.createElement(_ultraHome.default, { ...props, colors: C });
  }
  function Deposit(props) {
    return _react.createElement(_depositScreen.default, { ...props, colors: C });
  }
  function LegacyUpiSetup(_ref41) {
    var upiProfile = _ref41.upiProfile,
      upiInput = _ref41.upiInput,
      setUpiInput = _ref41.setUpiInput,
      upiNameInput = _ref41.upiNameInput,
      setUpiNameInput = _ref41.setUpiNameInput,
      saveUpiId = _ref41.saveUpiId,
      removeUpiId = _ref41.removeUpiId,
      working = _ref41.working,
      go = _ref41.go;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "UPI settings",
        sub: "Enter the account name shown in your UPI app and your UPI ID. Check both before saving."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.cardTitle,
          children: "UPI account details"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "Account name",
          value: upiNameInput,
          onChangeText: setUpiNameInput,
          placeholder: "Name shown in your UPI app",
          autoCapitalize: "words",
          autoCorrect: false
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "UPI ID",
          value: upiInput,
          onChangeText: setUpiInput,
          placeholder: "example@bank — check carefully",
          autoCapitalize: "none",
          autoCorrect: false
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
          style: styles.small,
          children: ["UPI details: ", upiProfile?.detailsStatus === 'USER_CONFIRMED' ? 'SAVED · READY FOR P2P OFFERS' : 'NOT SET']
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: working ? 'Saving…' : 'Save UPI details',
          disabled: working || !upiInput.trim() || !upiNameInput.trim(),
          onPress: saveUpiId
        }, void 0), upiProfile?.upiId && /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: "Remove UPI ID",
          secondary: true,
          disabled: working,
          onPress: removeUpiId
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.cardTitle,
          children: "Payment methods"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.bodyText,
          children: "PaisaPay UPI deposits open the Android UPI app chooser. MobiKwik wallet linking and Buy/Sell integration have been removed."
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: "Add money with UPI",
          onPress: () => go('Deposit')
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "Before saving, check that the account name and UPI ID exactly match the details shown in your UPI app. Saving these details does not verify ownership or confirm that they are correct. Never enter a UPI PIN, banking password, or payment OTP in PaisaPay."
      }, void 0)]
    }, void 0);
  }
  function UpiSetup(props) {
    return _react.createElement(_upiSetupScreen.default, { ...props, colors: C });
  }
  function Orders(_ref42) {
    var methods = _ref42.methods,
      screen = _ref42.screen,
      orders = _ref42.orders,
      go = _ref42.go,
      onSelect = _ref42.onSelect;
    var type = screen.startsWith('Buy') ? 'Buy' : 'Sell';
    var rows = orders.filter(o => o.kind === type && (type !== 'Buy' || methods.some(m => m.name === o.method && m.available && m.buy)));
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: type + " orders",
        sub: "Payment methods appear only when the backend reports them available."
      }, void 0), type === 'Buy' && /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.cardTitle,
          children: "No active wallet payment integration"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.bodyText,
          children: "MobiKwik linking and payment integration have been removed. No other approved Buy provider is configured."
        }, void 0)]
      }, void 0), type === 'Sell' && /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Create Sell order",
        onPress: () => go('Create Sell Order')
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
        style: styles.wrap,
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Chip, {
          label: "Buy",
          active: type === 'Buy',
          onPress: () => go('Buy Orders')
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Chip, {
          label: "Sell",
          active: type === 'Sell',
          onPress: () => go('Sell Orders')
        }, void 0)]
      }, void 0), rows.map(o => /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        style: {
          marginBottom: 12
        },
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
          style: styles.space,
          children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: styles.cardTitle,
            children: o.id
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Status, {
            status: o.status
          }, void 0)]
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.orderAmount,
          children: money(o.amountPaise)
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
          style: styles.bodyText,
          children: [o.method, " \xB7 ", type === 'Sell' ? "Seller " + o.seller : 'Payment route unavailable']
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
          style: styles.small,
          children: ["Expires in ", o.expires, " \xB7 Created just now"]
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: o.status === 'Available' ? 'View order' : o.status,
          disabled: o.status !== 'Available',
          onPress: () => onSelect(o)
        }, void 0)]
      }, o.id)), rows.length === 0 && /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Empty, {
        title: 'No ' + type.toLowerCase() + ' orders',
        body: type === 'Buy' ? 'No eligible verified Buy payment method is available.' : 'There are no eligible orders available from the server.'
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "Payment completion and wallet credit require backend verification. A mobile-app response alone is not payment proof."
      }, void 0)]
    }, void 0);
  }
  function CreateSellOrder(_ref43) {
    var methods = _ref43.methods,
      amount = _ref43.amount,
      setAmount = _ref43.setAmount,
      method = _ref43.method,
      setMethod = _ref43.setMethod,
      create = _ref43.create;
    var rule = methods.find(m => m.name === method);
    var available = Boolean(rule?.available && rule.sell);
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Create Sell order",
        sub: "New orders require an approved, operational payment integration."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Amount (whole rupees)",
        value: amount,
        onChangeText: setAmount,
        placeholder: "\u20B910 \u2013 \u20B950,000",
        keyboardType: "number-pad"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: styles.sectionTitle,
        children: "Payment method"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.View, {
        style: styles.wrap,
        children: methods.filter(m => m.sell).map(m => /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Chip, {
          label: m.name,
          active: method === m.name,
          onPress: () => setMethod(m.name)
        }, m.name))
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Card, {
        children: /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
          style: styles.bodyText,
          children: [available ? 'The selected method is approved and operational for Sell orders.' : rule?.availabilityMessage || 'No approved, operational Sell provider is configured. This order will not be published.', " A payment route must be able to verify settlement."]
        }, void 0)
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Create Sell order",
        disabled: !available,
        onPress: create
      }, void 0)]
    }, void 0);
  }
  function OrderDetails(_ref44) {
    var order = _ref44.order,
      go = _ref44.go,
      note = _ref44.note,
      reserve = _ref44.reserve;
    if (!order) return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Page, {
      children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Empty, {
        title: "Order not found",
        body: "Return to the order list."
      }, void 0)
    }, void 0);
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Order details",
        sub: order.id
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
          style: styles.space,
          children: [/*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
            style: styles.cardTitle,
            children: [order.kind, " order"]
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Status, {
            status: order.status
          }, void 0)]
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.orderAmount,
          children: money(order.amountPaise)
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Row, {
          title: "Payment method",
          sub: order.method
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Row, {
          title: "Seller / destination",
          sub: order.seller
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Row, {
          title: "Expiry",
          sub: `In ${order.expires}`
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Row, {
          title: "Payment status",
          sub: "Not submitted"
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "No payment is initiated or verified by this app. An order cannot be marked paid without authorized payment confirmation."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Reserve order",
        disabled: order.status !== 'Available',
        onPress: () => reserve(order)
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Back to orders",
        secondary: true,
        onPress: () => go(order.kind === 'Buy' ? 'Buy Orders' : 'Sell Orders')
      }, void 0)]
    }, void 0);
  }
  function Status(_ref45) {
    var status = _ref45.status;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
      style: [styles.status, {
        color: status === 'Available' ? C.green : C.gold
      }],
      children: status
    }, void 0);
  }
  function Team(_ref46) {
    var referrals = _ref46.referrals,
      go = _ref46.go;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "My team",
        sub: "Referral counts and eligible commission from your account."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.View, {
        style: styles.twoCol,
        children: [['Direct members', String(referrals?.directCount ?? 0)], ['Indirect members', String(referrals?.indirectCount ?? 0)], ['Eligible commission', money(referrals?.eligibleCommissionPaise ?? 0)]].map(_ref47 => {
          var _ref48 = (0, _slicedToArray.default)(_ref47, 2),
            label = _ref48[0],
            value = _ref48[1];
          return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
            style: {
              width: '48%'
            },
            children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
              style: styles.muted,
              children: label
            }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
              style: styles.metric,
              children: value
            }, void 0)]
          }, label);
        })
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "View members",
        onPress: () => go('Members')
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Share referral code",
        secondary: true,
        onPress: () => go('Share & Earn')
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "Commission is shown only when a qualifying funded award exists in the server records."
      }, void 0)]
    }, void 0);
  }
  function Members(_ref49) {
    var members = _ref49.members;
    var _useState91 = (0, _react.useState)(''),
      _useState92 = (0, _slicedToArray.default)(_useState91, 2),
      q = _useState92[0],
      setQ = _useState92[1];
    var filtered = members.filter(m => `${m.displayName || ''} ${m.permittedIdentifier || ''}`.toLowerCase().includes(q.toLowerCase()));
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Members",
        sub: "Only display name and masked phone are shown."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
        label: "Search permitted identifier",
        value: q,
        onChangeText: setQ,
        placeholder: "Name or masked phone"
      }, void 0), filtered.length ? filtered.map(m => /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Row, {
        title: m.displayName || 'PaisaPay member',
        sub: `${m.permittedIdentifier} · ${m.depth === 1 ? 'Direct' : 'Indirect'} · ${new Date(m.joinedAt).toLocaleDateString()}`,
        amount: ""
      }, m.id)) : /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Empty, {
        title: "No members found",
        body: "No matching referral members were returned by the server."
      }, void 0)]
    }, void 0);
  }
  function ShareEarn(_ref50) {
    var code = _ref50.code;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Share & Earn",
        sub: "Your referral status is managed by the server."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.muted,
          children: "YOUR REFERRAL CODE"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.refCode,
          children: code || 'Unavailable'
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.bodyText,
          children: "A public referral link is not configured yet."
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: "Share referral code",
          disabled: !code,
          onPress: () => _reactNative.Share.share({
            message: `Join PaisaPay with referral code ${code}`
          })
        }, void 0)]
      }, void 0), code && /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        style: {
          alignItems: 'center'
        },
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(QRCode.default, {
          value: code,
          size: 160,
          color: C.navy,
          backgroundColor: "white"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: [styles.muted, {
            marginTop: 12
          }],
          children: "Referral code QR"
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "Referral rewards and referral reporting are not implemented. No reward is being promised or credited."
      }, void 0)]
    }, void 0);
  }
  function Tasks() {
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Daily tasks",
        sub: "Tasks and rewards are not configured."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Empty, {
        title: "No tasks available",
        body: "A task appears here only after the backend validates its conditions and funding."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "No reward can be claimed now."
      }, void 0)]
    }, void 0);
  }
  function Mine(props) {
    return /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_profileScreen.default, {
      name: props.name,
      accountId: props.accountId,
      balance: props.balance,
      status: props.status,
      avatarId: props.avatarId,
      onSaveName: props.onSaveName,
      onSelectAvatar: props.onSelectAvatar,
      go: props.go,
      logout: props.logout,
      note: props.note,
      themeMode: props.themeMode,
      onThemeChange: props.onThemeChange,
      colors: C
    }, void 0);
  }
  function Bills(props) {
    return _react.createElement(_ultraActivity.default, { ...props, colors: C });
  }
  function History(_ref55) {
    var rows = _ref55.rows,
      empty = _ref55.empty,
      note = _ref55.note,
      onRefresh = _ref55.onRefresh,
      upiReceiver = _ref55.upiReceiver;
    var _useState93 = (0, _react.useState)(null),
      _useState94 = (0, _slicedToArray.default)(_useState93, 2),
      checkingId = _useState94[0],
      setCheckingId = _useState94[1];
    var _useState95 = (0, _react.useState)({}),
      _useState96 = (0, _slicedToArray.default)(_useState95, 2),
      claimRefs = _useState96[0],
      setClaimRefs = _useState96[1];
    var submitManualClaim = /*#__PURE__*/function () {
      var _ref56 = (0, _asyncToGenerator.default)(function* (row) {
        var transactionReference = claimRefs[row.id]?.trim();
        if (!transactionReference) return note('Reference required', 'Enter the reference shown by your bank/payment provider.');
        try {
          setCheckingId(row.id);
          var result = yield (0, _srcApi.apiPost)(`/api/v1/deposits/${encodeURIComponent(row.id)}/manual-verification`, {
            transactionReference
          });
          note('Claim submitted', result.message);
          setClaimRefs(current => ({
            ...current,
            [row.id]: ''
          }));
          yield onRefresh?.();
        } catch (error) {
          note('Claim not submitted', error.message || 'Try again or contact support.');
        } finally {
          setCheckingId(null);
        }
      });
      return function submitManualClaim(_x11) {
        return _ref56.apply(this, arguments);
      };
    }();
    var copyReceiver = /*#__PURE__*/function () {
      var _ref57 = (0, _asyncToGenerator.default)(function* () {
        var receiver = upiReceiver;
        if (!receiver) return note('UPI recipient unavailable', 'PaisaPay has not configured a payment recipient. Do not make a payment.');
        try {
          yield Clipboard.setStringAsync(receiver);
          note('Copied', 'Receiver UPI ID copied.');
        } catch {
          note('Receiver UPI ID', receiver);
        }
      });
      return function copyReceiver() {
        return _ref57.apply(this, arguments);
      };
    }();
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Deposit history",
        sub: "Requests and user-submitted references are not proof of payment."
      }, void 0), rows.length ? rows.map(r => /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        style: {
          marginBottom: 9
        },
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Row, {
          title: r.id,
          sub: `${r.method} · ${r.status}`,
          amount: money(r.amountPaise)
        }, void 0), r.method === 'UPI' && ['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(r.status) && upiReceiver && /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
          style: {
            alignItems: 'center',
            paddingVertical: 12
          },
          children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: styles.cardTitle,
            children: "Scan to pay PaisaPay"
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.View, {
            style: {
              padding: 12,
              backgroundColor: '#FFFFFF',
              marginVertical: 10
            },
            children: /*#__PURE__*/((0, _reactJsxRuntime.jsx))(QRCode.default, {
              value: makeUpiIntent(upiReceiver, r.amountPaise, r.merchantReference),
              size: 176
            }, void 0)
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
            style: styles.bodyText,
            children: ["Receiver: ", upiReceiver]
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
            style: styles.small,
            children: ["Reference: ", r.merchantReference]
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
            title: "Copy receiver UPI ID",
            secondary: true,
            onPress: copyReceiver
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: styles.small,
            children: "Status stays pending until Finance verifies merchant receipt."
          }, void 0)]
        }, void 0), r.method === 'UPI' && /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_react.Fragment, {
          children: [/*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
            style: styles.small,
            children: ["Manual review: ", r.manualPaymentClaim?.status || 'No reference submitted']
          }, void 0), r.manualPaymentClaim?.status === 'PENDING_REVIEW' ? /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: styles.bodyText,
            children: "Finance is reviewing merchant records. This deposit is not yet verified."
          }, void 0) : ['CREATED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(r.status) && /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_react.Fragment, {
            children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
              label: "Transaction reference (unverified claim)",
              value: claimRefs[r.id] || '',
              onChangeText: value => setClaimRefs(current => ({
                ...current,
                [r.id]: value
              })),
              placeholder: "Reference from payment statement",
              autoCapitalize: "none",
              autoCorrect: false
            }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
              title: checkingId === r.id ? 'Submitting…' : 'Submit reference for manual review',
              disabled: checkingId === r.id,
              secondary: true,
              onPress: () => submitManualClaim(r)
            }, void 0)]
          }, void 0)]
        }, void 0)]
      }, r.id)) : /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Empty, {
        title: empty,
        body: "No payments have been made."
      }, void 0)]
    }, void 0);
  }
  function BankAccounts(_ref58) {
    var accounts = _ref58.accounts,
      onAdd = _ref58.onAdd,
      onUpdate = _ref58.onUpdate,
      onRemove = _ref58.onRemove,
      working = _ref58.working;
    var _useState97 = (0, _react.useState)(''),
      _useState98 = (0, _slicedToArray.default)(_useState97, 2),
      holder = _useState98[0],
      setHolder = _useState98[1];
    var _useState99 = (0, _react.useState)(''),
      _useState100 = (0, _slicedToArray.default)(_useState99, 2),
      number = _useState100[0],
      setNumber = _useState100[1];
    var _useState101 = (0, _react.useState)(''),
      _useState102 = (0, _slicedToArray.default)(_useState101, 2),
      confirm = _useState102[0],
      setConfirm = _useState102[1];
    var _useState103 = (0, _react.useState)(''),
      _useState104 = (0, _slicedToArray.default)(_useState103, 2),
      ifsc = _useState104[0],
      setIfsc = _useState104[1];
    var _useState105 = (0, _react.useState)(''),
      _useState106 = (0, _slicedToArray.default)(_useState105, 2),
      bank = _useState106[0],
      setBank = _useState106[1];
    var _useState107 = (0, _react.useState)(''),
      _useState108 = (0, _slicedToArray.default)(_useState107, 2),
      editing = _useState108[0],
      setEditing = _useState108[1];
    var _useState109 = (0, _react.useState)(''),
      _useState110 = (0, _slicedToArray.default)(_useState109, 2),
      editHolder = _useState110[0],
      setEditHolder = _useState110[1];
    var _useState111 = (0, _react.useState)(''),
      _useState112 = (0, _slicedToArray.default)(_useState111, 2),
      editIfsc = _useState112[0],
      setEditIfsc = _useState112[1];
    var _useState113 = (0, _react.useState)(''),
      _useState114 = (0, _slicedToArray.default)(_useState113, 2),
      editBank = _useState114[0],
      setEditBank = _useState114[1];
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Bank accounts",
        sub: "Account numbers are encrypted on the server and masked here."
      }, void 0), accounts.map(account => /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.cardTitle,
          children: account.accountHolderName
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
          style: styles.bodyText,
          children: [account.bankName || 'Bank', " \xB7 ", account.maskedAccountNumber]
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.Text, {
          style: styles.bodyText,
          children: ["IFSC ", account.ifsc, " \xB7 ", account.verificationStatus]
        }, void 0), editing === account.id ? /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_react.Fragment, {
          children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
            label: "Account holder name",
            value: editHolder,
            onChangeText: setEditHolder
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
            label: "Bank name",
            value: editBank,
            onChangeText: setEditBank
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
            label: "IFSC code",
            value: editIfsc,
            onChangeText: setEditIfsc,
            autoCapitalize: "characters"
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
            title: "Save changes",
            disabled: working,
            onPress: /*#__PURE__*/(0, _asyncToGenerator.default)(function* () {
              yield onUpdate(account.id, {
                accountHolderName: editHolder.trim(),
                bankName: editBank.trim() || null,
                ifsc: editIfsc.trim().toUpperCase()
              });
              setEditing('');
            })
          }, void 0)]
        }, void 0) : /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: "Edit details",
          secondary: true,
          disabled: working,
          onPress: () => {
            setEditing(account.id);
            setEditHolder(account.accountHolderName);
            setEditBank(account.bankName || '');
            setEditIfsc(account.ifsc);
          }
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: "Remove account",
          secondary: true,
          disabled: working,
          onPress: () => onRemove(account.id)
        }, void 0)]
      }, account.id)), !accounts.length && /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Empty, {
        title: "No saved bank accounts",
        body: "Add an account to keep its masked details in PaisaPay. Saving details does not verify ownership."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.cardTitle,
          children: "Add bank account"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "Account holder name",
          value: holder,
          onChangeText: setHolder,
          placeholder: "Name on account"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "Bank account number",
          value: number,
          onChangeText: setNumber,
          placeholder: "8\u201320 digits",
          keyboardType: "number-pad"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "Confirm account number",
          value: confirm,
          onChangeText: setConfirm,
          placeholder: "Re-enter account number",
          keyboardType: "number-pad"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "IFSC code",
          value: ifsc,
          onChangeText: setIfsc,
          placeholder: "ABCD0123456",
          autoCapitalize: "characters"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "Bank name (optional)",
          value: bank,
          onChangeText: setBank,
          placeholder: "Bank name"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: working ? 'Saving…' : 'Save bank account',
          disabled: working,
          onPress: () => onAdd({
            accountHolderName: holder.trim(),
            accountNumber: number,
            confirmAccountNumber: confirm,
            ifsc: ifsc.trim().toUpperCase(),
            ...(bank.trim() ? {
              bankName: bank.trim()
            } : {})
          })
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "Format validation does not confirm account ownership. Bank verification and payouts are unavailable until an authorized provider is configured."
      }, void 0)]
    }, void 0);
  }
  function Withdraw(props) {
    return _react.createElement(_withdrawalScreen.default, { ...props, colors: C });
  }
  function Support(_ref61) {
    var tickets = _ref61.tickets,
      setTickets = _ref61.setTickets,
      note = _ref61.note,
      supportContext = _ref61.supportContext;
    var _useState115 = (0, _react.useState)(supportContext && supportContext.subject || ''),
      _useState116 = (0, _slicedToArray.default)(_useState115, 2),
      subject = _useState116[0],
      setSubject = _useState116[1];
    var _useState117 = (0, _react.useState)(supportContext && supportContext.message || ''),
      _useState118 = (0, _slicedToArray.default)(_useState117, 2),
      message = _useState118[0],
      setMessage = _useState118[1];
    var submit = /*#__PURE__*/function () {
      var _ref62 = (0, _asyncToGenerator.default)(function* () {
        if (!subject.trim() || !message.trim()) return note('Add details', 'Enter a subject and message.');
        try {
          var x = yield (0, _srcApi.apiPost)('/api/v1/support/tickets', {
            subject,
            message
          });
          var ticket = {
            id: x.ticket.id,
            subject: x.ticket.subject,
            status: x.ticket.status
          };
          setTickets(rows => [ticket, ...rows]);
          setSubject('');
          setMessage('');
          note('Ticket created', 'Your support request was saved.');
        } catch (e) {
          note('Could not create ticket', e.message || 'Check the API connection.');
        }
      });
      return function submit() {
        return _ref62.apply(this, arguments);
      };
    }();
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Support",
        sub: "Create a support ticket for the support team."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.cardTitle,
          children: "Create a support ticket"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "Subject",
          value: subject,
          onChangeText: setSubject,
          placeholder: "How can we help?"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Field, {
          label: "Details",
          value: message,
          onChangeText: setMessage,
          placeholder: "Describe the issue"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
          title: "Submit ticket",
          onPress: submit
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Contact PaisaPay on Telegram",
        secondary: true,
        onPress: () => _reactNative.Linking.openURL('https://t.me/Paisapayservice').catch(() => note('Could not open Telegram', 'Open https://t.me/Paisapayservice in your browser.'))
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "FAQs",
        secondary: true,
        onPress: () => note('FAQs', 'See Mine → FAQs for common questions.')
      }, void 0), tickets.map(t => /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Row, {
        title: t.subject,
        sub: `${t.id} · ${t.status}`,
        amount: t.status
      }, t.id)), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "Do not include bank credentials, payment-app passwords, OTPs, or sensitive financial information."
      }, void 0)]
    }, void 0);
  }
  function NotificationList(_ref63) {
    var rows = _ref63.rows;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Notifications",
        sub: "Updates delivered for your account."
      }, void 0), rows.length ? rows.map(n => /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Row, {
        title: n.title,
        sub: `${n.body} · ${new Date(n.createdAt).toLocaleString()}`,
        amount: n.readAt ? 'Read' : 'New'
      }, n.id)) : /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Empty, {
        title: "No notifications",
        body: "There are no account notifications from the server yet."
      }, void 0)]
    }, void 0);
  }
  function FAQs() {
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Frequently asked questions",
        sub: "PaisaPay account and payment information"
      }, void 0), [['Is this a real wallet?', 'This app displays the server ledger. Deposit and payout processing is disabled until an approved provider is connected.'], ['Can I make a deposit?', 'You may record a pending deposit request. No payment starts and no money is credited in this release.'], ['Are payment apps connected?', 'No. Saving a UPI reference does not connect the payment app or provide transaction access.'], ['How are orders verified?', 'Payment verification and settlement are disabled until a provider can confirm the transaction.'], ['How do I contact support?', 'Create a support ticket in the Support section.']].map(_ref64 => {
        var _ref65 = (0, _slicedToArray.default)(_ref64, 2),
          q = _ref65[0],
          a = _ref65[1];
        return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
          style: {
            marginBottom: 9
          },
          children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: styles.cardTitle,
            children: q
          }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
            style: styles.bodyText,
            children: a
          }, void 0)]
        }, q);
      })]
    }, void 0);
  }
  function Security(_ref66) {
    var note = _ref66.note;
    var onResetPassword = _ref66.onResetPassword;
    var onLogout = _ref66.onLogout;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Security",
        sub: "Verification codes are sent through the configured PaisaPay SMS service. Never share your code."
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.cardTitle,
          children: "Account protection"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.bodyText,
          children: "Sign in with your mobile number and password. If you need to change it, PaisaPay verifies your registered number with a one-time SMS code."
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.small,
          children: "No payment app credentials should ever be entered into PaisaPay."
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Reset login password by SMS",
        onPress: onResetPassword
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Button, {
        title: "Sign out this device",
        secondary: true,
        onPress: onLogout
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "A separate transaction PIN and device session manager are not available. Do not use this build for real-money payments."
      }, void 0)]
    }, void 0);
  }
  function Version() {
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Page, {
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(Title, {
        title: "Version Center",
        sub: "Official release information"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.cardTitle,
          children: "PaisaPay Demo"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.bodyText,
          children: "Installed version \xB7 1.0.0"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.bodyText,
          children: "Latest version \xB7 Not available"
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.bodyText,
          children: "PaisaPay customer app"
        }, void 0)]
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(Banner, {
        children: "No APK is published. A production APK needs signed releases, HTTPS hosting, and signature verification."
      }, void 0)]
    }, void 0);
  }
  function Empty(_ref67) {
    var title = _ref67.title,
      body = _ref67.body;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(Card, {
      style: {
        alignItems: 'center',
        paddingVertical: 30
      },
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: {
          fontSize: 32,
          color: C.blue
        },
        children: "\u25C8"
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: styles.cardTitle,
        children: title
      }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: [styles.bodyText, {
          textAlign: 'center'
        }],
        children: body
      }, void 0)]
    }, void 0);
  }
  function Row(_ref68) {
    var title = _ref68.title,
      sub = _ref68.sub,
      amount = _ref68.amount;
    return /*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
      style: styles.row,
      children: [/*#__PURE__*/((0, _reactJsxRuntime.jsxs))(_reactNative.View, {
        style: {
          flex: 1
        },
        children: [/*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.cardTitle,
          children: title
        }, void 0), /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
          style: styles.small,
          children: sub
        }, void 0)]
      }, void 0), !!amount && /*#__PURE__*/((0, _reactJsxRuntime.jsx))(_reactNative.Text, {
        style: styles.rowAmount,
        children: amount
      }, void 0)]
    }, void 0);
  }
  var createStyles = () => _reactNative.StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: C.bg
    },
    header: {
      height: 60,
      backgroundColor: C.navy,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      gap: 14
    },
    brand: {
      color: 'white',
      fontWeight: '900',
      fontSize: 18,
      flex: 1
    },
    demoTag: {
      color: C.warningText,
      fontWeight: '800',
      fontSize: 11,
      borderColor: '#475569',
      borderWidth: 1,
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 5
    },
    back: {
      fontSize: 30,
      color: 'white'
    },
    body: {
      flex: 1
    },
    page: {
      padding: 17,
      paddingBottom: 32
    },
    title: {
      fontSize: 25,
      color: C.ink,
      fontWeight: '900',
      letterSpacing: -.4
    },
    subtitle: {
      fontSize: 13,
      color: C.muted,
      marginTop: 4,
      lineHeight: 18
    },
    loginHero: {
      backgroundColor: C.navy,
      borderRadius: 24,
      padding: 24,
      alignItems: 'center',
      marginBottom: 26,
      marginTop: 8
    },
    loginBrand: {
      color: 'white',
      fontWeight: '900',
      fontSize: 30,
      marginVertical: 2
    },
    fieldLabel: {
      color: C.ink,
      fontSize: 13,
      fontWeight: '700',
      marginBottom: 6
    },
    input: {
      backgroundColor: C.surface,
      borderWidth: 1,
      borderColor: C.line,
      borderRadius: 13,
      paddingHorizontal: 14,
      paddingVertical: 13,
      color: C.ink,
      fontSize: 16
    },
    button: {
      backgroundColor: C.blue,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      marginTop: 10
    },
    buttonSecondary: {
      backgroundColor: C.softSurface,
      borderColor: C.line,
      borderWidth: 1
    },
    buttonText: {
      color: 'white',
      fontSize: 15,
      fontWeight: '800'
    },
    buttonTextSecondary: {
      color: C.blue
    },
    banner: {
      backgroundColor: C.warningSurface,
      padding: 13,
      borderRadius: 14,
      marginTop: 14
    },
    bannerText: {
      color: C.warningText,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '600'
    },
    small: {
      fontSize: 12,
      color: C.muted,
      lineHeight: 18,
      marginTop: 6
    },
    muted: {
      fontSize: 13,
      color: C.muted
    },
    card: {
      backgroundColor: C.card,
      borderRadius: 21,
      padding: 17,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: C.line
    },
    cardTitle: {
      fontSize: 15,
      color: C.ink,
      fontWeight: '800'
    },
    bodyText: {
      fontSize: 13,
      color: C.textSecondary,
      lineHeight: 20,
      marginTop: 6
    },
    hero: {
      backgroundColor: C.navy,
      borderColor: '#234A77',
      borderWidth: 1,
      borderRadius: 24,
      padding: 21,
      marginBottom: 20,
      elevation: 8,
      shadowColor: '#000',
      shadowOpacity: .2,
      shadowRadius: 14,
      shadowOffset: {
        width: 0,
        height: 8
      }
    },
    heroEyebrow: {
      color: C.textSecondary,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.2
    },
    heroAmount: {
      color: 'white',
      fontSize: 34,
      fontWeight: '900',
      marginTop: 6
    },
    heroSub: {
      color: C.textSecondary,
      fontSize: 10,
      letterSpacing: .7,
      marginTop: 2
    },
    heroRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 19
    },
    heroAction: {
      flex: 1,
      backgroundColor: '#FFFFFF12',
      padding: 12,
      borderRadius: 12,
      alignItems: 'center'
    },
    heroActionText: {
      color: 'white',
      fontWeight: '800'
    },
    sectionTitle: {
      fontSize: 17,
      color: C.ink,
      fontWeight: '900',
      marginBottom: 10
    },
    sectionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
      marginTop: 4
    },
    link: {
      color: C.blue,
      fontWeight: '700'
    },
    quickGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: 12
    },
    quick: {
      width: '23.7%',
      height: 80,
      backgroundColor: C.card,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 9,
      borderWidth: 1,
      borderColor: C.line
    },
    quickIcon: {
      fontSize: 22,
      color: C.blue,
      fontWeight: '800',
      marginBottom: 7
    },
    quickText: {
      fontSize: 10,
      color: C.ink,
      fontWeight: '700',
      textAlign: 'center'
    },
    nav: {
      height: 76,
      marginHorizontal: 12,
      marginBottom: 4,
      borderRadius: 24,
      backgroundColor: C.surface,
      borderColor: C.line,
      borderWidth: 1,
      elevation: 10,
      shadowColor: '#000',
      shadowOpacity: .18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center'
    },
    navItem: {
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      minWidth: 54,
      minHeight: 64,
      borderRadius: 17,
      paddingVertical: 5
    },
    navItemActive: {
      backgroundColor: '#DCEBFF'
    },
    navIcon: {
      fontSize: 23,
      color: C.muted
    },
    navLabel: {
      fontSize: 11,
      color: C.muted,
      marginTop: 2
    },
    navActive: {
      color: '#22D3EE',
      fontWeight: '900'
    },
    balanceMini: {
      backgroundColor: C.surface,
      borderColor: C.line,
      borderWidth: 1,
      borderRadius: 20
    },
    balanceMiniAmount: {
      fontSize: 26,
      fontWeight: '900',
      color: C.ink,
      marginTop: 4
    },
    wrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginVertical: 10
    },
    chip: {
      borderWidth: 1,
      borderColor: C.line,
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: 30,
      backgroundColor: C.card
    },
    chipActive: {
      backgroundColor: C.navy,
      borderColor: C.navy
    },
    chipText: {
      color: C.ink,
      fontWeight: '700',
      fontSize: 12
    },
    chipTextActive: {
      color: 'white'
    },
    space: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    status: {
      fontWeight: '800',
      fontSize: 12
    },
    statusUnavailable: {
      color: C.red,
      fontWeight: '800',
      fontSize: 11
    },
    orderAmount: {
      fontSize: 25,
      color: C.ink,
      fontWeight: '900',
      marginTop: 10
    },
    twoCol: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between'
    },
    metric: {
      fontSize: 22,
      fontWeight: '900',
      color: C.ink,
      marginTop: 8
    },
    gold: {
      color: '#F59E0B',
      fontWeight: '800',
      marginTop: 8
    },
    profile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 14
    },
    avatar: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: C.softSurface,
      alignItems: 'center',
      justifyContent: 'center'
    },
    menuRow: {
      backgroundColor: C.card,
      borderRadius: 13,
      padding: 15,
      marginBottom: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderColor: C.line,
      borderWidth: 1
    },
    row: {
      backgroundColor: C.card,
      padding: 14,
      borderRadius: 14,
      marginBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      borderColor: C.line,
      borderWidth: 1
    },
    rowAmount: {
      fontWeight: '800',
      color: C.ink,
      marginLeft: 8
    },
    refCode: {
      fontSize: 24,
      fontWeight: '900',
      color: C.blue,
      marginTop: 6,
      marginBottom: 4
    },
    marketHeading: {
      marginTop: 8,
      marginBottom: 8
    },
    marketCard: {
      backgroundColor: C.card,
      borderRadius: 20,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: C.line,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11
    },
    marketLogo: {
      width: 54,
      height: 54,
      borderRadius: 18,
      backgroundColor: C.softSurface,
      alignItems: 'center',
      justifyContent: 'center'
    },
    marketLogoText: {
      fontWeight: '900',
      color: C.textSecondary
    },
    marketTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6
    },
    marketReference: {
      fontSize: 12,
      color: C.muted,
      marginTop: 5
    },
    marketUnavailable: {
      fontSize: 11,
      color: '#EF4444',
      fontWeight: '700',
      marginTop: 3
    },
    capBuy: {
      fontSize: 10,
      color: '#22C55E',
      backgroundColor: C.successSurface,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 8,
      fontWeight: '800'
    },
    capSell: {
      fontSize: 10,
      color: '#22D3EE',
      backgroundColor: C.accentSurface,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 8,
      fontWeight: '800'
    },
    walletAccountCard: {
      borderRadius: 22,
      padding: 10,
      marginBottom: 13
    },
    walletFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingTop: 1
    },
    offlineIndicator: {
      color: '#F59E0B',
      fontWeight: '800',
      fontSize: 12
    },
    withdrawDisabled: {
      color: C.muted,
      fontSize: 12
    },
    boosterCard: {
      borderRadius: 20,
      padding: 17
    },
    boosterTitle: {
      color: C.ink,
      fontWeight: '900',
      fontSize: 15,
      flex: 1
    },
    boosterCount: {
      color: C.muted,
      fontWeight: '700',
      fontSize: 12,
      marginLeft: 24
    },
    boosterLock: {
      color: C.warningText,
      fontWeight: '800',
      fontSize: 11
    },
    boosterDescription: {
      color: C.muted,
      fontSize: 12,
      marginTop: 14
    },
    modalShade: {
      flex: 1,
      backgroundColor: '#0008',
      justifyContent: 'flex-end'
    },
    sheet: {
      height: '84%',
      backgroundColor: C.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      padding: 20,
      paddingBottom: 0
    },
    detailsSheet: {
      height: '76%',
      backgroundColor: C.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      padding: 20
    },
    sheetHandle: {
      width: 54,
      height: 5,
      backgroundColor: C.line,
      borderRadius: 4,
      alignSelf: 'center',
      marginBottom: 22
    },
    sheetTitle: {
      fontSize: 22,
      color: C.ink,
      fontWeight: '900'
    },
    closeX: {
      fontSize: 32,
      color: C.muted,
      lineHeight: 34,
      paddingHorizontal: 5
    },
    categoryTabs: {
      flexDirection: 'row',
      gap: 7,
      marginTop: 15,
      marginBottom: 9
    },
    categoryTab: {
      paddingVertical: 9,
      paddingHorizontal: 10,
      borderRadius: 18,
      backgroundColor: C.softSurface
    },
    categoryTabActive: {
      backgroundColor: '#1D4ED8'
    },
    categoryText: {
      color: C.muted,
      fontWeight: '700',
      fontSize: 11
    },
    categoryTextActive: {
      color: C.white
    },
    stepRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginVertical: 22
    },
    stepItem: {
      alignItems: 'center',
      gap: 5
    },
    stepCircle: {
      width: 38,
      height: 38,
      borderRadius: 20,
      borderWidth: 2,
      borderColor: C.line,
      alignItems: 'center',
      justifyContent: 'center'
    },
    stepCircleCurrent: {
      backgroundColor: '#2563EB',
      borderColor: '#2563EB'
    },
    stepNumber: {
      color: C.muted,
      fontWeight: '900'
    }
  });
  var styles = createStyles();
