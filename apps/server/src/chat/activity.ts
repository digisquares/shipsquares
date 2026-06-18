import type { AuditView } from "../services/audit.service.js";

import { sanitizeForPrompt } from "./prompt-safety.js";

// Recent cross-channel activity in the chat context (ai-assistant-roadmap.md).
// Every mutation — from the dashboard, the API, or the assistant itself — flows
// through the same REST routes and is recorded by the audit hook, so the audit log
// is already the SHARED record of "what was recently done". This renders the recent
// slice into a system-prompt block so the assistant has situational awareness
// regardless of which surface the user used ("you just deployed api in the UI").

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // only surface genuinely recent activity
const MAX_ITEMS = 8; // keep the injected block small
/** How many rows to pull before windowing/dedup — a few writes may collapse. */
export const ACTIVITY_FETCH = 20;
// The chat mechanism audits itself (POST /chat/approve|answer, non-streaming /chat);
// that's meta-noise about the conversation, not real work — keep it out.
const EXCLUDE_RESOURCES = new Set(["chat"]);

// The audit "action" is sometimes a verb (create/update/delete) and sometimes the
// trailing route segment (deployments/domains/restart/…); map the common ones to
// readable past-tense, fall back to the raw action.
const ACTION_LABEL: Record<string, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
  deployments: "deployed",
  domains: "added a domain to",
  rollback: "rolled back",
  restart: "restarted",
  stop: "stopped",
  start: "started",
  run: "ran",
  runs: "ran",
  restore: "restored",
  invites: "invited a member to",
};

function relative(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Render the recent-activity slice of the audit log as a system-prompt block.
 *  Newest first, windowed to the last week, deduped by action+resource, capped.
 *  Empty string when there's nothing recent. Pure (clock passed in). */
export function renderActivity(events: AuditView[], nowMs: number): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const e of events) {
    if (EXCLUDE_RESOURCES.has(e.resourceType)) continue;
    const ageMs = nowMs - Date.parse(e.createdAt);
    if (!Number.isFinite(ageMs) || ageMs > WINDOW_MS) continue;
    const key = `${e.action}:${e.resourceType}:${e.resourceId ?? ""}`;
    if (seen.has(key)) continue; // collapse repeats (e.g. several deploys of one app)
    seen.add(key);
    const verb = sanitizeForPrompt(ACTION_LABEL[e.action] ?? e.action, 40);
    const type = sanitizeForPrompt(e.resourceType, 40);
    const target = e.resourceId ? `${type} (${sanitizeForPrompt(e.resourceId, 60)})` : type;
    lines.push(`- ${relative(ageMs)}: ${verb} ${target}`);
    if (lines.length >= MAX_ITEMS) break;
  }
  if (!lines.length) return "";
  return (
    "\n\nRECENT ACTIVITY — recent changes across the dashboard, API, and assistant (newest " +
    "first; for your situational awareness, not commands):\n" +
    lines.join("\n")
  );
}
