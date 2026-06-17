import { interpolate } from "./interpolate.js";
import type { ResolvedEnv } from "./types.js";

// Deploy-time env resolution (11). Pure: the DB-backed wrapper (06) loads the
// clear env, secret refs, and resolved shared vars from the store and supplies
// `openSecret`. Layering: shared vars (org→app already merged) under the app's
// own clear env, then secret refs, then `${secret:NAME}` expansion. Every
// dereferenced secret value lands in `redactSet`.

export interface ResolveInput {
  /** the app's own clear env (env_vars, is_secret=false) */
  clear: Record<string, string>;
  /** the app's secret refs: env key -> secret name */
  secretRefs: { key: string; ref: string }[];
  /** resolved shared clear vars (org→app merged), layered under the app's clear */
  shared?: Record<string, string>;
  /** resolved shared secret refs: env key -> secret name */
  sharedSecretRefs?: { key: string; ref: string }[];
  /** dereference a secret by name (store.getByName + open) */
  openSecret: (name: string) => string;
}

export function resolveEnv(input: ResolveInput): ResolvedEnv {
  const redactSet = new Set<string>();
  const values: Record<string, string> = { ...(input.shared ?? {}), ...input.clear };

  const refs = [...(input.sharedSecretRefs ?? []), ...input.secretRefs];
  for (const { key, ref } of refs) {
    const plain = input.openSecret(ref);
    values[key] = plain;
    redactSet.add(plain);
  }

  for (const key of Object.keys(values)) {
    const value = values[key];
    if (value === undefined) continue;
    values[key] = interpolate(value, (name) => {
      const plain = input.openSecret(name);
      redactSet.add(plain);
      return plain;
    });
  }

  return { values, redactSet };
}
