// Ingest-time line sanitizers (28-deployment-logs.md). Applied once before a line
// is buffered/persisted: strip ANSI, make valid UTF-8 (Postgres `text` rejects
// invalid UTF-8 and would abort the batch INSERT), clamp pathological lines, then
// redact secrets. Pure.

// CSI escape sequences: ESC '[' (params) (intermediates) final-byte.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI, "");
}

/** Replace invalid UTF-8 (lone surrogates) with U+FFFD by round-tripping bytes. */
export function sanitizeUtf8(input: string): string {
  return Buffer.from(input, "utf8").toString("utf8");
}

/** Truncate to maxBytes (UTF-8) with an explicit marker so a minified/base64 line
 *  can't bloat a row. */
export function clampLineBytes(input: string, maxBytes: number): string {
  const buf = Buffer.from(input, "utf8");
  if (buf.length <= maxBytes) return input;
  const head = buf.subarray(0, maxBytes).toString("utf8");
  return `${head}…[clamped ${buf.length - maxBytes} bytes]`;
}

export interface RawLine {
  stream: number; // 0=stdout 1=stderr 2=system
  text: string;
}

export interface PreparedLine {
  stream: number;
  seq: number;
  line: string;
}

export interface PrepareOptions {
  maxLineBytes: number;
  redact?: (line: string) => string;
}

/** Full ingest transform: strip ANSI → sanitize UTF-8 → clamp → redact. */
export function prepareLine(raw: RawLine, seq: number, opts: PrepareOptions): PreparedLine {
  let line = stripAnsi(raw.text);
  line = sanitizeUtf8(line);
  line = clampLineBytes(line, opts.maxLineBytes);
  if (opts.redact) line = opts.redact(line);
  return { stream: raw.stream, seq, line };
}
