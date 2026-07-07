import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { loadConfig, newId, type Env } from "@ss/shared";
import { and, eq, lt } from "drizzle-orm";

import { buildPackArgs } from "../build/buildpacks.js";
import { buildComposeArgs } from "../build/compose.js";
import { resolveComposeFile } from "../build/dispatch.js";
import { buildDockerfileArgs } from "../build/dockerfile.js";
import { buildNixpacksArgs } from "../build/nixpacks.js";
import { safePublishDir, staticDockerfile } from "../build/static.js";
import type { Db } from "../db/index.js";
import {
  apps,
  deploymentLogs,
  deploymentSteps,
  deployments,
  previewEnvironments,
  servers,
} from "../db/schema/index.js";
import { computeTrim } from "../deployment-logs/trim.js";
import { parsePortMapping } from "../docker/ports.js";
import { selectImagesToPrune } from "../docker/prune.js";
import { dockerLoginCommand, dockerLogoutCommand } from "../docker/registry-auth.js";
import { swallow } from "../lib/swallow.js";
import { convergeProxy } from "../proxy/caddy/converge.js";
import { logBus } from "../realtime/bus.js";
import { resolveDeployEnv } from "../services/env.service.js";
import { notifyDeploymentOutcome } from "../services/notifications.service.js";
import { dispatchDeploymentOutcome } from "../services/outbound-webhooks.service.js";
import { sshPool } from "../ssh/pool.js";
import { openSecretRef } from "../vcs/provider-deps.js";
import { cloneUrlFor } from "../vcs/resolve-clone.js";

import { clearDeploy, isCancelRequested, registerDeploy } from "./cancel-registry.js";
import { formatDotEnv } from "./dotenv.js";
import { type Exec, firstStdout, localExec, runCommand } from "./exec.js";
import { preDeployCommand, postDeployCommand } from "./hooks.js";
import { createLogWriter, createRedactor } from "./log-writer.js";
import { resolveServerExecTarget } from "./server-exec.js";

// The real deploy pipeline (06-deploy-engine.md): clone the app's repo →
// build (Dockerfile/Nixpacks → image, or `docker compose up` for a
// compose-strategy source with a compose file) → run → health → converge.
// Each step records a deployment_steps row and streams output to
// deployment_logs. Routing the app's domain to the container is the proxy
// converge step (08) — tracked separately; this owns build+run+status+logs.
const LOG_LINE_CAP = 5000; // keep the newest N lines per deployment (28)
// Step timeouts: a hung git/docker must not leave a deployment
// `running` forever. Streaming/housekeeping docker calls stay untimed.
const FETCH_TIMEOUT_MS = 10 * 60_000;
const PULL_TIMEOUT_MS = 15 * 60_000;
const BUILD_TIMEOUT_MS = 30 * 60_000;
const RUN_TIMEOUT_MS = 2 * 60_000;

export interface DeployMeta {
  image?: string;
  container?: string;
  hostPort?: string;
  /** host the published port is reachable on — 127.0.0.1 locally, the worker's
   *  address for a remote (serverId) deploy. Caddy routes the upstream here. */
  host?: string;
  containerPort?: number;
  url?: string;
}

/** Thrown when a cancel request aborts the pipeline — finalizes the row as
 *  cancelled (not failed) in the catch. */
class CancelledError extends Error {
  constructor() {
    super("deployment cancelled");
    this.name = "CancelledError";
  }
}

/** The deterministic image name (and container-name base) for an app. */
export function containerName(appId: string): string {
  return `ss-${appId.toLowerCase()}`;
}

/** True once the container answers an HTTP request on its published port. A bare
 *  TCP connect is NOT enough — docker-proxy accepts the connection even when
 *  nothing listens inside, so an actual request is what reveals a dead backend.
 *  Any HTTP status (even 404/500) means the app is up. (HTTP-oriented; non-HTTP
 *  services like databases want a protocol-specific check — future.) */
async function httpOk(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitHealthy(
  host: string,
  port: number,
  attempts = 30,
  intervalMs = 1000,
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (await httpOk(host, port)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/** Tear down an app's compose project (no-op when none exists) — `-p` finds
 *  the containers by compose's own project label, so no -f is needed. */
export async function removeAppProject(appId: string): Promise<void> {
  await runCommand("docker", [
    "compose",
    "-p",
    containerName(appId),
    "down",
    "--remove-orphans",
  ]).catch((e) => swallow("deploy.compose_down", e));
}

/** Remove all of an app's SINGLE-RUN containers (by our label — compose
 *  project containers don't carry it; see removeAppProject), optionally
 *  keeping one — used for the zero-downtime swap (keep the new), app deletion
 *  (remove all), and legacy cleanup when an app switches to compose. */
export async function removeAppContainers(
  appId: string,
  keepContainer?: string,
  exec: Exec = localExec,
): Promise<void> {
  const list = await exec("docker", [
    "ps",
    "-aq",
    "--no-trunc",
    "--filter",
    `label=shipsquares.app=${appId}`,
  ]);
  const ids = list.lines
    .filter((l) => l.stream === "stdout")
    .map((l) => l.line.trim())
    .filter(Boolean);
  const keepId = keepContainer
    ? firstStdout(await exec("docker", ["inspect", "-f", "{{.Id}}", keepContainer]))
    : "";
  for (const id of ids) {
    if (id === keepId) continue;
    await exec("docker", ["rm", "-f", id]);
  }
}

async function startStep(
  db: Db,
  deploymentId: string,
  ordinal: number,
  name: string,
): Promise<string> {
  const id = newId("stp");
  await db
    .insert(deploymentSteps)
    .values({ id, deploymentId, ordinal, name, status: "running", startedAt: new Date() });
  return id;
}

async function finishStep(db: Db, id: string, status: "succeeded" | "failed"): Promise<void> {
  await db
    .update(deploymentSteps)
    .set({ status, finishedAt: new Date() })
    .where(eq(deploymentSteps.id, id));
}

async function failDeployment(db: Db, deploymentId: string, message: string): Promise<void> {
  await db
    .update(deployments)
    .set({ status: "failed", errorMessage: message, finishedAt: new Date() })
    .where(eq(deployments.id, deploymentId));
  await db
    .update(deploymentSteps)
    .set({ status: "failed", finishedAt: new Date() })
    .where(
      and(eq(deploymentSteps.deploymentId, deploymentId), eq(deploymentSteps.status, "running")),
    );
  logBus.publishStatus(deploymentId, "failed");
  // Best-effort: tell subscribed channels + outbound hooks (never block/raise
  // on the deploy path).
  void notifyDeploymentOutcome(db, loadConfig(), deploymentId, "deploy.failed").catch(
    () => undefined,
  );
  void dispatchDeploymentOutcome(db, loadConfig(), deploymentId, "deploy.failed").catch(
    () => undefined,
  );
}

/**
 * Run a deployment to completion. Never throws — failures land in the row.
 * `opts.image` short-circuits the fetch+build and re-runs an existing image —
 * this is how a rollback redeploys a previous deployment's image.
 */
export async function executeDeploy(
  db: Db,
  deploymentId: string,
  opts: { image?: string; preview?: { prNumber: number; branch: string } } = {},
): Promise<void> {
  const dep = (
    await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1)
  )[0];
  if (!dep) return;
  const app = (await db.select().from(apps).where(eq(apps.id, dep.appId)).limit(1))[0];
  if (!app) return failDeployment(db, deploymentId, "app not found");

  // Atomic claim: only a still-queued row may start. A cancelled deployment
  // redelivered by the queue (or a double delivery racing the inline
  // fallback) must never resurrect into a running pipeline.
  const claimed = await db
    .update(deployments)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "queued")))
    .returning({ id: deployments.id });
  if (!claimed[0]) return;
  logBus.publishStatus(deploymentId, "running");

  // Track this run so a cancel request (R cancel-running) can SIGKILL the
  // current child and finalize the row as cancelled. signal threads into the
  // long-running build/clone/up commands.
  const cancel = registerDeploy(deploymentId);
  const signal = cancel.signal;

  // Executor knobs come from the validated EnvSchema (SS_BUILDS_DIR etc.) — no
  // bare process.env reads.
  const cfg = loadConfig();
  const workdir = join(cfg.SS_BUILDS_DIR, deploymentId);
  const image = containerName(app.id);
  const container = containerName(app.id);

  // R4.1 multi-server: resolve where this app deploys. A null serverId (or the
  // control server) runs locally; a worker runs agentlessly over SSH. Shadowing
  // `runCommand` re-routes EVERY command in this function through the chosen
  // transport — local stays byte-identical (target.exec === localExec,
  // host === 127.0.0.1); a worker builds/runs on its own docker daemon.
  const server = app.serverId
    ? ((await db.select().from(servers).where(eq(servers.id, app.serverId)).limit(1))[0] ?? null)
    : null;
  const target = await resolveServerExecTarget(server, {
    readKey: (ref) => Promise.resolve(openSecretRef(ref, cfg)),
    pool: sshPool,
  });

  const runCommand: Exec = target.exec;
  // Resilient ingest: sanitized once, published live, DB-batched —
  // a failed INSERT can no longer become an unhandled rejection. Secrets minted
  // mid-pipeline (the clone token) register on the redactor before first use.
  const redactor = createRedactor();
  const writer = createLogWriter({
    deploymentId,
    insert: async (rows) => {
      await db.insert(deploymentLogs).values(rows);
    },
    publish: (r) =>
      logBus.publishLog(deploymentId, {
        seq: r.seq,
        stream: r.stream,
        line: r.line,
        at: r.at.toISOString(),
      }),
    onError: () => undefined, // a dropped batch must never fail the deploy
    redact: redactor.redact,
  });
  const logTo = (stepId: string) => (stream: "stdout" | "stderr" | "system", line: string) => {
    writer.write(stepId, stream, line);
  };

  try {
    let tag: string;
    let commit: string;

    if (opts.image) {
      // ── rollback: reuse an existing image, skip fetch + build ────────────────
      tag = opts.image;
      commit = opts.image.includes(":") ? (opts.image.split(":").pop() ?? "") : "";
    } else if (app.image) {
      // ── image source: pull + run a registry image, no build (Docker Hub etc.) ─
      const pullStep = await startStep(db, deploymentId, 0, "pull");
      // Private registry: log in with the app's selected credential (sealed at
      // rest; the stdin-piped login never puts the password on argv) and log
      // out afterwards regardless of the pull result.
      let loggedOutOf: string | null = null;
      if (app.registryCredentialId) {
        const { openRegistryCredential } =
          await import("../services/registry-credentials.service.js");
        const cred = await openRegistryCredential(db, loadConfig(), app.registryCredentialId);
        if (cred) {
          const login = await runCommand(
            "bash",
            [
              "-c",
              dockerLoginCommand({
                registry: cred.registryUrl,
                username: cred.username,
                password: cred.password,
              }),
            ],
            { timeoutMs: 60_000 },
          );
          if (login.code !== 0) throw new Error(`docker login ${cred.registryUrl} failed`);
          loggedOutOf = cred.registryUrl;
        }
      }
      let pull;
      try {
        pull = await runCommand("docker", ["pull", app.image], {
          onLine: (s, l) => void logTo(pullStep)(s, l),
          timeoutMs: PULL_TIMEOUT_MS,
        });
      } finally {
        if (loggedOutOf !== null) {
          await runCommand("bash", ["-c", dockerLogoutCommand(loggedOutOf)], {
            timeoutMs: 30_000,
          }).catch((e) => swallow("deploy.docker_logout", e));
        }
      }
      if (pull.code !== 0) {
        throw new Error(`docker pull ${app.image} failed${pull.timedOut ? " (timed out)" : ""}`);
      }
      await finishStep(db, pullStep, "succeeded");
      tag = app.image;
      commit = "";
    } else if (app.repo) {
      // ── fetch ──────────────────────────────────────────────────────────────
      if (target.remote) {
        // the clone/build context lives on the WORKER for a remote deploy —
        // the node fs calls below would (wrongly) prepare the control plane.
        await runCommand("rm", ["-rf", workdir]);
        await runCommand("mkdir", ["-p", workdir]);
      } else {
        await rm(workdir, { recursive: true, force: true });
        await mkdir(workdir, { recursive: true });
      }
      const fetchStep = await startStep(db, deploymentId, 0, "fetch");
      // Token-injected URL when the app is bound to a VCS connection (26 handoff).
      // Register the credential on the redactor so git output echoing the URL
      // (clone errors do) never lands in logs with the token intact (19).
      const cloneUrl = await cloneUrlFor(db, app);
      try {
        const u = new URL(cloneUrl);
        if (u.password) redactor.add(u.password);
      } catch {
        /* non-URL clone strings have no embedded credential */
      }
      const clone = await runCommand(
        "git",
        [
          "clone",
          "--depth",
          "1",
          "--branch",
          opts.preview?.branch ?? app.branch,
          cloneUrl,
          workdir,
        ],
        { onLine: (s, l) => void logTo(fetchStep)(s, l), timeoutMs: FETCH_TIMEOUT_MS, signal },
      );
      if (clone.aborted) throw new CancelledError();
      if (clone.code !== 0) {
        throw new Error(`git clone failed${clone.timedOut ? " (timed out)" : ""}`);
      }
      commit = firstStdout(await runCommand("git", ["-C", workdir, "rev-parse", "HEAD"]));
      await finishStep(db, fetchStep, "succeeded");

      // ── compose path (07): a compose-strategy source WITH a compose file
      // deploys as a compose project. Previews keep the single-container
      // fallback — their per-PR container naming/teardown doesn't fit a
      // project. No compose file → the detection fallback below.
      if (app.buildStrategy === "compose" && !opts.preview) {
        const composeRel = resolveComposeFile(
          { rootDirectory: app.buildConfig.rootDirectory, composePath: app.composePath },
          { has: (p) => existsSync(join(workdir, p)) },
        );
        if (composeRel) {
          if (target.remote) {
            throw new Error(
              "remote compose deploys are not yet supported — use an image or dockerfile app on a worker (R4.1 tail)",
            );
          }
          await composeUp({
            db,
            deploymentId,
            app,
            cfg,
            workdir,
            composeRel,
            commit,
            redactor,
            logTo,
          });
          return;
        }
      }

      // ── build — honor the app's strategy + buildConfig (07) ─────────────────
      // "compose" with no compose file falls back to detection
      // (Dockerfile-else-nixpacks); an explicit dockerfile/nixpacks choice is
      // followed exactly. buildConfig supplies a custom Dockerfile path /
      // build context subdirectory.
      const buildStep = await startStep(db, deploymentId, 1, "build");
      tag = `${image}:${commit.slice(0, 7) || "latest"}`;
      const buildCfg = app.buildConfig;
      const context = join(workdir, buildCfg.rootDirectory ?? ".");
      const dockerfile = join(context, buildCfg.dockerfilePath ?? "Dockerfile");
      let strategy = app.buildStrategy;
      if (!target.remote) {
        // existsSync stats the CONTROL plane — only meaningful for a local build.
        if (strategy === "compose") strategy = existsSync(dockerfile) ? "dockerfile" : "nixpacks";
        if (strategy === "dockerfile" && !existsSync(dockerfile)) {
          throw new Error(`build strategy is "dockerfile" but ${dockerfile} does not exist`);
        }
      } else {
        // Remote: can't stat the worker fs from here. Support image (handled
        // earlier) + dockerfile; a missing Dockerfile fails the build with a
        // clear docker error. Other strategies need tools/files on the worker.
        if (strategy === "compose") strategy = "dockerfile";
        if (strategy !== "dockerfile") {
          throw new Error(
            `remote deploys currently support image + dockerfile strategies, not "${strategy}" (R4.1 tail)`,
          );
        }
      }

      let build;
      if (strategy === "static") {
        // Static: generate a throwaway Dockerfile that serves the publish dir
        // over busybox httpd, then build it like any Dockerfile.
        const publishDir = safePublishDir(buildCfg.publishDirectory);
        const publishPath = join(context, publishDir);
        if (!existsSync(publishPath)) {
          throw new Error(`publish directory "${publishDir}" does not exist in the repo`);
        }
        const genDockerfile = join(context, ".shipsquares.static.Dockerfile");
        await writeFile(
          genDockerfile,
          staticDockerfile({ publishDir, port: app.port || cfg.SS_APP_PORT }),
          "utf8",
        );
        build = await runCommand(
          "docker",
          buildDockerfileArgs({ imageRef: tag, dockerfile: genDockerfile, context }),
          {
            env: { DOCKER_BUILDKIT: "1" },
            onLine: (s, l) => void logTo(buildStep)(s, l),
            timeoutMs: BUILD_TIMEOUT_MS,
            signal,
          },
        );
      } else if (strategy === "buildpacks") {
        // Cloud-native buildpacks: `pack build` from the context, no Dockerfile.
        build = await runCommand(
          "pack",
          buildPackArgs({
            imageRef: tag,
            context,
            ...(buildCfg.builder ? { builder: buildCfg.builder } : {}),
          }),
          {
            onLine: (s, l) => void logTo(buildStep)(s, l),
            timeoutMs: BUILD_TIMEOUT_MS,
            signal,
          },
        );
      } else {
        const useDockerfile = strategy === "dockerfile";
        build = useDockerfile
          ? await runCommand(
              "docker",
              buildDockerfileArgs({ imageRef: tag, dockerfile, context }),
              {
                env: { DOCKER_BUILDKIT: "1" },
                onLine: (s, l) => void logTo(buildStep)(s, l),
                timeoutMs: BUILD_TIMEOUT_MS,
                signal,
              },
            )
          : await runCommand("nixpacks", buildNixpacksArgs({ appName: tag, workDir: context }), {
              onLine: (s, l) => void logTo(buildStep)(s, l),
              timeoutMs: BUILD_TIMEOUT_MS,
              signal,
            });
      }
      if (build.aborted) throw new CancelledError();
      if (build.code !== 0) {
        throw new Error(`build failed${build.timedOut ? " (timed out)" : ""}`);
      }
      await runCommand("docker", ["tag", tag, `${image}:latest`]);
      await finishStep(db, buildStep, "succeeded");
    } else {
      throw new Error("app has no repo or image to deploy");
    }

    // ── up: run the NEW container alongside the old (zero-downtime) ─────────────
    const containerPort = app.port || cfg.SS_APP_PORT;
    let upOrdinal = opts.image ? 0 : app.image ? 1 : 2;
    const upStep = await startStep(db, deploymentId, upOrdinal, "up");
    // Inject the app's env. `-e KEY` (no value) makes docker read each value from
    // its OWN environment, so secret values never appear in argv (ps) or a file.
    // Resolution goes through the 11 resolver (`${secret:NAME}` expansion), and
    // every dereferenced secret value joins the log redactor — a secret
    // echoed by the app at startup is masked in deployment logs/WS.
    const resolved = await resolveDeployEnv(db, loadConfig(), app.id);
    const appEnv = resolved.values;
    for (const secret of resolved.redactSet) redactor.add(secret);
    if (appEnv.PORT === undefined) appEnv.PORT = String(containerPort);
    const envFlags = Object.keys(appEnv).flatMap((k) => ["-e", k]);
    // Resource limits (32-monitoring / app resource allocation): enforced by the
    // kernel via docker run flags. cpu_limit -> --cpus, mem -> --memory (+ soft).
    const resourceFlags: string[] = [];
    if (app.cpuLimit) resourceFlags.push("--cpus", String(app.cpuLimit));
    if (app.memLimitBytes) resourceFlags.push("--memory", String(app.memLimitBytes));
    if (app.memReservationBytes)
      resourceFlags.push("--memory-reservation", String(app.memReservationBytes));
    // unique name so the new container runs WHILE the old one keeps serving
    // ── pre-deploy hook: migrations etc. against the NEW image, before traffic ─
    if (app.preDeployCommand) {
      const preStep = await startStep(db, deploymentId, upOrdinal, "pre-deploy");
      const pre = await runCommand("bash", ["-c", preDeployCommand(tag, app.preDeployCommand)], {
        onLine: (s, l) => void logTo(preStep)(s, l),
        timeoutMs: 10 * 60_000,
      });
      if (pre.code !== 0) {
        await finishStep(db, preStep, "failed");
        throw new Error(`pre-deploy hook failed (exit ${pre.code})`);
      }
      await finishStep(db, preStep, "succeeded");
      upOrdinal += 1;
    }

    const { previewContainerName } = await import("../previews/orchestrator.js");
    const newContainer = opts.preview
      ? previewContainerName(app.id, opts.preview.prNumber) // exact: teardown removes this name
      : `${container}-${deploymentId.slice(-8).toLowerCase()}`;
    await runCommand("docker", ["rm", "-f", newContainer]); // clear a stale same-name container
    const run = await runCommand(
      "docker",
      [
        "run",
        "-d",
        "--name",
        newContainer,
        "--label",
        `shipsquares.app=${app.id}`,
        "--restart",
        "unless-stopped",
        ...envFlags,
        ...resourceFlags,
        "-p",
        // Bind the published port to the host the control plane reaches the app
        // on: loopback for a local deploy; the worker's own address for a remote
        // one (its private VNet IP — NOT 0.0.0.0, so the port isn't exposed on
        // the worker's public interface). health + Caddy upstream use the same
        // `target.host` (R4.1).
        `${target.remote ? target.host : "127.0.0.1"}::${containerPort}`,
        tag,
      ],
      {
        env: appEnv,
        onLine: (s, l) => void logTo(upStep)(s, l),
        timeoutMs: RUN_TIMEOUT_MS,
      },
    );
    if (run.code !== 0) throw new Error(`docker run failed${run.timedOut ? " (timed out)" : ""}`);
    const mapping = firstStdout(
      await runCommand("docker", ["port", newContainer, `${containerPort}/tcp`]),
    );
    const hostPort = mapping.split(":").pop() ?? "";
    await finishStep(db, upStep, "succeeded");

    // ── health: gate the swap; a bad new container never replaces a working one ─
    const healthStep = await startStep(db, deploymentId, upOrdinal + 1, "health");
    const healthy =
      Number(hostPort) > 0 &&
      (await waitHealthy(target.host, Number(hostPort), cfg.SS_HEALTH_ATTEMPTS));
    if (!healthy) {
      await runCommand("docker", ["rm", "-f", newContainer]); // discard the bad one
      await finishStep(db, healthStep, "failed");
      // the OLD container + its route are untouched — no downtime
      throw new Error("health check failed: container did not start listening");
    }
    logTo(healthStep)("system", `healthy on :${containerPort} (${target.host}:${hostPort})`);
    await finishStep(db, healthStep, "succeeded");

    // ── post-deploy hook: runs INSIDE the healthy new container, still pre-swap ─
    if (app.postDeployCommand) {
      const postStep = await startStep(db, deploymentId, upOrdinal + 2, "post-deploy");
      const post = await runCommand(
        "bash",
        ["-c", postDeployCommand(newContainer, app.postDeployCommand)],
        { onLine: (s, l) => void logTo(postStep)(s, l), timeoutMs: 10 * 60_000 },
      );
      if (post.code !== 0) {
        await runCommand("docker", ["rm", "-f", newContainer]); // discard like a failed health
        await finishStep(db, postStep, "failed");
        throw new Error(`post-deploy hook failed (exit ${post.code})`);
      }
      await finishStep(db, postStep, "succeeded");
    }

    const meta: DeployMeta = {
      image: tag,
      container: newContainer,
      containerPort,
      ...(hostPort
        ? { hostPort, host: target.host, url: `http://${target.host}:${hostPort}` }
        : {}),
    };
    await db
      .update(deployments)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        commitAfter: commit,
        meta: meta as Record<string, unknown>,
      })
      .where(eq(deployments.id, deploymentId));
    logBus.publishStatus(deploymentId, "succeeded");
    void notifyDeploymentOutcome(db, loadConfig(), deploymentId, "deploy.succeeded").catch(
      () => undefined,
    );
    void dispatchDeploymentOutcome(db, loadConfig(), deploymentId, "deploy.succeeded").catch(
      () => undefined,
    );

    // Swap: route to the new container, THEN remove the old one(s). Converge is
    // isolated so a missing Caddy/domain never fails an otherwise-good deploy.
    try {
      await convergeProxy(db, loadConfig());
    } catch (e) {
      // no caddy reachable or no domain yet — the deploy still succeeded
      swallow("deploy.swap_converge", e);
    }
    if (opts.preview) {
      // Previews never sweep the app's containers (that would kill the main
      // app) and never prune shared images. Stamp the row; converge reads the
      // meta hostPort and routes the preview FQDN from DB state.
      await db
        .update(previewEnvironments)
        .set({ deploymentId, status: "running" })
        .where(
          and(
            eq(previewEnvironments.appId, app.id),
            eq(previewEnvironments.prNumber, opts.preview.prNumber),
          ),
        );
      await convergeProxy(db, cfg).catch((e) => swallow("deploy.preview_converge", e));
      const { postPreviewComment } = await import("../previews/comments.js");
      const domain = (
        await db
          .select({ domain: previewEnvironments.domain })
          .from(previewEnvironments)
          .where(
            and(
              eq(previewEnvironments.appId, app.id),
              eq(previewEnvironments.prNumber, opts.preview.prNumber),
            ),
          )
          .limit(1)
      )[0]?.domain;
      void postPreviewComment(db, cfg, app.id, opts.preview.prNumber, "deployed", domain);
      return;
    }
    await removeAppContainers(app.id, newContainer, target.exec);

    // Rollback-image retention: keep the newest imagesToKeep tags plus the one
    // just deployed; prune the rest (best-effort — never fails the deploy).
    try {
      const listed = await runCommand("docker", [
        "images",
        image,
        "--format",
        "{{.Repository}}:{{.Tag}}",
      ]);
      const tagList = listed.lines
        .filter((l) => l.stream === "stdout")
        .map((l) => l.line.trim())
        .filter((t) => t.length > 0 && !t.endsWith(":latest") && !t.endsWith(":<none>"));
      // docker lists newest-first — synthesize recency from position.
      const candidates = tagList.map((t, i) => ({ tag: t, createdAt: tagList.length - i }));
      for (const stale of selectImagesToPrune(candidates, app.imagesToKeep, tag)) {
        await runCommand("docker", ["rmi", stale]);
      }
    } catch (e) {
      swallow("deploy.image_prune", e);
    }
  } catch (err) {
    // A cancel request (signal aborted) finalizes as cancelled, not failed —
    // it's an operator action, not a build error.
    if (err instanceof CancelledError || isCancelRequested(deploymentId)) {
      await db
        .update(deployments)
        .set({ status: "cancelled", finishedAt: new Date(), errorMessage: "cancelled" })
        .where(eq(deployments.id, deploymentId));
      await db
        .update(deploymentSteps)
        .set({ status: "failed", finishedAt: new Date() })
        .where(
          and(
            eq(deploymentSteps.deploymentId, deploymentId),
            eq(deploymentSteps.status, "running"),
          ),
        );
      logBus.publishStatus(deploymentId, "cancelled");
      // Leave the previously-serving container untouched — cancelling a deploy
      // must not take the app down. A late half-built container (cancel after
      // `up`) is reaped by the next deploy's swap.
    } else {
      const message = err instanceof Error ? err.message : String(err);
      await failDeployment(db, deploymentId, redactor.redact(message));
      if (opts.preview) {
        const { postPreviewComment } = await import("../previews/comments.js");
        void postPreviewComment(db, loadConfig(), app.id, opts.preview.prNumber, "failed");
      }
    }
  } finally {
    clearDeploy(deploymentId);
    // Drain buffered log writes, then enforce the per-deployment cap (28) and
    // record bookkeeping. All best-effort: cleanup never fails a deploy.
    await writer.close();
    try {
      const total = writer.count();
      const trim = computeTrim(total, total, LOG_LINE_CAP);
      if (trim.deleteBelowSeq !== null) {
        await db
          .delete(deploymentLogs)
          .where(
            and(
              eq(deploymentLogs.deploymentId, deploymentId),
              lt(deploymentLogs.seq, trim.deleteBelowSeq),
            ),
          );
      }
      await db
        .update(deployments)
        .set({ logLineCount: Math.min(total, LOG_LINE_CAP), logTruncated: trim.truncated })
        .where(eq(deployments.id, deploymentId));
    } catch (e) {
      swallow("deploy.log_bookkeeping", e);
    }
    await rm(workdir, { recursive: true, force: true }).catch((e) =>
      swallow("deploy.workdir_cleanup", e),
    );
  }
}

interface ComposeUpArgs {
  db: Db;
  deploymentId: string;
  app: typeof apps.$inferSelect;
  cfg: Env;
  workdir: string;
  composeRel: string;
  commit: string;
  redactor: { add(value: string): void; redact(line: string): string };
  logTo: (stepId: string) => (stream: "stdout" | "stderr" | "system", line: string) => void;
}

/** Deploy a compose project (07): write the resolved env as the project's
 *  .env (compose interpolates ${VAR} from it), `up -d --build
 *  --remove-orphans` under the app's project name, resolve the routed host
 *  port (app.service, else any project container publishing app.port),
 *  health-probe it when found, stamp meta, converge. Stacks that publish no
 *  host port deploy fine — they just aren't routed. Throws on failure; the
 *  caller's catch records it. */
async function composeUp(args: ComposeUpArgs): Promise<void> {
  const { db, deploymentId, app, cfg, workdir, composeRel, commit, redactor, logTo } = args;
  const project = containerName(app.id);
  const composeFile = join(workdir, composeRel);

  // ── up: compose builds + (re)creates changed services in place ────────────
  const upStep = await startStep(db, deploymentId, 1, "up");
  const resolved = await resolveDeployEnv(db, cfg, app.id);
  for (const secret of resolved.redactSet) redactor.add(secret);
  const dotenv = formatDotEnv(resolved.values);
  // The project's .env (compose reads it from the compose file's directory).
  // A repo-committed .env is intentionally overridden — platform env wins.
  await writeFile(join(dirname(composeFile), ".env"), dotenv.content, "utf8");
  logTo(upStep)(
    "system",
    `wrote .env (${Object.keys(resolved.values).length - dotenv.skipped.length} keys` +
      (dotenv.skipped.length ? `; skipped multi-line: ${dotenv.skipped.join(", ")}` : "") +
      `) for project ${project}`,
  );
  const up = await runCommand(
    "docker",
    buildComposeArgs({ appName: project, composePath: composeFile }),
    {
      env: { ...process.env, ...resolved.values },
      onLine: (s, l) => void logTo(upStep)(s, l),
      timeoutMs: BUILD_TIMEOUT_MS,
    },
  );
  if (up.code !== 0) {
    throw new Error(`docker compose up failed${up.timedOut ? " (timed out)" : ""}`);
  }
  await finishStep(db, upStep, "succeeded");

  // ── port: which published host port routes the app's domains ──────────────
  let hostPort: string | null = null;
  if (app.service) {
    const out = await runCommand("docker", [
      "compose",
      "-p",
      project,
      "-f",
      composeFile,
      "port",
      app.service,
      String(app.port),
    ]);
    hostPort = parsePortMapping(firstStdout(out));
  } else {
    const ps = await runCommand("docker", [
      "compose",
      "-p",
      project,
      "-f",
      composeFile,
      "ps",
      "-q",
    ]);
    const cids = ps.lines
      .filter((l) => l.stream === "stdout")
      .map((l) => l.line.trim())
      .filter(Boolean);
    for (const cid of cids) {
      const mapping = await runCommand("docker", ["port", cid, `${app.port}/tcp`]);
      hostPort = parsePortMapping(firstStdout(mapping));
      if (hostPort) break;
    }
  }

  // ── health: probe the routed port when there is one. There is no old
  // container to preserve (compose replaced in place), so a failed probe
  // fails the deploy but leaves the stack as compose left it. ───────────────
  const healthStep = await startStep(db, deploymentId, 2, "health");
  if (hostPort) {
    const healthy = await waitHealthy("127.0.0.1", Number(hostPort), cfg.SS_HEALTH_ATTEMPTS);
    if (!healthy) {
      await finishStep(db, healthStep, "failed");
      throw new Error("health check failed: the compose service did not start listening");
    }
    logTo(healthStep)("system", `healthy on :${app.port} (127.0.0.1:${hostPort})`);
  } else {
    logTo(healthStep)(
      "system",
      `no published host port found for :${app.port} — skipping the HTTP probe and domain ` +
        `routing (publish ${app.port} in the compose file, or set the app's service)`,
    );
  }
  await finishStep(db, healthStep, "succeeded");

  const meta: DeployMeta = {
    containerPort: app.port,
    ...(hostPort ? { hostPort, url: `http://127.0.0.1:${hostPort}` } : {}),
  };
  await db
    .update(deployments)
    .set({
      status: "succeeded",
      finishedAt: new Date(),
      commitAfter: commit,
      meta: meta as Record<string, unknown>,
    })
    .where(eq(deployments.id, deploymentId));
  logBus.publishStatus(deploymentId, "succeeded");
  void notifyDeploymentOutcome(db, cfg, deploymentId, "deploy.succeeded").catch((e) =>
    swallow("deploy.notify", e),
  );
  void dispatchDeploymentOutcome(db, cfg, deploymentId, "deploy.succeeded").catch((e) =>
    swallow("deploy.dispatch", e),
  );

  try {
    await convergeProxy(db, cfg);
  } catch (e) {
    // no caddy reachable or no domain yet — the deploy still succeeded
    swallow("deploy.converge", e);
  }
  // An app that switched single-container → compose leaves its old labeled
  // container behind; compose containers carry only compose's project label,
  // so this touches nothing the project owns.
  await removeAppContainers(app.id).catch((e) => swallow("deploy.remove_old_containers", e));
}
