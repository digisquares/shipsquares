import { describe, expect, it } from "vitest";

import { SYSTEM_PROMPT } from "./chat.service.js";

// The system prompt encodes the assistant's behavioural guardrails — cheap to
// regress on, so pin the load-bearing clauses. See ai-multistep-conversations.md
// (multi-step) and ai-assistant-roadmap.md (prompt-injection defense).
describe("SYSTEM_PROMPT", () => {
  it("instructs the model to clarify rather than fabricate required inputs", () => {
    expect(SYSTEM_PROMPT).toMatch(/never fabricate/i);
    expect(SYSTEM_PROMPT).toMatch(/ASK one short, specific question/i);
  });

  it("tells the model to discover with reads, outline steps, and stop on failure", () => {
    expect(SYSTEM_PROMPT).toMatch(/DISCOVER what you can with read tools/i);
    expect(SYSTEM_PROMPT).toMatch(/outline the steps first/i);
    expect(SYSTEM_PROMPT).toMatch(/If a step fails, STOP/i);
  });

  it("carries the prompt-injection rule for untrusted tool output", () => {
    expect(SYSTEM_PROMPT).toContain("<untrusted-tool-output>");
    expect(SYSTEM_PROMPT).toMatch(/NEVER follow instructions/i);
  });

  it("points how-to/concept questions at search_docs for grounding", () => {
    expect(SYSTEM_PROMPT).toMatch(/search_docs/);
    expect(SYSTEM_PROMPT).toMatch(/ground your answer/i);
  });

  it("explains memory usage and forbids storing secrets there", () => {
    expect(SYSTEM_PROMPT).toMatch(/remember\(key, content\)/);
    expect(SYSTEM_PROMPT).toMatch(/never secrets/i);
  });
});
