#!/usr/bin/env bash
# ShipSquares one-command installer (18-installer-ops.md).
#
#   curl -fsSL https://get.shipsquares.com | bash
#   curl -fsSL https://get.shipsquares.com | bash -s -- --domain ship.example.com
#
# Turns a bare Linux VM into a running control server: native Caddy + Postgres +
# control plane as systemd units (NOT Docker), DB migrated, behind HTTPS.
# Idempotent: re-running repairs in place and never rotates a live secret.
#
# ADAPTS Coolify scripts/install.sh (Apache-2.0): root check, OS normalization,
# per-step logging, generate-if-missing secrets. Payload is native, not compose.
set -euo pipefail

# --- inputs (flags or env) ----------------------------------------------------
# NB: never export a bare VERSION — get.docker.com reads $VERSION as the Docker
# version to install. Namespaced SS_VERSION avoids that (and similar) collisions.
SS_VERSION="${SS_VERSION:-latest}"
# Bundles are arch-specific (vendored node-pty addon); the URL carries the arch.
case "$(uname -m)" in x86_64) _SS_ARCH=amd64 ;; aarch64|arm64) _SS_ARCH=arm64 ;; *) _SS_ARCH=amd64 ;; esac
PUBLIC_DOMAIN="${SS_DOMAIN:-}"
ADMIN_EMAIL="${SS_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${SS_ADMIN_PASSWORD:-}"
SS_LOCAL="${SS_LOCAL:-}"          # force a localhost (tunnel-only) install
SS_PUBLIC_IP="${SS_PUBLIC_IP:-}"  # override public-IP detection
BUNDLE_SRC=""                     # set from --bundle, else derived after the loop
_bundle_explicit=0
_version_pinned=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version)  SS_VERSION="$2"; _version_pinned=1; shift 2 ;;
    --bundle)   BUNDLE_SRC="$2"; _bundle_explicit=1; shift 2 ;;
    --domain)   PUBLIC_DOMAIN="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --public-ip) SS_PUBLIC_IP="$2"; shift 2 ;;
    --local)    SS_LOCAL=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
# Resolve the bundle source AFTER parsing flags, so `--version X` actually pins the
# bundle URL (it was previously computed from the default SS_VERSION before the
# loop, and an inherited SS_BUNDLE=latest from the piped bootstrap always won).
# Precedence: --bundle > --version > SS_BUNDLE env > default latest.
if [ "$_bundle_explicit" = "1" ]; then
  :
elif [ "$_version_pinned" = "1" ]; then
  BUNDLE_SRC="https://get.shipsquares.com/bundles/${SS_VERSION}-${_SS_ARCH}.tgz"
elif [ -n "${SS_BUNDLE:-}" ]; then
  BUNDLE_SRC="$SS_BUNDLE"
else
  BUNDLE_SRC="https://get.shipsquares.com/bundles/${SS_VERSION}-${_SS_ARCH}.tgz"
fi
export SS_VERSION BUNDLE_SRC PUBLIC_DOMAIN ADMIN_EMAIL ADMIN_PASSWORD SS_LOCAL SS_PUBLIC_IP

# --- load libs ----------------------------------------------------------------
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/detect.sh
. "$HERE/lib/detect.sh"
# shellcheck source=lib/secrets.sh
. "$HERE/lib/secrets.sh"
# shellcheck source=lib/steps.sh
. "$HERE/lib/steps.sh"

require_root
OS_TYPE="$(detect_os)"; export OS_TYPE

# Dashboard host (docs/installer-access.md): explicit --domain wins; a raw-IP
# domain is upgraded to sslip.io (no public cert for a bare IP); otherwise default
# to <public-ip>.sslip.io for trusted HTTPS with zero DNS; --local ⇒ localhost.
if [ "$SS_LOCAL" = "1" ]; then
  PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-localhost}"
elif [ -z "$PUBLIC_DOMAIN" ]; then
  PUB_IP="${SS_PUBLIC_IP:-$(detect_public_ip)}"
  if [ -n "$PUB_IP" ]; then PUBLIC_DOMAIN="${PUB_IP}.sslip.io"; else PUBLIC_DOMAIN="localhost"; fi
elif printf '%s' "$PUBLIC_DOMAIN" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  PUBLIC_DOMAIN="${PUBLIC_DOMAIN}.sslip.io"
fi
export PUBLIC_DOMAIN
log "ShipSquares installer · os=$OS_TYPE · version=$SS_VERSION · dashboard=$PUBLIC_DOMAIN"

step_packages
step_user_dirs
step_secrets       # before postgres/env: they read DB_PASSWORD
step_docker
step_postgres
step_bundle
step_env
step_units
step_firewall
step_migrate_seed

URL="https://${PUBLIC_DOMAIN}"
log "done — dashboard: $URL"
if [ "$PUBLIC_DOMAIN" = "localhost" ]; then
  log "local install — reach it via an SSH tunnel:"
  log "  ssh -L 8443:127.0.0.1:443 <user>@<server>  then open https://localhost:8443"
else
  log "open inbound TCP 80 + 443 to this server in your firewall to reach $URL"
  case "$(detect_cloud)" in
    azure) log "  (Azure: VM → Networking → add inbound port rule for 80,443)" ;;
    aws)   log "  (AWS: the instance Security Group → inbound 80,443)" ;;
    gcp)   log "  (GCP: VPC firewall → allow tcp:80,443)" ;;
  esac
fi
[ -n "$ADMIN_EMAIL" ] || log "set an admin: re-run with --admin-email you@example.com"
