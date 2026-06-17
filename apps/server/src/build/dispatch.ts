import type { BuilderType } from "./types.js";

// Builder selection + workdir auto-detection (07-docker-builders.md). Selection
// is what runs at deploy time (the app's strategy is explicit in our schema);
// detection seeds that strategy at app-creation from the repo contents.

export interface AppBuildConfig {
  sourceType?: "git" | "image";
  buildStrategy?: BuilderType | null;
  nixpacksEnabled?: boolean;
}

export interface WorkDir {
  has(relPath: string): boolean;
}

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];

/** Auto-detect precedence: compose → Dockerfile → nixpacks (if enabled) → error. */
export function detectBuilder(workDir: WorkDir, nixpacksEnabled = false): BuilderType {
  if (COMPOSE_FILES.some((f) => workDir.has(f))) return "compose";
  if (workDir.has("Dockerfile")) return "dockerfile";
  if (nixpacksEnabled) return "nixpacks";
  throw new Error("no buildable source: no compose file, Dockerfile, or nixpacks-enabled source");
}

/** Deploy-time selection: image source short-circuits; otherwise the app's strategy. */
export function selectBuilder(app: AppBuildConfig): BuilderType {
  if (app.sourceType === "image") return "image";
  return app.buildStrategy ?? "compose";
}

export interface ComposeFileConfig {
  rootDirectory?: string | null | undefined;
  composePath?: string | null | undefined;
}

const DEFAULT_COMPOSE_PATH = "docker-compose.yml";

/** Resolve the compose file to deploy (workdir-relative), or null when the
 *  source has none. An explicit non-default composePath is strict — a typo
 *  must not silently deploy something else; the schema default falls back
 *  through the standard filenames. */
export function resolveComposeFile(cfg: ComposeFileConfig, workDir: WorkDir): string | null {
  const root = cfg.rootDirectory?.replace(/\/+$/, "") ?? "";
  const rel = (p: string): string => (root ? `${root}/${p}` : p);
  if (cfg.composePath && cfg.composePath !== DEFAULT_COMPOSE_PATH) {
    return workDir.has(rel(cfg.composePath)) ? rel(cfg.composePath) : null;
  }
  for (const f of COMPOSE_FILES) if (workDir.has(rel(f))) return rel(f);
  return null;
}
