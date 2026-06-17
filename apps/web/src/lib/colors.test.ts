import { describe, expect, it } from "vitest";

import { contrastRatio, type Theme, type TokenName, TOKENS } from "./colors";

const SURFACES: TokenName[] = ["bg", "surface-1", "surface-2"];
const STATUS: TokenName[] = ["ok", "warn", "fail", "info"];
const themes = Object.keys(TOKENS) as Theme[];

describe("design-token contrast (WCAG 2.2 AA)", () => {
  for (const theme of themes) {
    const t = TOKENS[theme];
    describe(theme, () => {
      it("primary text is AA (≥ 4.5) on every surface", () => {
        for (const s of SURFACES) {
          expect(contrastRatio(t.text, t[s])).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("muted text is AA (≥ 4.5) on every surface", () => {
        for (const s of SURFACES) {
          expect(contrastRatio(t["text-muted"], t[s])).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("accent foreground is AA (≥ 4.5) on the accent fill", () => {
        expect(contrastRatio(t["accent-fg"], t.accent)).toBeGreaterThanOrEqual(4.5);
      });

      it("status colors clear the 3:1 UI-component threshold on bg", () => {
        for (const s of STATUS) {
          expect(contrastRatio(t[s], t.bg)).toBeGreaterThanOrEqual(3);
        }
      });
    });
  }
});

describe("contrastRatio", () => {
  it("is 21:1 for black/white and 1:1 for identical colors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });
});
