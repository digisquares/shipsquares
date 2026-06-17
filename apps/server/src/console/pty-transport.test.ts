import { describe, expect, it, vi } from "vitest";

import { execPtySpec, makePtyTransport, type NodePtyModule } from "./pty-transport.js";

describe("execPtySpec", () => {
  it("allocates a TTY in the container (docker exec -it)", () => {
    expect(execPtySpec("ss-app_1", "bash")).toEqual({
      command: "docker",
      args: ["exec", "-it", "ss-app_1", "bash"],
    });
  });
});

describe("makePtyTransport", () => {
  function fakePty() {
    const handlers = {
      data: undefined as ((d: string) => void) | undefined,
      exit: undefined as ((e: { exitCode: number }) => void) | undefined,
    };
    const ipty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: (cb: (d: string) => void) => {
        handlers.data = cb;
      },
      onExit: (cb: (e: { exitCode: number }) => void) => {
        handlers.exit = cb;
      },
    };
    const spawn = vi.fn(() => ipty);
    const mod: NodePtyModule = { spawn: spawn as unknown as NodePtyModule["spawn"] };
    return { mod, ipty, handlers, spawn };
  }

  it("spawns the command via node-pty with default winsize and maps the surface", () => {
    const { mod, ipty, handlers, spawn } = fakePty();
    const pty = makePtyTransport(mod)({ command: "docker", args: ["exec", "-it", "c", "sh"] });
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      ["exec", "-it", "c", "sh"],
      expect.objectContaining({ cols: expect.any(Number), rows: expect.any(Number) }),
    );

    const seen: string[] = [];
    pty.onData((d) => seen.push(d));
    handlers.data?.("hello");
    expect(seen).toEqual(["hello"]);

    pty.write("ls\n");
    expect(ipty.write).toHaveBeenCalledWith("ls\n");
    pty.resize(120, 40);
    expect(ipty.resize).toHaveBeenCalledWith(120, 40);

    let exitCode = -99;
    pty.onExit((c) => (exitCode = c));
    handlers.exit?.({ exitCode: 0 });
    expect(exitCode).toBe(0);

    pty.kill();
    expect(ipty.kill).toHaveBeenCalled();
  });
});
