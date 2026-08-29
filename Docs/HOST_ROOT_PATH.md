# HOST_ROOT_PATH - Documentation

> 🇫🇷 [Lire en français](./HOST_ROOT_PATH.fr.md)

## 📋 Usage

The `HOST_ROOT_PATH` environment variable is used to access the host system's files when LogviewR runs inside a Docker container.

## 🎯 Use cases

### 1. OS detection (`OSDetector.ts`)
- Reads `/host/etc/os-release` to detect the host's OS type
- Used to determine default log paths (Debian vs RedHat vs Arch, etc.)
- **Requires**: `/:/host:ro` mount in docker-compose

### 2. System metrics (`systemServer.ts`)
- Reads host metrics (disks, hostname, uptime)
- Uses `/host/proc`, `/host/sys` for system statistics
- **Requires**: `/:/host:ro` mount or specific mounts (`/proc:/host/proc:ro`, `/sys:/host/sys:ro`)

### 3. Log access (`HostSystemLogPlugin.ts`)
- Accesses host logs via `/host/logs` (which points to the host's `/var/log`)
- **Requires**: `/var/log:/host/logs:ro` mount

## 📦 Configuration in docker-compose

### Production (`docker-compose.yml`)
```yaml
environment:
  HOST_ROOT_PATH: ${HOST_ROOT_PATH:-/host}

volumes:
  - /:/host:ro                    # ✅ Mounted - host OS detection works
  - /proc:/host/proc:ro
  - /sys:/host/sys:ro
  - /var/log:/host/logs:ro
```
**Result**: Host OS detection ✅

### Development (`docker-compose.dev.yml`)
```yaml
environment:
  HOST_ROOT_PATH: ${HOST_ROOT_PATH:-/host}

volumes:
  # - /:/host:ro                  # ❌ Commented out - permission issues
  - /proc:/host/proc:ro
  - /sys:/host/sys:ro
  - /var/log:/host/logs:ro
```
**Result**: Container OS detection (Alpine) ⚠️

### Local (`docker-compose.local.yml`)
```yaml
environment:
  HOST_ROOT_PATH: ${HOST_ROOT_PATH:-/host}

volumes:
  - /:/host:ro                    # ✅ Mounted - host OS detection works
  - /proc:/host/proc:ro
  - /sys:/host/sys:ro
  - /var/log:/host/logs:ro
```
**Result**: Host OS detection ✅

## ❓ Should HOST_ROOT_PATH be kept?

### ✅ YES, keep the variable

**Reasons**:
1. **Production**: The `/:/host:ro` mount is present → host OS detection works
2. **Existing code**: The code uses `HOST_ROOT_PATH` in several places
3. **Flexibility**: Allows changing the path if needed
4. **System metrics**: Used to read host metrics

### ⚠️ Impact if HOST_ROOT_PATH is removed

If the environment variable is removed:
- The code falls back to the default value `/host`
- If `/:/host:ro` isn't mounted → OS detection uses the container's `/etc/os-release` (Alpine)
- System metrics won't work correctly

## 🔧 Recommendation

**Keep `HOST_ROOT_PATH` in all docker-compose files** because:
- ✅ Required for OS detection in production
- ✅ Used for system metrics
- ✅ The default value `/host` works when the mount is present
- ✅ No issue if the mount isn't present (falls back to the container's `/etc/os-release`)

## 📝 Note on docker-compose.dev.yml

In `docker-compose.dev.yml`, the `/:/host:ro` mount is commented out to avoid permission issues. In that case:
- OS detection uses the Alpine container's `/etc/os-release`
- This is acceptable for development
- To test host OS detection, uncomment `/:/host:ro`
