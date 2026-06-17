import { prepareLine } from "../deployment-logs/sanitize.js";

// Resilient deployment-log ingest (28-deployment-logs.md): the
// executor used to `await db.insert` per line behind a discarded promise — one
// rejected INSERT (transient DB error, invalid UTF-8) was an unhandled rejection
// that could kill the process. This writer sanitizes each line once
// (ANSI-strip → UTF-8 → clamp → redact), publishes to the realtime bus
// immediately, and batches DB writes on a serialized chain whose failures are
// reported, never thrown.

export type LogStream = "stdout" | "stderr" | "system";

export interface LogRow {
  deploymentId: string;
  stepId: string;
  seq: number;
  stream: LogStream;
  line: string;
  at: Date;
}

export interface LogWriterDeps {
  deploymentId: string;
  /** batched INSERT; rejections are caught and routed to onError */
  insert: (rows: LogRow[]) => Promise<void>;
  /** immediate realtime fan-out (not batched) */
  publish: (row: LogRow) => void;
  /** called once per failed flush */
  onError?: (err: unknown) => void;
  /** applied at ingest (e.g. clone-token redaction) */
  redact?: (line: string) => string;
  maxLineBytes?: number;
  batchSize?: number;
  flushMs?: number;
  now?: () => Date;
}

export interface LogWriter {
  write(stepId: string, stream: LogStream, line: string): void;
  /** lines accepted so far (drives deployments.log_line_count) */
  count(): number;
  /** drain the queue; resolves when all flushes settle — never rejects */
  close(): Promise<void>;
}

const STREAM_NUM: Record<LogStream, number> = { stdout: 0, stderr: 1, system: 2 };
const DEFAULT_MAX_LINE_BYTES = 8192;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_MS = 250;

export function createLogWriter(deps: LogWriterDeps): LogWriter {
  const maxLineBytes = deps.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const flushMs = deps.flushMs ?? DEFAULT_FLUSH_MS;
  const now = deps.now ?? (() => new Date());

  let seq = 0;
  let queue: LogRow[] = [];
  let chain: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | null = null;

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue.length === 0) return chain;
    const rows = queue;
    queue = [];
    chain = chain
      .then(() => deps.insert(rows))
      .catch((err: unknown) => {
        deps.onError?.(err);
      });
    return chain;
  };

  return {
    write(stepId, stream, line) {
      seq += 1;
      const prepared = prepareLine(
        { stream: STREAM_NUM[stream], text: line },
        seq,
        deps.redact ? { maxLineBytes, redact: deps.redact } : { maxLineBytes },
      );
      const row: LogRow = {
        deploymentId: deps.deploymentId,
        stepId,
        seq,
        stream,
        line: prepared.line,
        at: now(),
      };
      deps.publish(row);
      queue.push(row);
      if (queue.length >= batchSize) void flush();
      else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          void flush();
        }, flushMs);
      }
    },
    count: () => seq,
    close: () => flush(),
  };
}

/** A mutable substring redactor: register secrets as they're minted (e.g. the
 *  clone token) and every later log line has them replaced at ingest. */
export function createRedactor(): {
  add: (secret: string) => void;
  redact: (line: string) => string;
} {
  const secrets = new Set<string>();
  return {
    add(secret) {
      if (secret && secret.length >= 4) secrets.add(secret);
    },
    redact(line) {
      let out = line;
      for (const s of secrets) out = out.split(s).join("[redacted]");
      return out;
    },
  };
}
