import type { AnthropicToolDef } from "./anthropic.js";
import { PROPOSE_PLAN_TOOL_NAME } from "./loop.js";

// Plan-then-execute (ai-multistep-conversations.md Phase C): for a task that takes
// several mutating actions, the model proposes an ordered plan and the user
// approves it up front. runToolLoop intercepts the call, the SSE layer renders the
// plan with Approve/Cancel, and on approval the plan's write steps run without
// re-prompting (destructive steps still confirm). Offered only on an interactive
// transport, alongside request_input.

export const PROPOSE_PLAN_TOOL: AnthropicToolDef = {
  name: PROPOSE_PLAN_TOOL_NAME,
  description:
    "Propose a short, ordered plan for a multi-step task and get the user's go-ahead BEFORE " +
    "executing it. Use this when a request needs several mutating actions (e.g. create app → " +
    "set env → add domain). List each step with the tool you'll call and its key arguments. " +
    "Once the user approves, run the steps in order — you won't need to re-request approval for " +
    "the plan's write steps, though destructive steps (deletes, restores) still confirm " +
    "individually. If the user cancels, stop and ask what to change. For a single action, just " +
    "call the tool directly instead.",
  inputSchema: {
    type: "object",
    properties: {
      goal: { type: "string", description: "One line: what the whole plan accomplishes." },
      steps: {
        type: "array",
        description: "The ordered steps to carry out.",
        items: {
          type: "object",
          properties: {
            n: { type: "integer", description: "1-based step number." },
            description: { type: "string", description: "Plain-English what + why." },
            tool: { type: "string", description: "The tool you'll call for this step." },
            input: {
              type: "object",
              description: "The arguments you'll pass (your best estimate).",
            },
          },
          required: ["description", "tool"],
        },
      },
    },
    required: ["goal", "steps"],
  },
};
