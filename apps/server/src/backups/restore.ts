import { shq, type S3Destination } from "./commands.js";
import {
  chownDirCommand,
  containerRecoveryConfig,
  parsePgVersion,
  pgIsInRecoveryCommand,
  restoreBundleCommand,
  restoreContainerRunCommand,
  stageWalCommand,
} from "./pitr.js";

// Automated PITR restore into a FRESH postgres container — never touches the
// source. Stage the base + WAL locally, write the recovery config, hand the data
// dir to the image's uid (999, via a root helper container), start postgres
// pointed at it, then poll until it has replayed WAL to the target and promoted.
// exec + sleep are injected so the orchestration is unit-tested; the service
// binds runCommand + the staging paths. Best-effort: never throws.

export interface ExecResult {
  code: number;
  timedOut?: boolean;
  lines: { stream: string; line: string }[];
}

export interface RestoreSpec {
  dest: S3Destination;
  baseLocation: string;
  walPrefix: string;
  /** host dir (under the writable /var/lib/shipsquares); data/ + wal/ live here */
  stagingDir: string;
  containerName: string;
  port: number;
  targetTime?: string;
  /** recovery poll attempts (× 2s); default 60 → ~2 min */
  pollAttempts?: number;
}

export interface RestoreDeps {
  exec: (command: string) => Promise<ExecResult>;
  sleep: (ms: number) => Promise<void>;
}

export interface RestoreResult {
  ok: boolean;
  container?: string;
  port?: number;
  pgVersion?: string;
  recovered?: boolean;
  error?: string;
}

const stdoutOf = (r: ExecResult): string =>
  r.lines
    .filter((l) => l.stream === "stdout")
    .map((l) => l.line)
    .join("\n");

const errTail = (r: ExecResult): string =>
  r.lines
    .filter((l) => l.stream === "stderr")
    .slice(-5)
    .map((l) => l.line)
    .join("\n");

export async function runRestore(spec: RestoreSpec, deps: RestoreDeps): Promise<RestoreResult> {
  const data = `${spec.stagingDir}/data`;
  const wal = `${spec.stagingDir}/wal`;
  const unpack = `${spec.stagingDir}/unpack`;
  const tbs = `${spec.stagingDir}/tbs`;
  try {
    // 1. fresh staging dirs
    let r = await deps.exec(`rm -rf ${shq(spec.stagingDir)} && mkdir -p ${shq(data)} ${shq(wal)}`);
    if (r.code !== 0) return { ok: false, error: `staging failed: ${errTail(r)}` };

    // 2. download + unpack the base bundle (main data dir + each tablespace tar,
    //    rewriting tablespace_map to the in-container /tbs mounts)
    r = await deps.exec(restoreBundleCommand(spec.dest, spec.baseLocation, data, unpack, tbs));
    if (r.code !== 0) return { ok: false, error: `base download/extract failed: ${errTail(r)}` };

    // 3. the restore image must match the source major version
    r = await deps.exec(`cat ${shq(`${data}/PG_VERSION`)}`);
    const pgVersion = r.code === 0 ? parsePgVersion(stdoutOf(r)) : null;
    if (!pgVersion) return { ok: false, error: `could not read PG_VERSION: ${errTail(r)}` };

    // 4. stage the archived WAL (segments + .history)
    r = await deps.exec(stageWalCommand(spec.dest, spec.walPrefix, wal));
    if (r.code !== 0) return { ok: false, pgVersion, error: `wal staging failed: ${errTail(r)}` };

    // 5. recovery config + signal (heredoc keeps the restore_command quotes intact)
    const conf = containerRecoveryConfig(spec.targetTime);
    r = await deps.exec(
      `cat >> ${shq(`${data}/postgresql.auto.conf`)} <<'PGEOF'\n${conf}PGEOF\n` +
        `touch ${shq(`${data}/recovery.signal`)}`,
    );
    if (r.code !== 0)
      return { ok: false, pgVersion, error: `writing recovery config failed: ${errTail(r)}` };

    // 6. hand the whole staging (data + wal + tablespaces) to the image's uid
    r = await deps.exec(chownDirCommand(spec.stagingDir));
    if (r.code !== 0) return { ok: false, pgVersion, error: `chown failed: ${errTail(r)}` };

    // 7. start the restore container (replacing any stale one)
    await deps.exec(`docker rm -f ${shq(spec.containerName)}`);
    r = await deps.exec(
      restoreContainerRunCommand(
        spec.containerName,
        data,
        wal,
        tbs,
        spec.port,
        `postgres:${pgVersion}`,
      ),
    );
    if (r.code !== 0)
      return { ok: false, pgVersion, error: `starting restore container failed: ${errTail(r)}` };

    // 8. poll until it has promoted (out of recovery)
    const attempts = spec.pollAttempts ?? 60;
    for (let i = 0; i < attempts; i += 1) {
      await deps.sleep(2000);
      const p = await deps.exec(pgIsInRecoveryCommand(spec.containerName));
      if (p.code === 0 && stdoutOf(p).trim().startsWith("f")) {
        return {
          ok: true,
          container: spec.containerName,
          port: spec.port,
          pgVersion,
          recovered: true,
        };
      }
    }
    return {
      ok: false,
      container: spec.containerName,
      port: spec.port,
      pgVersion,
      recovered: false,
      error: "restore container did not finish recovery in time",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
