# How Log Access Works

> 🇫🇷 [Lire en français](./HOW_LOGS_ACCESS_WORKS.fr.md)

## 📋 Overview

LogviewR runs inside a Docker container but needs to read log files living on the host system. This document explains the mechanism used to access those files.

## 🔧 The `/:/host:ro` mount

In production and local docker-compose files, the entire host filesystem is mounted read-only inside the container:

```yaml
volumes:
  - /:/host:ro
```

This means the container's `/host` directory mirrors the host's `/` (root) filesystem. For example:
- Host `/var/log/auth.log` → Container `/host/var/log/auth.log`
- Host `/etc/os-release` → Container `/host/etc/os-release`

## 🔗 The `/host/logs -> /host/var/log` symlink

Since `/var/log:/host/logs:ro` isn't mounted directly (it caused "read-only file system" errors in some setups), `docker-entrypoint.sh` creates a symlink at container startup:

```bash
# In docker-entrypoint.sh
if [ -d /host/var/log ] && [ ! -e /host/logs ]; then
    ln -s /host/var/log /host/logs
fi
```

This way, code referencing `/host/logs` transparently resolves to `/host/var/log`, without requiring a separate mount.

## 💻 Code: `HostSystemLogPlugin.ts`

```typescript
const DOCKER_LOG_PATH = '/host/logs';
const STANDARD_LOG_PATH = '/var/log';

function getLogBasePath(): string {
    if (fs.existsSync(DOCKER_LOG_PATH)) {
        return DOCKER_LOG_PATH;
    }
    return STANDARD_LOG_PATH;
}
```

**Logic**:
1. If `/host/logs` exists (Docker environment with the mount + symlink) → use it
2. Otherwise (bare-metal/non-Docker environment) → fall back to the standard `/var/log` path

This lets the exact same code run both inside a Docker container and directly on a host machine.

## 🧩 Why this two-step approach (mount + symlink)?

- **Direct mount** (`/var/log:/host/logs:ro`) is simpler but can fail on some systems where `/var/log` is itself a mount point or a symlink on the host, causing Docker's bind-mount to error out.
- **Full-root mount** (`/:/host:ro`) plus an internal symlink sidesteps that issue entirely: the whole filesystem is already available under `/host`, and the symlink just provides the conventional `/host/logs` shortcut that the code expects.
- This approach also gives the container access to `/host/etc`, `/host/proc`, `/host/sys` for OS detection and system metrics, which a narrow `/var/log` mount wouldn't provide.

## 🔍 Verification

### 1. Check the mount inside the container

```bash
docker exec logviewr ls -la /host
```

### 2. Check the symlink

```bash
docker exec logviewr ls -la /host/logs
# Should show: /host/logs -> /host/var/log
```

### 3. Check that log files are readable

```bash
docker exec logviewr ls -la /host/logs/auth.log
docker exec logviewr cat /host/logs/auth.log | head -5
```

### 4. Check permissions

If files aren't readable, see [Fixing Log File Permissions](./FIX_LOG_PERMISSIONS.md).

## ⚠️ Important notes

1. **Read-only mount** (`:ro`) — LogviewR can never modify files on the host, only read them
2. **Non-root user** — the container runs as the `node` user, so file permissions on the host still apply (see [Fixing Log File Permissions](./FIX_LOG_PERMISSIONS.md))
3. **Symlink created at startup** — if `/host/var/log` doesn't exist when the container starts, the symlink won't be created either
