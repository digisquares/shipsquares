import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// MCP stdio smoke test (13-mcp-server.md): initialize → tools/list →
// tools/call against a dead API URL. ASSERTS (exits non-zero on failure):
// init succeeds, the expected tool surface is present, and the call surfaces
// isError (the API is unreachable by design). Response-driven — no sleeps.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.argv[2] ?? repoRoot;
const EXPECTED_MIN_TOOLS = 7;
const DEADLINE_MS = 15_000;

const child = spawn("node", ["mcp/dist/index.js"], {
  cwd,
  env: { ...process.env, SHIPSQUARES_URL: "http://127.0.0.1:9999" },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (d) => (stderr += d.toString()));

const failures = [];
const pending = new Map(); // id -> resolve
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      // Anything non-JSON on stdout would corrupt JSON-RPC framing.
      failures.push(`non-JSON line on stdout: ${line.slice(0, 120)}`);
    }
  }
});

const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
const request = (id, method, params) =>
  new Promise((res, rej) => {
    pending.set(id, res);
    setTimeout(
      () => rej(new Error(`timeout waiting for response id=${id} (${method})`)),
      DEADLINE_MS,
    );
    send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
  });

const assert = (cond, label) => {
  console.log(`${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) failures.push(label);
};

try {
  const init = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  assert(Boolean(init.result?.serverInfo?.name), "initialize returns serverInfo");
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const tools = await request(2, "tools/list");
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  assert(
    names.length >= EXPECTED_MIN_TOOLS,
    `tools/list has >= ${EXPECTED_MIN_TOOLS} tools (got ${names.length}: ${names.join(",")})`,
  );
  assert(names.includes("list_apps"), "list_apps tool present");

  const call = await request(3, "tools/call", { name: "list_apps", arguments: {} });
  assert(call.result?.isError === true, "tools/call against a dead API surfaces isError");
} catch (e) {
  failures.push(e instanceof Error ? e.message : String(e));
  console.log(`FAIL - ${failures.at(-1)}`);
} finally {
  child.kill();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s).`);
  if (stderr.trim()) console.error("stderr:", stderr.trim());
  process.exit(1);
}
console.log("\nmcp smoke: all assertions passed");
