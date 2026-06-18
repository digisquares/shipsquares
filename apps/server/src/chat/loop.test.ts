import { describe, expect, it, vi } from "vitest";

import {
  dropLeadingAssistant,
  fenceToolResult,
  runToolLoop,
  trimToTokenBudget,
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
    // ToolEvent.result is the RAW output (for display); the model gets it fenced.
    expect(r.toolEvents).toEqual([
      { tool: "list_apps", input: { limit: 5 }, result: '{"data":[1,2]}' },
    ]);
    expect(r.turns).toBe(2);

    // The second call must carry the assistant tool_use + the matching result.
    const second = createMessage.mock.calls[1]![0] as Array<{ role: string; content: unknown }>;
    expect(second.at(-2)?.role).toBe("assistant");
    const resultMsg = second.at(-1) as {
      role: string;
      content: Array<{ type: string; tool_use_id: string; content: string }>;
    };
    expect(resultMsg.role).toBe("user");
    expect(resultMsg.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
    // The untrusted tool output is fenced before it re-enters the model.
    expect(resultMsg.content[0]?.content).toContain("<untrusted-tool-output>");
    expect(resultMsg.content[0]?.content).toContain('{"data":[1,2]}');
  });

  it("feeds trusted tool output back UNFENCED (e.g. guided_template reference data)", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUse("g1", "guided_template", { id: "docker-hub-app" }))
      .mockResolvedValueOnce(text("here's the plan"));
    const execTool = vi.fn(async () => ({ text: '{"id":"docker-hub-app"}', trusted: true }));
    const r = await runToolLoop({ createMessage, execTool }, [
      { role: "user", content: "from docker hub" },
    ]);
    const second = createMessage.mock.calls[1]![0] as Array<{ content: unknown }>;
    const resultMsg = second.at(-1) as { content: Array<{ content: string }> };
    expect(resultMsg.content[0]?.content).toBe('{"id":"docker-hub-app"}'); // not fenced
    expect(resultMsg.content[0]?.content).not.toContain("<untrusted-tool-output>");
    expect(r.text).toBe("here's the plan");
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

describe("trimToTokenBudget", () => {
  const u = (t: string): LoopMessage => ({ role: "user", content: t });
  const a = (t: string): LoopMessage => ({ role: "assistant", content: t });

  it("keeps the most recent messages within budget, in chronological order", () => {
    const big = "x".repeat(350); // ~100 tokens each
    const h = [u(big), a(big), u(big), a("recent")];
    const kept = trimToTokenBudget(h, 250);
    expect(kept.length).toBeLessThan(h.length); // oldest dropped
    expect(kept[kept.length - 1]).toEqual(a("recent")); // newest retained
    expect(kept).toEqual(h.slice(h.length - kept.length)); // order preserved
  });

  it("always keeps at least the latest message, even over budget", () => {
    const huge = "y".repeat(10_000);
    expect(trimToTokenBudget([u("old"), a(huge)], 5)).toEqual([a(huge)]);
  });
});

describe("fenceToolResult", () => {
  it("wraps short output in the untrusted delimiter without truncating", () => {
    const out = fenceToolResult("hello");
    expect(out).toBe("<untrusted-tool-output>\nhello\n</untrusted-tool-output>");
  });

  it("caps oversized output and notes how much was dropped", () => {
    const out = fenceToolResult("x".repeat(20), 8);
    expect(out).toContain("xxxxxxxx\n…[truncated 12 chars]");
    expect(out.startsWith("<untrusted-tool-output>")).toBe(true);
    expect(out.endsWith("</untrusted-tool-output>")).toBe(true);
  });
});

describe("request_input meta-tool", () => {
  const ask = () =>
    vi
      .fn()
      .mockResolvedValueOnce(
        toolUse("ti_1", "request_input", {
          reason: "need details",
          fields: [{ key: "port", label: "Port", type: "integer" }],
        }),
      )
      .mockResolvedValueOnce(text("created"));

  it("collects answers and feeds them back unfenced (trusted user input)", async () => {
    const createMessage = ask();
    const execTool = vi.fn(async () => ({ text: "ok" }));
    const requestInput = vi.fn(async () => ({ port: 8080 }));
    const r = await runToolLoop({ createMessage, execTool, requestInput }, [
      { role: "user", content: "deploy" },
    ]);
    expect(requestInput).toHaveBeenCalledWith({
      reason: "need details",
      fields: [{ key: "port", label: "Port", type: "integer" }],
    });
    expect(execTool).not.toHaveBeenCalled(); // request_input never reaches execTool
    expect(r.toolEvents[0]).toMatchObject({ tool: "request_input", result: '{"port":8080}' });
    const second = createMessage.mock.calls[1]![0] as Array<{ content: unknown }>;
    const resultMsg = second.at(-1) as { content: Array<{ content: string }> };
    expect(resultMsg.content[0]?.content).toBe('{"port":8080}'); // unfenced
    expect(r.text).toBe("created");
  });

  it("feeds back a cancellation when the user dismisses the form", async () => {
    const createMessage = ask();
    const r = await runToolLoop(
      { createMessage, execTool: deps().execTool, requestInput: async () => null },
      [{ role: "user", content: "deploy" }],
    );
    expect(r.toolEvents[0]).toMatchObject({ tool: "request_input", isError: true });
    const second = createMessage.mock.calls[1]![0] as Array<{ content: unknown }>;
    const resultMsg = second.at(-1) as { content: Array<{ is_error?: boolean }> };
    expect(resultMsg.content[0]?.is_error).toBe(true);
  });

  it("tells the model to ask in chat when no interactive transport is wired", async () => {
    const createMessage = ask();
    const r = await runToolLoop({ createMessage, execTool: deps().execTool }, [
      { role: "user", content: "deploy" },
    ]);
    expect(r.toolEvents[0]?.isError).toBe(true);
    expect(r.toolEvents[0]?.result).toMatch(/ask the user in chat/i);
  });
});

describe("propose_plan meta-tool", () => {
  const riskOf = (n: string) =>
    n === "create_app" ? "write" : n === "delete_database" ? "destructive" : ("read" as const);

  it("approving a plan auto-runs its write steps but still confirms destructive ones", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(
        toolUse("pl_1", "propose_plan", {
          goal: "rebuild",
          steps: [
            { description: "create app", tool: "create_app" },
            { description: "drop old db", tool: "delete_database" },
          ],
        }),
      )
      .mockResolvedValueOnce(toolUse("t1", "create_app", { name: "web" }))
      .mockResolvedValueOnce(toolUse("t2", "delete_database", { id: "db1" }))
      .mockResolvedValueOnce(text("done"));
    const execTool = vi.fn(async () => ({ text: "ok" }));
    const requestApproval = vi.fn(async () => true);
    const requestPlan = vi.fn(async () => true);
    const r = await runToolLoop({ createMessage, execTool, requestApproval, requestPlan, riskOf }, [
      { role: "user", content: "rebuild" },
    ]);
    expect(requestPlan).toHaveBeenCalledTimes(1);
    // create_app (write, in the approved plan) auto-ran; only the destructive
    // delete_database hit the approval gate.
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "delete_database" }),
    );
    expect(execTool).toHaveBeenCalledWith("create_app", { name: "web" });
    expect(execTool).toHaveBeenCalledWith("delete_database", { id: "db1" });
    expect(r.text).toBe("done");
  });

  it("bounds auto-runs to the plan's steps — a 2nd call of a once-granted tool re-gates", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(
        toolUse("pl_1", "propose_plan", {
          goal: "set env once",
          steps: [{ description: "set env", tool: "set_env" }],
        }),
      )
      .mockResolvedValueOnce(toolUse("t1", "set_env", { appId: "a1" })) // granted → auto-runs
      .mockResolvedValueOnce(toolUse("t2", "set_env", { appId: "a1" })) // beyond grant → re-gates
      .mockResolvedValueOnce(text("done"));
    const execTool = vi.fn(async () => ({ text: "ok" }));
    const requestApproval = vi.fn(async () => true);
    const requestPlan = vi.fn(async () => true);
    await runToolLoop(
      { createMessage, execTool, requestApproval, requestPlan, riskOf: () => "write" },
      [{ role: "user", content: "set env" }],
    );
    expect(requestApproval).toHaveBeenCalledTimes(1); // only the 2nd, un-granted call
    expect(execTool).toHaveBeenCalledTimes(2);
  });

  it("a cancelled plan is fed back as an error and nothing auto-runs", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(
        toolUse("pl_1", "propose_plan", {
          goal: "x",
          steps: [{ description: "create", tool: "create_app" }],
        }),
      )
      .mockResolvedValueOnce(text("okay, what should change?"));
    const execTool = vi.fn(async () => ({ text: "ok" }));
    const r = await runToolLoop(
      { createMessage, execTool, requestPlan: async () => false, riskOf },
      [{ role: "user", content: "x" }],
    );
    expect(r.toolEvents[0]).toMatchObject({ tool: "propose_plan", isError: true });
    const second = createMessage.mock.calls[1]![0] as Array<{ content: unknown }>;
    const resultMsg = second.at(-1) as { content: Array<{ content: string; is_error?: boolean }> };
    expect(resultMsg.content[0]?.content).toMatch(/did not approve/i);
    expect(resultMsg.content[0]?.is_error).toBe(true);
  });

  it("without a plan transport, tells the model to proceed conservatively", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUse("pl_1", "propose_plan", { goal: "x", steps: [] }))
      .mockResolvedValueOnce(text("ok"));
    const r = await runToolLoop({ createMessage, execTool: deps().execTool }, [
      { role: "user", content: "x" },
    ]);
    expect(r.toolEvents[0]?.isError).toBeUndefined(); // informational, not an error
    expect(r.toolEvents[0]?.result).toMatch(/proceed conservatively/i);
  });
});

describe("approval gate", () => {
  const deploy = () =>
    vi
      .fn()
      .mockResolvedValueOnce(toolUse("tu_1", "deploy_app", { appId: "a1" }))
      .mockResolvedValueOnce(text("done"));

  it("runs a write tool only after approval", async () => {
    const createMessage = deploy();
    const execTool = vi.fn(async () => ({ text: "ok" }));
    const requestApproval = vi.fn(async () => true);
    await runToolLoop({ createMessage, execTool, riskOf: () => "write", requestApproval }, [
      { role: "user", content: "deploy a1" },
    ]);
    expect(requestApproval).toHaveBeenCalledWith({
      tool: "deploy_app",
      input: { appId: "a1" },
      risk: "write",
    });
    expect(execTool).toHaveBeenCalledWith("deploy_app", { appId: "a1" });
  });

  it("never executes a write tool the user declines, and feeds the decline back", async () => {
    const createMessage = deploy();
    const execTool = vi.fn(async () => ({ text: "ok" }));
    const r = await runToolLoop(
      { createMessage, execTool, riskOf: () => "write", requestApproval: async () => false },
      [{ role: "user", content: "deploy a1" }],
    );
    expect(execTool).not.toHaveBeenCalled();
    expect(r.toolEvents[0]).toMatchObject({ tool: "deploy_app", isError: true });
    const second = createMessage.mock.calls[1]![0] as Array<{ content: unknown }>;
    const resultMsg = second.at(-1) as { content: Array<{ is_error?: boolean }> };
    expect(resultMsg.content[0]?.is_error).toBe(true);
    expect(r.text).toBe("done");
  });

  it("auto-runs read tools without asking", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUse("tu_1", "list_apps", {}))
      .mockResolvedValueOnce(text("2 apps"));
    const requestApproval = vi.fn(async () => true);
    await runToolLoop(
      {
        createMessage,
        execTool: vi.fn(async () => ({ text: "[]" })),
        riskOf: () => "read",
        requestApproval,
      },
      [{ role: "user", content: "apps?" }],
    );
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("declines write tools when no approval transport is wired", async () => {
    const execTool = vi.fn(async () => ({ text: "ok" }));
    const r = await runToolLoop({ createMessage: deploy(), execTool, riskOf: () => "write" }, [
      { role: "user", content: "deploy" },
    ]);
    expect(execTool).not.toHaveBeenCalled();
    expect(r.toolEvents[0]?.isError).toBe(true);
  });
});
