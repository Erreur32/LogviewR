# Guide de test Docker local (simulation production)

Ce guide explique comment tester la configuration Docker localement pour simuler l'environnement de production avant de déployer.

## 🎯 Objectif

Vérifier que :
- Les logs de l'hôte sont accessibles depuis le conteneur
- Les chemins Docker sont correctement convertis
- Les plugins peuvent lire les fichiers de logs
- La configuration est identique à la production

## 📋 Prérequis

1. Docker et Docker Compose installés
2. Accès en lecture à `/var/log` sur l'hôte
3. Le projet cloné localement

## 🚀 Étapes de test

### 1. Préparer l'environnement

```bash
# Aller dans le répertoire du projet
cd /chemin/vers/LogviewR

# Créer le fichier .env si nécessaire
if [ ! -f .env ]; then
    echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
    echo "DASHBOARD_PORT=7501" >> .env
    echo "HOST_ROOT_PATH=/host" >> .env
fi
```

### 2. Construire et démarrer le conteneur local

```bash
# Construire l'image localement
docker-compose -f docker-compose.local.yml build

# Démarrer le conteneur
docker-compose -f docker-compose.local.yml up -d

# Vérifier que le conteneur est démarré
docker ps | grep logviewr-local
```

### 3. Exécuter les tests d'accès aux logs

```bash
# Exécuter le script de test
./scripts/test-local-docker.sh
```

Ce script vérifie :
- ✅ Accès à `/host/var/log`
- ✅ Existence du symlink `/host/logs` (optionnel)
- ✅ Lecture des fichiers de logs communs
- ✅ Accès aux logs Apache/Nginx
- ✅ Variables d'environnement
- ✅ Conversion des chemins Docker

### 4. Tests manuels supplémentaires

#### Vérifier l'accès aux logs depuis le conteneur

```bash
# Lister les fichiers dans /host/var/log
docker exec logviewr-local ls -la /host/var/log

# Vérifier le symlink (s'il existe)
docker exec logviewr-local ls -la /host/logs

# Tester la lecture d'un fichier de log
docker exec logviewr-local head -n 5 /host/var/log/syslog

# Vérifier les logs Apache (si présents)
docker exec logviewr-local ls -la /host/var/log/apache2
```

#### Tester la conversion des chemins

```bash
# Tester la conversion des chemins dans Node.js
docker exec logviewr-local node -e "
const fs = require('fs');
const HOST_ROOT_PATH = process.env.HOST_ROOT_PATH || '/host';

function isDocker() {
    try { fs.accessSync('/.dockerenv'); return true; } catch { return false; }
}

function convertToDockerPath(filePath) {
    if (!isDocker()) return filePath;
    const DOCKER_LOG_PATH = '/host/logs';
    const STANDARD_LOG_PATH = '/var/log';
    if (filePath.startsWith(STANDARD_LOG_PATH)) {
        if (fs.existsSync(DOCKER_LOG_PATH)) {
            return filePath.replace(STANDARD_LOG_PATH, DOCKER_LOG_PATH);
        } else {
            return filePath.replace(STANDARD_LOG_PATH, \`\${HOST_ROOT_PATH}/var/log\`);
        }
    }
    return filePath;
}

const testPaths = ['/var/log', '/var/log/apache2', '/var/log/syslog'];
testPaths.forEach(p => {
    const converted = convertToDockerPath(p);
    const exists = fs.existsSync(converted);
    console.log(\`\${p} -> \${converted} (\${exists ? 'OK' : 'MISSING'})\`);
});
"
```

#### Vérifier les logs du conteneur

```bash
# Voir les logs du conteneur
docker logs logviewr-local

# Suivre les logs en temps réel
docker logs -f logviewr-local
```

### 5. Tester l'application web

```bash
# Ouvrir l'application dans le navigateur
# URL: http://localhost:7501 (ou le port configuré dans DASHBOARD_PORT)

# Tester la connexion au plugin host-system
# 1. Aller dans "Plugins" > "Host System"
# 2. Cliquer sur "Options"
# 3. Vérifier que le chemin de base est détecté
# 4. Cliquer sur "Tester la connexion"
# 5. Vérifier qu'il n'y a pas d'erreur "Connection failed"
```

### 6. Vérifier la configuration Docker Compose

Comparer `docker-compose.local.yml` avec `docker-compose.yml` pour s'assurer que :
- Les volumes sont identiques (sauf le nom du volume de données)
- Les variables d'environnement sont cohérentes
- Les ports sont différents (7501 pour local, 7500 pour prod)

## 🔍 Dépannage

### Problème : "Connection failed" dans les options du plugin

**Causes possibles :**
1. Le conteneur n'a pas accès à `/host/var/log`
2. Les permissions sont incorrectes
3. Le symlink `/host/logs` n'existe pas et le fallback ne fonctionne pas

**Solutions :**

```bash
# Vérifier que /host/var/log est accessible
docker exec logviewr-local test -d /host/var/log && echo "OK" || echo "FAIL"

# Vérifier les permissions
docker exec logviewr-local ls -ld /host/var/log

# Créer manuellement le symlink si nécessaire (en tant que root)
docker exec -u root logviewr-local ln -s /host/var/log /host/logs

# Vérifier que le code utilise le bon chemin
docker exec logviewr-local node -e "
const fs = require('fs');
const paths = ['/host/logs', '/host/var/log'];
paths.forEach(p => console.log(p + ':', fs.existsSync(p) ? 'exists' : 'missing'));
"
```

### Problème : Les logs ne s'affichent pas

**Vérifications :**

```bash
# Vérifier que les fichiers de logs existent
docker exec logviewr-local ls -la /host/var/log/syslog
docker exec logviewr-local ls -la /host/var/log/auth.log

# Vérifier que le plugin peut les lire
docker exec logviewr-local node -e "
const fs = require('fs');
try {
    const content = fs.readFileSync('/host/var/log/syslog', 'utf8');
    console.log('OK: Can read syslog, first 100 chars:', content.substring(0, 100));
} catch (e) {
    console.log('ERROR:', e.message);
}
"
```

### Problème : Le symlink `/host/logs` n'est pas créé

**Cause :** Le système de fichiers `/host` est en lecture seule, donc le symlink ne peut pas être créé.

**Solution :** C'est normal ! Le code utilise automatiquement `/host/var/log` comme fallback. Vérifiez que le fallback fonctionne :

```bash
# Vérifier que le code détecte correctement le chemin
docker exec logviewr-local node -e "
const fs = require('fs');
const HOST_ROOT_PATH = '/host';
const DOCKER_LOG_PATH = '/host/logs';
const directPath = \`\${HOST_ROOT_PATH}/var/log\`;

if (fs.existsSync(DOCKER_LOG_PATH)) {
    console.log('Using symlink:', DOCKER_LOG_PATH);
} else if (fs.existsSync(directPath)) {
    console.log('Using direct path (fallback):', directPath);
} else {
    console.log('ERROR: No log path available');
}
"
```

## ✅ Checklist de validation

Avant de déployer en production, vérifier :

- [ ] Le conteneur démarre sans erreur
- [ ] `/host/var/log` est accessible depuis le conteneur
- [ ] Les fichiers de logs peuvent être lus (syslog, auth.log, etc.)
- [ ] Le plugin host-system peut se connecter (test dans l'UI)
- [ ] Les logs Apache/Nginx sont accessibles (si présents)
- [ ] Les variables d'environnement sont correctes (JWT_SECRET, HOST_ROOT_PATH)
- [ ] Le script de test passe tous les tests
- [ ] L'application web fonctionne correctement
- [ ] Aucune erreur dans les logs du conteneur

## 📝 Notes importantes

1. **Symlink optionnel** : Le symlink `/host/logs` est créé par `docker-entrypoint.sh`, mais s'il échoue (système de fichiers en lecture seule), le code utilise automatiquement `/host/var/log` comme fallback.

2. **Port différent** : Le port local (7501) est différent du port de production (7500) pour éviter les conflits.

3. **Variables d'environnement** : Assurez-vous que `JWT_SECRET` est défini dans le fichier `.env` pour éviter les erreurs 401.

4. **Permissions** : Le conteneur s'exécute en tant qu'utilisateur `node` (non-root), donc il ne peut que lire les fichiers de logs, pas les modifier.

## 🔗 Ressources

- [Documentation Docker Compose](https://docs.docker.com/compose/)
- [Guide de configuration Docker](./DOCKER_MOUNT_FIX.md)
- [Guide d'accès aux logs](./HOW_LOGS_ACCESS_WORKS.md)
