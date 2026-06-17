// Build the document.title from context segments (25-design-system.md: clear
// orientation). Pure + tested; pages set document.title via an effect.

const APP_NAME = "ShipSquares";

export function pageTitle(...segments: string[]): string {
  const parts = segments.map((s) => s.trim()).filter(Boolean);
  return parts.length ? `${parts.join(" · ")} — ${APP_NAME}` : APP_NAME;
}
