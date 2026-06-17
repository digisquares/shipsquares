// Shared-variable scope resolution (11). A value defined once at org scope is
// inherited by every app; an app-scoped value of the same key overrides it
// (app > org). Project/environment scopes are reserved.

export interface SharedVarRecord {
  scope: "org" | "app";
  scopeId?: string | null; // app_id when scope='app'
  key: string;
  value?: string | null; // when !is_secret
  valueSecretRef?: string | null; // when is_secret (→ secret store)
  isSecret: boolean;
}

export interface ResolvedSharedVars {
  clear: Record<string, string>;
  /** env key -> secret name, for the resolver to dereference */
  secretRefs: { key: string; ref: string }[];
}

export function resolveSharedVars(vars: SharedVarRecord[], appId: string): ResolvedSharedVars {
  // org first, then app, so app definitions win for the same key.
  const ordered = [
    ...vars.filter((v) => v.scope === "org"),
    ...vars.filter((v) => v.scope === "app" && v.scopeId === appId),
  ];

  const clear: Record<string, string> = {};
  const secretRefs = new Map<string, string>();

  for (const v of ordered) {
    if (v.isSecret && v.valueSecretRef) {
      secretRefs.set(v.key, v.valueSecretRef);
      delete clear[v.key];
    } else if (!v.isSecret && v.value != null) {
      clear[v.key] = v.value;
      secretRefs.delete(v.key);
    }
  }

  return { clear, secretRefs: [...secretRefs].map(([key, ref]) => ({ key, ref })) };
}
