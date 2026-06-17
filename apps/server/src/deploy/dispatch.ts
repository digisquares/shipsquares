// Deploy dispatch (06-deploy-engine.md): deployments ride the pg-boss "deploy"
// queue so a control-plane restart redelivers queued work instead of stranding
// it. If the queue is unavailable (dev without pg-boss), fall back to inline
// execution — same behavior as before the queue existed.

export const DEPLOY_QUEUE = "deploy";

export interface PreviewContext {
  prNumber: number;
  branch: string;
}

export interface DeployJobData {
  deploymentId: string;
  image?: string;
  preview?: PreviewContext;
}

interface QueueLike {
  send(name: string, data: object): Promise<unknown>;
}

export async function dispatchDeploy(
  queue: QueueLike,
  deploymentId: string,
  opts: { image?: string; preview?: PreviewContext },
  fallback: () => void,
): Promise<void> {
  try {
    await queue.send(DEPLOY_QUEUE, {
      deploymentId,
      ...(opts.image ? { image: opts.image } : {}),
      ...(opts.preview ? { preview: opts.preview } : {}),
    });
  } catch {
    fallback();
  }
}
