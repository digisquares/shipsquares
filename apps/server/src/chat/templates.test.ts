import { describe, expect, it } from "vitest";

import { findTool } from "../mcp/tools.js";

import { GUIDED_TEMPLATES, resolveGuide, suggestGuide } from "./templates.js";

describe("guided templates", () => {
  it("lists every guide when called with no id", () => {
    const out = JSON.parse(resolveGuide({}));
    expect(out.guides.map((g: { id: string }) => g.id).sort()).toEqual(
      GUIDED_TEMPLATES.map((g) => g.id).sort(),
    );
  });

  it("returns a guide's fields + steps by id", () => {
    const out = JSON.parse(resolveGuide({ id: "docker-hub-app" }));
    expect(out.id).toBe("docker-hub-app");
    expect(out.fields.some((f: { key: string }) => f.key === "image")).toBe(true);
    expect(out.steps[0].tool).toBe("create_app");
    expect(out.discover).toContain("list_servers");
  });

  it("reports an unknown id with the valid list", () => {
    const out = JSON.parse(resolveGuide({ id: "nope" }));
    expect(out.error).toMatch(/unknown guide/);
    expect(out.available).toContain("catalog-app");
  });

  it("every step + discover tool is a real catalog tool (typo guard)", () => {
    for (const t of GUIDED_TEMPLATES) {
      for (const s of t.steps) {
        expect(findTool(s.tool), `${t.id} step → ${s.tool}`).toBeTruthy();
      }
      for (const d of t.discover ?? []) {
        expect(findTool(d), `${t.id} discover → ${d}`).toBeTruthy();
      }
    }
  });

  it("guide ids are unique", () => {
    const ids = GUIDED_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("suggestGuide matches a trigger phrase and returns null otherwise", () => {
    expect(suggestGuide("deploy nginx from docker hub")).toBe("docker-hub-app");
    expect(suggestGuide("the weather is nice today")).toBeNull();
  });

  it("resolveGuide surfaces a suggested id when given a query", () => {
    const out = JSON.parse(resolveGuide({ query: "set up plausible" }));
    expect(out.suggested).toBe("catalog-app");
    expect(JSON.parse(resolveGuide({})).suggested).toBeUndefined(); // none without a query
  });
});
