# Correction des permissions pour les fichiers de logs

> 🇬🇧 [Read in English](./FIX_LOG_PERMISSIONS.md)

## 🐛 Problème

Les fichiers de logs système (auth.log, cron.log, daemon.log, etc.) appartiennent à `root:adm` avec des permissions `640` (rw-r-----), ce qui signifie que seul le propriétaire (root) et le groupe (adm) peuvent les lire.

Le conteneur Docker s'exécute avec l'utilisateur `node` (non-root) qui n'est pas dans le groupe `adm`, donc il ne peut pas lire ces fichiers.

## ✅ Solutions

### Solution 1 : Ajouter l'utilisateur node au groupe adm (Recommandé)

Modifier le `docker-entrypoint.sh` pour ajouter l'utilisateur `node` au groupe `adm` :

```bash
# Dans docker-entrypoint.sh, avant de switcher vers node
# Ajouter node au groupe adm (GID 4 sur Debian/Ubuntu)
if getent group adm > /dev/null 2>&1; then
    # Si le groupe adm existe dans le conteneur, ajouter node
    addgroup -g 4 adm 2>/dev/null || true
    addgroup node adm 2>/dev/null || true
else
    # Sinon, créer le groupe adm avec le GID standard (4)
    addgroup -g 4 adm 2>/dev/null || true
    addgroup node adm 2>/dev/null || true
fi
```

**Limitation** : Cette solution ne fonctionne que si le GID du groupe `adm` sur l'hôte correspond au GID dans le conteneur.

### Solution 2 : Utiliser le GID du groupe adm de l'hôte (Meilleure solution)

Modifier `docker-compose.yml` pour mapper le GID du groupe `adm` de l'hôte :

```yaml
services:
  logviewr:
    # ... autres configurations ...
    user: "${UID:-1000}:${ADM_GID:-4}"  # UID de node : GID de adm
    group_add:
      - "${ADM_GID:-4}"  # Ajouter le groupe adm
```

Puis dans `.env` :
```bash
# Récupérer le GID du groupe adm sur l'hôte
ADM_GID=$(getent group adm | cut -d: -f3)
echo "ADM_GID=$ADM_GID" >> .env
```

**Note** : Cette solution nécessite de modifier le `user` du conteneur, ce qui peut causer des problèmes avec les permissions de `/app/data`.

### Solution 3 : Modifier les permissions sur l'hôte (Non recommandé)

Modifier les permissions des fichiers de logs sur l'hôte pour les rendre lisibles par tous :

```bash
# ⚠️ NON RECOMMANDÉ pour la sécurité
sudo chmod 644 /var/log/auth.log
sudo chmod 644 /var/log/cron.log
# etc.
```

**Problème** : Cela réduit la sécurité du système.

### Solution 4 : Exécuter le conteneur en root (Non recommandé)

Modifier `docker-compose.yml` pour exécuter le conteneur en root :

```yaml
services:
  logviewr:
    # ... autres configurations ...
    user: "root:root"  # ⚠️ NON RECOMMANDÉ
```

**Problème** : Cela réduit la sécurité du conteneur.

## 🎯 Solution recommandée : Mapper le groupe adm

La meilleure solution est de mapper le GID du groupe `adm` de l'hôte dans le conteneur et d'ajouter l'utilisateur `node` à ce groupe.

### Étapes d'implémentation

1. **Modifier `docker-entrypoint.sh`** pour ajouter node au groupe adm
2. **Modifier `docker-compose.yml`** pour mapper le groupe adm
3. **Créer un script** pour récupérer le GID de adm sur l'hôte
