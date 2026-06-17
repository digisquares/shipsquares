// `${secret:NAME}` interpolation, expanded only at deploy time so a composed
// value (e.g. a DSN) keeps the secret out of stored clear config (11).

const TOKEN = /\$\{secret:([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function interpolate(value: string, resolve: (name: string) => string): string {
  return value.replace(TOKEN, (_match, name: string) => resolve(name));
}

/** The secret names a clear value references via `${secret:NAME}`. */
export function referencedSecrets(value: string): string[] {
  const names: string[] = [];
  for (const match of value.matchAll(TOKEN)) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}
