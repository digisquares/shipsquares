// Cloud-native buildpacks builder (07 gap-fill): `pack build` turns source
// into an OCI image with no Dockerfile, using a CNB builder image (Paketo by
// default; Heroku/custom via buildConfig). Pure arg builder, mirroring
// build/nixpacks.ts; the installer provides the `pack` CLI.

export const DEFAULT_BUILDER = "paketobuildpacks/builder-jammy-base";

export interface PackBuildOptions {
  imageRef: string;
  context: string; // build context dir (--path)
  builder?: string; // CNB builder image
  envVars?: string[]; // "KEY=value" build-time env
  noCache?: boolean;
}

export function buildPackArgs(opts: PackBuildOptions): string[] {
  const args = [
    "build",
    opts.imageRef,
    "--path",
    opts.context,
    "--builder",
    opts.builder ?? DEFAULT_BUILDER,
  ];
  for (const env of opts.envVars ?? []) args.push("--env", env);
  if (opts.noCache) args.push("--clear-cache");
  return args;
}
