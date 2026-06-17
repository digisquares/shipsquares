#!/usr/bin/env bash
# The 9 idempotent install steps (18-installer-ops.md). Each step probes before
# acting so a re-run repairs rather than duplicates. The payload is NATIVE
# (systemd) Caddy + Postgres + control plane; only user apps run in Docker.

PREFIX=/opt/shipsquares
ETC=/etc/shipsquares
DATA=/var/lib/shipsquares
ARCH="$(uname -m)"; case "$ARCH" in x86_64) GOARCH=amd64;; aarch64|arm64) GOARCH=arm64;; *) GOARCH=amd64;; esac

# 1 ── base packages -----------------------------------------------------------
step_packages() {
  # rclone is the S3/SFTP transport for DB backups + PITR WAL archiving (27);
  # without it every backup exits 127. pg client tools come with postgresql.
  step 1 "packages (curl, jq, openssl, ca-certificates, git, tar, rclone)"
  ensure_pkgs curl jq openssl ca-certificates git tar rclone
}

# 2 ── service user + dirs -----------------------------------------------------
step_user_dirs() {
  step 2 "user + directories"
  getent passwd shipsquares >/dev/null || useradd -r -s /usr/sbin/nologin -d "$DATA" shipsquares
  install -d -o shipsquares -g shipsquares "$ETC" "$DATA" "$DATA/ssh" "$PREFIX"
}

# 3 ── Docker (for app workloads + worker parity) ------------------------------
step_docker() {
  step 4 "docker"
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker
  # the control plane builds/runs app containers, so its user needs the daemon
  usermod -aG docker shipsquares 2>/dev/null || true
  install -d -o shipsquares -g shipsquares "$DATA/builds"  # deploy build contexts (06)
  # Nixpacks: build apps that have no Dockerfile (auto-detect language) (07)
  command -v nixpacks >/dev/null 2>&1 || curl -fsSL https://nixpacks.com/install.sh | bash || true
}

# 4 ── native Postgres + Node runtime + cluster --------------------------------
step_postgres() {
  step 5 "postgres + node runtime"
  if ! command -v psql >/dev/null 2>&1; then
    case "$OS_TYPE" in
      ubuntu|debian) ensure_pkgs postgresql postgresql-contrib ;;
      fedora)        ensure_pkgs postgresql-server postgresql-contrib
                     [ -s /var/lib/pgsql/data/PG_VERSION ] || postgresql-setup --initdb ;;
      arch)          ensure_pkgs postgresql
                     [ -s /var/lib/postgres/data/PG_VERSION ] || \
                       sudo -u postgres initdb -D /var/lib/postgres/data ;;
    esac
  fi
  systemctl enable --now postgresql
  if ! command -v node >/dev/null 2>&1; then
    case "$OS_TYPE" in
      ubuntu|debian) curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
                     ensure_pkgs nodejs ;;
      fedora)        ensure_pkgs nodejs ;;
      arch)          ensure_pkgs nodejs npm ;;
    esac
  fi
  # control-plane role + DB (idempotent); password from secrets.env
  local pw; pw="$(secret DB_PASSWORD)"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='shipsquares'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE ROLE shipsquares LOGIN PASSWORD '$pw' CREATEDB CREATEROLE"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='shipsquares'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE shipsquares OWNER shipsquares"
}

# 5 ── control-plane bundle + Caddy binary -------------------------------------
step_bundle() {
  step 6 "bundle + caddy ($SS_VERSION)"
  local dest="$PREFIX/$SS_VERSION"
  if [ ! -f "$dest/dist/index.js" ]; then
    install -d -o shipsquares -g shipsquares "$dest"
    local tgz="$DATA/bundle-$SS_VERSION.tgz"
    case "$BUNDLE_SRC" in
      http://*|https://*) curl -fsSL "$BUNDLE_SRC" -o "$tgz" ;;
      *)                  cp "$BUNDLE_SRC" "$tgz" ;;
    esac
    tar xzf "$tgz" -C "$dest"
    chown -R shipsquares:shipsquares "$dest"
  fi
  if ! command -v caddy >/dev/null 2>&1; then
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$GOARCH" -o /usr/local/bin/caddy
    chmod 0755 /usr/local/bin/caddy
  fi
  getent passwd caddy >/dev/null || useradd -r -s /usr/sbin/nologin -d /var/lib/caddy caddy
  install -d -o caddy -g caddy /var/lib/caddy   # Caddy's writable ACME/data store
}

# 6 ── env file (non-secret config; DATABASE_URL/AUTH_SECRET live in secrets) --
step_env() {
  step 7 "env file"
  cat > "$ETC/env" <<EOF
NODE_ENV=production
PORT=3000
AUTH_URL=https://${PUBLIC_DOMAIN:-localhost}
CADDY_ADMIN_URL=http://127.0.0.1:2019
PROXY_DRIVER=caddy
LOG_LEVEL=info
EOF
  chmod 0644 "$ETC/env"
}

# 7 ── secrets (generate-if-missing) ------------------------------------------
step_secrets() { step 3 "secrets"; gen_secrets_if_missing; }

# 8 ── systemd units -----------------------------------------------------------
step_units() {
  step 8 "systemd units"
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  install -m 0644 "$here/systemd/shipsquares.service"       /etc/systemd/system/
  install -m 0644 "$here/systemd/shipsquares-caddy.service" /etc/systemd/system/
  [ -f "$ETC/caddy.base.json" ] || install -m 0644 -o caddy "$here/caddy/caddy.base.json" "$ETC/caddy.base.json"
  ln -sfn "$PREFIX/$SS_VERSION" "$PREFIX/current"
  systemctl daemon-reload
  systemctl enable --now shipsquares-caddy
}

# 8b ── host firewall (a PaaS must expose 80/443; cloud SG is the operator's job)
step_firewall() {
  step 9 "firewall (80/443)"
  # Allow-rules only — never *enable* a dormant ufw, which could strand SSH.
  if command -v ufw >/dev/null 2>&1; then
    for p in 22 80 443; do ufw allow "$p"/tcp >/dev/null 2>&1 || true; done
  elif command -v firewall-cmd >/dev/null 2>&1; then
    for s in ssh http https; do firewall-cmd --permanent --add-service="$s" >/dev/null 2>&1 || true; done
    firewall-cmd --reload >/dev/null 2>&1 || true
  fi
}

# 9 ── migrate + seed + start + verify ----------------------------------------
step_migrate_seed() {
  step 10 "migrate + seed + start"
  # Loads both the non-secret env and the 0600 secrets (DATABASE_URL/AUTH_SECRET,
  # and ADMIN_PASSWORD for the seed). Word-split is intentional (one KEY=VAL arg
  # per env line).
  local envvars
  envvars=$(grep -hv '^#' "$ETC/env" "$SECRETS_FILE" | xargs)
  # Programmatic migrator (ships in the bundle; no drizzle-kit needed).
  sudo -u shipsquares env $envvars node "$PREFIX/current/dist/db/migrate.js"
  # First-admin seed (org + owner user with a credential) when an email is given.
  if [ -n "${ADMIN_EMAIL:-}" ]; then
    sudo -u shipsquares env $envvars ADMIN_EMAIL="$ADMIN_EMAIL" \
      node "$PREFIX/current/dist/auth/seed-admin.js"
    log "first admin: $ADMIN_EMAIL (password in $SECRETS_FILE -> ADMIN_PASSWORD)"
  else
    log "no --admin-email; create the first admin later (re-run with --admin-email)"
  fi
  systemctl enable --now shipsquares
  verify_ready
}

verify_ready() {
  for _ in $(seq 1 30); do
    curl -fsS http://localhost:3000/readyz >/dev/null 2>&1 && { log "control plane ready"; return 0; }
    sleep 1
  done
  die "control plane did not become ready (see: journalctl -u shipsquares)"
}
