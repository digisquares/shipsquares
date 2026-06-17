// Minimal in-process async mutex: serialize critical sections (e.g. Caddy
// converge — two racing full-config loads could apply stale state last). The
// chain swallows predecessors' errors so one failed run never blocks the next.
export interface Mutex {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createMutex(): Mutex {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = chain.then(
        () => fn(),
        () => fn(),
      );
      chain = result.catch(() => undefined);
      return result;
    },
  };
}
