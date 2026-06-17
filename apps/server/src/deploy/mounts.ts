// Render an app's mounts into compose/run volume entries (06-deploy-engine.md).
// A `file` mount has no source; its body is materialized from the secret store
// (11) to a 0600 temp file at deploy time and that path becomes `resolvedSource`.

export interface AppMount {
  type: "volume" | "bind" | "file";
  source: string;
  target: string;
  readOnly: boolean;
  /** for `file` mounts: the materialized host path (runtime). */
  resolvedSource?: string;
}

function sourceOf(mount: AppMount): string {
  if (mount.type === "file") {
    if (!mount.resolvedSource) {
      throw new Error("file mount must be materialized before rendering");
    }
    return mount.resolvedSource;
  }
  return mount.source;
}

/** `source:target` or `source:target:ro` for compose `volumes:`. */
export function toComposeVolume(mount: AppMount): string {
  const base = `${sourceOf(mount)}:${mount.target}`;
  return mount.readOnly ? `${base}:ro` : base;
}

/** `-v source:target[:ro]` for `docker run`. */
export function toRunVolumeFlag(mount: AppMount): string {
  return `-v ${toComposeVolume(mount)}`;
}
