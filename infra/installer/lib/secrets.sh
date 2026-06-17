#!/usr/bin/env bash
# Generate-if-missing secrets (18-installer-ops.md). Mirrors Coolify's
# "only generate when absent" pattern so re-runs NEVER rotate a live secret.

SECRETS_FILE="${SECRETS_FILE:-/etc/shipsquares/secrets.env}"

# Write secrets.env exactly once, mode 0600, owned by the shipsquares user.
# A second call is a no-op: the existing bytes are left untouched.
gen_secrets_if_missing() {
  if [ -f "$SECRETS_FILE" ]; then
    log "secrets exist — leaving untouched ($SECRETS_FILE)"
    return 0
  fi
  umask 077
  # The dir must stay world-traversable (0755): it also holds the non-secret env
  # and caddy.base.json, which the caddy user reads. Only secrets.env is 0600.
  install -d -m 0755 -o shipsquares -g shipsquares "$(dirname "$SECRETS_FILE")"
  local db_pw; db_pw="$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)"
  {
    echo "DB_PASSWORD=$db_pw"
    # Full connection string lives here (0600), not in the world-readable env —
    # systemd EnvironmentFile does no $-expansion, so it must be pre-composed.
    echo "DATABASE_URL=postgres://shipsquares:$db_pw@localhost:5432/shipsquares"
    echo "AUTH_SECRET=$(openssl rand -hex 32)"
    # base64 32-byte key that seals at-rest secret env vars (11-secrets-config.md)
    echo "SHIPSQUARES_MASTER_KEY=$(openssl rand -base64 32)"
    # Surfaced once to the operator at the end of install if unset by the caller.
    echo "ADMIN_PASSWORD=${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)}"
    echo "WEBHOOK_SIGNING_KEY=$(openssl rand -hex 24)"
  } > "$SECRETS_FILE"
  chmod 0600 "$SECRETS_FILE"
  chown shipsquares:shipsquares "$SECRETS_FILE"
  log "generated secrets ($SECRETS_FILE, 0600)"
}

# Read a single value back out of secrets.env (for migrate/seed steps).
secret() { awk -F= -v k="$1" '$1==k{print substr($0, index($0,"=")+1)}' "$SECRETS_FILE"; }
