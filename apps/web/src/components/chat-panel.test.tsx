// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations, renderComponent } from "../test/component";

import { ChatPanel } from "./chat-panel";

const jsonResponse = (status: number, data: unknown) => ({
  ok: status < 400,
  status,
  headers: new Headers({ "content-type": "application/json" }),
  body: null,
  json: async () => data,
});

const sseResponse = (frames: string[]) => ({
  ok: true,
  status: 200,
  headers: new Headers({ "content-type": "text/event-stream" }),
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  }),
});

afterEach(() => vi.unstubAllGlobals());

describe("ChatPanel (component)", () => {
  it("opens on the ⌘K hand-off, asks the query, and renders the answer + tool summary", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        conversationId: "conv_1",
        text: "you have 2 apps",
        toolEvents: [{ tool: "list_apps", input: {}, result: "[]" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderComponent(<ChatPanel />);

    expect(screen.getByRole("button", { name: /open the assistant/i })).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ss:assistant", { detail: { query: "how many apps?" } }),
      );
    });

    await screen.findByText("you have 2 apps");
    expect(screen.getByText("how many apps?")).toBeTruthy();
    expect(screen.getByText(/ran list_apps/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/chat",
      expect.objectContaining({ method: "POST" }),
    );
    await expectNoA11yViolations(container);
  });

  it("points an unconfigured org at Settings instead of erroring", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(409, { code: "ai.not_configured" })),
    );
    renderComponent(<ChatPanel />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("ss:assistant", { detail: { query: "hi" } }));
    });
    await screen.findByText(/isn(’|')t configured/);
    expect(screen.getByRole("link", { name: /Settings/ })).toBeTruthy();
  });

  it("streams an SSE turn: live tool activity, then the final answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'event: tool\ndata: {"tool":"list_apps","input":{},"result":"[]"}\n\n',
          'event: done\ndata: {"conversationId":"conv_1","text":"2 apps running",' +
            '"toolEvents":[{"tool":"list_apps","input":{},"result":"[]"}]}\n\n',
        ]),
      ),
    );
    renderComponent(<ChatPanel />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("ss:assistant", { detail: { query: "status?" } }));
    });
    await screen.findByText("2 apps running");
    expect(screen.getByText(/ran list_apps/)).toBeTruthy();
  });

  it("surfaces a network failure as a conversation message, not a stuck spinner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    renderComponent(<ChatPanel />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("ss:assistant", { detail: { query: "hi" } }));
    });
    await screen.findByText(/couldn(’|')t reach the server/);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });
});
