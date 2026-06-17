#!/usr/bin/env bash
# OS detection + small idempotency helpers (18-installer-ops.md).
# ADAPTS the structure of Coolify's scripts/install.sh (Apache-2.0): root check,
# OS_TYPE normalization, per-step logging. See NOTICE for attribution.

# --- logging -----------------------------------------------------------------
STEP_TOTAL=10
log()  { printf '\033[1;34m[ss]\033[0m %s\n' "$*"; }
step() { printf '\033[1;32m%s/%s\033[0m %s\n' "$1" "$STEP_TOTAL" "$2"; }
die()  { printf '\033[1;31m[ss] error:\033[0m %s\n' "$*" >&2; exit 1; }

# --- preconditions -----------------------------------------------------------
require_root() { [ "${EUID:-$(id -u)}" -eq 0 ] || die "run as root (sudo)"; }

# Normalize distro IDs the way Coolify's installer does, so downstream package
# steps branch on a small known set.
normalize_os() {
  case "$1" in
    manjaro|manjaro-arm)              echo "arch" ;;
    endeavouros|arch|archarm)         echo "arch" ;;
    pop|linuxmint|zorin|ubuntu)       echo "ubuntu" ;;
    debian|raspbian)                  echo "debian" ;;
    fedora|fedora-asahi-remix)        echo "fedora" ;;
    *)                                echo "$1" ;;
  esac
}

detect_os() {
  [ -r /etc/os-release ] || die "cannot read /etc/os-release"
  # shellcheck disable=SC1091
  OS_TYPE="$(. /etc/os-release && echo "$ID")"
  OS_TYPE="$(normalize_os "$OS_TYPE")"
  case "$OS_TYPE" in
    ubuntu|debian|fedora|arch) : ;;
    *) die "unsupported OS '$OS_TYPE' (supported: ubuntu, debian, fedora, arch)" ;;
  esac
  echo "$OS_TYPE"
}

# Package install dispatch per normalized OS.
ensure_pkgs() {
  case "$OS_TYPE" in
    ubuntu|debian) export DEBIAN_FRONTEND=noninteractive
                   apt-get update -qq && apt-get install -y -qq "$@" ;;
    fedora)        dnf install -y -q "$@" ;;
    arch)          pacman -Sy --noconfirm "$@" ;;
  esac
}

# Idempotency probe: run the action only if the test command fails.
unless() { # unless <test-cmd...> -- <action-cmd...>
  local test_cmd=() ; while [ "$1" != "--" ]; do test_cmd+=("$1"); shift; done; shift
  if "${test_cmd[@]}" >/dev/null 2>&1; then return 0; else "$@"; fi
}

# Best-effort public IPv4 for the dashboard host (18-installer-ops.md /
# docs/installer-access.md): cloud metadata first (fast + authoritative), then a
# public echo. Empty output ⇒ couldn't determine ⇒ caller treats as a local box.
detect_public_ip() {
  local ip=""
  # Azure IMDS (requires the Metadata header)
  ip="$(curl -fsS -m 2 -H 'Metadata:true' \
    'http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text' 2>/dev/null)"
  # AWS IMDSv2 (token then query)
  if [ -z "$ip" ]; then
    local tok
    tok="$(curl -fsS -m 2 -X PUT 'http://169.254.169.254/latest/api/token' \
      -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null)"
    [ -n "$tok" ] && ip="$(curl -fsS -m 2 -H "X-aws-ec2-metadata-token: $tok" \
      'http://169.254.169.254/latest/meta-data/public-ipv4' 2>/dev/null)"
  fi
  # GCP
  if [ -z "$ip" ]; then
    ip="$(curl -fsS -m 2 -H 'Metadata-Flavor: Google' \
      'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip' 2>/dev/null)"
  fi
  # Public echo fallback
  if [ -z "$ip" ]; then
    ip="$(curl -fsS -m 4 https://api.ipify.org 2>/dev/null || curl -fsS -m 4 https://ifconfig.me 2>/dev/null)"
  fi
  if printf '%s' "$ip" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    printf '%s' "$ip"
  fi
}

# Best-effort cloud identification, for the post-install firewall hint.
detect_cloud() {
  curl -fsS -m 2 -H 'Metadata:true' \
    'http://169.254.169.254/metadata/instance?api-version=2021-02-01' >/dev/null 2>&1 \
    && { echo azure; return; }
  curl -fsS -m 2 -H 'Metadata-Flavor: Google' 'http://metadata.google.internal/' >/dev/null 2>&1 \
    && { echo gcp; return; }
  curl -fsS -m 2 'http://169.254.169.254/latest/meta-data/' >/dev/null 2>&1 \
    && { echo aws; return; }
  echo unknown
}
