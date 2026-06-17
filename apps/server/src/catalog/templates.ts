import { readFileSync } from "node:fs";

// Vendored one-click catalog (17-catalog-accessories.md): Coolify's service
// templates, copied per 35-reuse-map.md (Apache-2.0, see NOTICE).
// `catalog/index.json` is their generated service-templates.json (keyed by
// slug, compose as base64); `catalog/templates/` holds the source yamls.

export interface CatalogEntry {
  slug: string;
  documentation: string;
  slogan: string;
  /** base64-encoded docker-compose yaml */
  compose: string;
  tags: string[];
  category?: string;
  logo?: string;
  minversion?: string;
  port?: string;
}

/** Light list view — everything except the compose payload. */
export interface CatalogItem {
  slug: string;
  slogan: string;
  category: string | null;
  tags: string[];
  port: string | null;
  logo: string | null;
  documentation: string;
}

const INDEX_URL = new URL("../../catalog/index.json", import.meta.url);
let cached: Map<string, CatalogEntry> | null = null;

export function loadCatalog(): Map<string, CatalogEntry> {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(INDEX_URL, "utf8")) as Record<
    string,
    Omit<CatalogEntry, "slug">
  >;
  cached = new Map(Object.entries(raw).map(([slug, e]) => [slug, { slug, ...e }]));
  return cached;
}

export function listCatalog(): CatalogItem[] {
  return [...loadCatalog().values()].map((e) => ({
    slug: e.slug,
    slogan: e.slogan,
    category: e.category ?? null,
    tags: e.tags,
    port: e.port ?? null,
    logo: e.logo ?? null,
    documentation: e.documentation,
  }));
}

/** The template's docker-compose yaml (decoded), or null for an unknown slug. */
export function getTemplateCompose(slug: string): string | null {
  const entry = loadCatalog().get(slug);
  if (!entry) return null;
  return Buffer.from(entry.compose, "base64").toString("utf8");
}
