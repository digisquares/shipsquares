// Faithful port of Dokploy builders/nixpacks.ts:19-66 (Apache-2.0):
// nixpacks build <workDir> --name <appName> [--no-cache] [--env K=V ...] [--no-error-without-start]

export interface NixpacksBuildOptions {
  appName: string;
  workDir: string;
  envVars?: string[]; // "KEY=value" strings
  noCache?: boolean;
  /** set when a publishDirectory (static output) is configured. */
  noErrorWithoutStart?: boolean;
}

export function buildNixpacksArgs(opts: NixpacksBuildOptions): string[] {
  const args = ["build", opts.workDir, "--name", opts.appName];
  if (opts.noCache) args.push("--no-cache");
  for (const env of opts.envVars ?? []) args.push("--env", env);
  if (opts.noErrorWithoutStart) args.push("--no-error-without-start");
  return args;
}
