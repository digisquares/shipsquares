// Construct the `docker build` argv (07-docker-builders.md). BuildKit secrets are
// passed as `--secret type=env,id=KEY`; the secret VALUE never enters argv (it is
// read from the build env at runtime), so it can't leak into logs or `ps`.

export interface DockerfileBuildOptions {
  imageRef: string;
  dockerfile: string; // path to the Dockerfile
  context: string; // build context dir
  buildArgs?: Record<string, string>;
  /** keys exposed to the build as BuildKit env secrets; values are NOT in argv. */
  secretEnvKeys?: string[];
  target?: string; // multi-stage target
  noCache?: boolean;
}

// Argv order mirrors Dokploy builders/docker-file.ts:35-85 (Apache-2.0):
// build -t <image> -f <dockerfile> <context> [--target] [--no-cache]
// [--build-arg K=V ...] [--secret type=env,id=K ...]
export function buildDockerfileArgs(opts: DockerfileBuildOptions): string[] {
  const args = ["build", "-t", opts.imageRef, "-f", opts.dockerfile, opts.context];
  if (opts.target) args.push("--target", opts.target);
  if (opts.noCache) args.push("--no-cache");
  for (const [key, value] of Object.entries(opts.buildArgs ?? {})) {
    args.push("--build-arg", `${key}=${value}`);
  }
  for (const key of opts.secretEnvKeys ?? []) {
    args.push("--secret", `type=env,id=${key}`);
  }
  return args;
}
