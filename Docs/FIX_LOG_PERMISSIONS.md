# Fixing Log File Permissions

> 🇫🇷 [Lire en français](./FIX_LOG_PERMISSIONS.fr.md)

## 🐛 Problem

System log files (auth.log, cron.log, daemon.log, etc.) are owned by `root:adm` with `640` permissions (rw-r-----), meaning only the owner (root) and the group (adm) can read them.

The Docker container runs as the `node` user (non-root), which isn't in the `adm` group, so it can't read these files.

## ✅ Solutions

### Solution 1: Add the node user to the adm group (Recommended)

Modify `docker-entrypoint.sh` to add the `node` user to the `adm` group:

```bash
# In docker-entrypoint.sh, before switching to node
# Add node to the adm group (GID 4 on Debian/Ubuntu)
if getent group adm > /dev/null 2>&1; then
    # If the adm group already exists in the container, add node
    addgroup -g 4 adm 2>/dev/null || true
    addgroup node adm 2>/dev/null || true
else
    # Otherwise, create the adm group with the standard GID (4)
    addgroup -g 4 adm 2>/dev/null || true
    addgroup node adm 2>/dev/null || true
fi
```

**Limitation**: This only works if the `adm` group's GID on the host matches the GID inside the container.

### Solution 2: Use the host's adm group GID (Better solution)

Modify `docker-compose.yml` to map the host's `adm` group GID:

```yaml
services:
  logviewr:
    # ... other configuration ...
    user: "${UID:-1000}:${ADM_GID:-4}"  # node's UID : adm's GID
    group_add:
      - "${ADM_GID:-4}"  # Add the adm group
```

Then in `.env`:
```bash
# Get the host's adm group GID
ADM_GID=$(getent group adm | cut -d: -f3)
echo "ADM_GID=$ADM_GID" >> .env
```

**Note**: This solution requires changing the container's `user`, which can cause issues with `/app/data` permissions.

### Solution 3: Change permissions on the host (Not recommended)

Change the permissions of log files on the host to make them world-readable:

```bash
# ⚠️ NOT RECOMMENDED for security
sudo chmod 644 /var/log/auth.log
sudo chmod 644 /var/log/cron.log
# etc.
```

**Problem**: This reduces the security of the system.

### Solution 4: Run the container as root (Not recommended)

Modify `docker-compose.yml` to run the container as root:

```yaml
services:
  logviewr:
    # ... other configuration ...
    user: "root:root"  # ⚠️ NOT RECOMMENDED
```

**Problem**: This reduces container security.

## 🎯 Recommended solution: map the adm group

The best solution is to map the host's `adm` group GID into the container and add the `node` user to that group.

### Implementation steps

1. **Modify `docker-entrypoint.sh`** to add node to the adm group
2. **Modify `docker-compose.yml`** to map the adm group
3. **Create a script** to fetch the host's adm GID
