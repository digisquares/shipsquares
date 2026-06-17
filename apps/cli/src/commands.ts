import type { Api } from "./api.js";
import type { ParsedArgs } from "./args.js";
import { formatApps, formatDeployments, formatLogs, formatMetrics } from "./format.js";
import { pollDeployment } from "./poll.js";

// Each command returns what to print + a process exit code. Commands take the
// Api interface (not the concrete client), so they're unit-tested with a fake.
export interface CommandResult {
  output: string;
  exitCode: number;
}

const ok = (output: string): CommandResult => ({ output, exitCode: 0 });
const fail = (output: string): CommandResult => ({ output, exitCode: 1 });

function appId(args: ParsedArgs): string | null {
  return args.positionals[0] ?? null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runApps(api: Api, args: ParsedArgs): Promise<CommandResult> {
  const apps = await api.listApps();
  return ok(args.flags.json ? JSON.stringify(apps, null, 2) : formatApps(apps));
}

export async function runDeployments(api: Api, args: ParsedArgs): Promise<CommandResult> {
  const id = appId(args);
  if (!id) return fail("usage: ss deployments <appId>");
  const limit = Number(args.flags.limit ?? 10) || 10;
  const deps = await api.listDeployments(id, limit);
  return ok(args.flags.json ? JSON.stringify(deps, null, 2) : formatDeployments(deps));
}

export async function runStatus(api: Api, args: ParsedArgs): Promise<CommandResult> {
  const id = appId(args);
  if (!id) return fail("usage: ss status <appId>");
  const m = await api.appMetrics(id);
  return ok(args.flags.json ? JSON.stringify(m, null, 2) : formatMetrics(m));
}

export async function runLogs(api: Api, args: ParsedArgs): Promise<CommandResult> {
  const id = appId(args);
  if (!id) return fail("usage: ss logs <appId> [--tail N]");
  const tail = Number(args.flags.tail ?? 200) || 200;
  const lines = await api.appLogs(id, tail);
  return ok(args.flags.json ? JSON.stringify(lines, null, 2) : formatLogs(lines));
}

export async function runDeploy(api: Api, args: ParsedArgs): Promise<CommandResult> {
  const id = appId(args);
  if (!id) return fail("usage: ss deploy <appId> [--wait] [--timeout <seconds>]");
  const { id: deploymentId } = await api.deploy(id);
  if (!args.flags.wait) return ok(`Deploy queued: ${deploymentId}`);

  // --wait: resilient poll (poll.ts, tested) — transient blips don't fail CI;
  // 401/404 abort; --timeout overrides the 10-minute default budget.
  const timeoutSec = Number(args.flags.timeout ?? 600) || 600;
  const r = await pollDeployment({
    getStatus: () => api.getDeployment(deploymentId),
    sleep,
    timeoutMs: timeoutSec * 1000,
  });
  if (r.outcome === "succeeded") return ok(`Deploy ${deploymentId}: succeeded`);
  return fail(`Deploy ${deploymentId}: ${r.outcome}${r.error ? ` — ${r.error}` : ""}`);
}
