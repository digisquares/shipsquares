// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
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

  it("handles streamed text deltas, then lands the authoritative answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'event: delta\ndata: {"text":"2 apps "}\n\n',
          'event: delta\ndata: {"text":"running"}\n\n',
          'event: done\ndata: {"conversationId":"conv_1","text":"2 apps running","toolEvents":[]}\n\n',
        ]),
      ),
    );
    renderComponent(<ChatPanel />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("ss:assistant", { detail: { query: "status?" } }));
    });
    await screen.findByText("2 apps running");
  });

  it("handles an approval request mid-stream without breaking the turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'event: approval\ndata: {"id":"appr_1","tool":"deploy_app","input":{"appId":"a1"},"risk":"write"}\n\n',
          'event: done\ndata: {"conversationId":"conv_1","text":"deployed","toolEvents":[]}\n\n',
        ]),
      ),
    );
    renderComponent(<ChatPanel />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("ss:assistant", { detail: { query: "deploy a1" } }));
    });
    await screen.findByText("deployed");
  });

  it("renders the structured-input form mid-turn and submits typed answers", async () => {
    // A controllable SSE stream: emit the input_request, let the form render and
    // submit, THEN land `done` — mirroring the server blocking on /chat/answer.
    const enc = new TextEncoder();
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => (ctrl = c) });
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/v1/chat"
        ? {
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "text/event-stream" }),
            body,
          }
        : jsonResponse(200, { ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderComponent(<ChatPanel />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("ss:assistant", { detail: { query: "deploy nginx" } }));
    });
    await act(async () => {
      ctrl.enqueue(
        enc.encode(
          'event: input_request\ndata: {"id":"in_1","reason":"A couple details",' +
            '"fields":[{"key":"name","label":"App name","type":"string","default":"nginx"},' +
            '{"key":"port","label":"Port","type":"integer","default":80}]}\n\n',
        ),
      );
    });

    await screen.findByText("A couple details");
    expect(screen.getByText("App name")).toBeTruthy();

    // Submit with the prefilled defaults → answers POST to /chat/answer, typed.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/chat/answer",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ id: "in_1", answers: { name: "nginx", port: 80 } }),
      }),
    );

    await act(async () => {
      ctrl.enqueue(
        enc.encode(
          'event: done\ndata: {"conversationId":"conv_1","text":"created nginx","toolEvents":[]}\n\n',
        ),
      );
      ctrl.close();
    });
    await screen.findByText("created nginx");
  });

  it("renders a proposed plan, approves it, and lands the result", async () => {
    const enc = new TextEncoder();
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => (ctrl = c) });
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/v1/chat"
        ? {
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "text/event-stream" }),
            body,
          }
        : jsonResponse(200, { ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderComponent(<ChatPanel />);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("ss:assistant", { detail: { query: "set up web app" } }),
      );
    });
    await act(async () => {
      ctrl.enqueue(
        enc.encode(
          'event: plan\ndata: {"id":"pl_1","goal":"create app + domain",' +
            '"steps":[{"description":"create app web","tool":"create_app"},' +
            '{"description":"add domain","tool":"add_domain"}]}\n\n',
        ),
      );
    });

    await screen.findByText(/create app \+ domain/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /approve plan/i }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/chat/approve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ id: "pl_1", approve: true }),
      }),
    );
    expect(screen.getByText(/Running/)).toBeTruthy(); // approved → live checklist

    await act(async () => {
      ctrl.enqueue(
        enc.encode(
          'event: done\ndata: {"conversationId":"conv_1","text":"all set","toolEvents":[]}\n\n',
        ),
      );
      ctrl.close();
    });
    await screen.findByText("all set");
  });

  it("shows suggested prompts when empty and sends one on click", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { conversationId: "c1", text: "ok", toolEvents: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderComponent(<ChatPanel />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("ss:assistant", { detail: {} })); // open, empty
    });
    const chip = await screen.findByRole("button", { name: "How do I set up PITR?" });
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/chat",
      expect.objectContaining({ method: "POST" }),
    );
    await screen.findByText("ok");
  });

  it("renders a 'What I did' recap for write actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          conversationId: "c1",
          text: "Deployed it.",
          toolEvents: [{ tool: "deploy_app", input: { appId: "app_1" }, result: "{}" }],
        }),
      ),
    );
    renderComponent(<ChatPanel />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("ss:assistant", { detail: { query: "deploy" } }));
    });
    await screen.findByText("Deployed it.");
    expect(screen.getByText("What I did")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Deployed the app" })).toBeTruthy();
  });

  it("shows a per-turn token usage line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          conversationId: "c1",
          text: "answer",
          toolEvents: [],
          usage: { inputTokens: 1100, outputTokens: 200 },
        }),
      ),
    );
    renderComponent(<ChatPanel />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("ss:assistant", { detail: { query: "hi" } }));
    });
    await screen.findByText("answer");
    expect(screen.getByText("1.3k tokens")).toBeTruthy();
  });

  it("Stop aborts a running turn and shows it stopped", async () => {
    // Mirror real fetch: the body stream is tied to the abort signal, so aborting
    // errors the reader (which the panel catches and reports as stopped).
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          init?.signal?.addEventListener("abort", () =>
            c.error(new DOMException("aborted", "AbortError")),
          );
        },
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderComponent(<ChatPanel />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("ss:assistant", { detail: { query: "do a lot" } }));
    });
    const stop = await screen.findByRole("button", { name: "Stop" });
    await act(async () => {
      fireEvent.click(stop);
    });
    await screen.findByText("Stopped.");
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
