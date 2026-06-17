// ssh2 is CJS — the ESM named-export lexer misses `utils`, so destructure the
// default export (works under tsc, tsx, and vitest alike).
import ssh2 from "ssh2";

// Platform SSH keypair generation (09-multi-server.md), adapted from Dokploy's
// utils/filesystem/ssh.ts (Apache-2.0, see NOTICE). The private key is sealed
// into the secret store by the caller; only the public key is shown/installed.

const { utils } = ssh2;

export interface SshKeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateSshKeyPair(
  type: "ed25519" | "rsa" = "ed25519",
  opts: { bits?: number } = {},
): SshKeyPair {
  const pair =
    type === "rsa"
      ? utils.generateKeyPairSync("rsa", { bits: opts.bits ?? 4096 })
      : utils.generateKeyPairSync("ed25519");
  return { privateKey: pair.private, publicKey: pair.public };
}
