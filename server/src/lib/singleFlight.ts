/** Wrap a scheduled task so overlapping timer ticks share one in-flight execution. */
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T | undefined> {
  let running = false;
  return async () => {
    if (running) return undefined;
    running = true;
    try {
      return await task();
    } finally {
      running = false;
    }
  };
}
