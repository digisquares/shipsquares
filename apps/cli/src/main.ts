#!/usr/bin/env node
import { ApiClient, HttpError } from "./api.js";
import { parseArgs, VALUE_FLAGS } from "./args.js";
import { runApps, runDeploy, runDeployments, runLogs, runStatus } from "./commands.js";
import { loadConfig, saveConfig } from "./config.js";

const HELP = `ss — ShipSquares CLI

Usage:
  ss login --url <url> --email <e> --password <p>   authenticate; saves a session
  ss apps                                           list apps
  ss deploy <appId> [--wait] [--timeout <seconds>]  trigger a deploy (--wait polls)
  ss status <appId>                                 live container metrics
  ss logs <appId> [--tail N]                        runtime container logs (tail)
  ss deployments <appId> [--limit N]                recent deployments

Global flags:
  --json        machine-readable JSON output
  --url <url>   override the control-plane URL (else SHIPSQUARES_URL or saved config)

Auth/config also read from env: SHIPSQUARES_URL, SHIPSQUARES_COOKIE, SHIPSQUARES_CONFIG.`;

async function login(args: ReturnType<typeof parseArgs>): Promise<number> {
  const url = (args.flags.url as string) || process.env.SHIPSQUARES_URL || "";
  const email = args.flags.email as string;
  const password = args.flags.password as string;
  if (!url || !email || !password) {
    process.stderr.write("usage: ss login --url <url> --email <e> --password <p>\n");
    return 1;
  }
  const result = await new ApiClient(url).login(email, password);
  if (!result.ok || !result.cookie) {
    process.stderr.write(`Login failed (${result.status}).\n`);
    return 1;
  }
  saveConfig({ url, cookie: result.cookie });
  process.stdout.write(`Logged in to ${url}.\n`);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2), VALUE_FLAGS);
  const command = args.command;
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (command === "login") return login(args);

  const handlers: Record<string, typeof runApps> = {
    apps: runApps,
    deploy: runDeploy,
    status: runStatus,
    logs: runLogs,
    deployments: runDeployments,
  };
  // Object.hasOwn, not `handlers[command]` truthiness: a bare index would resolve
  // inherited prototype members, so `ss constructor` / `ss toString` slipped past
  // this guard and crashed with a confusing error instead of "Unknown command".
  if (!Object.hasOwn(handlers, command)) {
    process.stderr.write(`Unknown command: ${command}\nRun \`ss help\`.\n`);
    return 1;
  }
  const handler = handlers[command]!;

  const cfg = loadConfig();
  const url = (args.flags.url as string) || cfg.url;
  if (!url) {
    process.stderr.write("No control-plane URL. Run `ss login` or set SHIPSQUARES_URL.\n");
    return 1;
  }
  const api = new ApiClient(url, cfg.cookie);
  try {
    const { output, exitCode } = await handler(api, args);
    process.stdout.write(`${output}\n`);
    return exitCode;
  } catch (err) {
    if (err instanceof HttpError) {
      process.stderr.write(
        err.status === 401 ? "Not authenticated. Run `ss login`.\n" : `${err.message}\n`,
      );
      return 1;
    }
    // network / fetch failure (server unreachable, bad URL, DNS, …)
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Could not reach ${url}: ${msg}\n`);
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
