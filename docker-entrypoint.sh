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

# Switch to node user and execute the main command (passed as arguments)
# Use su-exec (available in Alpine) to switch user
exec su-exec node "$@"

