// Graceful shutdown (platform-review C2). Nothing used to handle SIGTERM/SIGINT,
// so `docker stop` / `systemctl stop` SIGKILLed the process: pg-boss never
// drained, the dbStudio pools and the pg-bridge LISTEN connection were left
// open, and no onClose hook ran. This drains once, bounded by a watchdog so a
// stuck drain can't wedge the service stop (in-flight deploys are intentionally
// NOT awaited — the executor's row survives and `sweepStaleDeployments` finalizes
// it on the next boot).

export interface ShutdownDeps {
  /** The Fastify app; `close()` runs the onClose hooks (queue graceful-stop, dbStudio pool close). */
  app: { close: () => Promise<unknown> };
  /** Background loops started after `listen` that own their own resources (metrics collector, pg-bridge). */
  stops?: Array<() => void | Promise<void>>;
  /** Hard cap before forcing exit. Well under systemd's DefaultTimeoutStopSec (90s). */
  timeoutMs?: number;
  exit?: (code: number) => void;
  log?: (msg: string) => void;
  errorLog?: (msg: string) => void;
}

/**
 * Run one graceful shutdown: stop the background loops, then `app.close()`, all
 * under a watchdog. Resolves after `exit` is called (exit(0) on a clean drain,
 * exit(1) on error or timeout). A background stopper that throws is logged and
 * skipped — it must never block the rest of the drain.
 */
export async function runShutdown(deps: ShutdownDeps): Promise<void> {
  const exit = deps.exit ?? ((c: number) => process.exit(c));
  const log = deps.log ?? ((m: string) => console.log(m));
  const errorLog = deps.errorLog ?? ((m: string) => console.error(m));
  const timeoutMs = deps.timeoutMs ?? 25_000;

  const watchdog = setTimeout(() => {
    errorLog("graceful shutdown timed out — forcing exit");
    exit(1);
  }, timeoutMs);
  watchdog.unref?.();

  try {
    for (const stop of deps.stops ?? []) {
      try {
        await stop();
      } catch (err) {
        errorLog(`background stop failed during shutdown: ${(err as Error).message}`);
      }
    }
    await deps.app.close();
    clearTimeout(watchdog);
    log("shutdown complete");
    exit(0);
  } catch (err) {
    clearTimeout(watchdog);
    errorLog(`error during shutdown: ${(err as Error).message}`);
    exit(1);
  }
}

/**
 * Wire SIGTERM + SIGINT to a single-flight graceful shutdown. A second signal
 * forces an immediate exit, so twice-Ctrl+C (or an impatient supervisor) always
 * gets out even if a drain is hung.
 */
export function installShutdownHandlers(deps: ShutdownDeps): void {
  let shuttingDown = false;
  const handle = (signal: string): void => {
    if (shuttingDown) {
      console.error(`${signal} received again — forcing exit`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`${signal} received — draining queue, connections, and background jobs…`);
    void runShutdown(deps);
  };
  process.on("SIGTERM", () => handle("SIGTERM"));
  process.on("SIGINT", () => handle("SIGINT"));
}
