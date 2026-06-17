// GITHUB_APP_PRIVATE_KEY transport normalization (26-vcs-connections.md):
// multiline PEMs survive quoted .env files but not systemd EnvironmentFile, so
// the key may arrive base64-wrapped or \n-escaped. Normalize once at the read
// site; non-PEM garbage passes through unchanged and fails loudly downstream.

const PEM_HEADER = "-----BEGIN";

export function normalizePrivateKey(value: string): string {
  if (value.includes(PEM_HEADER)) {
    // \n-escaped single-line PEM → real newlines (no-op for true multiline).
    return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
  }
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (decoded.includes(PEM_HEADER)) return decoded;
  } catch {
    /* not base64 */
  }
  return value;
}
