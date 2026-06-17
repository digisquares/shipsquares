import { shq } from "../backups/commands.js";

// Scheduled-job core (29-scheduled-jobs.md), adapted from Dokploy's schedule
// model + executor (Apache-2.0, see NOTICE + 35-reuse-map.md), run on pg-boss
// cron instead of their node-schedule/BullMQ. Pure: command composition,
// cron validation, queue naming, and run-output clamping.

const CRON_FIELD = /^[\d*,/-]+$/;

/** 5-field cron (pg-boss). Numeric fields with * , - / — no month/day names. */
export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((f) => f.length > 0 && CRON_FIELD.test(f));
}

/** One pg-boss queue per schedule so cron registration is individually addressable. */
export function scheduleQueueName(jobId: string): string {
  return `schedule:${jobId}`;
}

/** Expand one cron field to its matching values (or null if malformed). Supports
 *  a wildcard, a number, a range `a-b`, a list `a,b,c`, and step syntax `a-b/n`. */
function cronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    let range = part;
    let step = 1;
    const slash = part.indexOf("/");
    if (slash !== -1) {
      step = Number(part.slice(slash + 1));
      range = part.slice(0, slash);
      if (!Number.isInteger(step) || step < 1) return null;
    }
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(range);
      hi = lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      return null;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Next UTC fire time of a 5-field cron strictly after `after` (schedules run with
 *  tz=UTC), or null for a malformed expr / none within ~366 days. Pure — minute
 *  stepping, good enough for "next run" status display. dow 0 and 7 are Sunday;
 *  when both day-of-month and day-of-week are restricted a day matches EITHER. */
export function nextCronRun(expr: string, after: Date): Date | null {
  if (!isValidCron(expr)) return null;
  const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
  const minutes = cronField(m!, 0, 59);
  const hours = cronField(h!, 0, 23);
  const days = cronField(dom!, 1, 31);
  const months = cronField(mon!, 1, 12);
  const weekdays = cronField(dow!, 0, 7);
  if (!minutes || !hours || !days || !months || !weekdays) return null;
  const domR = dom !== "*";
  const dowR = dow !== "*";
  const d = new Date(Math.floor(after.getTime() / 60000) * 60000 + 60000); // next whole minute
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    const wd = d.getUTCDay();
    const dowMatch = weekdays.has(wd) || (wd === 0 && weekdays.has(7));
    const dayOk =
      domR && dowR ? days.has(d.getUTCDate()) || dowMatch : days.has(d.getUTCDate()) && dowMatch;
    if (
      minutes.has(d.getUTCMinutes()) &&
      hours.has(d.getUTCHours()) &&
      months.has(d.getUTCMonth() + 1) &&
      dayOk
    ) {
      return d;
    }
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}

const SHELLS = ["bash", "sh"] as const;

export interface JobExecSpec {
  target: "app_container" | "service" | "server";
  /** required for container targets — the resolved container name */
  container?: string;
  shell: string;
  command: string;
}

/** The shell line a run executes. App targets exec inside the container with
 *  the user command single-quoted (injection stays inert — tested); server
 *  targets run the command on the host as-is. */
export function jobExecCommand(spec: JobExecSpec): string {
  if (spec.target === "server") return spec.command;
  if (!(SHELLS as readonly string[]).includes(spec.shell)) {
    throw new Error(`unsupported shell "${spec.shell}" — use bash or sh`);
  }
  return `docker exec ${shq(spec.container ?? "")} ${spec.shell} -c ${shq(spec.command)}`;
}

/** Last `maxLines` lines, byte-clamped from the FRONT (the tail is what
 *  diagnoses a failure) — feeds scheduled_job_runs.output_tail. */
export function tailOutput(lines: string[], maxLines: number, maxBytes: number): string {
  let out = lines.slice(-maxLines).join("\n");
  if (Buffer.byteLength(out, "utf8") > maxBytes) {
    const buf = Buffer.from(out, "utf8");
    out = buf.subarray(buf.length - maxBytes).toString("utf8");
  }
  return out;
}
