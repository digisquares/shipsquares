import { z } from "zod";

/**
 * The single, validated source of runtime configuration. Twelve-factor: every
 * value comes from the environment. Nothing else in the codebase reads
 * `process.env` directly — call {@link loadConfig} once at boot.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // Postgres (control plane — native; 03-data-model.md)
  DATABASE_URL: z.string().url(),
  // better-auth (05-auth-rbac.md)
  AUTH_SECRET: z.string().min(32),
  AUTH_URL: z.string().url(),
  // base64-encoded 32-byte key that seals at-rest secrets (11-secrets-config.md).
  // Optional so dev/tests boot without it; required to set/use secret env vars.
  SHIPSQUARES_MASTER_KEY: z.string().optional(),
  // Caddy admin API (08-proxy-ssl.md)
  // 127.0.0.1 (not localhost): Node fetch resolves localhost to ::1 on some
  // hosts, and Caddy's admin origin check wants the IPv4 loopback host.
  CADDY_ADMIN_URL: z.string().url().default("http://127.0.0.1:2019"),
  // Proxy driver selection (08-proxy-ssl.md)
  PROXY_DRIVER: z.enum(["caddy", "traefik", "nginx"]).default("caddy"),
  // Default inbound webhook signing key; per-repo secrets override (10-webhooks-vcs.md)
  WEBHOOK_SIGNING_KEY: z.string().min(16).optional(),
  // GitHub App config (26-vcs-connections.md): slug for the install redirect,
  // numeric app id + PEM private key for App-JWT auth (installation-account
  // lookup, token minting). The private key is sealed per-connection at rest.
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  // Platform SMTP for email notification channels (30-notifications.md). Optional.
  SMTP_URL: z.string().url().optional(),
  SMTP_FROM: z.string().optional(),
  // Platform install key for the AI chat (22-chatbot-agent.md). Optional — a
  // per-org BYO key (sealed via /ai-settings) overrides it; with neither, chat
  // is disabled.
  ANTHROPIC_API_KEY: z.string().optional(),
  // Extra browser origins (comma-separated) trusted for credentialed CORS and
  // better-auth beyond AUTH_URL — for reaching the dashboard by server IP,
  // domain, and SSH tunnel at once. Explicit allowlist; never reflection.
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
  // SSO / social login (22/05, ROADMAP R3.2). Optional — a provider turns on
  // only when both its id and secret are present. OAuth apps for LOGIN
  // (callback /auth/callback/<provider>), distinct from the VCS GitHub App.
  SSO_GITHUB_CLIENT_ID: z.string().optional(),
  SSO_GITHUB_CLIENT_SECRET: z.string().optional(),
  SSO_GOOGLE_CLIENT_ID: z.string().optional(),
  SSO_GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Public email/password self-signup. Default on for first-run bootstrap;
  // set "false" once invites (R3.4) are the onboarding path (05/R3.x).
  ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // OAuth client credentials for token refresh (26-vcs-connections.md). Optional;
  // refresh stays inert for providers without them (non-expiring tokens unaffected).
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITLAB_OAUTH_CLIENT_ID: z.string().optional(),
  GITLAB_OAUTH_CLIENT_SECRET: z.string().optional(),
  // Deploy executor knobs (06-deploy-engine.md)
  SS_BUILDS_DIR: z.string().default("/var/lib/shipsquares/builds"),
  SS_APP_PORT: z.coerce.number().int().positive().default(8080),
  SS_HEALTH_ATTEMPTS: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // Optional bearer token for the /metrics endpoint (R6.4). If set, Prometheus
  // scrapes must include `Authorization: Bearer <token>`. Unset = unauthenticated.
  METRICS_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Parse + validate the environment exactly once. On the first call the result
 * is memoised; subsequent calls return the cached {@link Env} and ignore a
 * changed `source`. Throws a single aggregated, multi-line error listing every
 * offending key (not one throw per key) so a misconfiguration is obvious.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clear the memoised config so a fresh `source` can be validated. */
export function resetConfigCache(): void {
  cached = null;
}
