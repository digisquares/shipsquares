import { posix } from "node:path";

// Static-site builder (07 / ROADMAP gap-fill): serve a directory of
// pre-built files over a tiny busybox httpd — no build step, no runtime
// dependency. For sites that need a build first, use the Dockerfile or
// Nixpacks strategy. (SPA history-API fallback to index.html is a known
// busybox-httpd limitation; a Caddy/nginx variant is a follow-up.)

/** Normalize the publish directory to a context-relative path, rejecting
 *  absolute paths and any `..` escape out of the build context. */
export function safePublishDir(raw: string | null | undefined): string {
  const value = (raw ?? ".").trim();
  if (value === "" || value === ".") return ".";
  if (posix.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) {
    throw new Error("publishDirectory must be a relative path, not absolute");
  }
  const norm = posix.normalize(value).replace(/\/+$/, "");
  if (norm === ".." || norm.startsWith("../")) {
    throw new Error("publishDirectory resolves outside the build context");
  }
  return norm;
}

/** Generate a Dockerfile that copies the publish dir and serves it. The
 *  COPY source is context-relative (`<dir>/`); `.` serves the whole context. */
export function staticDockerfile(opts: { publishDir: string; port: number }): string {
  const src = opts.publishDir === "." ? "./" : `${opts.publishDir}/`;
  return [
    "FROM busybox:1.37",
    "WORKDIR /www",
    `COPY ${src} /www/`,
    `EXPOSE ${opts.port}`,
    `CMD ["httpd","-f","-v","-p","${opts.port}","-h","/www"]`,
    "",
  ].join("\n");
}
