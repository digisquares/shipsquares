import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { NotFoundError, ValidationError, loadConfig, newId } from "@ss/shared";
import { and, desc, eq } from "drizzle-orm";

import {
  defaultTemplateValue,
  renderEnvFile,
  resolveTemplateEnv,
} from "../catalog/template-env.js";
import { getTemplateCompose, loadCatalog } from "../catalog/templates.js";
import type { Db } from "../db/index.js";
import { catalogServices } from "../db/schema/index.js";
import { runCommand } from "../deploy/exec.js";
import { swallow } from "../lib/swallow.js";

// One-click catalog installs (17): mint the magic env, write the compose
// project (compose.yml + .env) under SS_BUILDS_DIR, `docker compose up -d` it
// as project ss-svc-<id>. Installs run in the background (image pulls are
// slow); the row carries status/error. Uninstall = `down -v` + row delete.

const INSTALL_TIMEOUT_MS = 15 * 60_000;

type Row = typeof catalogServices.$inferSelect;

export interface CatalogServiceView {
  id: string;
  slug: string;
  name: string;
  status: string;
  error: string | null;
  unsupportedTokens: string[];
  createdAt: string;
}

export function toCatalogServiceView(r: Row): CatalogServiceView {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    error: r.error,
    unsupportedTokens: r.unsupportedTokens,
    createdAt: r.createdAt.toISOString(),
  };
}

export const catalogProjectName = (id: string): string => `ss-svc-${id}`;

export async function listCatalogServices(db: Db, orgId: string): Promise<CatalogServiceView[]> {
  const rows = await db
    .select()
    .from(catalogServices)
    .where(eq(catalogServices.organizationId, orgId))
    .orderBy(desc(catalogServices.createdAt));
  return rows.map(toCatalogServiceView);
}

export async function installCatalogService(
  db: Db,
  orgId: string,
  input: { slug: string; name?: string },
): Promise<CatalogServiceView> {
  const entry = loadCatalog().get(input.slug);
  const compose = getTemplateCompose(input.slug);
  if (!entry || compose === null) throw new NotFoundError("unknown catalog template");

  const resolved = resolveTemplateEnv(compose, defaultTemplateValue);
  if (resolved.unsupported.length > 0) {
    // FQDN/URL minting needs domain wiring — refuse loudly rather than start
    // a stack with blank required values.
    throw new ValidationError(
      `template needs unsupported tokens: ${resolved.unsupported.join(", ")}`,
    );
  }

  const id = newId("svc");
  const rows = await db
    .insert(catalogServices)
    .values({
      id,
      organizationId: orgId,
      slug: input.slug,
      name: input.name ?? entry.slug,
      unsupportedTokens: resolved.unsupported,
    })
    .returning();

  // Background install: pulls can take minutes; the row carries the outcome.
  void (async () => {
    try {
      const cfg = loadConfig();
      const dir = join(cfg.SS_BUILDS_DIR, `svc-${id}`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "docker-compose.yml"), resolved.compose, "utf8");
      await writeFile(join(dir, ".env"), renderEnvFile(resolved.env), "utf8");
      const up = await runCommand(
        "docker",
        ["compose", "-p", catalogProjectName(id), "--project-directory", dir, "up", "-d"],
        { timeoutMs: INSTALL_TIMEOUT_MS },
      );
      if (up.code !== 0) {
        const tail = up.lines
          .filter((l) => l.stream === "stderr")
          .slice(-5)
          .map((l) => l.line)
          .join("\n");
        await db
          .update(catalogServices)
          .set({ status: "failed", error: `compose up exited ${up.code}: ${tail}` })
          .where(eq(catalogServices.id, id));
        return;
      }
      await db
        .update(catalogServices)
        .set({ status: "running", error: null })
        .where(eq(catalogServices.id, id));
    } catch (e) {
      await db
        .update(catalogServices)
        .set({ status: "failed", error: e instanceof Error ? e.message : String(e) })
        .where(eq(catalogServices.id, id))
        .catch((err) => swallow("catalog.mark_failed", err));
    }
  })();

  return toCatalogServiceView(rows[0]!);
}

export async function uninstallCatalogService(db: Db, orgId: string, id: string): Promise<void> {
  const rows = await db
    .select()
    .from(catalogServices)
    .where(and(eq(catalogServices.id, id), eq(catalogServices.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("catalog service not found");
  const cfg = loadConfig();
  const dir = join(cfg.SS_BUILDS_DIR, `svc-${id}`);
  await runCommand(
    "docker",
    ["compose", "-p", catalogProjectName(id), "--project-directory", dir, "down", "-v"],
    { timeoutMs: 5 * 60_000 },
  ).catch(() => undefined); // volumes may already be gone — the row must still delete
  await db.delete(catalogServices).where(eq(catalogServices.id, id));
}
