// Builder dispatch types (07-docker-builders.md). Adapted from Dokploy
// utils/builders/index.ts (Apache-2.0), dropping the Swarm branches.

export type BuilderType = "compose" | "dockerfile" | "nixpacks" | "buildpacks" | "static" | "image";

export interface BuildResult {
  builder: BuilderType;
  imageRef: string; // e.g. "myapp:9f2c1ab"
  /** true for compose, where build+up are one CLI call (engine `up` runs compose). */
  inlineUp: boolean;
}
