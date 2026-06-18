import type { AnthropicToolDef } from "./anthropic.js";
import { REQUEST_INPUT_TOOL_NAME } from "./loop.js";

// Structured elicitation (ai-multistep-conversations.md Phase B): a non-mutating
// meta-tool the model calls to collect missing details from the user — app name,
// container port, which server, a domain — instead of guessing. The chat service
// offers it only on an interactive (streaming) transport; runToolLoop intercepts
// the call and the SSE layer renders a form, feeding the answers back as the tool
// result. Mirrors the MCP "elicitation" pattern so the in-product assistant and
// the MCP server stay conceptually aligned.

export type InputFieldType = "string" | "integer" | "number" | "boolean" | "enum";

export interface InputFieldOption {
  value: string;
  label: string;
}

export interface InputField {
  /** Machine key; becomes the argument name when the model calls the real tool. */
  key: string;
  /** Human label shown next to the input. */
  label: string;
  type: InputFieldType;
  /** For type=enum: the allowed choices. */
  options?: InputFieldOption[];
  /** Prefilled value, if any. */
  default?: string | number | boolean;
  /** Whether the user must fill it (default true). */
  required?: boolean;
  placeholder?: string;
}

export interface InputRequest {
  reason: string;
  fields: InputField[];
}

export const REQUEST_INPUT_TOOL: AnthropicToolDef = {
  name: REQUEST_INPUT_TOOL_NAME,
  description:
    "Ask the user for structured details you need before you can act (e.g. app name, " +
    "container port, which server, a custom domain) and receive their answers back. Prefer " +
    "this over guessing or fabricating required values. Discover what you can with read tools " +
    "first, then request ONLY the fields you genuinely can't determine. Each field's `key` is " +
    "the argument name you'll use when you call the real tool with the answers.",
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "One short sentence on why you need these details.",
      },
      fields: {
        type: "array",
        description: "The fields to ask the user for.",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "Machine key; becomes the argument name." },
            label: { type: "string", description: "Human label shown next to the input." },
            type: { type: "string", enum: ["string", "integer", "number", "boolean", "enum"] },
            options: {
              type: "array",
              description: "For type=enum: the allowed choices.",
              items: {
                type: "object",
                properties: { value: { type: "string" }, label: { type: "string" } },
                required: ["value", "label"],
              },
            },
            default: { description: "Prefilled value, if any." },
            required: {
              type: "boolean",
              description: "Whether the user must fill it (default true).",
            },
            placeholder: { type: "string" },
          },
          required: ["key", "label", "type"],
        },
      },
    },
    required: ["reason", "fields"],
  },
};
