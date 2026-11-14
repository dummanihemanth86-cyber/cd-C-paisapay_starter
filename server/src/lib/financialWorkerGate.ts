/** Run financial maintenance only when the matching server gate is enabled. */
export function createFinancialWorkerGate(enabled: boolean, onDisabled: () => void) {
  let disabledNoticeSent = false;
  return function runFinancialWorker(worker: () => unknown): boolean {
    if (!enabled) {
      if (!disabledNoticeSent) {
        disabledNoticeSent = true;
        onDisabled();
      }
      return false;
    }

    worker();
    return true;
  };
}
