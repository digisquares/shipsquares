import { z } from "zod";

// Git-as-truth app config (shipsquares.yml; Kamal deploy.yml shape, 11). Clear
// env inline; secrets referenced by NAME only — values never appear in the file.

export const AppConfigSchema = z.object({
  name: z.string().min(1),
  server: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().default("main"),
  build: z.object({
    type: z.enum(["compose", "dockerfile", "nixpacks", "image"]),
    dockerfile: z.string().optional(),
    composePath: z.string().optional(),
  }),
  env: z
    .object({
      clear: z.record(z.string(), z.string()).default({}),
      secret: z.array(z.string()).default([]),
    })
    .default({ clear: {}, secret: [] }),
  domains: z.array(z.string()).optional(),
});

export type AppConfigFile = z.infer<typeof AppConfigSchema>;

export function parseConfigFile(input: unknown): AppConfigFile {
  return AppConfigSchema.parse(input);
}

export interface ExportInput {
  name: string;
  server: string;
  repo: string;
  branch: string;
  build: AppConfigFile["build"];
  clearEnv: Record<string, string>;
  secretNames: string[];
  domains?: string[];
}

/** Build the portable config — clear env inline, secrets by NAME only. */
export function toConfigFile(input: ExportInput): AppConfigFile {
  return {
    name: input.name,
    server: input.server,
    repo: input.repo,
    branch: input.branch,
    build: input.build,
    env: { clear: input.clearEnv, secret: input.secretNames },
    ...(input.domains ? { domains: input.domains } : {}),
  };
}

/** Referenced-but-absent secrets, flagged "value required" on import. */
export function missingSecrets(file: AppConfigFile, existing: ReadonlySet<string>): string[] {
  return file.env.secret.filter((name) => !existing.has(name));
}
