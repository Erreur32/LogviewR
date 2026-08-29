# Comment les logs sont accessibles dans Docker

> 🇬🇧 [Read in English](./HOW_LOGS_ACCESS_WORKS.md)

## 🔍 Explication du mécanisme

### Le montage `/:/host:ro` monte TOUT

Quand vous montez `/:/host:ro` dans docker-compose, Docker monte **tout le système de fichiers du host** dans le conteneur sous `/host`.

Cela signifie que :
- `/var/log` du host → accessible via `/host/var/log` dans le conteneur
- `/etc/os-release` du host → accessible via `/host/etc/os-release` dans le conteneur
- `/proc` du host → accessible via `/host/proc` dans le conteneur
- Etc.

### Pourquoi ne pas monter `/var/log:/host/logs:ro` séparément ?

**Problème** : Docker essaie de créer le répertoire `/host/logs` dans le système de fichiers overlay2 qui est en lecture seule lors de l'initialisation du conteneur. Cela cause l'erreur :
```
error mounting "/var/log" to rootfs at "/host/logs": read-only file system
```

**Solution** : Utiliser le symlink créé par l'entrypoint au lieu d'un montage séparé.

## 🔗 Comment ça fonctionne

### 1. Montage principal (`/:/host:ro`)

```yaml
volumes:
  - /:/host:ro  # Monte TOUT le système de fichiers du host
```

**Résultat** :
- `/var/log` du host → `/host/var/log` dans le conteneur ✅
- Tous les fichiers de logs sont accessibles via `/host/var/log/...`

### 2. Symlink créé par l'entrypoint

Le fichier `docker-entrypoint.sh` crée automatiquement un symlink :

```bash
# Créer symlink /host/logs -> /host/var/log pour compatibilité
if [ -d "/host/var/log" ] && [ ! -e "/host/logs" ]; then
    ln -s /host/var/log /host/logs
fi
```

**Résultat** :
- `/host/logs` → pointe vers `/host/var/log` ✅
- Le plugin peut utiliser `/host/logs` comme prévu ✅

### 3. Le plugin utilise `/host/logs`

Dans `HostSystemLogPlugin.ts` :

```typescript
private readonly DOCKER_LOG_PATH = '/host/logs';
private readonly STANDARD_LOG_PATH = '/var/log';

private getLogBasePath(): string {
    if (this.isDocker()) {
        // Vérifie si /host/logs existe (symlink créé par entrypoint)
        if (fsSync.existsSync(this.DOCKER_LOG_PATH)) {
            return this.DOCKER_LOG_PATH;  // Retourne /host/logs
        }
    }
    // Fallback vers /var/log si pas en Docker
    return this.STANDARD_LOG_PATH;
}
```

**Résultat** :
- Le plugin trouve `/host/logs` (via le symlink) ✅
- `/host/logs` pointe vers `/host/var/log` ✅
- `/host/var/log` contient les vrais logs du host ✅
- **Les logs sont accessibles !** ✅

## 📋 Exemple concret

### Fichier de log sur le host
```
/var/log/syslog  (sur le host)
```

### Accessible dans le conteneur via
```
/host/var/log/syslog  (montage direct via /:/host:ro)
/host/logs/syslog     (via symlink /host/logs -> /host/var/log)
```

### Le plugin convertit automatiquement
```typescript
// Le plugin reçoit : /var/log/syslog
// Il convertit en : /host/logs/syslog
// Qui pointe vers : /host/var/log/syslog
// Qui est le vrai fichier du host ✅
```

## ✅ Avantages de cette approche

1. **Pas d'erreur de montage** : Pas besoin de créer `/host/logs` dans overlay2
2. **Tous les logs accessibles** : Le montage `/:/host:ro` donne accès à tout
3. **Compatibilité** : Le plugin utilise toujours `/host/logs` comme prévu
4. **Simplicité** : Un seul montage principal au lieu de plusieurs montages séparés

## 🔍 Vérification

Pour vérifier que ça fonctionne dans le conteneur :

```bash
# Entrer dans le conteneur
docker exec -it logviewr sh

# Vérifier que /host/var/log existe (montage principal)
ls -la /host/var/log

# Vérifier que /host/logs est un symlink
ls -la /host/logs

# Vérifier que le symlink pointe vers /host/var/log
readlink /host/logs
# Devrait afficher : /host/var/log

# Vérifier qu'on peut lire les logs
cat /host/logs/syslog | head -5
```

## 📝 Résumé

**Question** : Comment lire les logs si on ne monte pas `/var/log:/host/logs:ro` ?

**Réponse** :
1. Le montage `/:/host:ro` monte déjà `/var/log` du host → accessible via `/host/var/log`
2. L'entrypoint crée un symlink `/host/logs -> /host/var/log`
3. Le plugin utilise `/host/logs` qui pointe vers les vrais logs du host
4. **Tous les logs sont accessibles sans montage séparé !**
