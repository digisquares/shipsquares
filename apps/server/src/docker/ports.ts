// Parse `docker port` / `docker compose port` output ("0.0.0.0:49153",
// "[::]:49153", possibly multi-line) down to the bare host port.
export function parsePortMapping(output: string): string | null {
  const first = output.split("\n")[0]?.trim() ?? "";
  const port = first.split(":").pop()?.trim() ?? "";
  return /^\d+$/.test(port) ? port : null;
}
