// Hardening for dynamic text injected into the system prompt (ai-assistant-roadmap.md
// security notes). Memory content, the recent-activity block, and the client-supplied
// page context all land in the SYSTEM block (high trust). To stop a second-order /
// stored injection from forging a new instruction line or closing the untrusted-output
// fence, we flatten newlines (no forged "\n\nSECURITY …" headers) and drop angle
// brackets (no forged <untrusted-tool-output>-style tags), then cap the length.

export function sanitizeForPrompt(s: string, maxLen = 500): string {
  return s
    .replace(/[\r\n\t]+/g, " ") // no forged newlines / section headers
    .replace(/[<>]/g, "") // no forged fence / tag tokens
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}
