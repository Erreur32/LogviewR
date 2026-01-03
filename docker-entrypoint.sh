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
if ! getent group adm > /dev/null 2>&1; then
    # Create adm group with standard GID 4 if it doesn't exist
    addgroup -g 4 adm 2>/dev/null || true
fi
# Add node user to adm group
addgroup node adm 2>/dev/null || true

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

