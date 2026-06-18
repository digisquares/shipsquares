import type { AnthropicToolDef } from "./anthropic.js";

// Knowledge grounding (ai-assistant-roadmap.md): a `search_docs` tool over a small
// bundled help corpus so the assistant can EXPLAIN ("how do I set up PITR?"), not
// just act. Retrieval is dependency-free term scoring — no embedding service, works
// offline, right for a self-hosted control plane. Results are our own trusted docs,
// so the loop feeds them back unfenced (the `trusted` execTool flag). For questions
// about the user's own resources the model uses the read tools instead.

export interface HelpDoc {
  slug: string;
  title: string;
  /** Extra keywords/synonyms to bias retrieval (tokenized like the body). */
  tags: string[];
  body: string;
}

export const HELP_DOCS: HelpDoc[] = [
  {
    slug: "deploy-from-git",
    title: "Deploy an app from a Git repository",
    tags: ["deploy", "git", "github", "repo", "repository", "branch", "build", "nixpacks"],
    body: `# Deploy an app from a Git repository
Create an app pointed at a Git repo and ShipSquares builds and runs it for you.

## Steps
1. Create the app with the repository URL and the branch to track (default \`main\`).
2. ShipSquares detects how to build it (Dockerfile, Nixpacks, buildpacks, or static) and runs the first deployment.
3. Add a custom domain if you want it reachable from the internet.

Every later push (or a manual "deploy") builds a new version; use rollback to return to a previous one. Watch progress in the live deploy logs.`,
  },
  {
    slug: "deploy-from-docker-hub",
    title: "Deploy an app from a Docker Hub image",
    tags: ["docker", "dockerhub", "image", "registry", "container", "deploy", "tag"],
    body: `# Deploy an app from a Docker Hub image
Run any public image directly — no source build needed.

## Steps
1. Create the app with the image reference (e.g. \`nginx\`) and a tag (default \`latest\`).
2. Set the container port the image listens on (nginx is 80) and choose which server in your fleet runs it.
3. Optionally add a custom domain.

Private registries need credentials configured first; a pull-auth failure means the image is private. The assistant can walk this whole flow for you — just ask "deploy nginx from Docker Hub".`,
  },
  {
    slug: "custom-domains-tls",
    title: "Custom domains and automatic HTTPS",
    tags: ["domain", "domains", "tls", "https", "ssl", "certificate", "cert", "caddy", "dns"],
    body: `# Custom domains and automatic HTTPS
Point a domain at your app and ShipSquares serves it over HTTPS automatically.

## How it works
The built-in Caddy reverse proxy issues and renews TLS certificates on demand the first time a request arrives for a domain — there's no certificate step to manage.

## Steps
1. Add the domain (FQDN) to your app.
2. Create a DNS A/AAAA record pointing the domain at your server's IP.
3. The first HTTPS request triggers certificate issuance (a few seconds); after that it's cached and auto-renewed.`,
  },
  {
    slug: "env-and-secrets",
    title: "Environment variables and secrets",
    tags: ["env", "environment", "variables", "secret", "secrets", "config", "rotate"],
    body: `# Environment variables and secrets
Set configuration per app; secrets are encrypted at rest.

## Steps
- Set environment variables on the app; changing them redeploys with the new values.
- Mark sensitive values as secrets — they're sealed (encrypted) at rest and redacted in logs.
- Reference shared values with \`\${secret:NAME}\` interpolation.

Rotating a secret is a write action, so the assistant will confirm it with you before applying.`,
  },
  {
    slug: "managed-databases",
    title: "Managed databases (Postgres and MySQL)",
    tags: ["database", "databases", "postgres", "postgresql", "mysql", "db", "studio", "replica"],
    body: `# Managed databases
Provision Postgres or MySQL databases on a server and connect your apps to them.

## What you get
- One-click provisioning on any server in your fleet, with read replicas where supported.
- Database Studio: browse tables, inspect the schema, and run SQL from the dashboard (read-only by default; write mode is gated).
- Automatic connection wiring so a linked app gets its connection string.

See "Backups and point-in-time recovery" for protecting the data.`,
  },
  {
    slug: "backups-and-pitr",
    title: "Backups and point-in-time recovery (PITR)",
    tags: [
      "backup",
      "backups",
      "pitr",
      "point-in-time",
      "recovery",
      "restore",
      "wal",
      "retention",
      "s3",
    ],
    body: `# Backups and point-in-time recovery (PITR)
ShipSquares backs up your managed databases on a schedule and can restore them — to the latest backup or to an exact moment in time.

## Logical backups
A backup configuration runs a logical dump on a cron schedule and keeps results under a retention policy (the last N runs OR everything from the last N days, whichever keeps more). Trigger one immediately with "run a backup", or restore a run into a fresh database.

## Point-in-time recovery (PITR)
For Postgres, enable physical PITR: ShipSquares takes a base backup and continuously archives write-ahead log (WAL) segments to your S3-compatible bucket. You can then restore to any timestamp within the retention window — ideal after an accidental delete. Restores run into a fresh container first, so your live database is never overwritten until you switch over.

## Set it up
1. Add a backup configuration for the database (schedule + retention).
2. For PITR, enable physical/WAL archiving and point it at an S3 bucket.
3. Run a restore drill before you rely on it.`,
  },
  {
    slug: "catalog-apps",
    title: "One-click catalog apps",
    tags: ["catalog", "one-click", "template", "install", "plausible", "umami", "service"],
    body: `# One-click catalog apps
Install popular self-hosted apps from the catalog of hundreds of templates.

## Steps
1. Find the app in the catalog (e.g. Plausible analytics, Umami, Uptime Kuma).
2. Install it as a managed service on a server — ShipSquares wires up the container, volumes, and routing.
3. Manage or uninstall it later from the dashboard.

Ask the assistant "set up Plausible" and it will find the right template and install it.`,
  },
  {
    slug: "adding-servers",
    title: "Adding servers to your fleet",
    tags: ["server", "servers", "fleet", "ssh", "bootstrap", "node", "agent", "host"],
    body: `# Adding servers to your fleet
Bring any Linux host under management — no agent to install.

## How it works
ShipSquares connects over SSH and bootstraps the host (installs the container runtime and the proxy) for you. It's agentless: nothing to pre-install beyond SSH access.

## Steps
1. Add the server with its host/IP and SSH details.
2. ShipSquares bootstraps it and it joins your fleet.
3. Deploy apps and provision databases onto it. Server CPU/memory metrics show in the dashboard.`,
  },
  {
    slug: "pr-previews",
    title: "PR preview environments",
    tags: ["preview", "previews", "pr", "pull request", "branch", "ephemeral"],
    body: `# PR preview environments
Get a live, isolated environment for every pull request.

## How it works
When PR previews are enabled, an opened PR is built and deployed to its own URL, and ShipSquares comments the link on the PR. Pushing to the PR redeploys it; closing or merging the PR sweeps the environment away automatically.`,
  },
  {
    slug: "scheduled-jobs",
    title: "Scheduled (cron) jobs",
    tags: ["schedule", "scheduled", "cron", "job", "jobs", "task", "recurring"],
    body: `# Scheduled (cron) jobs
Run commands on a recurring schedule against an app container, a service, or a server.

## Steps
1. Create a schedule with a cron expression, a target (app/service/server), and the command to run.
2. Run it immediately with "run now" to test it.
3. Review the run history (status + output) from the dashboard.`,
  },
  {
    slug: "managed-email",
    title: "Managed email (mailboxes, DKIM/SPF/DMARC)",
    tags: ["email", "mail", "mailbox", "dkim", "spf", "dmarc", "smtp", "domain", "stalwart"],
    body: `# Managed email
Host real mailboxes on your own domain with the deliverability records set up for you.

## How it works
ShipSquares runs a mail server and generates the DNS records (DKIM, SPF, DMARC, MX) you need; it then verifies them with live DNS lookups so you know when the domain is ready.

## Steps
1. Provision a mail instance and add your domain.
2. Create the generated DNS records at your registrar; ShipSquares verifies them.
3. Create mailboxes and aliases. New mailboxes get a one-time password to share with the user.`,
  },
  {
    slug: "ai-assistant",
    title: "Using the AI assistant",
    tags: ["assistant", "ai", "chat", "chatbot", "claude", "approve", "approval"],
    body: `# Using the AI assistant
Drive ShipSquares by asking — the assistant inspects real state and can act for you.

## What it can do
- Answer questions about your apps, deploys, servers, databases, and logs by calling read tools.
- Do work — deploy, roll back, set env, add a domain, provision a database, install a catalog app, manage members and jobs — with every write or destructive action confirmed by you first.
- Handle multi-step tasks: it asks for missing details, proposes a plan you approve, then runs it step by step.

Configure a Claude API key under Settings → AI assistant. Tool output is treated as untrusted, and the assistant never exceeds your own permissions.`,
  },
];

export const SEARCH_DOCS_TOOL_NAME = "search_docs";

export const SEARCH_DOCS_TOOL: AnthropicToolDef = {
  name: SEARCH_DOCS_TOOL_NAME,
  description:
    "Search the ShipSquares documentation for how-to and concept answers — 'how do I set up " +
    "PITR?', 'what is on-demand TLS?', backups, custom domains, adding servers, previews, email. " +
    "Returns the most relevant help docs with excerpts. Use it to GROUND explanations in the real " +
    "docs instead of guessing product behaviour, and cite the doc title. For questions about the " +
    "user's OWN resources (their apps, deploys, logs), use the read tools instead.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to look up." },
      limit: { type: "integer", description: "Max docs to return (default 3, max 5)." },
    },
    required: ["query"],
  },
};

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "is",
  "are",
  "how",
  "do",
  "does",
  "i",
  "my",
  "me",
  "with",
  "set",
  "up",
  "what",
  "can",
  "it",
  "that",
  "this",
  "you",
  "your",
  "we",
  "from",
  "use",
  "using",
  "get",
  "got",
  "be",
  "as",
  "at",
  "by",
  "if",
  "so",
  "about",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Split a doc body into heading-delimited chunks for excerpt selection. */
function chunks(body: string): string[] {
  return body
    .split(/\n(?=#{1,3} )/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function scoreDoc(doc: HelpDoc, q: string[]): { score: number; excerpt: string } {
  const title = new Set(tokenize(doc.title));
  const tags = new Set(doc.tags.flatMap((t) => tokenize(t)));
  let score = 0;
  for (const t of q) {
    if (tags.has(t)) score += 5; // curated keywords are the strongest signal
    if (title.has(t)) score += 3;
  }
  const cs = chunks(doc.body);
  let best = { s: -1, text: cs[0] ?? doc.body };
  for (const c of cs) {
    const toks = tokenize(c);
    let cScore = 0;
    for (const t of q) cScore += toks.filter((x) => x === t).length;
    score += cScore;
    if (cScore > best.s) best = { s: cScore, text: c };
  }
  return { score, excerpt: best.text };
}

/** Retrieve the most relevant help docs for a query → JSON (trusted reference data).
 *  No match ⇒ the topic list so the model can guide the user. Pure. */
export function searchDocs(input: Record<string, unknown>): string {
  const query = typeof input.query === "string" ? input.query : "";
  const limit =
    typeof input.limit === "number" && input.limit > 0 ? Math.min(Math.floor(input.limit), 5) : 3;
  const q = tokenize(query);
  const scored = HELP_DOCS.map((doc) => ({ doc, ...scoreDoc(doc, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (!scored.length) {
    return JSON.stringify({
      query,
      results: [],
      topics: HELP_DOCS.map((d) => ({ slug: d.slug, title: d.title })),
      note: "No close match — tell the user which topics exist, or answer from general knowledge and say it's not ShipSquares-specific.",
    });
  }
  return JSON.stringify({
    query,
    results: scored.map((r) => ({
      slug: r.doc.slug,
      title: r.doc.title,
      excerpt: r.excerpt.slice(0, 600),
    })),
  });
}
