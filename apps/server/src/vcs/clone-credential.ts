import { cloneUrlWithToken } from "./clone-url.js";
import { type CloneCredential, type RepoRef } from "./types.js";

// Assemble the clone credential 06.fetch uses (26-vcs-connections.md handoff).
// This is the PURE half: given a repo and an already-resolved credential, build
// the CloneCredential. The runtime half (read the secret store, mint a fresh App
// installation token) resolves the credential and calls this; the token is only
// injected into the URL here and must never be logged (19-security.md).

export type ResolvedCredential =
  | { type: "token"; token: string } // github_app / oauth / manual-PAT
  | { type: "ssh-key"; keyRef: string; sshUrl: string } // manual deploy key
  | { type: "none" }; // public repo — no credential

export function buildCloneCredential(repo: RepoRef, cred: ResolvedCredential): CloneCredential {
  switch (cred.type) {
    case "token":
      return {
        scheme: "https-token",
        url: cloneUrlWithToken(repo.cloneUrl, cred.token),
        token: cred.token,
      };
    case "ssh-key":
      return { scheme: "ssh-key", url: cred.sshUrl, keyRef: cred.keyRef };
    case "none":
      return { scheme: "https-token", url: repo.cloneUrl, token: "" };
  }
}
