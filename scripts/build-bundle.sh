#!/usr/bin/env bash
# Build the self-contained control-plane bundle that the installer ships
# (18-installer-ops.md). Output is a directory (and optional tarball) containing
# the compiled server, the vendored @ss/shared, a production node_modules, and
# the committed drizzle/ migrations — bootable with `node dist/index.js` on any
# box that has Node 22 + the runtime env. No pnpm/monorepo needed at the target.
#
# Usage: scripts/build-bundle.sh [OUT_DIR] [VERSION]
#   OUT_DIR  default: ./dist-bundle
#   VERSION  default: git short sha (only used to name the tarball)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist-bundle}"
VERSION="${2:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)}"

cd "$ROOT"

echo "==> install (injected workspace packages; see .npmrc)"
pnpm install --frozen-lockfile

echo "==> build (tsc -b: @ss/shared + @ss/server -> dist)"
pnpm build

echo "==> build web SPA (@ss/web -> apps/web/dist)"
pnpm --filter @ss/web build

echo "==> deploy @ss/server -> $OUT"
rm -rf "$OUT"
pnpm --filter @ss/server deploy --prod "$OUT"

echo "==> bundle web SPA -> $OUT/public"
rm -rf "$OUT/public"
cp -r "$ROOT/apps/web/dist" "$OUT/public"

# pnpm deploy can drop "type":"module"; the compiled output is ESM, so restore it.
node -e '
  const f = process.argv[1];
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  p.type = "module";
  fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
' "$OUT/package.json"

# True-TTY console: vendor node-pty's compiled native addon into the bundle.
# node-pty ships no Linux prebuild, and `pnpm deploy` relinks it from the store
# WITHOUT running its build script (the deployed manifest carries no
# pnpm.onlyBuiltDependencies), so the bundle would otherwise lack
# build/Release/pty.node and the web console would silently fall back to the
# `docker exec -i` pipe transport. The workspace install already compiled it
# (root pnpm.onlyBuiltDependencies + a C toolchain), so copy that addon in.
# node-pty is an optional dep and the addon is arch-specific, so skip cleanly
# when it's absent (the build host arch must match the deploy target).
SRC_PTY_BUILD="$(find "$ROOT/node_modules/.pnpm" -maxdepth 5 -type d -path '*/node-pty/build' 2>/dev/null | head -1)"
DST_PTY="$(readlink -f "$OUT/node_modules/node-pty" 2>/dev/null || true)"
if [ -n "$SRC_PTY_BUILD" ] && [ -n "$DST_PTY" ] && [ -d "$DST_PTY" ]; then
  echo "==> vendor node-pty native addon into bundle"
  rm -rf "$DST_PTY/build"
  cp -r "$SRC_PTY_BUILD" "$DST_PTY/build"
  test -f "$DST_PTY/build/Release/pty.node" || { echo "node-pty addon missing after copy"; exit 1; }
fi

# Stamp the version so the running control plane knows what it is (auto-update.md);
# the server reads ./VERSION from its working dir (/opt/shipsquares/current).
printf '%s\n' "$VERSION" > "$OUT/VERSION"

# Sanity: the bundle must be self-contained and migration-capable.
test -s "$OUT/VERSION"                                || { echo "missing VERSION"; exit 1; }
test -f "$OUT/dist/index.js"                         || { echo "missing dist/index.js"; exit 1; }
test -f "$OUT/dist/db/migrate.js"                     || { echo "missing dist/db/migrate.js"; exit 1; }
test -f "$OUT/node_modules/@ss/shared/dist/index.js"  || { echo "@ss/shared not vendored"; exit 1; }
ls "$OUT"/drizzle/*.sql >/dev/null 2>&1                || { echo "missing drizzle migrations"; exit 1; }
test -f "$OUT/public/index.html"                       || { echo "missing web SPA (public/)"; exit 1; }

TARBALL="$ROOT/shipsquares-control-plane-$VERSION.tgz"
echo "==> tar -> $TARBALL"
tar czf "$TARBALL" -C "$OUT" .

echo "OK: bundle at $OUT ($(du -sh "$OUT" | cut -f1)), tarball $TARBALL"
