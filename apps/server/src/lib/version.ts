import { readFileSync } from "node:fs";

import type { Env } from "@ss/shared";

// The running control-plane version (auto-update.md). The authoritative source is
// the bundle's VERSION file, written by scripts/build-bundle.sh and read from the
// service's working directory (/opt/shipsquares/current). Falls back to an explicit
// SS_VERSION override, then "dev" for a workspace run (no bundle). Cached after the
// first resolve.

let cached: string | null = null;

export function getAppVersion(config: Env): string {
  if (cached) return cached;
  let version = "dev";
  try {
    const fromBundle = readFileSync("VERSION", "utf8").trim();
    if (fromBundle) version = fromBundle;
  } catch {
    // not running from a bundle (dev / tests) — fall through to the env override
  }
  if (version === "dev") {
    const override = config.SS_VERSION;
    if (override && override !== "latest" && override !== "dev") version = override;
  }
  cached = version;
  return version;
}

/** Test-only: clear the memoised version. */
export function resetAppVersionCache(): void {
  cached = null;
}
