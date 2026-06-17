import { describe, expect, it } from "vitest";

import { getTemplateCompose, listCatalog, loadCatalog } from "./templates.js";

// Runs against the real vendored index (catalog/index.json).
describe("catalog templates", () => {
  it("loads a substantial catalog with well-formed entries", () => {
    const catalog = loadCatalog();
    expect(catalog.size).toBeGreaterThan(300);
    for (const entry of [...catalog.values()].slice(0, 25)) {
      expect(entry.slug.length).toBeGreaterThan(0);
      expect(typeof entry.compose).toBe("string");
      expect(Array.isArray(entry.tags)).toBe(true);
    }
  });

  it("lists a light view without the compose payload", () => {
    const items = listCatalog();
    expect(items.length).toBeGreaterThan(300);
    expect(items[0]).not.toHaveProperty("compose");
  });

  it("decodes a known template to docker-compose yaml", () => {
    const yaml = getTemplateCompose("grafana");
    expect(yaml).toBeTruthy();
    expect(yaml).toContain("services:");
  });

  it("returns null for unknown slugs", () => {
    expect(getTemplateCompose("definitely-not-a-template")).toBeNull();
  });
});
