import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AppError, type Env } from "@ss/shared";
import { eq } from "drizzle-orm";
import type PgBoss from "pg-boss";

import type { Db } from "../db/index.js";
import { updateSettings, updateState } from "../db/schema/index.js";
import { getAppVersion } from "../lib/version.js";

// Update-check (auto-update.md · Phase 1, notify-only). A pg-boss cron fetches the
// release manifest at get.shipsquares.com/channels/<channel>.json, compares it to
// the running version, and upserts the singleton update_state row. The dashboard
// reads that state for the notify badge + Settings → Updates. No apply yet.

export const UPDATE_CHECK_QUEUE = "update-check";
const UPDATE_CHECK_CRON = "0 */6 * * *"; // every 6 hours
const SINGLETON = "singleton";
const FETCH_TIMEOUT_MS = 10_000;

export interface UpdateStateView {
  currentVersion: string;
  latestVersion: string | null;
  channel: string;
  updateAvailable: boolean;
  notesUrl: string | null;
  releasedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

interface Manifest {
  channel?: string;
  latest?: string;
  releasedAt?: string;
  notesUrl?: string;
  artifacts?: Record<string, { url: string; sha256?: string; bytes?: number }>;
}

export interface UpdateSettingsView {
  channel: string;
  autoUpdate: boolean;
}

const SETTINGS_SINGLETON = "singleton";

/** Operator intent: tracked channel + auto-apply. Defaults to the env channel and
 *  auto-update OFF until a row is written. */
export async function getUpdateSettings(db: Db, config: Env): Promise<UpdateSettingsView> {
  const rows = await db
    .select()
    .from(updateSettings)
    .where(eq(updateSettings.id, SETTINGS_SINGLETON))
    .limit(1);
  const row = rows[0];
  if (!row) return { channel: config.SS_RELEASE_CHANNEL, autoUpdate: false };
  return { channel: row.channel, autoUpdate: row.autoUpdate };
}

export async function setUpdateSettings(
  db: Db,
  config: Env,
  patch: { channel?: string; autoUpdate?: boolean },
): Promise<UpdateSettingsView> {
  const cur = await getUpdateSettings(db, config);
  const next = {
    channel: patch.channel ?? cur.channel,
    autoUpdate: patch.autoUpdate ?? cur.autoUpdate,
  };
  const now = new Date();
  await db
    .insert(updateSettings)
    .values({
      id: SETTINGS_SINGLETON,
      channel: next.channel,
      autoUpdate: next.autoUpdate,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: updateSettings.id,
      set: { channel: next.channel, autoUpdate: next.autoUpdate, updatedAt: now },
    });
  return next;
}

// Forward-only channels: the manifest is the publisher's source of truth and only
// advances, so "different from what we run" means "newer". Dev/workspace builds
// (version "dev") never nag.
function isNewer(latest: string | null, current: string): boolean {
  if (!latest) return false;
  if (current === "dev") return false;
  return latest !== current;
}

export async function fetchManifest(base: string, channel: string): Promise<Manifest> {
  const url = `${base.replace(/\/+$/, "")}/${channel}.json`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`manifest ${url} -> HTTP ${res.status}`);
  return (await res.json()) as Manifest;
}

function toView(row: typeof updateState.$inferSelect): UpdateStateView {
  return {
    currentVersion: row.currentVersion,
    latestVersion: row.latestVersion,
    channel: row.channel,
    updateAvailable: row.updateAvailable,
    notesUrl: row.notesUrl,
    releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    lastError: row.lastError,
  };
}

/** Fetch the manifest, compare, and persist the singleton state. Network/parse
 *  errors are captured into `lastError` (never thrown) so a check failure leaves
 *  the prior "available" state intact and simply records why. */
export async function checkForUpdate(db: Db, config: Env): Promise<UpdateStateView> {
  const current = getAppVersion(config);
  const settings = await getUpdateSettings(db, config);
  const channel = settings.channel;
  let latest: string | null = null;
  let notesUrl: string | null = null;
  let releasedAt: Date | null = null;
  let lastError: string | null = null;
  let updateAvailable = false;
  try {
    const m = await fetchManifest(config.SS_UPDATE_MANIFEST_BASE, channel);
    latest = m.latest ?? null;
    notesUrl = m.notesUrl ?? null;
    releasedAt = m.releasedAt ? new Date(m.releasedAt) : null;
    updateAvailable = isNewer(latest, current);
  } catch (err) {
    lastError = (err as Error).message;
  }
  const now = new Date();
  await db
    .insert(updateState)
    .values({
      id: SINGLETON,
      currentVersion: current,
      latestVersion: latest,
      channel,
      updateAvailable,
      notesUrl,
      releasedAt,
      lastCheckedAt: now,
      lastError,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: updateState.id,
      set: {
        currentVersion: current,
        latestVersion: latest,
        channel,
        updateAvailable,
        notesUrl,
        releasedAt,
        lastCheckedAt: now,
        lastError,
        updatedAt: now,
      },
    });
  // Phase 3: opt-in auto-apply — when enabled and a newer version is available, hand
  // off to the updater (best-effort; failures surface via the status file / next check).
  if (settings.autoUpdate && updateAvailable && !lastError) {
    try {
      await applyUpdate(db, config);
    } catch {
      /* up-to-date race / missing artifact — ignore; the next check retries */
    }
  }
  return getUpdateState(db, config);
}

/** Read the stored state; if no check has run yet, return a baseline reflecting
 *  the current version so the UI can always render. */
export async function getUpdateState(db: Db, config: Env): Promise<UpdateStateView> {
  const rows = await db.select().from(updateState).where(eq(updateState.id, SINGLETON)).limit(1);
  const row = rows[0];
  if (!row) {
    return {
      currentVersion: getAppVersion(config),
      latestVersion: null,
      channel: config.SS_RELEASE_CHANNEL,
      updateAvailable: false,
      notesUrl: null,
      releasedAt: null,
      lastCheckedAt: null,
      lastError: null,
    };
  }
  return toView(row);
}

// ── Apply (auto-update.md · Phase 2) ────────────────────────────────────────
// The control plane never updates itself in-process — it writes a request file
// that the root `shipsquares-updater.path` unit picks up; the updater downloads +
// verifies the bundle, migrates, swaps the `current` symlink, restarts, health-
// gates, and rolls back. Progress is surfaced via the status file the updater writes.

export interface ApplyResult {
  accepted: boolean;
  fromVersion: string;
  toVersion: string;
}

export interface UpdateProgress {
  state: "idle" | "running" | "done" | "failed";
  step: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  message: string | null;
  ts: string | null;
}

function arch(): "amd64" | "arm64" {
  return process.arch === "arm64" ? "arm64" : "amd64";
}

/** Resolve the channel's latest artifact for this arch and drop an update request
 *  for the root updater. Validates against the manifest — only the manifest's
 *  `latest` is ever requested, never an arbitrary URL/version. */
export async function applyUpdate(db: Db, config: Env): Promise<ApplyResult> {
  const current = getAppVersion(config);
  const settings = await getUpdateSettings(db, config);
  const m = await fetchManifest(config.SS_UPDATE_MANIFEST_BASE, settings.channel);
  if (!m.latest) {
    throw new AppError("release manifest has no latest version", {
      status: 503,
      code: "update.manifest_unavailable",
    });
  }
  if (!isNewer(m.latest, current)) {
    throw new AppError(`already on the latest version (${current})`, {
      status: 409,
      code: "update.up_to_date",
    });
  }
  const a = arch();
  const artifact = m.artifacts?.[a];
  if (!artifact?.url) {
    throw new AppError(`no ${a} bundle in the ${settings.channel} manifest`, {
      status: 409,
      code: "update.no_artifact",
    });
  }
  const request = {
    version: m.latest,
    channel: settings.channel,
    url: artifact.url,
    sha256: artifact.sha256 ?? null,
    // The updater re-fetches + (if a public key is installed) verifies this manifest,
    // then derives the bundle url/sha from it — so trust never rests on this request.
    manifestUrl: `${config.SS_UPDATE_MANIFEST_BASE.replace(/\/+$/, "")}/${settings.channel}.json`,
    requestedAt: new Date().toISOString(),
  };
  // Write atomically (tmp + rename) so the .path unit never sees a half-written file.
  const dest = join(config.SS_STATE_DIR, "update.request");
  const tmp = `${dest}.tmp`;
  await writeFile(tmp, `${JSON.stringify(request)}\n`, { mode: 0o600 });
  const { rename } = await import("node:fs/promises");
  await rename(tmp, dest);
  return { accepted: true, fromVersion: current, toVersion: m.latest };
}

/** Read the updater's status file; "idle" when no update has been requested. */
export async function getUpdateProgress(config: Env): Promise<UpdateProgress> {
  try {
    const raw = await readFile(join(config.SS_STATE_DIR, "update.status"), "utf8");
    const p = JSON.parse(raw) as Partial<UpdateProgress>;
    return {
      state: p.state ?? "idle",
      step: p.step ?? null,
      fromVersion: p.fromVersion ?? null,
      toVersion: p.toVersion ?? null,
      message: p.message ?? null,
      ts: p.ts ?? null,
    };
  } catch {
    return {
      state: "idle",
      step: null,
      fromVersion: null,
      toVersion: null,
      message: null,
      ts: null,
    };
  }
}

/** Register the recurring check (idempotent) and kick one off shortly after boot.
 *  No-op when SS_UPDATE_CHECK=false (air-gapped). */
export async function bootUpdateCheck(db: Db, config: Env, boss: PgBoss): Promise<void> {
  if (!config.SS_UPDATE_CHECK) return;
  await boss.createQueue(UPDATE_CHECK_QUEUE);
  await boss.unschedule(UPDATE_CHECK_QUEUE).catch(() => undefined);
  await boss.schedule(UPDATE_CHECK_QUEUE, UPDATE_CHECK_CRON, {}, { tz: "UTC" });
  await boss.work(UPDATE_CHECK_QUEUE, async () => {
    await checkForUpdate(db, config);
  });
  // Best-effort initial check; never blocks or fails boot.
  void checkForUpdate(db, config).catch(() => undefined);
}
