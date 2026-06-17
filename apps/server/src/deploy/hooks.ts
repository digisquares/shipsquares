import { shq } from "../backups/commands.js";

// Pre/post-deploy hooks (06-deploy-engine.md): user-supplied commands run
// around the container swap — pre in a throwaway container of the freshly
// built image (migrations against the new code BEFORE traffic), post inside
// the running container after health passes (cache warm-up etc.). The command
// itself is single-quote-escaped into `sh -c`; a hook failure fails the
// deploy.

export function preDeployCommand(tag: string, command: string): string {
  return `docker run --rm ${shq(tag)} sh -c ${shq(command)}`;
}

export function postDeployCommand(containerName: string, command: string): string {
  return `docker exec ${shq(containerName)} sh -c ${shq(command)}`;
}
