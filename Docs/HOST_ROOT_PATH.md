# HOST_ROOT_PATH - Documentation

## 📋 Utilisation

La variable d'environnement `HOST_ROOT_PATH` est utilisée pour accéder aux fichiers du système hôte quand LogviewR s'exécute dans un conteneur Docker.

## 🎯 Cas d'usage

### 1. Détection OS (`OSDetector.ts`)
- Lit `/host/etc/os-release` pour détecter le type d'OS du host
- Utilisé pour déterminer les chemins de logs par défaut (Debian vs RedHat vs Arch, etc.)
- **Nécessite** : Montage `/:/host:ro` dans docker-compose

### 2. Métriques système (`systemServer.ts`)
- Lit les métriques du host (disques, hostname, uptime)
- Utilise `/host/proc`, `/host/sys` pour les statistiques système
- **Nécessite** : Montage `/:/host:ro` ou montages spécifiques (`/proc:/host/proc:ro`, `/sys:/host/sys:ro`)

### 3. Accès aux logs (`HostSystemLogPlugin.ts`)
- Accède aux logs du host via `/host/logs` (qui pointe vers `/var/log` du host)
- **Nécessite** : Montage `/var/log:/host/logs:ro`

## 📦 Configuration dans docker-compose

### Production (`docker-compose.yml`)
```yaml
environment:
  HOST_ROOT_PATH: ${HOST_ROOT_PATH:-/host}

volumes:
  - /:/host:ro                    # ✅ Monté - Détection OS host fonctionne
  - /proc:/host/proc:ro
  - /sys:/host/sys:ro
  - /var/log:/host/logs:ro
```
**Résultat** : Détection OS du host ✅

### Développement (`docker-compose.dev.yml`)
```yaml
environment:
  HOST_ROOT_PATH: ${HOST_ROOT_PATH:-/host}

volumes:
  # - /:/host:ro                  # ❌ Commenté - Problèmes de permissions
  - /proc:/host/proc:ro
  - /sys:/host/sys:ro
  - /var/log:/host/logs:ro
```
**Résultat** : Détection OS du conteneur (Alpine) ⚠️

### Local (`docker-compose.local.yml`)
```yaml
environment:
  HOST_ROOT_PATH: ${HOST_ROOT_PATH:-/host}

volumes:
  - /:/host:ro                    # ✅ Monté - Détection OS host fonctionne
  - /proc:/host/proc:ro
  - /sys:/host/sys:ro
  - /var/log:/host/logs:ro
```
**Résultat** : Détection OS du host ✅

## ❓ Faut-il garder HOST_ROOT_PATH ?

### ✅ OUI, garder la variable

**Raisons** :
1. **Production** : Le montage `/:/host:ro` est présent → La détection OS du host fonctionne
2. **Code existant** : Le code utilise `HOST_ROOT_PATH` dans plusieurs endroits
3. **Flexibilité** : Permet de changer le chemin si nécessaire
4. **Métriques système** : Utilisé pour lire les métriques du host

### ⚠️ Impact si on retire HOST_ROOT_PATH

Si on retire la variable d'environnement :
- Le code utilisera la valeur par défaut `/host`
- Si `/:/host:ro` n'est pas monté → La détection OS utilisera `/etc/os-release` du conteneur (Alpine)
- Les métriques système ne fonctionneront pas correctement

## 🔧 Recommandation

**Garder `HOST_ROOT_PATH` dans tous les docker-compose** car :
- ✅ Nécessaire pour la détection OS en production
- ✅ Utilisé pour les métriques système
- ✅ Valeur par défaut `/host` fonctionne si le montage est présent
- ✅ Pas de problème si le montage n'est pas présent (fallback vers `/etc/os-release` du conteneur)

## 📝 Note sur docker-compose.dev.yml

Dans `docker-compose.dev.yml`, le montage `/:/host:ro` est commenté pour éviter les problèmes de permissions. Dans ce cas :
- La détection OS utilisera `/etc/os-release` du conteneur Alpine
- C'est acceptable pour le développement
- Pour tester la détection OS du host, décommentez `/:/host:ro`
