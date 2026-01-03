# Comparaison des fichiers Docker Compose

## 📋 Vue d'ensemble

Le projet contient 3 fichiers docker-compose pour différents usages :

| Fichier | Usage | Image | Port par défaut |
|---------|-------|-------|-----------------|
| `docker-compose.yml` | Production | `ghcr.io/erreur32/logviewr:latest` | 7500 |
| `docker-compose.local.yml` | Build local | Build local | 7501 |
| `docker-compose.dev.yml` | Développement | Build local (hot reload) | 3777 |

## 🔍 Comparaison détaillée

### Variables d'environnement

| Variable | docker-compose.yml | docker-compose.local.yml | docker-compose.dev.yml |
|----------|-------------------|-------------------------|----------------------|
| `JWT_SECRET` | ✅ `${JWT_SECRET}` (requis) | ✅ `${JWT_SECRET:-change-me...}` | ✅ `${JWT_SECRET:-dev_secret...}` |
| `DASHBOARD_PORT` | ✅ `7500` | ✅ `7501` | ✅ `3777` |
| `HOST_ROOT_PATH` | ✅ `/host` | ❌ **MANQUANT** | ✅ `/host` |
| `HOST_IP` | ✅ Optionnel | ✅ `192.168.1.150` | ❌ Non défini |
| `CONFIG_FILE_PATH` | ✅ `/app/config/logviewr.conf` | ✅ `/app/config/logviewr.conf` | ❌ Non défini |

### Volumes

| Montage | docker-compose.yml | docker-compose.local.yml | docker-compose.dev.yml |
|---------|-------------------|-------------------------|----------------------|
| `./data:/app/data` | ✅ | ✅ (volume nommé) | ✅ |
| `/:/host:ro` | ✅ | ✅ | ❌ Commenté (permissions) |
| `/proc:/host/proc:ro` | ✅ | ✅ | ✅ |
| `/sys:/host/sys:ro` | ✅ | ✅ | ✅ |
| `/var/log:/host/logs:ro` | ❌ Symlink | ❌ Symlink | ✅ Nécessaire |

### Montage `/var/log:/host/logs:ro`

**docker-compose.yml** et **docker-compose.local.yml** :
- ❌ Montage supprimé (cause erreur "read-only file system")
- ✅ Utilisation du symlink `/host/logs -> /host/var/log` créé par `docker-entrypoint.sh`
- ✅ `/host/var/log` disponible via `/:/host:ro`

**docker-compose.dev.yml** :
- ✅ Montage conservé car `/:/host:ro` est commenté
- ✅ Nécessaire pour accéder aux logs en mode dev

## ⚠️ Problèmes identifiés

### 1. HOST_ROOT_PATH manquant dans docker-compose.local.yml

**Problème** : `HOST_ROOT_PATH` n'est pas défini dans `docker-compose.local.yml`

**Impact** : La détection OS et les métriques système peuvent ne pas fonctionner correctement

**Solution** : Ajouter `HOST_ROOT_PATH: ${HOST_ROOT_PATH:-/host}` dans la section environment

## ✅ Alignement recommandé

Tous les fichiers devraient avoir :
- ✅ `HOST_ROOT_PATH: ${HOST_ROOT_PATH:-/host}`
- ✅ Même stratégie pour `/host/logs` (symlink si `/:/host:ro` présent, montage sinon)
- ✅ Documentation cohérente
