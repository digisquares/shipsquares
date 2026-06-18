import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { findTool, toolsForCategories, TOOL_CATEGORY_NAMES } from "../mcp/tools.js";

import { EVAL_CASES } from "./evals.js";
import { HELP_DOCS, searchDocs } from "./knowledge.js";
import { GUIDED_TEMPLATES, suggestGuide } from "./templates.js";
import { pickCategories } from "./tool-picker.js";

const docSlugs = new Set(HELP_DOCS.map((d) => d.slug));
const guideIds = new Set(GUIDED_TEMPLATES.map((g) => g.id));

// ── Offline golden evals (always run in CI; no API key) ──────────────────────
describe("selection evals (deterministic)", () => {
  it("every expectation in the dataset references something real", () => {
    for (const c of EVAL_CASES) {
      if (c.expectDoc) expect(docSlugs, c.prompt).toContain(c.expectDoc);
      if (c.expectGuide) expect(guideIds, c.prompt).toContain(c.expectGuide);
      if (c.expectCategory) expect(TOOL_CATEGORY_NAMES, c.prompt).toContain(c.expectCategory);
      if (c.expectTool) expect(findTool(c.expectTool), c.prompt).toBeTruthy();
    }
  });

  for (const c of EVAL_CASES) {
    if (c.expectDoc) {
      it(`search_docs ranks "${c.expectDoc}" first for: ${c.prompt}`, () => {
        const out = JSON.parse(searchDocs({ query: c.prompt }));
        expect(out.results[0]?.slug).toBe(c.expectDoc);
      });
    }
    if (c.expectGuide) {
      it(`suggestGuide picks "${c.expectGuide}" for: ${c.prompt}`, () => {
        expect(suggestGuide(c.prompt)).toBe(c.expectGuide);
      });
    }
    if (c.expectCategory && c.expectTool) {
      it(`"${c.expectTool}" lives in category "${c.expectCategory}" (for: ${c.prompt})`, () => {
        const names = toolsForCategories([c.expectCategory!]).map((t) => t.name);
        expect(names).toContain(c.expectTool);
      });
    }
  }
});

// ── Live Haiku tool-picker eval (gated on an API key; skipped in CI) ──────────
const KEY = process.env.ANTHROPIC_API_KEY;
describe.skipIf(!KEY)("tool-picker eval (live Haiku)", () => {
  const client = new Anthropic({ apiKey: KEY });
  for (const c of EVAL_CASES) {
    if (!c.expectCategory) continue;
    it(`routes "${c.prompt}" to the ${c.expectCategory} category`, async () => {
      const cats = await pickCategories(client, c.prompt);
      expect(cats).toContain(c.expectCategory);
    }, 30_000);
  }
});
