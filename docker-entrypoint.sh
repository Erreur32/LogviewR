#!/bin/sh
# Docker entrypoint script to fix permissions for SQLite database
# This ensures the node user can write to /app/data directory
# This script runs as root to fix permissions, then switches to node user

set -e

# Get the UID/GID of the node user (usually 1000:1000)
NODE_UID=$(id -u node 2>/dev/null || echo "1000")
NODE_GID=$(id -g node 2>/dev/null || echo "1000")

# Create /app/data directory if it doesn't exist
if [ ! -d "/app/data" ]; then
  mkdir -p /app/data
fi

# Fix permissions for /app/data directory
# This is necessary because Docker volumes are created with root ownership
# Set directory permissions to 755 and file permissions to 644
chown -R ${NODE_UID}:${NODE_GID} /app/data 2>/dev/null || true
find /app/data -type d -exec chmod 755 {} \; 2>/dev/null || true
find /app/data -type f -exec chmod 644 {} \; 2>/dev/null || true

# Add node user to adm group to read log files (GID 4 is standard for adm group)
# This allows the container to read files owned by root:adm (like auth.log, cron.log, etc.)
# The adm group GID (4) should match the host's adm group GID
if ! getent group adm >/dev/null 2>&1; then
  # Create adm group with standard GID 4 if it doesn't exist
  addgroup -g 4 adm 2>/dev/null || true
fi
# Add node user to adm group
addgroup node adm 2>/dev/null || true

# ── Shared helper: join the group that owns a host-mounted resource ─────────
# Reads the resource's GID at runtime, creates a matching group inside the
# container if needed, and adds node to it — so node can access any
# socket/directory owned by that GID without a hardcoded value in the image.
# Prints the joined group name on success; returns 1 if the resource is
# owned by gid 0 (root), since joining "root" would over-grant access.
join_owning_group() {
  path="$1"
  want_name="$2"
  gid=$(stat -c "%g" "$path" 2>/dev/null || echo "0")
  [ "$gid" = "0" ] && return 1
  group=$(getent group "$gid" 2>/dev/null | cut -d: -f1)
  if [ -z "$group" ]; then
    addgroup -g "$gid" "$want_name" 2>/dev/null || true
    group="$want_name"
  fi
  addgroup node "$group" 2>/dev/null || true
  echo "$group"
}

# ── Fail2ban socket access ────────────────────────────────────────────────────
if [ -S "/var/run/fail2ban/fail2ban.sock" ]; then
  SOCK_GID=$(stat -c "%g" /var/run/fail2ban/fail2ban.sock 2>/dev/null || echo "0")
  SOCK_MODE=$(stat -c "%a" /var/run/fail2ban/fail2ban.sock 2>/dev/null || echo "0")
  if [ "$SOCK_GID" != "0" ]; then
    F2B_GROUP=$(join_owning_group /var/run/fail2ban/fail2ban.sock fail2ban)
    echo "fail2ban socket: node joined group '$F2B_GROUP' (gid=$SOCK_GID, mode=$SOCK_MODE)"
  else
    echo "fail2ban socket: gid=0 (root:root) — run setup-fail2ban-access.sh on the host for proper permissions"
  fi
else
  echo "fail2ban socket: not found at /var/run/fail2ban/fail2ban.sock (plugin will be unavailable)"
fi

# ── Fail2ban SQLite database access ──────────────────────────────────────────
# fail2ban.sqlite3 is typically owned by root:root with mode 600.
# The node user needs read access. Fix on host via systemd drop-in:
#   ExecStartPost=/bin/chmod 644 /var/lib/fail2ban/fail2ban.sqlite3
DB_HOST_PATH="/host/var/lib/fail2ban/fail2ban.sqlite3"
if [ -f "${DB_HOST_PATH}" ]; then
  # Test read access as the node user (not as root)
  if su-exec node test -r "${DB_HOST_PATH}" 2>/dev/null; then
    echo "fail2ban SQLite: readable ✓ (${DB_HOST_PATH})"
  else
    echo "WARNING: fail2ban SQLite exists but is NOT readable by node user!"
    echo "  Host fix: chmod o+r /var/lib/fail2ban/fail2ban.sqlite3"
    echo "  Persistent fix (systemd drop-in):"
    echo "    ExecStartPost=/bin/chmod 644 /var/lib/fail2ban/fail2ban.sqlite3"
    echo "  Ban history and stats will be unavailable until this is fixed."
  fi
else
  echo "fail2ban SQLite: not found at ${DB_HOST_PATH} (fail2ban may not be installed, or different path)"
fi

# ── Web server log directory access (Apache, nginx, ...) ────────────────────
# These directories are bind-mounted from the host and can be owned by an
# arbitrary group there (not always the standard "adm" group added above —
# e.g. a distro-specific group like "www-data" or a custom one). Instead of
# hardcoding a GID, detect each directory's owning group at startup and join
# it dynamically via join_owning_group() above. This keeps log access working
# even if the host resets directory ownership later.
for LOG_DIR in /host/var/log/apache2 /host/var/log/httpd /host/var/log/nginx; do
  [ -d "${LOG_DIR}" ] || continue
  if su-exec node test -r "${LOG_DIR}" 2>/dev/null; then
    echo "log dir ${LOG_DIR}: readable ✓"
    continue
  fi
  DIR_GID=$(stat -c "%g" "${LOG_DIR}" 2>/dev/null || echo "0")
  if [ "${DIR_GID}" = "0" ]; then
    echo "WARNING: log dir ${LOG_DIR} is owned by group root (gid=0) and not readable by node — fix on host: chgrp adm ${LOG_DIR} && chmod g+rx ${LOG_DIR}"
    continue
  fi
  DIR_GROUP=$(join_owning_group "${LOG_DIR}" "loggrp${DIR_GID}")
  if su-exec node test -r "${LOG_DIR}" 2>/dev/null; then
    echo "log dir ${LOG_DIR}: node joined group '${DIR_GROUP}' (gid=${DIR_GID}) ✓"
  else
    echo "WARNING: log dir ${LOG_DIR} still not readable after joining group '${DIR_GROUP}' (gid=${DIR_GID})"
  fi
done

# Create symlink /host/logs -> /host/var/log for backward compatibility
# The plugin expects /host/logs but /host/var/log is already available via /:/host:ro mount
# This avoids Docker mount issues with read-only filesystem
# Note: This may fail if /host is read-only, but that's OK - the code has a fallback
if [ -d "/host/var/log" ] && [ ! -e "/host/logs" ]; then
  # Try to create symlink, but don't fail if it doesn't work (read-only filesystem)
  ln -s /host/var/log /host/logs 2>/dev/null || {
    echo "Warning: Could not create symlink /host/logs -> /host/var/log (read-only filesystem?)"
    echo "The application will use /host/var/log directly as fallback."
  }
fi

# Switch to node user and execute the main command (passed as arguments)
# Use su-exec (available in Alpine) to switch user
exec su-exec node "$@"
