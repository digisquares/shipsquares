import type { ToolEvent } from "./loop.js";

// Redact secret-bearing tool I/O before it is PERSISTED to conversation history
// (H4). Tool events are stored in messages.toolEvents (plain jsonb) and returned
// to any `app:read` member via listMessages, so plaintext secrets there — set_env's
// `secret:true` values (otherwise sealed + masked everywhere) and create_mailbox's
// one-time password (in the result) — would leak far past their normal sealed
// path. The LIVE streamed/returned copy to the requesting owner is left intact
// (that IS the "shown once" surface); only the stored copy is scrubbed.

const MASK = "***redacted***";

// Tools whose RESULT carries a one-time secret that must not be persisted.
const SECRET_RESULT_TOOLS = new Set(["create_mailbox"]);

// A value under one of these keys is a secret — but a *…Ref*/*…Id* is an opaque
// reference to the secret store (11), not the secret itself, so keep those.
const SECRET_KEY_RE = /pass(word)?|secret|token|api[-_]?key|private[-_]?key|credential/i;
const REFERENCE_KEY_RE = /(ref|id)$/i;

function redactValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      // Only mask a *string* secret value — a boolean like set_env's `secret:true`
      // flag key also matches the name heuristic but is metadata, not a secret.
      const isSecret =
        typeof val === "string" && SECRET_KEY_RE.test(k) && !REFERENCE_KEY_RE.test(k);
      out[k] = isSecret ? MASK : redactValue(val);
    }
    return out;
  }
  return v;
}

// set_env carries `vars: [{ key, value, secret }]`; the field names don't match
// the key heuristic, so mask the value of any var flagged secret specifically.
function redactSetEnvInput(input: Record<string, unknown>): Record<string, unknown> {
  const vars = input.vars;
  if (!Array.isArray(vars)) return input;
  return {
    ...input,
    vars: vars.map((entry) =>
      entry && typeof entry === "object" && (entry as { secret?: unknown }).secret === true
        ? { ...(entry as Record<string, unknown>), value: MASK }
        : entry,
    ),
  };
}

export function redactToolEventForStorage(ev: ToolEvent): ToolEvent {
  let input = redactValue(ev.input) as Record<string, unknown>;
  if (ev.tool === "set_env") input = redactSetEnvInput(input);
  const result = SECRET_RESULT_TOOLS.has(ev.tool)
    ? "[redacted — one-time secret shown once in the live response, not stored]"
    : ev.result;
  return { ...ev, input, result };
}

export function redactToolEventsForStorage(events: ToolEvent[]): ToolEvent[] {
  return events.map(redactToolEventForStorage);
}
