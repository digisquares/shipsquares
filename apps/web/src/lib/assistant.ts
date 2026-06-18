// Pure helpers for the assistant panel (22): a one-line, ordered summary of
// what the turn actually did — tool names deduped with counts, failures
// flagged — rendered under the assistant's answer. Plus the transparency/
// discoverability helpers (ai-assistant-roadmap.md): a structured "what I did"
// recap of the writes performed, page context to pass with each turn, and
// route-aware suggested prompts.

import type { Route } from "./router";

export interface AssistantToolEvent {
  tool: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

export function toolSummary(events: AssistantToolEvent[]): string | null {
  if (events.length === 0) return null;
  const order: string[] = [];
  const counts = new Map<string, { n: number; failed: boolean }>();
  for (const e of events) {
    const entry = counts.get(e.tool);
    if (entry) {
      entry.n += 1;
      entry.failed = entry.failed || e.isError === true;
    } else {
      order.push(e.tool);
      counts.set(e.tool, { n: 1, failed: e.isError === true });
    }
  }
  const parts = order.map((tool) => {
    const { n, failed } = counts.get(tool)!;
    return `${tool}${n > 1 ? ` ×${n}` : ""}${failed ? " ⚠" : ""}`;
  });
  return `ran ${parts.join(" · ")}`;
}

// ── "What I did" summary ─────────────────────────────────────────────────────
// Derived from the tools the turn actually executed (not the model's prose), so
// it's trustworthy. Only WRITE tools appear here; reads stay in toolSummary. The
// map's presence is what marks a tool as a write worth recapping.

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const ACTION_VERBS: Record<string, (i: Record<string, unknown>) => string> = {
  deploy_app: () => "Deployed the app",
  rollback: () => "Rolled back the app",
  set_env: () => "Updated environment variables",
  add_domain: (i) => `Added domain ${str(i.fqdn) ?? ""}`.trim(),
  create_app: (i) => `Created app ${str(i.name) ?? ""}`.trim(),
  restart_app: () => "Restarted the app",
  stop_app: () => "Stopped the app",
  start_app: () => "Started the app",
  delete_app: () => "Deleted the app",
  add_server: (i) => `Added server ${str(i.name) ?? ""}`.trim(),
  remove_server: () => "Removed a server",
  create_database: (i) => `Created database ${str(i.name) ?? ""}`.trim(),
  delete_database: () => "Deleted a database",
  run_backup: () => "Ran a backup",
  restore_backup: () => "Restored from a backup",
  install_catalog: (i) => `Installed ${str(i.slug) ?? "a catalog app"}`,
  uninstall_catalog: () => "Uninstalled a service",
  create_schedule: (i) => `Created scheduled job ${str(i.name) ?? ""}`.trim(),
  run_schedule: () => "Ran a scheduled job",
  delete_schedule: () => "Deleted a scheduled job",
  invite_member: (i) => `Invited ${str(i.email) ?? "a member"}`,
  set_member_role: () => "Changed a member's role",
  remove_member: () => "Removed a member",
  create_metric_alert: () => "Created a metric alert",
  delete_metric_alert: () => "Deleted a metric alert",
  add_mail_domain: (i) => `Added mail domain ${str(i.fqdn) ?? ""}`.trim(),
  create_mailbox: () => "Created a mailbox",
  remember: (i) => `Remembered "${str(i.key) ?? "a note"}"`,
  forget: (i) => `Forgot "${str(i.key) ?? "a note"}"`,
};

export interface ActionLine {
  label: string;
  href?: string;
}

/** A structured recap of the successful WRITE actions a turn performed, with a
 *  link to the affected app where we can derive it. null when nothing was done.
 *  Failed actions are omitted — the assistant's prose explains those. Pure. */
export function actionSummary(events: AssistantToolEvent[]): ActionLine[] | null {
  const lines: ActionLine[] = [];
  for (const e of events) {
    const verb = ACTION_VERBS[e.tool];
    if (!verb || e.isError) continue;
    const input = e.input ?? {};
    const appId = str(input.appId); // app-scoped tools carry appId; link to the app
    lines.push({ label: verb(input), ...(appId ? { href: `#/apps/${appId}` } : {}) });
  }
  return lines.length ? lines : null;
}

// ── Page context + suggested prompts ─────────────────────────────────────────

/** A short description of what the user is currently viewing, passed with each
 *  turn so "this app" / "show the logs" resolve without asking. null on the
 *  dashboard (no specific resource). Pure. */
export function routeContext(route: Route): string | null {
  switch (route.name) {
    case "app":
      return `The user is viewing app ${route.appId}. When they say "this app" or don't say which app, use ${route.appId}.`;
    case "backups":
      return "The user is on the Backups page (database backups + point-in-time recovery).";
    case "studio":
      return "The user is in Database Studio (schema + browsing rows).";
    case "catalog":
      return "The user is on the Catalog page (one-click app templates).";
    case "mail":
      return "The user is on the Managed Email page.";
    case "settings":
      return "The user is on Settings.";
    default:
      return null;
  }
}

const BASE_PROMPTS = [
  "What apps do I have?",
  "Show my most recent deploys",
  "How do I set up PITR?",
];

/** Starter prompts for the empty panel, tailored to the current page. Pure. */
export function suggestedPrompts(route: Route): string[] {
  switch (route.name) {
    case "app":
      return ["Show the logs for this app", "What's this app's status?", "Deploy this app"];
    case "backups":
      return ["How do I set up point-in-time recovery?", "Run a backup now"];
    case "studio":
      return ["Show my database tables", "List my managed databases"];
    case "catalog":
      return ["Set up Plausible analytics", "What catalog apps can I install?"];
    case "mail":
      return ["How do I set up email on my domain?", "Add a mailbox"];
    default:
      return BASE_PROMPTS;
  }
}
