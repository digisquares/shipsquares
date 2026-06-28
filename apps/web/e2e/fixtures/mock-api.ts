import { type Page, type Route } from "@playwright/test";

// ────────────────────────────────────────────────────────────────────────────
// Deterministic mock control plane for PLAYWRIGHT_STACK=mocked (the default).
//
// One catch-all router intercepts `/auth/*`, `/sso-providers`, and `/api/v1/*`
// only — SPA assets (JS/CSS/HTML) pass straight through to `vite preview`. The
// router dispatches on (method, pathname) against an ordered table and reads a
// live `MockState` object, so a spec can mutate state before navigating and the
// handlers reflect it. Response shapes mirror what the real handlers emit (see
// the per-page reference the specs were written against).
//
// In full mode (E2E_BASE_URL → real control plane) installMockApi() is a no-op.
// ────────────────────────────────────────────────────────────────────────────

export const FULL = process.env.PLAYWRIGHT_STACK === "full";

export type Role = "owner" | "admin" | "deployer" | "viewer";

export interface MockUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  twoFactorEnabled?: boolean;
}

export interface AppRow {
  id: string;
  name: string;
  branch?: string;
  repo?: string | null;
  image?: string | null;
  port?: number;
  cpu?: number | null;
  memoryMb?: number | null;
  buildStrategy?: string;
  buildConfig?: {
    rootDirectory?: string | null;
    dockerfilePath?: string | null;
    publishDirectory?: string | null;
    builder?: string | null;
  };
}

export interface Deployment {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  trigger: string;
  commitAfter: string | null;
  errorMessage?: string | null;
  queuedAt: string;
  meta?: { url?: string; container?: string } | null;
}

export interface EnvVar {
  key: string;
  value: string | null;
  isSecret: boolean;
}
export interface Domain {
  id: string;
  fqdn: string;
  certStatus: string;
}
export interface Webhook {
  id: string;
  url: string;
  provider: string;
  secret?: string;
}
export interface Channel {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  events: string[];
}
export interface Member {
  id: string;
  userId: string;
  email: string;
  name?: string | null;
  role: Role;
  createdAt: string;
}
export interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}
export interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}
export interface CatalogItem {
  slug: string;
  slogan: string;
  category: string | null;
  tags: string[];
}
export interface InstalledService {
  id: string;
  slug: string;
  name: string;
  status: string;
  error: string | null;
  /** internal: GET reads before an "installing" service flips to "running". */
  _reads?: number;
}
export interface BackupConfig {
  id: string;
  serverId: string;
  databaseId: string | null;
  type: string;
  schedule: string;
  walArchive: boolean;
  keepNewest: number;
  retentionDays: number;
  enabled: boolean;
  lastWalAt: string | null;
  nextRunAt: string | null;
  lastRun: { status: string; sizeBytes: number | null; finishedAt: string | null } | null;
}
export interface DbConnection {
  id: string;
  name: string;
  engine: string;
  host: string;
  database: string;
  readOnly: boolean;
  source: "managed" | "external";
}

export interface AiSettingsView {
  enabled: boolean;
  configured: boolean;
  keySource: "org" | "platform" | "none";
  keyHint: string;
  model: string;
  thinking: boolean;
}

export interface MockState {
  session: MockUser | null;
  ssoProviders: string[];
  /** sign-in returns { twoFactorRedirect:true } so the login TOTP step shows. */
  twoFactorOnSignIn: boolean;
  /** accepted password for the mocked sign-in. */
  password: string;
  apps: AppRow[];
  deployments: Record<string, Deployment[]>;
  metrics: Record<
    string,
    { running: boolean; cpuPercent?: number; memPercent?: number; memUsage?: string }
  >;
  env: Record<string, EnvVar[]>;
  domains: Record<string, Domain[]>;
  webhook: Record<string, Webhook | null>;
  schedules: Array<Record<string, unknown>>;
  channels: Channel[];
  vcsConnections: Array<{
    id: string;
    kind: string;
    provider: string;
    accountLogin?: string;
    createdAt: string;
  }>;
  members: Member[];
  invites: Invite[];
  apiKeys: ApiKey[];
  ai: AiSettingsView;
  updateState: Record<string, unknown>;
  updateSettings: { channel: string; autoUpdate: boolean };
  catalog: CatalogItem[];
  catalogServices: InstalledService[];
  backupConfigs: BackupConfig[];
  backupRuns: Record<string, Array<Record<string, unknown>>>;
  dbConnections: DbConnection[];
  servers: Array<{
    id: string;
    name: string;
    host: string;
    role: "control" | "worker";
    status: string;
    dockerOk: boolean;
    caddyOk: boolean;
    createdAt: string;
  }>;
  mailInstances: Array<Record<string, unknown>>;
  mailDomains: Record<string, Array<Record<string, unknown>>>;
  mailDns: Record<string, Array<Record<string, unknown>>>;
  mailMailboxes: Record<string, Array<Record<string, unknown>>>;
  mailAliases: Record<string, Array<Record<string, unknown>>>;
  orgs: Array<{ id: string; name: string; role: string; active: boolean }>;
  /** force a specific status on any mutating endpoint, keyed by "METHOD path-substr". */
  fail: Record<string, { status: number; body?: unknown }>;
  /** observed requests, for asserting a POST did/didn't happen. */
  calls: Array<{ method: string; path: string; body: unknown }>;
}

const owner: MockUser = {
  id: "user_owner",
  email: "owner@local.test",
  name: "Olivia",
  role: "owner",
};

export function defaultState(over: Partial<MockState> = {}): MockState {
  return {
    session: null,
    ssoProviders: [],
    twoFactorOnSignIn: false,
    password: "correct-horse",
    apps: [],
    deployments: {},
    metrics: {},
    env: {},
    domains: {},
    webhook: {},
    schedules: [],
    channels: [],
    vcsConnections: [],
    members: [],
    invites: [],
    apiKeys: [],
    ai: {
      enabled: false,
      configured: false,
      keySource: "none",
      keyHint: "",
      model: "claude-sonnet-4-6",
      thinking: false,
    },
    updateState: {
      currentVersion: "1.4.0",
      latestVersion: "1.4.0",
      channel: "stable",
      updateAvailable: false,
      notesUrl: null,
      releasedAt: null,
      lastCheckedAt: "2026-06-20T00:00:00Z",
      lastError: null,
    },
    updateSettings: { channel: "stable", autoUpdate: false },
    catalog: [],
    catalogServices: [],
    backupConfigs: [],
    backupRuns: {},
    dbConnections: [],
    servers: [],
    mailInstances: [],
    mailDomains: {},
    mailDns: {},
    mailMailboxes: {},
    mailAliases: {},
    orgs: [],
    fail: {},
    calls: [],
    ...over,
  };
}

export { owner as ownerUser };

// ── helpers ────────────────────────────────────────────────────────────────
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const noContent = (route: Route) => route.fulfill({ status: 204, body: "" });

function bodyOf(route: Route): Record<string, unknown> {
  try {
    return JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Look up a forced failure for this call (substring match on the path). */
function forced(state: MockState, method: string, path: string) {
  for (const [k, v] of Object.entries(state.fail)) {
    const [m, sub] = k.split(" ");
    if (m === method && sub && path.includes(sub)) return v;
  }
  return null;
}

// ── route table ──────────────────────────────────────────────────────────────
type Handler = (route: Route, m: RegExpExecArray, state: MockState) => void | Promise<void>;
interface Entry {
  method: string;
  re: RegExp;
  fn: Handler;
}

function deploymentsFor(state: MockState, appId: string): Deployment[] {
  return state.deployments[appId] ?? [];
}

const routes: Entry[] = [
  // ── auth (better-auth, basePath /auth) ───────────────────────────────────
  {
    method: "GET",
    re: /\/auth\/get-session$/,
    fn: (r, _m, s) =>
      s.session
        ? json(r, 200, { session: { id: "sess_mock" }, user: s.session })
        : json(r, 200, null),
  },
  {
    method: "GET",
    re: /\/sso-providers$/,
    fn: (r, _m, s) => json(r, 200, { providers: s.ssoProviders }),
  },
  {
    method: "POST",
    re: /\/auth\/sign-in\/email$/,
    fn: (r, _m, s) => {
      const b = bodyOf(r);
      if (b.password !== s.password) return json(r, 401, { message: "Invalid email or password" });
      if (s.twoFactorOnSignIn)
        return json(r, 200, { twoFactorRedirect: true, twoFactorMethods: ["totp"] });
      s.session = { ...owner, email: String(b.email ?? owner.email) };
      return json(r, 200, { redirect: false, token: "mock", user: s.session });
    },
  },
  {
    method: "POST",
    re: /\/auth\/two-factor\/verify-totp$/,
    fn: (r, _m, s) => {
      const b = bodyOf(r);
      if (b.code === "123456") {
        s.session = { ...owner, twoFactorEnabled: true };
        return json(r, 200, { token: "mock" });
      }
      return json(r, 401, { message: "Invalid code" });
    },
  },
  {
    method: "POST",
    re: /\/auth\/two-factor\/enable$/,
    fn: (r) =>
      json(r, 200, {
        totpURI: "otpauth://totp/ShipSquares:owner?secret=JBSWY3DPEHPK3PXP&issuer=ShipSquares",
        backupCodes: ["aaaa-bbbb", "cccc-dddd"],
      }),
  },
  {
    method: "POST",
    re: /\/auth\/two-factor\/disable$/,
    fn: (r, _m, s) => {
      if (s.session) s.session.twoFactorEnabled = false;
      return json(r, 200, {});
    },
  },
  {
    method: "POST",
    re: /\/auth\/sign-out$/,
    fn: (r, _m, s) => {
      s.session = null;
      return json(r, 200, {});
    },
  },
  {
    method: "POST",
    re: /\/auth\/sign-in\/social$/,
    fn: (r) =>
      json(r, 200, { url: "https://github.com/login/oauth/authorize?mock", redirect: true }),
  },

  // ── apps ─────────────────────────────────────────────────────────────────
  {
    method: "GET",
    re: /\/api\/v1\/apps$/,
    fn: (r, _m, s) => json(r, 200, { data: s.apps }),
  },
  {
    method: "POST",
    re: /\/api\/v1\/apps$/,
    fn: (r, _m, s) => {
      const b = bodyOf(r);
      const name = String(b.name);
      const f = forced(s, "POST", "/apps");
      if (f) return json(r, f.status, f.body ?? { detail: "Create failed" });
      const id = `app_${name}`;
      s.apps.push({
        id,
        name,
        branch: "main",
        repo: (b.repo as string) ?? null,
        image: (b.image as string) ?? null,
        port: b.port ? Number(b.port) : 8080,
      });
      return json(r, 201, { id, name, branch: "main" });
    },
  },
  {
    method: "GET",
    re: /\/api\/v1\/apps\/([^/]+)\/deployments/,
    fn: (r, m, s) => json(r, 200, { data: deploymentsFor(s, m[1]!) }),
  },
  {
    method: "POST",
    re: /\/api\/v1\/apps\/([^/]+)\/deployments$/,
    fn: (r, m, s) => {
      const id = m[1]!;
      const f = forced(s, "POST", `/apps/${id}/deployments`);
      if (f) return json(r, f.status, f.body ?? {});
      return json(r, 202, {
        id: `dep_${id}_${deploymentsFor(s, id).length + 1}`,
        status: "queued",
      });
    },
  },
  {
    method: "GET",
    re: /\/api\/v1\/apps\/([^/]+)\/metrics\/series/,
    fn: (r) =>
      json(r, 200, {
        metric: "cpu",
        range: "1h",
        stepMs: 60000,
        memLimitBytes: 268435456,
        points: [
          { avg: 10, min: 8, max: 12 },
          { avg: 12, min: 9, max: 15 },
          { avg: 11, min: 10, max: 13 },
        ],
      }),
  },
  {
    method: "GET",
    re: /\/api\/v1\/apps\/([^/]+)\/metrics$/,
    fn: (r, m, s) =>
      json(
        r,
        200,
        s.metrics[m[1]!] ?? { running: true, cpuPercent: 12.3, memPercent: 40, memUsage: "100 MB" },
      ),
  },
  {
    method: "POST",
    re: /\/api\/v1\/apps\/([^/]+)\/(start|stop|restart)$/,
    fn: (r, m, s) => {
      const id = m[1]!;
      const action = m[2]!;
      const running = action !== "stop";
      const next = {
        running,
        cpuPercent: running ? 12 : undefined,
        memPercent: running ? 40 : undefined,
      };
      s.metrics[id] = next;
      return json(r, 200, next);
    },
  },
  {
    method: "PATCH",
    re: /\/api\/v1\/apps\/([^/]+)$/,
    fn: (r, m, s) => {
      const id = m[1]!;
      const f = forced(s, "PATCH", `/apps/${id}`);
      if (f) return json(r, f.status, f.body ?? { detail: "failed" });
      const app = s.apps.find((a) => a.id === id);
      const b = bodyOf(r);
      if (app) {
        app.buildStrategy = (b.buildStrategy as string) ?? app.buildStrategy;
        app.buildConfig = { ...(app.buildConfig ?? {}), ...((b.buildConfig as object) ?? {}) };
      }
      return json(r, 200, { ok: true });
    },
  },
  {
    method: "GET",
    re: /\/api\/v1\/apps\/([^/]+)$/,
    fn: (r, m, s) => {
      const app = s.apps.find((a) => a.id === m[1]);
      if (!app) return json(r, 404, { detail: "not found" });
      return json(r, 200, {
        buildStrategy: "dockerfile",
        buildConfig: {
          rootDirectory: null,
          dockerfilePath: null,
          publishDirectory: null,
          builder: null,
        },
        port: 8080,
        cpu: 0.5,
        memoryMb: 256,
        ...app,
      });
    },
  },

  // env / domains / webhook
  {
    method: "GET",
    re: /\/api\/v1\/apps\/([^/]+)\/env$/,
    fn: (r, m, s) => json(r, 200, s.env[m[1]!] ?? []),
  },
  {
    method: "PUT",
    re: /\/api\/v1\/apps\/([^/]+)\/env$/,
    fn: (r, m, s) => {
      const f = forced(s, "PUT", `/apps/${m[1]}/env`);
      if (f) return json(r, f.status, f.body ?? { detail: "Save failed" });
      const b = bodyOf(r);
      s.env[m[1]!] = ((b.vars as EnvVar[]) ?? []).map((v) => ({
        key: v.key,
        value: v.isSecret ? null : v.value,
        isSecret: v.isSecret,
      }));
      return json(r, 200, { ok: true });
    },
  },
  {
    method: "GET",
    re: /\/api\/v1\/apps\/([^/]+)\/domains$/,
    fn: (r, m, s) => json(r, 200, s.domains[m[1]!] ?? []),
  },
  {
    method: "POST",
    re: /\/api\/v1\/apps\/([^/]+)\/domains$/,
    fn: (r, m, s) => {
      const b = bodyOf(r);
      const fqdn = String(b.fqdn ?? "");
      const f = forced(s, "POST", `/apps/${m[1]}/domains`);
      if (f) return json(r, f.status, f.body ?? { detail: "Domain rejected" });
      const list = (s.domains[m[1]!] ??= []);
      list.push({ id: `dom_${list.length + 1}`, fqdn, certStatus: "pending" });
      return json(r, 201, list[list.length - 1]);
    },
  },
  { method: "DELETE", re: /\/api\/v1\/domains\/([^/]+)$/, fn: (r) => noContent(r) },
  {
    method: "GET",
    re: /\/api\/v1\/apps\/([^/]+)\/webhook$/,
    fn: (r, m, s) => {
      const w = s.webhook[m[1]!];
      return w ? json(r, 200, w) : json(r, 404, { detail: "no webhook" });
    },
  },
  {
    method: "POST",
    re: /\/api\/v1\/apps\/([^/]+)\/webhook$/,
    fn: (r, m, s) => {
      const w: Webhook = {
        id: "wh_1",
        url: `https://cp.example.com/api/v1/webhooks/${m[1]}/deploy`,
        provider: "github",
        secret: "whsec_one_time_abc123",
      };
      s.webhook[m[1]!] = { ...w };
      return json(r, 201, w);
    },
  },

  // deployments (steps / rollback)
  { method: "GET", re: /\/api\/v1\/deployments\/([^/]+)\/steps$/, fn: (r) => json(r, 200, []) },
  {
    method: "POST",
    re: /\/api\/v1\/deployments\/([^/]+)\/rollback$/,
    fn: (r, m) => json(r, 202, { id: `dep_rollback_${m[1]}` }),
  },

  // schedules
  { method: "GET", re: /\/api\/v1\/schedules$/, fn: (r, _m, s) => json(r, 200, s.schedules) },
  { method: "GET", re: /\/api\/v1\/schedules\/([^/]+)\/runs$/, fn: (r) => json(r, 200, []) },
  {
    method: "POST",
    re: /\/api\/v1\/schedules$/,
    fn: (r, _m, s) => {
      const b = bodyOf(r);
      const sched = {
        id: `sch_${s.schedules.length + 1}`,
        enabled: true,
        createdAt: "2026-06-20T00:00:00Z",
        ...b,
      };
      s.schedules.push(sched);
      return json(r, 201, sched);
    },
  },
  {
    method: "POST",
    re: /\/api\/v1\/schedules\/([^/]+)\/run$/,
    fn: (r) => json(r, 200, { ok: true }),
  },
  { method: "DELETE", re: /\/api\/v1\/schedules\/([^/]+)$/, fn: (r) => noContent(r) },

  // vcs connections (repo picker + settings)
  {
    method: "GET",
    re: /\/api\/v1\/vcs-connections$/,
    fn: (r, _m, s) => json(r, 200, s.vcsConnections),
  },
  {
    method: "GET",
    re: /\/api\/v1\/vcs-connections\/([^/]+)\/repos$/,
    fn: (r) => json(r, 200, [{ fullName: "olivia/hello", defaultBranch: "main", private: false }]),
  },
  { method: "DELETE", re: /\/api\/v1\/vcs-connections\/([^/]+)$/, fn: (r) => noContent(r) },

  // notification channels
  {
    method: "GET",
    re: /\/api\/v1\/notification-channels$/,
    fn: (r, _m, s) => json(r, 200, s.channels),
  },
  {
    method: "POST",
    re: /\/api\/v1\/notification-channels$/,
    fn: (r, _m, s) => {
      const b = bodyOf(r);
      const c: Channel = {
        id: `chan_${s.channels.length + 1}`,
        kind: String(b.kind),
        name: String(b.name),
        enabled: true,
        events: ["deploy.succeeded", "deploy.failed"],
      };
      s.channels.push(c);
      return json(r, 201, c);
    },
  },
  {
    method: "POST",
    re: /\/api\/v1\/notification-channels\/([^/]+)\/test$/,
    fn: (r) => json(r, 200, { delivered: true }),
  },
  {
    method: "DELETE",
    re: /\/api\/v1\/notification-channels\/([^/]+)$/,
    fn: (r, m, s) => {
      s.channels = s.channels.filter((c) => c.id !== m[1]);
      return noContent(r);
    },
  },

  // members / invites
  { method: "GET", re: /\/api\/v1\/members$/, fn: (r, _m, s) => json(r, 200, s.members) },
  {
    method: "PATCH",
    re: /\/api\/v1\/members\/([^/]+)$/,
    fn: (r, m, s) => {
      const f = forced(s, "PATCH", `/members/${m[1]}`);
      if (f) return json(r, f.status, f.body ?? { detail: "invariant" });
      const mem = s.members.find((x) => x.id === m[1]);
      const b = bodyOf(r);
      if (mem) mem.role = b.role as Role;
      return json(r, 200, mem ?? {});
    },
  },
  {
    method: "DELETE",
    re: /\/api\/v1\/members\/([^/]+)$/,
    fn: (r, m, s) => {
      const f = forced(s, "DELETE", `/members/${m[1]}`);
      if (f) return json(r, f.status, f.body ?? {});
      s.members = s.members.filter((x) => x.id !== m[1]);
      return noContent(r);
    },
  },
  { method: "GET", re: /\/api\/v1\/members\/invites$/, fn: (r, _m, s) => json(r, 200, s.invites) },
  {
    method: "POST",
    re: /\/api\/v1\/members\/invites$/,
    fn: (r, _m, s) => {
      const b = bodyOf(r);
      const f = forced(s, "POST", "/members/invites");
      if (f) return json(r, f.status, f.body ?? {});
      const inv: Invite = {
        id: `inv_${s.invites.length + 1}`,
        email: String(b.email),
        role: String(b.role),
        status: "pending",
        expiresAt: "2026-06-27T00:00:00Z",
        createdAt: "2026-06-20T00:00:00Z",
      };
      s.invites.push(inv);
      return json(r, 201, {
        ...inv,
        acceptUrl: `https://cp.example.com/#/invite?token=tok_${inv.id}`,
        emailed: false,
      });
    },
  },
  {
    method: "POST",
    re: /\/api\/v1\/members\/invites\/accept$/,
    fn: (r, _m, s) => {
      const f = forced(s, "POST", "/invites/accept");
      if (f) return json(r, f.status, f.body ?? {});
      return json(r, 200, { organizationId: "org_1", role: "deployer" });
    },
  },
  {
    method: "DELETE",
    re: /\/api\/v1\/members\/invites\/([^/]+)$/,
    fn: (r, m, s) => {
      s.invites = s.invites.filter((i) => i.id !== m[1]);
      return noContent(r);
    },
  },

  // api keys
  { method: "GET", re: /\/api\/v1\/api-keys$/, fn: (r, _m, s) => json(r, 200, s.apiKeys) },
  {
    method: "POST",
    re: /\/api\/v1\/api-keys$/,
    fn: (r, _m, s) => {
      const f = forced(s, "POST", "/api-keys");
      if (f) return json(r, f.status, f.body ?? {});
      const b = bodyOf(r);
      const key: ApiKey = {
        id: `key_${s.apiKeys.length + 1}`,
        name: String(b.name),
        scopes: [],
        lastUsedAt: null,
        createdAt: "2026-06-20T00:00:00Z",
      };
      s.apiKeys.push(key);
      return json(r, 201, { key, token: "ssk_live_one_time_token_xyz" });
    },
  },
  {
    method: "DELETE",
    re: /\/api\/v1\/api-keys\/([^/]+)$/,
    fn: (r, m, s) => {
      s.apiKeys = s.apiKeys.filter((k) => k.id !== m[1]);
      return noContent(r);
    },
  },

  // ai settings
  { method: "GET", re: /\/api\/v1\/ai-settings$/, fn: (r, _m, s) => json(r, 200, s.ai) },
  {
    method: "PUT",
    re: /\/api\/v1\/ai-settings$/,
    fn: (r, _m, s) => {
      const f = forced(s, "PUT", "/ai-settings");
      if (f) return json(r, f.status, f.body ?? {});
      const b = bodyOf(r);
      if (b.apiKey) {
        s.ai = {
          ...s.ai,
          configured: true,
          enabled: true,
          keySource: "org",
          keyHint: "sk-ant-…xyz",
        };
      }
      if (b.model) s.ai.model = String(b.model);
      if (typeof b.thinking === "boolean") s.ai.thinking = b.thinking;
      return json(r, 200, s.ai);
    },
  },
  {
    method: "POST",
    re: /\/api\/v1\/ai-settings\/test$/,
    fn: (r, _m, s) => json(r, 200, { ok: true, model: s.ai.model }),
  },

  // system updates
  {
    method: "GET",
    re: /\/api\/v1\/system\/updates\/settings$/,
    fn: (r, _m, s) => json(r, 200, s.updateSettings),
  },
  {
    method: "PUT",
    re: /\/api\/v1\/system\/updates\/settings$/,
    fn: (r, _m, s) => {
      Object.assign(s.updateSettings, bodyOf(r));
      return json(r, 200, s.updateSettings);
    },
  },
  {
    method: "POST",
    re: /\/api\/v1\/system\/updates\/check$/,
    fn: (r, _m, s) => json(r, 200, s.updateState),
  },
  {
    method: "POST",
    re: /\/api\/v1\/system\/updates\/apply$/,
    fn: (r, _m, s) => json(r, 200, { accepted: true, toVersion: s.updateState.latestVersion }),
  },
  {
    method: "GET",
    re: /\/api\/v1\/system\/updates\/progress$/,
    fn: (r) => json(r, 200, { state: "running", step: "downloading", message: "Downloading…" }),
  },
  {
    method: "GET",
    re: /\/api\/v1\/system\/updates$/,
    fn: (r, _m, s) => json(r, 200, s.updateState),
  },

  // catalog
  { method: "GET", re: /\/api\/v1\/catalog$/, fn: (r, _m, s) => json(r, 200, s.catalog) },
  {
    method: "GET",
    re: /\/api\/v1\/catalog-services$/,
    fn: (r, _m, s) => {
      // Simulate provisioning: an "installing" service flips to "running" on its
      // second GET, so a spec can observe the installing→running transition.
      for (const svc of s.catalogServices) {
        if (svc.status === "installing") {
          svc._reads = (svc._reads ?? 0) + 1;
          if (svc._reads >= 2) svc.status = "running";
        }
      }
      return json(r, 200, s.catalogServices);
    },
  },
  {
    method: "POST",
    re: /\/api\/v1\/catalog-services$/,
    fn: (r, _m, s) => {
      const b = bodyOf(r);
      const f = forced(s, "POST", "/catalog-services");
      if (f) return json(r, f.status, f.body ?? { detail: "blocked" });
      const slug = String(b.slug);
      const svc: InstalledService = {
        id: `svc_${s.catalogServices.length + 1}`,
        slug,
        name: slug,
        status: "installing",
        error: null,
      };
      s.catalogServices.push(svc);
      return json(r, 201, svc);
    },
  },
  {
    method: "DELETE",
    re: /\/api\/v1\/catalog-services\/([^/]+)$/,
    fn: (r, m, s) => {
      s.catalogServices = s.catalogServices.filter((x) => x.id !== m[1]);
      return noContent(r);
    },
  },

  // backups
  {
    method: "GET",
    re: /\/api\/v1\/backup-configs$/,
    fn: (r, _m, s) => json(r, 200, s.backupConfigs),
  },
  {
    method: "GET",
    re: /\/api\/v1\/backup-configs\/([^/]+)\/runs$/,
    fn: (r, m, s) => json(r, 200, s.backupRuns[m[1]!] ?? []),
  },
  {
    method: "POST",
    re: /\/api\/v1\/backup-configs\/([^/]+)\/base-backup$/,
    fn: (r) => json(r, 202, { ok: true }),
  },
  {
    method: "POST",
    re: /\/api\/v1\/backup-configs\/([^/]+)\/run$/,
    fn: (r) => json(r, 202, { ok: true }),
  },

  // db studio
  {
    method: "GET",
    re: /\/api\/v1\/db-connections$/,
    fn: (r, _m, s) => json(r, 200, s.dbConnections),
  },
  {
    method: "POST",
    re: /\/api\/v1\/db-connections$/,
    fn: (r, _m, s) => {
      const b = bodyOf(r);
      const host = String(b.host ?? "");
      const f = forced(s, "POST", "/db-connections");
      if (f) return json(r, f.status, f.body);
      if (/^(127\.|localhost|10\.|192\.168\.|::1)/.test(host)) {
        return json(r, 400, { detail: "loopback address blocked", code: "dbstudio.host_blocked" });
      }
      const c: DbConnection = {
        id: `conn_${s.dbConnections.length + 1}`,
        name: String(b.name),
        engine: String(b.engine),
        host,
        database: String(b.database),
        readOnly: false,
        source: "external",
      };
      s.dbConnections.push(c);
      return json(r, 201, c);
    },
  },
  {
    method: "POST",
    re: /\/api\/v1\/db-connections\/([^/]+)\/test$/,
    fn: (r) => json(r, 200, { ok: true, serverVersion: "PostgreSQL 16.2" }),
  },
  {
    method: "DELETE",
    re: /\/api\/v1\/db-connections\/([^/]+)$/,
    fn: (r, m, s) => {
      s.dbConnections = s.dbConnections.filter((c) => c.id !== m[1]);
      return noContent(r);
    },
  },
  {
    method: "GET",
    re: /\/api\/v1\/db-connections\/([^/]+)\/schema$/,
    fn: (r) =>
      json(r, 200, [
        {
          name: "public",
          tables: [{ schema: "public", name: "users", kind: "table", estimatedRows: 3 }],
        },
      ]),
  },
  {
    method: "GET",
    re: /\/api\/v1\/db-connections\/([^/]+)\/tables\/([^/]+)\/([^/?]+)\/rows/,
    fn: (r) =>
      json(r, 200, {
        fields: [
          { name: "id", dataType: "int4" },
          { name: "email", dataType: "text" },
        ],
        rows: [
          { id: 1, email: "olivia@local.test" },
          { id: 2, email: "sam@local.test" },
        ],
        primaryKey: ["id"],
        page: { hasMore: false },
      }),
  },
  {
    method: "GET",
    re: /\/api\/v1\/db-connections\/([^/]+)\/tables\/([^/]+)\/([^/?]+)$/,
    fn: (r) =>
      json(r, 200, {
        columns: [
          { name: "id", dataType: "int4", nullable: false, default: null, primaryKey: true },
          { name: "email", dataType: "text", nullable: false, default: null, primaryKey: false },
        ],
        foreignKeys: [],
        indexes: [],
      }),
  },
  {
    method: "POST",
    re: /\/api\/v1\/db-connections\/([^/]+)\/query$/,
    fn: (r, m, s) => {
      const f = forced(s, "POST", `/db-connections/${m[1]}/query`);
      if (f) return json(r, f.status, f.body);
      return json(r, 200, {
        fields: [{ name: "?column?", dataType: "int4" }],
        rows: [{ "?column?": 1 }],
        rowCount: 1,
        command: "SELECT",
        elapsedMs: 2,
        truncated: false,
      });
    },
  },
  {
    method: "POST",
    re: /\/api\/v1\/db-connections\/([^/]+)\/edits$/,
    fn: (r, m, s) => {
      const f = forced(s, "POST", `/db-connections/${m[1]}/edits`);
      if (f) return json(r, f.status, f.body);
      return json(r, 200, { applied: 1 });
    },
  },

  // mail (managed Stalwart) — mocked per project note (template bugs)
  { method: "GET", re: /\/api\/v1\/servers$/, fn: (r, _m, s) => json(r, 200, { data: s.servers }) },
  {
    method: "POST",
    re: /\/api\/v1\/servers\/([^/]+)\/check$/,
    fn: (r) => json(r, 202, { queued: true }),
  },
  // org-wide deployment feed (Activity page): every app's deployments + appName
  {
    method: "GET",
    re: /\/api\/v1\/deployments$/,
    fn: (r, _m, s) =>
      json(r, 200, {
        data: s.apps.flatMap((a) =>
          deploymentsFor(s, a.id).map((d) => ({ ...d, appId: a.id, appName: a.name })),
        ),
      }),
  },
  {
    method: "GET",
    re: /\/api\/v1\/mail\/instances$/,
    fn: (r, _m, s) => json(r, 200, s.mailInstances),
  },
  {
    method: "POST",
    re: /\/api\/v1\/mail\/instances$/,
    fn: (r, _m, s) => {
      const b = bodyOf(r);
      const inst = {
        id: `mi_${s.mailInstances.length + 1}`,
        hostname: b.hostname,
        status: "running",
        port25Egress: "open",
        ptrOk: true,
      };
      s.mailInstances.push(inst);
      return json(r, 201, inst);
    },
  },
  {
    method: "GET",
    re: /\/api\/v1\/mail\/instances\/([^/]+)\/domains$/,
    fn: (r, m, s) => json(r, 200, s.mailDomains[m[1]!] ?? []),
  },
  {
    method: "POST",
    re: /\/api\/v1\/mail\/instances\/([^/]+)\/domains$/,
    fn: (r, m, s) => {
      const b = bodyOf(r);
      const list = (s.mailDomains[m[1]!] ??= []);
      const dom = {
        id: `dom_${list.length + 1}`,
        fqdn: b.fqdn,
        dkimSelector: "ss",
        dnsMode: b.dnsMode,
        verificationStatus: "pending",
        inboxSubdomain: `inbox.${b.fqdn}`,
      };
      list.push(dom);
      return json(r, 201, dom);
    },
  },
  {
    method: "GET",
    re: /\/api\/v1\/mail\/domains\/([^/]+)\/dns$/,
    fn: (r, m, s) => json(r, 200, s.mailDns[m[1]!] ?? []),
  },
  {
    method: "GET",
    re: /\/api\/v1\/mail\/domains\/([^/]+)$/,
    fn: (r, m) =>
      json(r, 200, {
        id: m[1],
        fqdn: "acme.test",
        verificationStatus: "verified",
        dnsMode: "hint",
      }),
  },
  {
    method: "POST",
    re: /\/api\/v1\/mail\/domains\/([^/]+)\/verify$/,
    fn: (r, m) => json(r, 200, { id: m[1], verificationStatus: "verifying" }),
  },
  {
    method: "GET",
    re: /\/api\/v1\/mail\/domains\/([^/]+)\/mailboxes$/,
    fn: (r, m, s) => json(r, 200, s.mailMailboxes[m[1]!] ?? []),
  },
  {
    method: "POST",
    re: /\/api\/v1\/mail\/domains\/([^/]+)\/mailboxes$/,
    fn: (r, m, s) => {
      const b = bodyOf(r);
      const list = (s.mailMailboxes[m[1]!] ??= []);
      list.push({
        id: `mb_${list.length + 1}`,
        localPart: b.localPart,
        displayName: null,
        status: "active",
      });
      return json(r, 201, { password: "Tmp-Pass-9x7Q-once" });
    },
  },
  { method: "DELETE", re: /\/api\/v1\/mail\/mailboxes\/([^/]+)$/, fn: (r) => noContent(r) },
  {
    method: "GET",
    re: /\/api\/v1\/mail\/domains\/([^/]+)\/aliases$/,
    fn: (r, m, s) => json(r, 200, s.mailAliases[m[1]!] ?? []),
  },
  {
    method: "POST",
    re: /\/api\/v1\/mail\/domains\/([^/]+)\/aliases$/,
    fn: (r, m, s) => {
      const b = bodyOf(r);
      const list = (s.mailAliases[m[1]!] ??= []);
      list.push({ id: `al_${list.length + 1}`, alias: b.alias, destinations: b.destinations });
      return json(r, 201, list[list.length - 1]);
    },
  },
  { method: "DELETE", re: /\/api\/v1\/mail\/aliases\/([^/]+)$/, fn: (r) => noContent(r) },

  // device login-flow consent
  {
    method: "POST",
    re: /\/api\/v1\/login\/flow\/authorize$/,
    fn: (r) => json(r, 200, { token: "devtok_abc123", message: "ok" }),
  },

  // org switcher
  { method: "GET", re: /\/api\/v1\/me\/organizations$/, fn: (r, _m, s) => json(r, 200, s.orgs) },
  {
    method: "POST",
    re: /\/api\/v1\/organizations\/([^/]+)\/activate$/,
    fn: (r) => json(r, 200, { ok: true }),
  },

  // chat (SSE) — handled specially in installMockApi via a dedicated route.
];

/**
 * Install the mock control plane on a page. No-op in full mode. The optional
 * `sse` callback lets a spec supply a streamed chat body (text/event-stream).
 */
export async function installMockApi(
  page: Page,
  state: MockState,
  opts: { chatSse?: string } = {},
): Promise<void> {
  if (FULL) return;

  const dispatch = (route: Route) => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname;
    state.calls.push({ method, path, body: safeBody(req.postData()) });
    for (const e of routes) {
      if (e.method !== method) continue;
      const m = e.re.exec(path);
      if (m) return e.fn(route, m, state);
    }
    // Unknown API path: empty 200 so a stray fetch never strands the UI.
    return json(route, 200, { data: [] });
  };

  // Register the catch-all routers first so the chat-specific handlers below
  // (registered later → higher precedence in Playwright) win for /chat paths.
  await page.route("**/sso-providers", dispatch);
  await page.route("**/auth/**", dispatch);
  await page.route("**/api/v1/**", dispatch);

  // Chat SSE — return a canned event stream (or a JSON 409 not-configured).
  await page.route("**/api/v1/chat", (route) => {
    const path = new URL(route.request().url()).pathname;
    state.calls.push({ method: route.request().method(), path, body: route.request().postData() });
    if (!state.ai.configured) {
      return json(route, 409, { code: "ai.not_configured", message: "AI chat isn't configured" });
    }
    const stream =
      opts.chatSse ??
      [
        `event: delta\ndata: ${JSON.stringify({ text: "Here are " })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "your apps." })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ conversationId: "conv_1", text: "Here are your apps.", toolEvents: [] })}\n\n`,
      ].join("");
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: stream,
    });
  });
  await page.route("**/api/v1/chat/approve", (route) => json(route, 200, { ok: true }));
  await page.route("**/api/v1/chat/answer", (route) => json(route, 200, { ok: true }));
}

function safeBody(data: string | null): unknown {
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
