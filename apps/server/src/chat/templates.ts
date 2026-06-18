import type { AnthropicToolDef } from "./anthropic.js";
import type { InputField } from "./elicitation.js";

// Guided templates (ai-multistep-conversations.md Phase D): known-good recipes for
// the common setup tasks — what details to ask for (request_input fields) and the
// plan skeleton (propose_plan steps) — so the assistant takes the fast, correct
// path for the 80% cases while free-form chat still covers the rest. Exposed via
// the `guided_template` tool; the result is TRUSTED reference data (our own static
// catalog), so the loop feeds it back unfenced and the model adapts it.

export interface GuidedStep {
  description: string;
  tool: string;
}

export interface GuidedTemplate {
  id: string;
  title: string;
  summary: string;
  /** Phrases that hint the user wants this guide (for the model's matching). */
  triggers: string[];
  /** Read tools to call FIRST, to fill in choices and avoid asking the user. */
  discover?: string[];
  /** Recommended fields to pass to request_input (adapt to the request). */
  fields: InputField[];
  /** Recommended ordered steps to pass to propose_plan. */
  steps: GuidedStep[];
}

export const GUIDED_TEMPLATES: GuidedTemplate[] = [
  {
    id: "docker-hub-app",
    title: "Deploy an app from a Docker Hub image",
    summary: "Create an app from a public Docker Hub image, then optionally expose it on a domain.",
    triggers: ["docker hub", "dockerhub", "docker image", "from an image", "run a container image"],
    discover: ["list_servers"],
    fields: [
      { key: "image", label: "Docker image", type: "string", placeholder: "e.g. nginx" },
      { key: "tag", label: "Tag", type: "string", default: "latest" },
      { key: "name", label: "App name", type: "string" },
      { key: "port", label: "Container port", type: "integer", placeholder: "e.g. 80" },
      {
        key: "serverId",
        label: "Server",
        type: "string",
        placeholder: "which server (run list_servers; offer the choices)",
      },
      { key: "domain", label: "Custom domain", type: "string", required: false },
    ],
    steps: [
      { description: "Create the app from the image", tool: "create_app" },
      { description: "Add the custom domain (only if one was given)", tool: "add_domain" },
    ],
  },
  {
    id: "git-repo-app",
    title: "Deploy an app from a Git repo",
    summary: "Create an app from a Git repository, deploy it, and optionally add a domain.",
    triggers: ["from git", "git repo", "from my repo", "github repo", "deploy my code"],
    discover: ["list_servers"],
    fields: [
      { key: "repo", label: "Repository URL", type: "string" },
      { key: "branch", label: "Branch", type: "string", default: "main" },
      { key: "name", label: "App name", type: "string" },
      { key: "port", label: "App port", type: "integer", required: false },
      {
        key: "serverId",
        label: "Server",
        type: "string",
        placeholder: "which server (run list_servers; offer the choices)",
      },
      { key: "domain", label: "Custom domain", type: "string", required: false },
    ],
    steps: [
      { description: "Create the app from the repo", tool: "create_app" },
      { description: "Trigger the first deployment", tool: "deploy_app" },
      { description: "Add the custom domain (only if one was given)", tool: "add_domain" },
    ],
  },
  {
    id: "catalog-app",
    title: "Install a one-click catalog app (e.g. Plausible)",
    summary: "Find a catalog template by name and install it as a managed service.",
    triggers: ["plausible", "umami", "uptime kuma", "install", "one-click", "catalog app"],
    discover: ["list_catalog"],
    fields: [
      {
        key: "slug",
        label: "Catalog slug",
        type: "string",
        placeholder: "run list_catalog to find it, e.g. plausible",
      },
      { key: "name", label: "Service name", type: "string", required: false },
    ],
    steps: [{ description: "Install the catalog service", tool: "install_catalog" }],
  },
  {
    id: "managed-postgres",
    title: "Add a managed Postgres database",
    summary: "Provision a managed Postgres database on a server, optionally linked to an app.",
    triggers: [
      "managed postgres",
      "add a database",
      "managed database",
      "provision postgres",
      "need a db",
    ],
    discover: ["list_servers", "list_apps"],
    fields: [
      {
        key: "serverId",
        label: "Server",
        type: "string",
        placeholder: "which server (run list_servers; offer the choices)",
      },
      { key: "name", label: "Database name", type: "string" },
      { key: "appId", label: "Link to app", type: "string", required: false },
    ],
    steps: [{ description: "Provision the managed database", tool: "create_database" }],
  },
];

export const GUIDED_TEMPLATE_TOOL_NAME = "guided_template";

export const GUIDED_TEMPLATE_TOOL: AnthropicToolDef = {
  name: GUIDED_TEMPLATE_TOOL_NAME,
  description:
    "Get a known-good recipe for a common setup task — the details to ask for plus a plan " +
    "skeleton. Call with no id to list the available guides (docker-hub-app, git-repo-app, " +
    "catalog-app, managed-postgres); call with an id to get its `discover` reads, `fields` (pass " +
    "to request_input), and `steps` (pass to propose_plan). Adapt the result to the user's " +
    "request: run the discover reads first to fill in choices, and only ask for what you can't " +
    "determine. For a recognized common task, prefer this over improvising. When listing, pass " +
    "`query` (the user's request) to get a `suggested` guide id back.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Guide id; omit to list all guides." },
      query: {
        type: "string",
        description: "The user's request — when listing, returns a suggested guide id.",
      },
    },
  },
};

/** Best-matching guide for a free-text intent, by trigger overlap (phrase triggers
 *  count strongest). Returns null if nothing matches. Pure + deterministic — the
 *  eval suite grades it, and resolveGuide surfaces it as a `suggested` hint. */
export function suggestGuide(query: string): string | null {
  const q = query.toLowerCase();
  let best: { id: string | null; score: number } = { id: null, score: 0 };
  for (const t of GUIDED_TEMPLATES) {
    let score = 0;
    for (const trig of t.triggers) {
      if (q.includes(trig)) score += trig.includes(" ") ? 3 : 1;
    }
    if (score > best.score) best = { id: t.id, score };
  }
  return best.id;
}

/** Resolve a guided_template call to JSON reference data. No id ⇒ the guide list
 *  (plus a `suggested` id when a `query` is given); a known id ⇒ the full template;
 *  an unknown id ⇒ an error + the valid ids. Pure. */
export function resolveGuide(input: Record<string, unknown>): string {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) {
    const query = typeof input.query === "string" ? input.query : "";
    const suggested = query ? suggestGuide(query) : null;
    return JSON.stringify({
      guides: GUIDED_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        summary: t.summary,
        triggers: t.triggers,
      })),
      ...(suggested ? { suggested } : {}),
      note: "Call guided_template with one of these ids to get its fields + plan, then adapt them.",
    });
  }
  const t = GUIDED_TEMPLATES.find((g) => g.id === id);
  if (!t) {
    return JSON.stringify({
      error: `unknown guide: ${id}`,
      available: GUIDED_TEMPLATES.map((g) => g.id),
    });
  }
  return JSON.stringify(t);
}
