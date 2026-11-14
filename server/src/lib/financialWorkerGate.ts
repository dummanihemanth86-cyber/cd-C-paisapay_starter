/** Gate scheduled background jobs that can mutate financial records. */
export function financialBackgroundWorkEnabled(financialOperationsEnabled: boolean, manualUpiOperationsEnabled: boolean): boolean {
  return financialOperationsEnabled || manualUpiOperationsEnabled;
}

export function createFinancialWorkerGate(enabled: boolean, onDisabled: () => void) {
  let disabledNoticeLogged = false;

  return (runWorker: () => void): boolean => {
    if (!enabled) {
      if (!disabledNoticeLogged) {
        disabledNoticeLogged = true;
        onDisabled();
      }
      return false;
    }

    runWorker();
    return true;
  };
}
