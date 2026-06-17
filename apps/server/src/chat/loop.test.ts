import { describe, expect, it, vi } from "vitest";

import {
  dropLeadingAssistant,
  runToolLoop,
  type ChatLoopDeps,
  type LoopMessage,
  type LoopResponse,
} from "./loop.js";

const text = (t: string): LoopResponse => ({
  content: [{ type: "text", text: t }],
  stop_reason: "end_turn",
});

const toolUse = (id: string, name: string, input: Record<string, unknown>): LoopResponse => ({
  content: [{ type: "tool_use", id, name, input }],
  stop_reason: "tool_use",
});

function deps(over: Partial<ChatLoopDeps> = {}): ChatLoopDeps {
  return {
    createMessage: vi.fn(async () => text("hi")),
    execTool: vi.fn(async () => ({ text: "{}" })),
    ...over,
  };
}

describe("runToolLoop", () => {
  it("returns the text of an end_turn answer without touching tools", async () => {
    const d = deps();
    const r = await runToolLoop(d, [{ role: "user", content: "hello" }]);
    expect(r.text).toBe("hi");
    expect(r.toolEvents).toEqual([]);
    expect(r.turns).toBe(1);
    expect(d.execTool).not.toHaveBeenCalled();
  });

  it("executes a tool round and feeds the result back before the final answer", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUse("tu_1", "list_apps", { limit: 5 }))
      .mockResolvedValueOnce(text("you have 2 apps"));
    const execTool = vi.fn(async () => ({ text: '{"data":[1,2]}' }));
    const r = await runToolLoop({ createMessage, execTool }, [{ role: "user", content: "apps?" }]);

    expect(execTool).toHaveBeenCalledWith("list_apps", { limit: 5 });
    expect(r.text).toBe("you have 2 apps");
    expect(r.toolEvents).toEqual([
      { tool: "list_apps", input: { limit: 5 }, result: '{"data":[1,2]}' },
    ]);
    expect(r.turns).toBe(2);

    // The second call must carry the assistant tool_use + the matching result.
    const second = createMessage.mock.calls[1]![0] as Array<{ role: string; content: unknown }>;
    expect(second.at(-2)?.role).toBe("assistant");
    const resultMsg = second.at(-1) as {
      role: string;
      content: Array<{ type: string; tool_use_id: string }>;
    };
    expect(resultMsg.role).toBe("user");
    expect(resultMsg.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
  });

  it("marks a failed tool execution as an error result and keeps going", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUse("tu_1", "deploy_app", { appId: "app_1" }))
      .mockResolvedValueOnce(text("that failed"));
    const execTool = vi.fn(async () => ({ text: "409 conflict", isError: true }));
    const r = await runToolLoop({ createMessage, execTool }, [{ role: "user", content: "ship" }]);
    expect(r.toolEvents[0]).toMatchObject({ tool: "deploy_app", isError: true });
    const second = createMessage.mock.calls[1]![0] as Array<{ content: unknown }>;
    const resultMsg = second.at(-1) as { content: Array<{ is_error?: boolean }> };
    expect(resultMsg.content[0]).toMatchObject({ is_error: true });
    expect(r.text).toBe("that failed");
  });

  it("stops at maxTurns when the model keeps asking for tools", async () => {
    const createMessage = vi.fn(async () => toolUse("tu_x", "list_apps", {}));
    const r = await runToolLoop({ createMessage, execTool: deps().execTool }, [], 3);
    expect(r.turns).toBe(3);
    expect(r.toolEvents).toHaveLength(3);
    expect(r.text).toContain("tool turns");
  });

  it("emits each tool event as it completes, before the final answer", async () => {
    const order: string[] = [];
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUse("tu_1", "list_apps", {}))
      .mockImplementationOnce(async () => {
        order.push("final-call");
        return text("done");
      });
    const onToolEvent = vi.fn((e: { tool: string }) => order.push(`event:${e.tool}`));
    await runToolLoop({ createMessage, execTool: deps().execTool, onToolEvent }, []);
    expect(onToolEvent).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["event:list_apps", "final-call"]);
  });
});

describe("dropLeadingAssistant", () => {
  const u = (t: string): LoopMessage => ({ role: "user", content: t });
  const a = (t: string): LoopMessage => ({ role: "assistant", content: t });

  it("drops leading assistant messages so the window opens on a user turn", () => {
    // a sliced window can start mid-conversation on an assistant reply
    expect(dropLeadingAssistant([a("hi"), u("q"), a("ans"), u("q2")])).toEqual([
      u("q"),
      a("ans"),
      u("q2"),
    ]);
  });

  it("leaves a user-first history untouched and handles empties", () => {
    expect(dropLeadingAssistant([u("q"), a("ans")])).toEqual([u("q"), a("ans")]);
    expect(dropLeadingAssistant([])).toEqual([]);
    expect(dropLeadingAssistant([a("only")])).toEqual([]); // all-assistant → empty
  });
});
