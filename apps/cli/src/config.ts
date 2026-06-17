import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// CLI config: the control-plane base URL + the session cookie from `ss login`.
// Resolution order is env over file (so CI can override without a config file).
export interface CliConfig {
  url: string;
  cookie?: string;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHIPSQUARES_CONFIG ?? join(homedir(), ".shipsquares", "config.json");
}

/** Pure merge of env + file config (env wins) — unit-tested. */
export function mergeConfig(env: NodeJS.ProcessEnv, file: Partial<CliConfig> | null): CliConfig {
  const url = env.SHIPSQUARES_URL ?? file?.url ?? "";
  const cookie = env.SHIPSQUARES_COOKIE ?? file?.cookie;
  return { url, ...(cookie ? { cookie } : {}) };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  let file: Partial<CliConfig> | null = null;
  const p = configPath(env);
  if (existsSync(p)) {
    try {
      file = JSON.parse(readFileSync(p, "utf8")) as Partial<CliConfig>;
    } catch {
      file = null;
    }
  }
  return mergeConfig(env, file);
}

export function saveConfig(cfg: CliConfig, env: NodeJS.ProcessEnv = process.env): void {
  const p = configPath(env);
  // The file holds a live session cookie — owner-only, like gh/kubectl.
  // Modes are POSIX no-ops on Windows, where profile ACLs already scope access.
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
