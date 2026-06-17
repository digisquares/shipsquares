// Faithful port of Dokploy builders/compose.ts:80-97 createCommand (Apache-2.0):
//   docker-compose: compose -p <appName> -f <path> up -d --build --remove-orphans
//   stack:          stack deploy -c <path> <appName> --prune --with-registry-auth
// (We run plain compose by default; the stack form is kept for parity, no Swarm.)

export interface ComposeCommandOptions {
  appName: string;
  composePath: string; // "docker-compose.yml" for a raw source
  type?: "docker-compose" | "stack";
}

export function buildComposeArgs(opts: ComposeCommandOptions): string[] {
  if (opts.type === "stack") {
    return [
      "stack",
      "deploy",
      "-c",
      opts.composePath,
      opts.appName,
      "--prune",
      "--with-registry-auth",
    ];
  }
  return [
    "compose",
    "-p",
    opts.appName,
    "-f",
    opts.composePath,
    "up",
    "-d",
    "--build",
    "--remove-orphans",
  ];
}
