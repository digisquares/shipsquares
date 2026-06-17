// Translate an app's resource envelope into a compose service fragment and the
// equivalent `docker run` flags, applied at `up` time (06-deploy-engine.md).
// Pure + deterministic; actual usage vs these limits is charted in 32.

export interface AppResourceConfig {
  cpuLimit?: string | null;
  cpuReservation?: string | null;
  memLimitBytes?: number | null;
  memReservationBytes?: number | null;
  replicas?: number | null;
  restartPolicy?: string | null; // 'no' | 'on-failure' | 'always' | 'unless-stopped'
}

export interface ComposeResources {
  limits?: { cpus?: string; memory?: string };
  reservations?: { cpus?: string; memory?: string };
}

export interface ComposeServiceFragment {
  restart?: string;
  deploy?: { replicas?: number; resources?: ComposeResources };
}

export function toComposeService(app: AppResourceConfig): ComposeServiceFragment {
  const limits: { cpus?: string; memory?: string } = {};
  if (app.cpuLimit) limits.cpus = app.cpuLimit;
  if (app.memLimitBytes != null) limits.memory = String(app.memLimitBytes);

  const reservations: { cpus?: string; memory?: string } = {};
  if (app.cpuReservation) reservations.cpus = app.cpuReservation;
  if (app.memReservationBytes != null) reservations.memory = String(app.memReservationBytes);

  const resources: ComposeResources = {};
  if (Object.keys(limits).length) resources.limits = limits;
  if (Object.keys(reservations).length) resources.reservations = reservations;

  const deploy: { replicas?: number; resources?: ComposeResources } = {};
  if (app.replicas != null && app.replicas !== 1) deploy.replicas = app.replicas;
  if (Object.keys(resources).length) deploy.resources = resources;

  const fragment: ComposeServiceFragment = {};
  // Non-swarm restart lives at the service top level (not deploy.restart_policy).
  if (app.restartPolicy) fragment.restart = app.restartPolicy;
  if (Object.keys(deploy).length) fragment.deploy = deploy;
  return fragment;
}

export function toRunFlags(app: AppResourceConfig): string[] {
  const flags: string[] = [];
  if (app.cpuLimit) flags.push("--cpus", app.cpuLimit);
  if (app.memLimitBytes != null) flags.push("--memory", String(app.memLimitBytes));
  if (app.memReservationBytes != null)
    flags.push("--memory-reservation", String(app.memReservationBytes));
  if (app.restartPolicy) flags.push("--restart", app.restartPolicy);
  return flags;
}
