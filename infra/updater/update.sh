#!/usr/bin/env bash
# ShipSquares self-updater (auto-update.md · Phase 2). Runs as ROOT, launched by
# shipsquares-updater.path when the control plane drops $SS_STATE_DIR/update.request.
#
# It runs OUTSIDE the control-plane process (which would otherwise kill itself on
# restart) and from a STABLE path (/opt/shipsquares/bin, never under `current`,
# which it swaps): download + verify the requested bundle → migrate → atomically
# repoint `current` → restart → health-gate → roll back on any failure. Progress is
# written to update.status for the dashboard to poll.
set -uo pipefail

PREFIX=/opt/shipsquares
DATA="${SS_STATE_DIR:-/var/lib/shipsquares}"
REQ="$DATA/update.request"
STATUS="$DATA/update.status"
LOCK="$DATA/update.lock"
SVC=shipsquares
PORT="$(grep -hs '^PORT=' /etc/shipsquares/env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
READY_URL="http://localhost:${PORT:-3000}/readyz"
HEALTH_TRIES=60
PUBKEY="$PREFIX/manifest-sign.pub" # Ed25519 public key (present iff signing is provisioned)
case "$(uname -m)" in x86_64) ARCH=amd64 ;; aarch64 | arm64) ARCH=arm64 ;; *) ARCH=amd64 ;; esac

FROM=""
TO=""
PREV=""

status() { # state step message
  printf '{"state":"%s","step":"%s","fromVersion":"%s","toVersion":"%s","message":"%s","ts":"%s"}\n' \
    "$1" "$2" "$FROM" "$TO" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$STATUS"
  chmod 0644 "$STATUS" 2>/dev/null || true
}

# Roll back to the previous version (if the symlink was moved) and record failure.
fail() { # step message
  if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$(readlink -f "$PREFIX/current" 2>/dev/null)" != "$PREV" ]; then
    status running rollback "rolling back to $FROM"
    ln -sfn "$PREV" "$PREFIX/current"
    systemctl restart "$SVC" 2>/dev/null || true
  fi
  status failed "$1" "$2"
  exit 1
}

# Single-flight: a second trigger while one runs is a no-op.
exec 9>"$LOCK" || exit 0
flock -n 9 || exit 0
[ -f "$REQ" ] || exit 0

FROM="$(cat "$PREFIX/current/VERSION" 2>/dev/null || echo unknown)"
PREV="$(readlink -f "$PREFIX/current" 2>/dev/null || true)"

command -v jq >/dev/null 2>&1 || fail deps "jq is required"
VER="$(jq -r '.version // empty' "$REQ")"
URL="$(jq -r '.url // empty' "$REQ")"
SHA="$(jq -r '.sha256 // empty' "$REQ")"
MANIFEST_URL="$(jq -r '.manifestUrl // empty' "$REQ")"
rm -f "$REQ" # consume → re-arms the .path unit for the next request
TO="$VER"

# Re-fetch the channel manifest and, when a public key is installed, verify its
# Ed25519 signature — then derive the bundle url+sha from the VERIFIED manifest, so
# trust never rests on the (control-plane-written) request file. Falls back to the
# request's url/sha when no manifest URL is present (older control plane).
if [ -n "$MANIFEST_URL" ]; then
  MJSON="$DATA/manifest.json"
  MSIG="$DATA/manifest.sig"
  curl -fsSL "$MANIFEST_URL" -o "$MJSON" || fail manifest "manifest download failed"
  if [ -s "$PUBKEY" ]; then
    curl -fsSL "$MANIFEST_URL.sig" -o "$MSIG" || fail verify "signature download failed"
    openssl pkeyutl -verify -pubin -inkey "$PUBKEY" -rawin -in "$MJSON" -sigfile "$MSIG" >/dev/null 2>&1 ||
      fail verify "manifest signature invalid"
    status running verify "manifest signature verified"
  fi
  VER="$(jq -r '.latest // empty' "$MJSON")"
  URL="$(jq -r --arg a "$ARCH" '.artifacts[$a].url // empty' "$MJSON")"
  SHA="$(jq -r --arg a "$ARCH" '.artifacts[$a].sha256 // empty' "$MJSON")"
  TO="$VER"
  rm -f "$MJSON" "$MSIG"
fi

[ -n "$VER" ] && [ -n "$URL" ] || fail parse "no bundle to install for $ARCH"

# No-op if already on the target (guards against rm-ing the live `current` dir).
if [ "$VER" = "$FROM" ]; then
  status done done "already on $VER"
  exit 0
fi

DEST="$PREFIX/$VER"
TGZ="$DATA/bundle-$VER.tgz"

status running download "downloading $VER"
curl -fsSL "$URL" -o "$TGZ" || fail download "download failed"

if [ -n "$SHA" ]; then
  status running verify "verifying checksum"
  echo "$SHA  $TGZ" | sha256sum -c - >/dev/null 2>&1 || { rm -f "$TGZ"; fail verify "checksum mismatch"; }
fi

status running extract "extracting bundle"
rm -rf "$DEST" && mkdir -p "$DEST"
tar xzf "$TGZ" -C "$DEST" || fail extract "extract failed"
rm -f "$TGZ"
chown -R shipsquares:shipsquares "$DEST" 2>/dev/null || true
[ -f "$DEST/dist/index.js" ] || fail extract "bundle missing dist/index.js"

status running migrate "running database migrations"
ENVVARS="$(grep -hv '^#' /etc/shipsquares/env /etc/shipsquares/secrets.env 2>/dev/null | xargs)"
# shellcheck disable=SC2086
sudo -u shipsquares env $ENVVARS node "$DEST/dist/db/migrate.js" || fail migrate "migration failed"

status running swap "switching to $VER"
ln -sfn "$DEST" "$PREFIX/current" || fail swap "symlink swap failed"
systemctl restart "$SVC" || fail restart "service restart failed"

status running health "waiting for the control plane"
ok=0
for _ in $(seq 1 "$HEALTH_TRIES"); do
  curl -fsS "$READY_URL" >/dev/null 2>&1 && {
    ok=1
    break
  }
  sleep 1
done
[ "$ok" = "1" ] || fail health "control plane did not become ready"

status done done "updated $FROM -> $VER"

# Prune old release dirs, keeping the newest 3 (never `current`/`bin`).
ls -1dt "$PREFIX"/*/ 2>/dev/null | grep -vE "/(current|bin)/" | tail -n +4 | while read -r d; do
  [ "$(readlink -f "$d")" = "$(readlink -f "$PREFIX/current")" ] || rm -rf "$d"
done
exit 0
