import { randomBytes } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";

import { parseConsoleFrame, type ConsoleFrame } from "../console/protocol.js";
import { execPtySpec, loadNodePty, makePtyTransport } from "../console/pty-transport.js";
import { dockerExecTransport, execSpawnSpec } from "../console/spawn-transport.js";
import { createTerminalRegistry, type Terminal } from "../console/terminal.js";
import { checkPermission } from "../rbac/require-permission.js";
import * as deploymentsService from "../services/deployments.service.js";

// Interactive container console over WS (21-logs-and-console.md): frames are
// validated by the tested protocol parser (target charset, shell allowlist,
// bounded sizes) before anything reaches docker. Exec is privileged →
// app:write. One shared terminal per target (late joiners replay scrollback);
// the underlying process dies with its last client.
//
// Transport: true-TTY via node-pty (`docker exec -it` — readline, vim/top,
// colour, resize) when the optional native build is present; otherwise the
// pipe transport (`docker exec -i`). Chosen once at boot.
export const consoleWsRoutes: FastifyPluginAsync = async (app) => {
  const pty = await loadNodePty();
  const tty = pty !== null;
  const registry = createTerminalRegistry({
    spawn: tty ? makePtyTransport(pty) : dockerExecTransport,
    scrollback: 500,
  });
  const specFor = tty ? execPtySpec : execSpawnSpec;
  app.log.info?.(`console transport: ${tty ? "node-pty (true TTY)" : "pipe (docker exec -i)"}`);

  app.get("/ws/console", { websocket: true }, (socket, req) => {
    const send = (msg: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };
    const ctx = req.ctx;
    const perm = checkPermission(ctx, "app:write");
    if (!perm.ok || !ctx?.organizationId) {
      send({ type: "error", code: perm.ok ? "auth.unauthenticated" : perm.code });
      socket.close();
      return;
    }
    const orgId = ctx.organizationId;

    const clientId = randomBytes(8).toString("hex");
    let term: Terminal | null = null;
    let opening = false; // guards the async ownership check against a second `open`

    // Open an exec, but only after confirming the target container belongs to the
    // actor's org. `app:write` alone is org-agnostic; without this a member of one
    // org could `docker exec` into another org's container by naming it (names are
    // derivable from the app id). Mirrors the getApp gate in ws.ts.
    const openTerminal = async (frame: Extract<ConsoleFrame, { type: "open" }>): Promise<void> => {
      if (term || opening) return send({ type: "error", code: "console.already_open" });
      opening = true;
      try {
        const owned = await deploymentsService.containerBelongsToOrg(app.db, orgId, frame.target);
        if (!owned) return send({ type: "error", code: "console.forbidden" });
        // the socket may have closed (and its cleanup run) during the await — don't
        // spawn an orphaned exec no close handler will reap.
        if (socket.readyState !== socket.OPEN || term) return;
        term = registry.open(`exec:${frame.target}`, specFor(frame.target, frame.shell));
        term.join(
          clientId,
          (chunk) => send({ type: "data", data: chunk }),
          (code) => {
            send({ type: "exit", code });
            socket.close();
          },
        );
        send({ type: "opened", target: frame.target });
      } finally {
        opening = false;
      }
    };

    socket.on("message", (raw: Buffer) => {
      const frame = parseConsoleFrame(raw.toString("utf8"));
      if (!frame) return send({ type: "error", code: "console.bad_frame" });

      if (frame.type === "open") {
        void openTerminal(frame);
        return undefined;
      }
      if (!term) return send({ type: "error", code: "console.not_open" });
      if (frame.type === "input") term.write(frame.data);
      else term.resize(frame.cols, frame.rows);
      return undefined;
    });

    socket.on("close", () => {
      if (!term) return;
      term.leave(clientId);
      if (term.clientCount() === 0) term.kill(); // last client gone → kill the exec
    });
  });
};
