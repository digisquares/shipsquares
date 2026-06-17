// Canonical design tokens (25-design-system.md) + a WCAG contrast helper.
// styles.css mirrors these values as CSS custom properties; this module is the
// source of truth that the programmatic AA-contrast suite validates (the design
// system's first test item).

export type Theme = "dark" | "light";

export type TokenName =
  | "bg"
  | "surface-1"
  | "surface-2"
  | "border"
  | "text"
  | "text-muted"
  | "accent"
  | "accent-fg"
  | "ok"
  | "warn"
  | "fail"
  | "info";

export const TOKENS: Record<Theme, Record<TokenName, string>> = {
  // Dark-first. (accent nudged #7c5cff → #7654fa so white text clears AA 4.5.)
  dark: {
    bg: "#0a0b0f",
    "surface-1": "#12141a",
    "surface-2": "#1a1d26",
    border: "#262a35",
    text: "#e7ebf3",
    "text-muted": "#8b93a7",
    accent: "#7654fa",
    "accent-fg": "#ffffff",
    ok: "#3fb950",
    warn: "#d29922",
    fail: "#f85149",
    info: "#4c8dff",
  },
  // Light is a first-class theme (not an afterthought). Darker accent/status
  // hues so they clear AA on white surfaces.
  light: {
    bg: "#ffffff",
    "surface-1": "#f7f8fa",
    "surface-2": "#eef1f5",
    border: "#d6dae2",
    text: "#11141b",
    "text-muted": "#5a6170",
    accent: "#5b34e0",
    "accent-fg": "#ffffff",
    ok: "#1a7f37",
    warn: "#8a6100",
    fail: "#cf222e",
    info: "#0a66c4",
  },
};

function channel(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG 2.x relative-contrast ratio (1–21). Order-independent.
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
