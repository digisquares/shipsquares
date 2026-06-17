// Client-side form validation (25-design-system.md: "Forms: inline validation …
// great error UX"). Pure + unit-tested.

export const APP_NAME_MAX = 63;

// An app name becomes a DNS label in preview URLs (pr-<n>-<name>.<domain>) and a
// compose project name, so validate it as a DNS-safe slug. Returns an error
// message, or null when valid. (The server enforces only 1–63 chars; the UI
// guides toward a safe name, like Vercel/Netlify.)
export function validateAppName(name: string): string | null {
  const n = name.trim();
  if (n === "") return "Name is required.";
  if (n.length > APP_NAME_MAX) return `Name must be ${APP_NAME_MAX} characters or fewer.`;
  if (!/^[a-z0-9-]+$/.test(n)) return "Use lowercase letters, numbers, and hyphens only.";
  if (n.startsWith("-") || n.endsWith("-")) return "Can't start or end with a hyphen.";
  return null;
}

// Best-effort conversion of free text to a valid app-name slug.
export function slugifyAppName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, APP_NAME_MAX)
    .replace(/-$/, "");
}
