# Docker Compose Files Comparison

> 🇫🇷 [Lire en français](./DOCKER_COMPOSE_COMPARISON.fr.md)

## 📋 Overview

The project contains 3 docker-compose files for different use cases:

| File | Usage | Image | Default port |
|------|-------|-------|---------------|
| `docker-compose.yml` | Production | `ghcr.io/erreur32/logviewr:latest` | 7500 |
| `docker-compose.local.yml` | Local build | Local build | 7501 |
| `docker-compose.dev.yml` | Development | Local build (hot reload) | 3777 |

## 🔍 Detailed comparison

### Environment variables

| Variable | docker-compose.yml | docker-compose.local.yml | docker-compose.dev.yml |
|----------|-------------------|-------------------------|----------------------|
| `JWT_SECRET` | ✅ `${JWT_SECRET}` (required) | ✅ `${JWT_SECRET:-change-me...}` | ✅ `${JWT_SECRET:-dev_secret...}` |
| `DASHBOARD_PORT` | ✅ `7500` | ✅ `7501` | ✅ `3777` |
| `HOST_ROOT_PATH` | ✅ `/host` | ❌ **MISSING** | ✅ `/host` |
| `HOST_IP` | ✅ Optional | ✅ `192.168.1.150` | ❌ Not set |
| `CONFIG_FILE_PATH` | ✅ `/app/config/logviewr.conf` | ✅ `/app/config/logviewr.conf` | ❌ Not set |

### Volumes

| Mount | docker-compose.yml | docker-compose.local.yml | docker-compose.dev.yml |
|-------|-------------------|-------------------------|----------------------|
| `./data:/app/data` | ✅ | ✅ (named volume) | ✅ |
| `/:/host:ro` | ✅ | ✅ | ❌ Commented out (permissions) |
| `/proc:/host/proc:ro` | ✅ | ✅ | ✅ |
| `/sys:/host/sys:ro` | ✅ | ✅ | ✅ |
| `/var/log:/host/logs:ro` | ❌ Symlink | ❌ Symlink | ✅ Required |

### `/var/log:/host/logs:ro` mount

**docker-compose.yml** and **docker-compose.local.yml**:
- ❌ Mount removed (causes "read-only file system" error)
- ✅ Uses the `/host/logs -> /host/var/log` symlink created by `docker-entrypoint.sh`
- ✅ `/host/var/log` is available via `/:/host:ro`

**docker-compose.dev.yml**:
- ✅ Mount kept because `/:/host:ro` is commented out
- ✅ Required to access logs in dev mode

## ⚠️ Identified issues

### 1. HOST_ROOT_PATH missing in docker-compose.local.yml

**Problem**: `HOST_ROOT_PATH` is not defined in `docker-compose.local.yml`

**Impact**: OS detection and system metrics may not work correctly

**Solution**: Add `HOST_ROOT_PATH: ${HOST_ROOT_PATH:-/host}` in the environment section

## ✅ Recommended alignment

All files should have:
- ✅ `HOST_ROOT_PATH: ${HOST_ROOT_PATH:-/host}`
- ✅ The same strategy for `/host/logs` (symlink if `/:/host:ro` is present, direct mount otherwise)
- ✅ Consistent documentation
