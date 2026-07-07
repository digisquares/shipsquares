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

# S6: the trigger is a file the (unprivileged) service user drops, and this script
# runs as root — so vet it before acting. Refuse a symlink (a planted link would
# make root read/rename an arbitrary path), and refuse a file not owned by root or
# the service user (a different low-priv account must not be able to drive a root
# update). Neither is expected on a healthy box; both are cheap to reject.
if [ -h "$REQ" ]; then
  logger -t shipsquares-updater "refusing symlinked update.request" 2>/dev/null || true
  rm -f "$REQ"
  exit 0
fi
case "$(stat -c %U "$REQ" 2>/dev/null || echo '?')" in
  root | shipsquares) ;;
  *)
    logger -t shipsquares-updater "refusing update.request with unexpected owner" 2>/dev/null || true
    rm -f "$REQ"
    exit 0
    ;;
esac

# Root-owned scratch (tmpfs): the consumed request + all downloads live here, so
# the unprivileged service user (which owns $DATA and by design writes $REQ) can't
# plant a symlink or swap a verified bundle between check and extract (TOCTOU).
RUN=/run/shipsquares-updater
mkdir -p "$RUN" && chmod 700 "$RUN" || true
WORKREQ="$RUN/request.json"

# Consume the trigger FIRST (atomic rename): any later failure must not leave $REQ
# in place, or the .path unit re-fires on every deactivation → start-limit-hit and
# updates wedge until `systemctl reset-failed`.
mv -f "$REQ" "$WORKREQ" 2>/dev/null || { rm -f "$REQ"; exit 0; }

FROM="$(cat "$PREFIX/current/VERSION" 2>/dev/null || echo unknown)"
PREV="$(readlink -f "$PREFIX/current" 2>/dev/null || true)"

command -v jq >/dev/null 2>&1 || fail deps "jq is required"
VER="$(jq -r '.version // empty' "$WORKREQ")"
URL="$(jq -r '.url // empty' "$WORKREQ")"
SHA="$(jq -r '.sha256 // empty' "$WORKREQ")"
MANIFEST_URL="$(jq -r '.manifestUrl // empty' "$WORKREQ")"
rm -f "$WORKREQ"
TO="$VER"

# Re-fetch the channel manifest and, when a public key is installed, verify its
# Ed25519 signature — then derive the bundle url+sha from the VERIFIED manifest, so
# trust never rests on the (control-plane-written) request file. Falls back to the
# request's url/sha when no manifest URL is present (older control plane).
# S6: host() extracts the scheme+host of an https URL, empty for anything else —
# used to require TLS and pin the bundle to the manifest's origin.
host() { printf '%s' "$1" | sed -nE 's#^https://([^/]+)(/.*)?$#\1#p'; }

if [ -n "$MANIFEST_URL" ]; then
  [ -n "$(host "$MANIFEST_URL")" ] || fail manifest "manifest URL must be https"
  MJSON="$RUN/manifest.json"
  MSIG="$RUN/manifest.sig"
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
  # Pin the bundle to the (verified, when signed) manifest's own host — even a
  # pre-provisioning box with no pubkey then can't be pointed at a foreign bundle
  # host by a tampered manifest-served URL.
  [ "$(host "$URL")" = "$(host "$MANIFEST_URL")" ] ||
    fail parse "bundle host '$(host "$URL")' != manifest host '$(host "$MANIFEST_URL")'"
fi

[ -n "$VER" ] && [ -n "$URL" ] || fail parse "no bundle to install for $ARCH"
# TLS is mandatory on both paths (manifest-derived and the older request fallback):
# this runs as root and executes the downloaded bundle, so an http:// URL is refused.
[ -n "$(host "$URL")" ] || fail parse "bundle URL must be https"

# $VER becomes a path component (DEST="$PREFIX/$VER") that is later `rm -rf`'d and
# symlinked, and the manifest may be unsigned — so refuse anything that isn't a
# plain version token, and never the reserved dirs.
case "$VER" in
  current | bin | *[!A-Za-z0-9._-]*) fail parse "unsafe version '$VER'" ;;
esac

# No-op if already on the target (guards against rm-ing the live `current` dir).
if [ "$VER" = "$FROM" ]; then
  status done done "already on $VER"
  exit 0
fi

DEST="$PREFIX/$VER"
TGZ="$RUN/bundle-$VER.tgz"

status running download "downloading $VER"
curl -fsSL "$URL" -o "$TGZ" || fail download "download failed"

# Integrity is mandatory: this runs as root and swaps live code, so a bundle with
# no advertised sha256 is REFUSED, not trusted (an empty checksum used to silently
# skip verification). The live path always carries one — the control plane always
# writes a manifestUrl and the updater re-derives sha from the manifest artifact.
[ -n "$SHA" ] || { rm -f "$TGZ"; fail verify "no sha256 for $VER — refusing unverified bundle"; }
status running verify "verifying checksum"
echo "$SHA  $TGZ" | sha256sum -c - >/dev/null 2>&1 || { rm -f "$TGZ"; fail verify "checksum mismatch"; }

status running extract "extracting bundle"
rm -rf "$DEST" && mkdir -p "$DEST"
tar xzf "$TGZ" -C "$DEST" || fail extract "extract failed"
rm -f "$TGZ"
chown -R shipsquares:shipsquares "$DEST" 2>/dev/null || true
[ -f "$DEST/dist/index.js" ] || fail extract "bundle missing dist/index.js"

status running migrate "running database migrations"
# One KEY=VALUE per argv element (mapfile), NOT `xargs`: a value containing a
# space would word-split under xargs and be read by `env` as the command to run,
# so migrate would never execute and every future update would fail here.
mapfile -t ENVVARS < <(grep -hE '^[A-Za-z_][A-Za-z0-9_]*=' /etc/shipsquares/env /etc/shipsquares/secrets.env 2>/dev/null)
sudo -u shipsquares env "${ENVVARS[@]}" node "$DEST/dist/db/migrate.js" || fail migrate "migration failed"

status running swap "switching to $VER"
# `ln -sfn` silently no-ops when `current` is a real directory (early installs
# left one) — the link lands INSIDE it, the swap doesn't happen, the restart
# relaunches OLD code, and the health gate passes (old code is healthy) → a false
# "updated" report. Clear a non-symlink first, swap via a temp link + rename
# (mirrors the installer's step_units), then VERIFY the swap took.
[ -L "$PREFIX/current" ] || rm -rf "$PREFIX/current"
rm -rf "$PREFIX/current.tmp"
ln -sfn "$DEST" "$PREFIX/current.tmp" || fail swap "symlink create failed"
mv -Tf "$PREFIX/current.tmp" "$PREFIX/current" || fail swap "symlink swap failed"
[ "$(readlink -f "$PREFIX/current")" = "$(readlink -f "$DEST")" ] ||
  fail swap "current did not point at $VER after swap"
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
