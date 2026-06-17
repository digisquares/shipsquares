// SSO / social-login configuration (ROADMAP R3.2). Pure: env → the
// better-auth `socialProviders` object + the list of enabled provider ids
// (which the public /sso-providers route surfaces so the login UI only shows
// available buttons). A provider is enabled only when BOTH its id and secret
// are set; with none configured, social login stays entirely off. Social
// login reuses better-auth's existing `accounts` table — no migration.

export interface SocialProviderConfig {
  clientId: string;
  clientSecret: string;
}

interface SsoEnv {
  SSO_GITHUB_CLIENT_ID?: string | undefined;
  SSO_GITHUB_CLIENT_SECRET?: string | undefined;
  SSO_GOOGLE_CLIENT_ID?: string | undefined;
  SSO_GOOGLE_CLIENT_SECRET?: string | undefined;
}

// id → [env id key, env secret key]; declaration order is the UI order.
const PROVIDERS: Array<[string, keyof SsoEnv, keyof SsoEnv]> = [
  ["github", "SSO_GITHUB_CLIENT_ID", "SSO_GITHUB_CLIENT_SECRET"],
  ["google", "SSO_GOOGLE_CLIENT_ID", "SSO_GOOGLE_CLIENT_SECRET"],
];

export function ssoProviders(config: SsoEnv): {
  providers: Record<string, SocialProviderConfig>;
  enabled: string[];
} {
  const providers: Record<string, SocialProviderConfig> = {};
  const enabled: string[] = [];
  for (const [id, idKey, secretKey] of PROVIDERS) {
    const clientId = config[idKey];
    const clientSecret = config[secretKey];
    if (clientId && clientSecret) {
      providers[id] = { clientId, clientSecret };
      enabled.push(id);
    }
  }
  return { providers, enabled };
}
