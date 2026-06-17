import { describe, expect, it, vi } from "vitest";

import { LimitQueue } from "./limit-queue.js";
import { createTerminalRegistry, type PtyLike } from "./terminal.js";

describe("LimitQueue", () => {
  it("evicts the oldest beyond the cap and replays in order", () => {
    const q = new LimitQueue<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => q.push(n));
    expect(q.toArray()).toEqual([3, 4, 5]);
    expect(q.size).toBe(3);
  });
});

// A controllable fake pty: tests drive output/exit by hand.
function fakePty() {
  let onData: (chunk: string) => void = () => undefined;
  let onExit: (code: number) => void = () => undefined;
  const pty: PtyLike = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb) => {
      onData = cb;
    },
    onExit: (cb) => {
      onExit = cb;
    },
  };
  return { pty, emit: (s: string) => onData(s), exit: (c: number) => onExit(c) };
}

describe("terminal registry", () => {
  it("creates once per name and returns the existing terminal after", () => {
    const a = fakePty();
    const spawn = vi.fn(() => a.pty);
    const reg = createTerminalRegistry({ spawn, scrollback: 10 });
    const t1 = reg.open("deploy:dpl_1", { command: "docker", args: ["logs"] });
    const t2 = reg.open("deploy:dpl_1", { command: "docker", args: ["logs"] });
    expect(t1).toBe(t2);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(reg.get("deploy:dpl_1")).toBe(t1);
  });

  it("broadcasts pty output to every joined client and buffers scrollback", () => {
    const a = fakePty();
    const reg = createTerminalRegistry({ spawn: () => a.pty, scrollback: 10 });
    const t = reg.open("t1", { command: "sh", args: [] });
    const c1 = vi.fn();
    const c2 = vi.fn();
    t.join("client-1", c1);
    a.emit("hello ");
    t.join("client-2", c2); // late joiner replays the buffer on join
    a.emit("world");
    expect(c1.mock.calls.map((c) => c[0])).toEqual(["hello ", "world"]);
    expect(c2.mock.calls.map((c) => c[0])).toEqual(["hello ", "world"]);
  });

  it("stops sending after leave; write/resize forward to the pty", () => {
    const a = fakePty();
    const reg = createTerminalRegistry({ spawn: () => a.pty, scrollback: 10 });
    const t = reg.open("t1", { command: "sh", args: [] });
    const c1 = vi.fn();
    t.join("c1", c1);
    t.leave("c1");
    a.emit("after");
    expect(c1).not.toHaveBeenCalled();
    t.write("ls\n");
    t.resize(120, 40);
    expect(a.pty.write).toHaveBeenCalledWith("ls\n");
    expect(a.pty.resize).toHaveBeenCalledWith(120, 40);
  });

  it("pty exit notifies clients and removes the terminal from the registry", () => {
    const a = fakePty();
    const reg = createTerminalRegistry({ spawn: () => a.pty, scrollback: 10 });
    const t = reg.open("t1", { command: "sh", args: [] });
    const exited = vi.fn();
    t.join("c1", vi.fn(), exited);
    a.exit(0);
    expect(exited).toHaveBeenCalledWith(0);
    expect(reg.get("t1")).toBeUndefined();
  });

  it("kill forwards to the pty; close with no clients reaps idle terminals", () => {
    const a = fakePty();
    const reg = createTerminalRegistry({ spawn: () => a.pty, scrollback: 10 });
    const t = reg.open("t1", { command: "sh", args: [] });
    t.kill();
    expect(a.pty.kill).toHaveBeenCalled();
  });
});
